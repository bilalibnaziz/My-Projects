import React, { useRef, useState } from 'react';
import { Download, X, Film, CheckCircle, Loader2, Camera } from 'lucide-react';
import { fxStore, EffectsScaleState, RESOLUTION_PRESETS } from '../store';
import { renderCompositionFrame } from '../compositor';
import { audioEngine } from '../audioEngine';
import { mediaSettled, pauseAllMedia, syncMedia } from '../media';
import { pickExportFormat, renderOffline } from '../offlineRender';

// Best container the browser can record: MP4 (Safari / macOS app, recent Chrome) or WebM
function pickRecorderFormat(): { mimeType: string; ext: string } {
  const candidates = [
    { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? { mimeType: '', ext: 'webm' };
}

interface DeliverExportModalProps {
  state: EffectsScaleState;
  onClose: () => void;
}

export const DeliverExportModal: React.FC<DeliverExportModalProps> = ({ state, onClose }) => {
  const [format, setFormat] = useState<'video' | 'snapshot'>('video');
  const cancelRef = useRef(false);
  const [fps, setFps] = useState(state.fps);
  const [resolution, setResolution] = useState(state.resolution);
  const [range, setRange] = useState<'entire' | 'in-out'>('entire');

  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [renderStatus, setRenderStatus] = useState('');
  const [finishedBlobUrl, setFinishedBlobUrl] = useState<string | null>(null);

  // Take Instant High-Res Frame Snapshot PNG
  const handleSnapshotPNG = () => {
    const canvas = document.createElement('canvas');
    canvas.width = resolution.width;
    canvas.height = resolution.height;
    const ctx = canvas.getContext('2d')!;

    renderCompositionFrame(
      ctx,
      canvas.width,
      canvas.height,
      state.tracks,
      state.clips,
      state.currentTime,
      null,
      false
    );

    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${state.projectName.replace(/\s+/g, '_')}_Frame_${state.currentTime.toFixed(2)}s.png`;
    a.click();
    onClose();
  };

  const deliver = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    setFinishedBlobUrl(url);
    setProgress(100);
    setRenderStatus('Render complete!');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.projectName.replace(/\s+/g, '_')}_Master.${ext}`;
    a.click();
  };

  // Video export: renders every frame offline with WebCodecs when the browser can encode, otherwise
  // records the sequence in real time.
  const handleStartRender = async () => {
    if (format === 'snapshot') {
      handleSnapshotPNG();
      return;
    }

    fxStore.pause();
    cancelRef.current = false;
    setFinishedBlobUrl(null);
    setIsRendering(true);
    setProgress(0);
    setRenderStatus('Preparing media…');

    const start = range === 'in-out' && state.inPoint !== null ? state.inPoint : 0;
    const end = range === 'in-out' && state.outPoint !== null ? state.outPoint : state.duration;
    const offline = await pickExportFormat(resolution.width, resolution.height, fps).catch(() => null);
    if (offline) {
      try {
        const t0 = performance.now();
        const blob = await renderOffline({
          width: resolution.width,
          height: resolution.height,
          fps,
          start,
          end,
          tracks: state.tracks,
          clips: state.clips,
          master: state.masterVolume,
          format: offline,
          isCancelled: () => cancelRef.current,
          onProgress: (n, total) => {
            setProgress(Math.min(99, Math.floor((n / total) * 100)));
            const speed = n / fps / ((performance.now() - t0) / 1000);
            setRenderStatus(`Rendering frame ${n} / ${total} · ${speed.toFixed(1)}× real time`);
          },
        });
        setIsRendering(false);
        if (!blob) {
          setProgress(0);
          setRenderStatus('');
          return;
        }
        deliver(blob, offline.container);
        return;
      } catch (err) {
        console.warn('Offline export failed, recording in real time instead', err);
        setRenderStatus('Preparing media…');
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = resolution.width;
    canvas.height = resolution.height;
    const ctx = canvas.getContext('2d')!;

    const startTime = range === 'in-out' && state.inPoint !== null ? state.inPoint : 0;
    const endTime = range === 'in-out' && state.outPoint !== null ? state.outPoint : state.duration;
    const duration = Math.max(0.5, endTime - startTime);

    // Cue every source on the first frame before the clock starts
    syncMedia(state.tracks, state.clips, startTime, false, fps);
    await mediaSettled();
    renderCompositionFrame(ctx, canvas.width, canvas.height, state.tracks, state.clips, startTime, null, false);

    const stream = canvas.captureStream(fps);
    const audio = audioEngine.startCapture();
    audio?.getAudioTracks().forEach((t) => stream.addTrack(t));

    const { mimeType, ext } = pickRecorderFormat();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: resolution.width >= 3000 ? 40_000_000 : 16_000_000,
      audioBitsPerSecond: 256_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));
    recorder.start(250);

    // Fallback recorder: it captures what plays, so footage must be playing (paused media records no
    // sound) and the clock must be wall time.
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const step = () => {
        const t = startTime + (performance.now() - t0) / 1000;
        if (cancelRef.current || t >= endTime) {
          done();
          return;
        }
        syncMedia(state.tracks, state.clips, t, true, fps);
        const beatTrack = fxStore.generatedAudioTrackAt(t);
        if (beatTrack) audioEngine.playTimelineAudioClock(t, true, beatTrack);
        renderCompositionFrame(ctx, canvas.width, canvas.height, state.tracks, state.clips, t, null, false);
        setProgress(Math.min(99, Math.floor(((t - startTime) / duration) * 100)));
        setRenderStatus(`Recording ${(t - startTime).toFixed(1)}s / ${duration.toFixed(1)}s (real time, keep this window open)`);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    recorder.stop();
    await stopped;
    pauseAllMedia();
    audioEngine.stopCapture();
    stream.getTracks().forEach((t) => t.stop());
    setIsRendering(false);

    if (cancelRef.current) {
      setProgress(0);
      setRenderStatus('');
      return;
    }

    deliver(new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' }), ext);
  };

  return (
    <div className="fx-modal-backdrop" onClick={() => !isRendering && onClose()}>
      <div className="fx-modal-window" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="fx-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={18} style={{ color: '#4daafc' }} />
            <span>Deliver & Export Studio</span>
          </div>
          <button className="fx-track-icon-btn" onClick={onClose} disabled={isRendering}>
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="fx-modal-body">
          {/* Export Format Selector */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#9d9d9d', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Export Format
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                className={`fx-chip-btn ${format === 'video' ? 'active' : ''}`}
                onClick={() => setFormat('video')}
                style={{ padding: '10px', justifyContent: 'flex-start' }}
              >
                <Film size={16} style={{ color: '#4daafc' }} />
                <div>
                  <div style={{ fontWeight: 600, color: '#cccccc' }}>Master Video ({pickRecorderFormat().ext.toUpperCase()})</div>
                  <div style={{ fontSize: '9px', color: '#6e7681' }}>Picture + full audio mix, high bit-rate</div>
                </div>
              </button>
              <button
                className={`fx-chip-btn ${format === 'snapshot' ? 'active' : ''}`}
                onClick={() => setFormat('snapshot')}
                style={{ padding: '10px', justifyContent: 'flex-start' }}
              >
                <Camera size={16} style={{ color: '#ec4899' }} />
                <div>
                  <div style={{ fontWeight: 600, color: '#cccccc' }}>Frame Snapshot (PNG)</div>
                  <div style={{ fontSize: '9px', color: '#6e7681' }}>High-res still frame snapshot</div>
                </div>
              </button>
            </div>
          </div>

          {/* Resolution Presets */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#9d9d9d', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Resolution & Aspect Ratio
            </label>
            <select
              value={resolution.name}
              onChange={(e) => {
                const found = RESOLUTION_PRESETS.find((p) => p.name === e.target.value);
                if (found) setResolution(found);
              }}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#252526',
                border: '1px solid var(--fx-border)',
                borderRadius: 6,
                color: '#ffffff',
                fontSize: '12px',
              }}
            >
              {RESOLUTION_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} · {p.width} × {p.height}
                </option>
              ))}
            </select>
          </div>

          {/* Frame Rate */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#9d9d9d', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Frame Rate
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[24, 30, 60].map((f) => (
                <button
                  key={f}
                  className={`fx-chip-btn ${fps === f ? 'active' : ''}`}
                  onClick={() => setFps(f)}
                  style={{ flex: 1, padding: '8px 0', justifyContent: 'center' }}
                >
                  {f} FPS {f === 24 ? '(Cinema)' : f === 60 ? '(High Speed)' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Range: Entire vs In/Out */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#9d9d9d', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Render Range
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className={`fx-chip-btn ${range === 'entire' ? 'active' : ''}`}
                onClick={() => setRange('entire')}
                style={{ flex: 1, padding: '8px 0', justifyContent: 'center' }}
              >
                Entire Timeline ({state.duration.toFixed(1)}s)
              </button>
              <button
                className={`fx-chip-btn ${range === 'in-out' ? 'active' : ''}`}
                onClick={() => setRange('in-out')}
                style={{ flex: 1, padding: '8px 0', justifyContent: 'center' }}
              >
                Work Area In/Out
              </button>
            </div>
          </div>

          {/* Rendering Progress Indicator */}
          {isRendering && (
            <div style={{ padding: '12px', background: '#252526', borderRadius: 8, border: '1px solid var(--fx-border-bright)', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '11px' }}>
                <span style={{ color: '#4daafc', fontWeight: 600 }}>{renderStatus}</span>
                <span style={{ color: '#ffffff', fontFamily: 'JetBrains Mono' }}>{progress}%</span>
              </div>
              <div style={{ width: '100%', height: '6px', background: '#181818', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: '#0078d4',
                    transition: 'width 0.1s ease',
                  }}
                />
              </div>
            </div>
          )}

          {finishedBlobUrl && (
            <div style={{ padding: '10px', background: 'rgba(16,185,129,0.15)', border: '1px solid #2ea043', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, color: '#2ea043' }}>
              <CheckCircle size={16} />
              <span>Video successfully rendered and downloaded!</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="fx-modal-footer">
          <button
            className="fx-chip-btn"
            onClick={() => {
              if (isRendering) cancelRef.current = true;
              else onClose();
            }}
          >
            {isRendering ? 'Stop Render' : 'Cancel'}
          </button>
          <button
            className="fx-export-btn"
            onClick={handleStartRender}
            disabled={isRendering}
            style={{ minWidth: '150px', justifyContent: 'center' }}
          >
            {isRendering ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Rendering...
              </>
            ) : format === 'snapshot' ? (
              <>
                <Camera size={14} /> Download Snapshot
              </>
            ) : (
              <>
                <Download size={14} /> Start Render & Export
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
