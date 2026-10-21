import React, { useRef, useEffect, useState, useCallback } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  ChevronLeft, 
  ChevronRight, 
  Repeat, 
  Maximize, 
  Crosshair, 
  Volume2, 
  VolumeX 
} from 'lucide-react';
import { fxStore, EffectsScaleState } from '../store';
import { renderCompositionFrame } from '../compositor';
import { audioEngine } from '../audioEngine';
import { onMediaFrame, syncMedia } from '../media';
import { GRID_PRESETS, autoGridSpecs, materialize, presetGrid } from '../grids';
import { drawLayoutGrids } from './gridDraw';

/** Monitor guide presets: video and social framing (never rendered into exports). */
const GUIDE_PRESETS = GRID_PRESETS.filter((p) => p.category === 'Video' || p.category === 'Composition' || ['social-reel', 'social-story', 'social-portrait', 'social-thumb', 'social-square'].includes(p.id));
const GUIDE_KEY = 'skillmotion.guides';

function loadGuide(): string {
  try {
    return localStorage.getItem(GUIDE_KEY) ?? 'off';
  } catch {
    return 'off';
  }
}

interface ProgramMonitorProps {
  state: EffectsScaleState;
}

// Converts seconds to SMPTE Timecode: HH:MM:SS:FF
export function formatTimecode(seconds: number, fps: number = 30): string {
  const totalFrames = Math.max(0, Math.floor(seconds * fps));
  const f = totalFrames % fps;
  const totalSeconds = Math.floor(seconds);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

export const ProgramMonitor: React.FC<ProgramMonitorProps> = ({ state }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoomMode, setZoomMode] = useState<'fit' | '100%' | '50%'>('fit');
  const [splitWipe, setSplitWipe] = useState(false);
  // Framing guides over the monitor: 'off', 'auto' (picked from the frame size) or a preset id
  const [guide, setGuide] = useState(loadGuide);
  const chooseGuide = (g: string) => {
    setGuide(g);
    try {
      localStorage.setItem(GUIDE_KEY, g);
    } catch {
      /* storage unavailable */
    }
  };
  const [vuLevels, setVuLevels] = useState({ leftDb: -60, rightDb: -60, leftRms: 0, rightRms: 0 });
  // Bumped when a video seek lands or an image loads, so the paused frame redraws
  const [frameTick, setFrameTick] = useState(0);
  useEffect(() => onMediaFrame(() => setFrameTick((n) => n + 1)), []);

  // Keep real footage and audio at the playhead
  useEffect(() => {
    syncMedia(state.tracks, state.clips, state.currentTime, state.isPlaying, state.fps);
  }, [state.tracks, state.clips, state.currentTime, state.isPlaying, state.fps]);

  // Render loop whenever state or time changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderCompositionFrame(
      ctx,
      canvas.width,
      canvas.height,
      state.tracks,
      state.clips,
      state.currentTime,
      state.selectedClipId,
      state.showSafeGuides
    );

    if (guide !== 'off') {
      const W = canvas.width;
      const H = canvas.height;
      const grids = guide === 'auto' ? autoGridSpecs(W, H, 72).specs : materialize(presetGrid(guide)?.build({ w: W, h: H, dpi: 72 }) ?? []);
      // One unit = one CSS pixel on screen, so lines and labels stay thin and readable at any size
      const k = W / Math.max(1, canvas.getBoundingClientRect().width || W);
      ctx.save();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      drawLayoutGrids(ctx, [{ box: { x: 0, y: 0, w: W, h: H }, grids }], { zoom: 1 / k, panX: 0, panY: 0, w: W / k, h: H / k });
      ctx.restore();
    }

    if (splitWipe) {
      const midX = Math.round(canvas.width / 2);
      ctx.save();
      ctx.strokeStyle = '#4daafc';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = 'bold 13px Inter, -apple-system, sans-serif';
      // Left badge: RAW
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(midX - 110, 20, 100, 26);
      ctx.fillStyle = '#9d9d9d';
      ctx.textAlign = 'center';
      ctx.fillText('RAW CLIP', midX - 60, 38);

      // Right badge: ACTIVE GRADE
      ctx.fillStyle = 'rgba(0, 120, 212, 0.85)';
      ctx.fillRect(midX + 10, 20, 110, 26);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText('ACTIVE GRADE', midX + 65, 38);
      ctx.restore();
    }
  }, [
    state.currentTime,
    state.tracks,
    state.clips,
    state.selectedClipId,
    state.showSafeGuides,
    state.resolution,
    frameTick,
    splitWipe,
    guide,
    zoomMode,
  ]);

  // Audio VU Meter Polling Loop (while playing or active)
  useEffect(() => {
    let animId: number;
    const poll = () => {
      const levels = audioEngine.getVUMeterLevels();
      setVuLevels(levels);
      animId = requestAnimationFrame(poll);
    };
    animId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Canvas Mouse Interactions for Gizmo Dragging
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!state.selectedClipId) return;
    fxStore.beginGesture();
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  }, [state.selectedClipId]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current || !state.selectedClipId) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    dragStartRef.current = { x: e.clientX, y: e.clientY };

    // Screen pixels → composition pixels, so the clip follows the cursor at any monitor size
    const canvas = canvasRef.current;
    const k = canvas ? canvas.width / canvas.getBoundingClientRect().width : 1;
    const clip = state.clips.find((c) => c.id === state.selectedClipId);
    if (clip) {
      fxStore.updateTransform(state.selectedClipId, {
        positionX: clip.transform.positionX + dx * k,
        positionY: clip.transform.positionY + dy * k,
      });
    }
  }, [state.selectedClipId, state.clips]);

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) fxStore.commitGesture();
    isDraggingRef.current = false;
  }, []);

  return (
    <div className="fx-monitor-stage">
      {/* Monitor Header Controls */}
      <div className="fx-monitor-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#4daafc' }}>
            PROGRAM MONITOR
          </span>
          <span style={{ fontSize: '10px', color: '#6e7681' }}>
            {state.resolution.width} × {state.resolution.height} ({state.fps}fps)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Safe Guides Toggle */}
          <button
            className={`fx-chip-btn ${state.showSafeGuides ? 'active' : ''}`}
            onClick={() => fxStore.toggleSafeGuides()}
            title="Toggle Safe Margins & Guides"
            style={{ color: state.showSafeGuides ? '#4daafc' : '#6e7681' }}
          >
            <Crosshair size={13} />
            Safe Guides
          </button>

          {/* Framing guides */}
          <select
            value={guide}
            onChange={(e) => chooseGuide(e.target.value)}
            className="fx-chip-btn fx-guides-select"
            title="Framing guides over the monitor (never rendered into exports)"
            style={{ background: '#1f1f1f', border: '1px solid rgba(255,255,255,0.1)', color: guide === 'off' ? '#6e7681' : '#4daafc' }}
          >
            <option value="off">Guides: off</option>
            <option value="auto">Guides: auto for {state.resolution.width}×{state.resolution.height}</option>
            {GUIDE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          {/* Split Wipe Comparison */}
          <button
            className={`fx-chip-btn ${splitWipe ? 'active' : ''}`}
            onClick={() => setSplitWipe(!splitWipe)}
            style={{
              background: splitWipe ? 'rgba(0, 120, 212, 0.25)' : '#1f1f1f',
              borderColor: splitWipe ? '#4daafc' : 'rgba(255, 255, 255, 0.1)',
              color: splitWipe ? '#4daafc' : '#9ca3af',
              fontWeight: splitWipe ? 600 : 400,
            }}
            title="Split-Screen Comparison Wipe: Compare raw original footage with active color grade"
          >
            Split Wipe
          </button>

          {/* Zoom Selector */}
          <select
            value={zoomMode}
            onChange={(e) => setZoomMode(e.target.value as any)}
            className="fx-chip-btn"
            style={{ background: '#1f1f1f', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <option value="fit">Fit</option>
            <option value="100%">100%</option>
            <option value="50%">50%</option>
          </select>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div className="fx-monitor-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={state.resolution.width}
          height={state.resolution.height}
          className="fx-monitor-canvas"
          style={{
            aspectRatio: `${state.resolution.width} / ${state.resolution.height}`,
            width: zoomMode === '100%' ? `${state.resolution.width}px` : zoomMode === '50%' ? `${state.resolution.width * 0.5}px` : 'auto',
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />

        {/* Real-time Stereo dB VU Peak Meter on Right Edge */}
        <div className="fx-monitor-vu-meter" title="Master level, RMS (−60 to 0 dBFS)">
          <div className="fx-vu-bar-col">
            <span style={{ fontSize: '8px', color: '#9d9d9d', fontWeight: 700 }}>L</span>
            <div className="fx-vu-channel-bar">
              <div
                className="fx-vu-channel-fill"
                style={{ height: `${Math.min(100, Math.max(0, vuLevels.leftRms * 100))}%` }}
              />
            </div>
          </div>
          <div className="fx-vu-bar-col">
            <span style={{ fontSize: '8px', color: '#9d9d9d', fontWeight: 700 }}>R</span>
            <div className="fx-vu-channel-bar">
              <div
                className="fx-vu-channel-fill"
                style={{ height: `${Math.min(100, Math.max(0, vuLevels.rightRms * 100))}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Transport Controls Bar */}
      <div className="fx-transport-bar">
        {/* Left: Timecode Display */}
        <div className="fx-timecode-display">
          <span className="fx-timecode-current">
            {formatTimecode(state.currentTime, state.fps)}
          </span>
          <span className="fx-timecode-total">
            / {formatTimecode(state.duration, state.fps)}
          </span>
        </div>

        {/* Center: Playback Transport Buttons */}
        <div className="fx-transport-center">
          <button
            className="fx-btn-transport"
            onClick={() => fxStore.jumpToStart()}
            title="Go to Beginning / In Point (I)"
          >
            <SkipBack size={15} />
          </button>
          <button
            className="fx-btn-transport"
            onClick={() => fxStore.stepFrames(-1)}
            title="Step 1 Frame Back (J / Left Arrow)"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="fx-btn-transport play"
            onClick={() => fxStore.togglePlay()}
            title="Play / Pause (Space)"
          >
            {state.isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: 2 }} />}
          </button>
          <button
            className="fx-btn-transport"
            onClick={() => fxStore.stepFrames(1)}
            title="Step 1 Frame Forward (L / Right Arrow)"
          >
            <ChevronRight size={16} />
          </button>
          <button
            className="fx-btn-transport"
            onClick={() => fxStore.jumpToEnd()}
            title="Go to End / Out Point (O)"
          >
            <SkipForward size={15} />
          </button>
          <button
            className={`fx-btn-transport ${state.isLooping ? 'active' : ''}`}
            onClick={() => fxStore.toggleLoop()}
            title="Toggle Loop Playback"
          >
            <Repeat size={14} />
          </button>
        </div>

        {/* Right: In / Out Mark Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button className="fx-chip-btn" onClick={() => fxStore.setInPoint()} title="Mark In (I)">
            Mark In
          </button>
          <button className="fx-chip-btn" onClick={() => fxStore.setOutPoint()} title="Mark Out (O)">
            Mark Out
          </button>
          {(state.inPoint !== null || state.outPoint !== null) && (
            <button className="fx-chip-btn" onClick={() => fxStore.clearInOut()} title="Clear In/Out">
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
