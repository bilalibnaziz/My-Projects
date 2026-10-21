import React, { useRef, useState, useEffect } from 'react';
import { 
  Scissors, 
  Trash2, 
  Copy, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock, 
  Volume2, 
  VolumeX, 
  ZoomIn, 
  ZoomOut, 
  Activity, 
  MousePointer, 
  Hand,
  Bookmark,
  ListOrdered,
  Zap,
  Smartphone,
  Gauge
} from 'lucide-react';
import { fxStore, EffectsScaleState } from '../store';
import { ClipWaveform } from './ClipWaveform';
import { TimelineClip } from '../types';
import { formatTimecode } from './ProgramMonitor';
import { probeFiles } from '../media';

export const ASSET_DRAG_TYPE = 'application/x-skill-asset';

interface TimelineProps {
  state: EffectsScaleState;
}

export const Timeline: React.FC<TimelineProps> = ({ state }) => {
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [dragAction, setDragAction] = useState<'move' | 'trim-left' | 'trim-right' | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [clipInitialTiming, setClipInitialTiming] = useState<{ start: number; duration: number; offset: number; limited: boolean } | null>(null);
  const [dropTrackId, setDropTrackId] = useState<string | null>(null);
  const [showSpeedModal, setShowSpeedModal] = useState(false);

  // Keyboard shortcut Cmd+R / Ctrl+R for Speed & Duration
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        if (state.selectedClipId) {
          e.preventDefault();
          setShowSpeedModal(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.selectedClipId]);

  const pixelsPerSecond = state.zoomLevel;
  const totalTimelineWidth = Math.max(1200, state.duration * pixelsPerSecond + 300);

  // Timecode Ruler Click & Drag to Scrub
  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rulerRef.current) return;
    setIsScrubbing(true);
    const rect = rulerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const newTime = Math.max(0, Math.min(state.duration, clickX / pixelsPerSecond));
    fxStore.setCurrentTime(newTime);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isScrubbing && rulerRef.current) {
        const rect = rulerRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const newTime = Math.max(0, Math.min(state.duration, clickX / pixelsPerSecond));
        fxStore.setCurrentTime(newTime);
      }

      // Handle clip dragging (move or trim)
      if (draggingClipId && dragAction && clipInitialTiming) {
        const dx = e.clientX - dragStartX;
        const dt = dx / pixelsPerSecond;

        if (dragAction === 'move') {
          const nextStart = Math.max(0, clipInitialTiming.start + dt);
          fxStore.updateClipTiming(draggingClipId, { startTime: nextStart });

          // Vertical drag to change track
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const trackEl = el?.closest('[data-track-id]') as HTMLElement | null;
          if (trackEl) {
            const targetTrackId = trackEl.getAttribute('data-track-id');
            if (targetTrackId) {
              fxStore.moveClipToTrack(draggingClipId, targetTrackId);
            }
          }
        } else if (dragAction === 'trim-left') {
          // The left edge can't pass time zero, the source's first frame, or the right edge
          const lo = Math.max(-clipInitialTiming.start, clipInitialTiming.limited ? -clipInitialTiming.offset : -Infinity);
          const d = Math.min(Math.max(dt, lo), clipInitialTiming.duration - 0.5);
          const nextStart = clipInitialTiming.start + d;
          const nextDur = clipInitialTiming.duration - d;
          const nextOffset = Math.max(0, clipInitialTiming.offset + d);
          fxStore.updateClipTiming(draggingClipId, {
            startTime: nextStart,
            duration: nextDur,
            offset: nextOffset,
          });
        } else if (dragAction === 'trim-right') {
          const nextDur = Math.max(0.5, clipInitialTiming.duration + dt);
          fxStore.updateClipTiming(draggingClipId, { duration: nextDur });
        }
      }
    };

    const handleMouseUp = () => {
      if (isScrubbing) setIsScrubbing(false);
      if (draggingClipId) {
        fxStore.commitGesture();
        setDraggingClipId(null);
        setDragAction(null);
        setClipInitialTiming(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbing, draggingClipId, dragAction, clipInitialTiming, pixelsPerSecond, dragStartX, state.duration]);

  // Click on a clip
  const handleClipMouseDown = (
    e: React.MouseEvent,
    clip: TimelineClip,
    action: 'move' | 'trim-left' | 'trim-right'
  ) => {
    e.stopPropagation();

    // If active tool is Razor, split immediately on click!
    if (state.activeTool === 'razor') {
      fxStore.selectClip(clip.id);
      fxStore.splitClipAtPlayhead(clip.id);
      return;
    }

    fxStore.selectClip(clip.id);
    fxStore.selectTrack(clip.trackId);
    if (clip.locked || state.tracks.find((t) => t.id === clip.trackId)?.locked) return;
    fxStore.beginGesture();
    setDraggingClipId(clip.id);
    setDragAction(action);
    setDragStartX(e.clientX);
    setClipInitialTiming({
      start: clip.startTime,
      duration: clip.duration,
      offset: clip.offset,
      limited: !!clip.sourceDuration,
    });
  };

  // Bin items and files from the desktop can be dropped straight onto a track
  const handleLaneDragOver = (e: React.DragEvent, trackId: string) => {
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes(ASSET_DRAG_TYPE) && !types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dropTrackId !== trackId) setDropTrackId(trackId);
  };

  const handleLaneDrop = async (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTrackId(null);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const time = Math.max(0, (e.clientX - rect.left) / pixelsPerSecond);
    const assetId = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (assetId) {
      const asset = fxStore.getState().mediaAssets.find((a) => a.id === assetId);
      if (asset) fxStore.addAssetClip(asset, trackId, time);
      return;
    }
    const { assets } = await probeFiles(Array.from(e.dataTransfer.files));
    fxStore.importMedia(assets);
    let t = time;
    for (const a of assets) {
      fxStore.addAssetClip(a, trackId, t);
      t += a.duration;
    }
  };

  // Render Timecode Ruler Tick Marks
  const renderRulerTicks = () => {
    const ticks = [];
    const stepSeconds = pixelsPerSecond > 150 ? 0.5 : pixelsPerSecond > 60 ? 1 : 2;
    for (let t = 0; t <= state.duration + 2; t += stepSeconds) {
      const x = t * pixelsPerSecond;
      const isMajor = Math.floor(t) === t;
      ticks.push(
        <div
          key={t}
          style={{
            position: 'absolute',
            left: `${x}px`,
            bottom: 0,
            height: isMajor ? '14px' : '7px',
            width: '1px',
            background: isMajor ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)',
          }}
        >
          {isMajor && (
            <span
              style={{
                position: 'absolute',
                top: '-14px',
                left: '4px',
                fontSize: '9px',
                fontFamily: 'JetBrains Mono',
                color: '#9d9d9d',
                userSelect: 'none',
              }}
            >
              {formatTimecode(t, state.fps).slice(3)}
            </span>
          )}
        </div>
      );
    }
    return ticks;
  };

  const selectedClip = state.clips.find((c) => c.id === state.selectedClipId);

  return (
    <div className="fx-timeline-panel">
      {/* Timeline Header Toolbar */}
      <div className="fx-timeline-toolbar">
        {/* Premiere Pro Toolset */}
        <div className="fx-tools-group">
          <button
            className={`fx-tool-btn ${state.activeTool === 'select' ? 'active' : ''}`}
            onClick={() => fxStore.setActiveTool('select')}
            title="Selection Tool (V)"
          >
            <MousePointer size={14} />
          </button>
          <button
            className={`fx-tool-btn ${state.activeTool === 'razor' ? 'active' : ''}`}
            onClick={() => fxStore.setActiveTool('razor')}
            title="Razor / Split Tool (C)"
          >
            <Scissors size={14} />
          </button>
          <button
            className={`fx-tool-btn ${state.activeTool === 'hand' ? 'active' : ''}`}
            onClick={() => fxStore.setActiveTool('hand')}
            title="Hand Tool (H)"
          >
            <Hand size={14} />
          </button>

          <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

          {/* Quick Editing Actions */}
          <button
            className="fx-chip-btn"
            onClick={() => fxStore.splitClipAtPlayhead()}
            disabled={!state.selectedClipId}
            title="Split Clip at Playhead (Cmd+K)"
          >
            <Scissors size={12} /> Split
          </button>
          <button
            className="fx-chip-btn"
            onClick={() => fxStore.rippleDeleteClip()}
            disabled={!state.selectedClipId}
            title="Ripple Delete Clip"
          >
            <Trash2 size={12} /> Ripple Delete
          </button>
          <button
            className="fx-chip-btn"
            onClick={() => fxStore.duplicateClip()}
            disabled={!state.selectedClipId}
            title="Duplicate Clip (Alt+Drag / Cmd+D)"
          >
            <Copy size={12} /> Duplicate
          </button>
          <button
            className="fx-chip-btn"
            onClick={() => setShowSpeedModal(true)}
            disabled={!state.selectedClipId}
            title="Change Clip Speed & Duration (Cmd+R)"
          >
            <Gauge size={12} /> Speed…
          </button>
          <button
            className="fx-chip-btn"
            onClick={() => {
              const label = prompt('Marker Label (YouTube Chapter):', `Chapter ${state.markers?.length ? state.markers.length + 1 : 1}`);
              if (label !== null) {
                fxStore.addMarker(state.currentTime, label);
              }
            }}
            title="Add Marker / YouTube Chapter at Playhead (M)"
          >
            <Bookmark size={12} /> Add Marker
          </button>
          <button
            className="fx-chip-btn"
            onClick={() => {
              const chapters = fxStore.exportYouTubeChapters();
              navigator.clipboard?.writeText(chapters);
              alert(`Copied YouTube Chapters to clipboard:\n\n${chapters}`);
            }}
            title="Export & Copy YouTube Chapters"
          >
            <ListOrdered size={12} /> YouTube Chapters
          </button>
          <button
            className="fx-chip-btn"
            onClick={() => {
              const count = fxStore.autoDetectBeatMarkers(120);
              alert(`Generated ${count} rhythmic beat markers (Kicks & Snares) along the timeline!`);
            }}
            title="Auto-Detect Beats & Transients (Sound-to-Markers for sync cuts)"
            style={{ color: '#ec4899', borderColor: 'rgba(236, 72, 153, 0.4)' }}
          >
            <Zap size={12} /> Detect Beats
          </button>
          <button
            className="fx-chip-btn"
            onClick={() => {
              fxStore.reframeToVerticalReel(true);
            }}
            title="1-Click Convert to 9:16 Reel with Smart Ambient Blurred Backdrop"
            style={{ color: '#a855f7', borderColor: 'rgba(168, 85, 247, 0.4)' }}
          >
            <Smartphone size={12} /> 9:16 Reel Reframer
          </button>
        </div>

        {/* After Effects Curve Graph Editor Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className={`fx-chip-btn ${state.showGraphEditor ? 'active' : ''}`}
            onClick={() => fxStore.toggleGraphEditor()}
            title="Toggle After Effects Bezier Velocity Curve Graph"
            style={{ color: state.showGraphEditor ? '#4daafc' : '#9d9d9d' }}
          >
            <Activity size={13} />
            Graph Editor
          </button>

          {/* Timeline Zoom Slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ZoomOut size={12} style={{ color: '#6e7681' }} />
            <input
              type="range"
              min={30}
              max={300}
              value={state.zoomLevel}
              onChange={(e) => fxStore.setZoomLevel(Number(e.target.value))}
              style={{ width: '80px', accentColor: '#4daafc', height: '4px' }}
            />
            <ZoomIn size={12} style={{ color: '#6e7681' }} />
          </div>
        </div>
      </div>

      {/* Main Timeline Body */}
      <div className="fx-timeline-body">
        {/* Left: Track Header Controls */}
        <div className="fx-track-headers">
          {/* Header Spacer matching Ruler */}
          <div style={{ height: '26px', borderBottom: '1px solid var(--fx-border)', background: '#181818' }} />

          {state.tracks.map((track) => (
            <div
              key={track.id}
              className={`fx-track-header-item ${state.selectedTrackId === track.id ? 'selected' : ''}`}
              style={{ height: `${track.height}px` }}
              onClick={() => fxStore.selectTrack(track.id)}
            >
              <span>{track.name}</span>
              <div className="fx-track-ctrls">
                <button
                  className={`fx-track-icon-btn ${track.visible ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    fxStore.toggleTrackVisible(track.id);
                  }}
                  title="Toggle Track Visibility / Monitor"
                >
                  {track.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                <button
                  className={`fx-track-icon-btn ${track.muted ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    fxStore.toggleTrackMute(track.id);
                  }}
                  title="Mute Track"
                >
                  {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </button>
                <button
                  className={`fx-track-icon-btn ${track.locked ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    fxStore.toggleTrackLock(track.id);
                  }}
                  title="Lock Track"
                >
                  {track.locked ? <Lock size={12} /> : <Unlock size={12} />}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Right: Timeline Viewport & Ruler */}
        <div className="fx-timeline-viewport" ref={viewportRef}>
          {/* Timecode Ruler */}
          <div
            className="fx-timeline-ruler"
            ref={rulerRef}
            style={{ width: `${totalTimelineWidth}px` }}
            onMouseDown={handleRulerMouseDown}
          >
            {renderRulerTicks()}

            {/* In / Out Work Area Bracket */}
            {state.inPoint !== null && state.outPoint !== null && (
              <div
                style={{
                  position: 'absolute',
                  left: `${state.inPoint * pixelsPerSecond}px`,
                  width: `${(state.outPoint - state.inPoint) * pixelsPerSecond}px`,
                  top: 0,
                  bottom: 0,
                  background: 'rgba(0, 120, 212, 0.15)',
                  borderLeft: '2px solid #4daafc',
                  borderRight: '2px solid #4daafc',
                  pointerEvents: 'none',
                }}
              />
            )}

            {/* Markers on Ruler */}
            {state.markers?.map((marker) => {
              const left = marker.time * pixelsPerSecond;
              return (
                <div
                  key={marker.id}
                  style={{
                    position: 'absolute',
                    left: `${left}px`,
                    top: 0,
                    bottom: 0,
                    width: '12px',
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    cursor: 'pointer',
                    zIndex: 15,
                  }}
                  title={`${marker.label} (${marker.time.toFixed(2)}s)`}
                  onClick={(e) => {
                    e.stopPropagation();
                    fxStore.setCurrentTime(marker.time);
                  }}
                >
                  <div
                    style={{
                      width: '10px',
                      height: '12px',
                      backgroundColor: marker.color || '#4daafc',
                      clipPath: 'polygon(0% 0%, 100% 0%, 100% 65%, 50% 100%, 0% 65%)',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Track Lanes */}
          <div
            className="fx-timeline-lanes"
            style={{ width: `${totalTimelineWidth}px` }}
            onClick={() => fxStore.selectClip(null)}
          >
            {state.tracks.map((track) => {
              const trackClips = state.clips.filter((c) => c.trackId === track.id);
              return (
                <div
                  key={track.id}
                  data-track-id={track.id}
                  className={`fx-track-lane ${dropTrackId === track.id ? 'drop-target' : ''}`}
                  style={{ height: `${track.height}px` }}
                  onDragOver={(e) => handleLaneDragOver(e, track.id)}
                  onDragLeave={() => setDropTrackId(null)}
                  onDrop={(e) => handleLaneDrop(e, track.id)}
                >
                  {trackClips.map((clip) => {
                    const isSelected = state.selectedClipId === clip.id;
                    const left = clip.startTime * pixelsPerSecond;
                    const width = Math.max(16, clip.duration * pixelsPerSecond);

                    return (
                      <div
                        key={clip.id}
                        className={`fx-timeline-clip ${isSelected ? 'selected' : ''}`}
                        style={{
                          left: `${left}px`,
                          width: `${width}px`,
                          backgroundColor: clip.color,
                        }}
                        onMouseDown={(e) => handleClipMouseDown(e, clip, 'move')}
                      >
                        {/* Trim Left Handle */}
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: '8px',
                            cursor: 'ew-resize',
                            background: 'rgba(255,255,255,0.2)',
                            borderRadius: '4px 0 0 4px',
                          }}
                          onMouseDown={(e) => handleClipMouseDown(e, clip, 'trim-left')}
                        />

                        {/* Waveform of the clip's sound (audio files and the sound of video files) */}
                        {(clip.mediaKind === 'audio' || clip.mediaKind === 'video') && clip.sourceUrl && (
                          <ClipWaveform clip={clip} width={width} height={clip.mediaKind === 'audio' ? track.height - 4 : Math.round((track.height - 4) * 0.45)} />
                        )}

                        {/* Clip Title */}
                        <div className="fx-clip-title">{clip.name}</div>

                        {/* Keyframe Diamonds Row */}
                        <div className="fx-clip-keyframes-row">
                          {Object.entries(clip.keyframes || {}).map(([prop, kfs]) =>
                            kfs.map((kf) => (
                              <div
                                key={kf.id}
                                className="fx-keyframe-diamond"
                                style={{
                                  left: `${kf.time * pixelsPerSecond}px`,
                                }}
                                title={`Keyframe: ${prop} = ${kf.value} (${kf.easing})`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  fxStore.setCurrentTime(clip.startTime + kf.time);
                                }}
                              />
                            ))
                          )}
                        </div>

                        {/* Trim Right Handle */}
                        <div
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: 0,
                            bottom: 0,
                            width: '8px',
                            cursor: 'ew-resize',
                            background: 'rgba(255,255,255,0.2)',
                            borderRadius: '0 4px 4px 0',
                          }}
                          onMouseDown={(e) => handleClipMouseDown(e, clip, 'trim-right')}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Playhead Line */}
            <div
              className="fx-playhead-line"
              style={{ left: `${state.currentTime * pixelsPerSecond}px` }}
            >
              <div className="fx-playhead-head" />
            </div>
          </div>

          {/* After Effects Bezier Velocity Graph Editor Modal / Overlay */}
          {state.showGraphEditor && selectedClip && (
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '110px',
                background: 'rgba(24, 24, 24, 0.95)',
                borderTop: '2px solid #4daafc',
                backdropFilter: 'blur(10px)',
                zIndex: 35,
                display: 'flex',
                flexDirection: 'column',
                padding: '8px 16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#4daafc' }}>
                  BEZIER VELOCITY CURVE EDITOR · {selectedClip.name}
                </span>
                <span style={{ fontSize: '10px', color: '#9d9d9d' }}>
                  After Effects Smooth S-Curve Interpolation Active
                </span>
              </div>
              <svg width="100%" height="70" style={{ overflow: 'visible' }}>
                <defs>
                  <linearGradient id="curveGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#4daafc" />
                    <stop offset="50%" stopColor="#a855f7" />
                    <stop offset="100%" stopColor="#ec4899" />
                  </linearGradient>
                </defs>
                {/* Bezier S-Curve */}
                <path
                  d="M 50,60 C 250,60 350,15 650,15"
                  fill="none"
                  stroke="url(#curveGrad)"
                  strokeWidth="3"
                />
                <circle cx="50" cy="60" r="5" fill="#4daafc" />
                <circle cx="650" cy="15" r="5" fill="#ec4899" />
                <line x1="50" y1="60" x2="250" y2="60" stroke="#4daafc" strokeWidth="1" strokeDasharray="3 3" />
                <circle cx="250" cy="60" r="4" fill="#ffffff" />
                <line x1="650" y1="15" x2="350" y2="15" stroke="#ec4899" strokeWidth="1" strokeDasharray="3 3" />
                <circle cx="350" cy="15" r="4" fill="#ffffff" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Speed & Duration Modal (Cmd+R) */}
      {showSpeedModal && selectedClip && (
        <SpeedDurationModal
          clip={selectedClip}
          onClose={() => setShowSpeedModal(false)}
        />
      )}
    </div>
  );
};

// ================================================================ Speed & Duration Modal
function SpeedDurationModal({
  clip,
  onClose,
}: {
  clip: TimelineClip;
  onClose: () => void;
}) {
  const [speedVal, setSpeedVal] = useState<number>(Math.round((clip.speed ?? 1.0) * 100));
  const [isReversed, setIsReversed] = useState<boolean>(clip.reversed ?? false);
  const [rippleTrailing, setRippleTrailing] = useState<boolean>(true);

  const calculatedDuration = Math.max(0.1, clip.duration * ((clip.speed ?? 1.0) / (speedVal / 100)));

  const handleApply = () => {
    fxStore.setClipSpeed(clip.id, speedVal / 100, {
      ripple: rippleTrailing,
      reversed: isReversed,
    });
    onClose();
  };

  return (
    <div
      className="fx-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        className="fx-modal-card"
        style={{
          background: '#18181b',
          border: '1px solid #3f3f46',
          borderRadius: 8,
          padding: '16px 20px',
          width: 360,
          color: '#f4f4f5',
          boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Clip Speed / Duration (Cmd+R)</span>
          <span style={{ fontSize: 11, color: '#a1a1aa' }}>{clip.name}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: '#d4d4d8' }}>Speed:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="number"
                min={25}
                max={1600}
                step={5}
                value={speedVal}
                onChange={(e) => setSpeedVal(Math.max(25, Math.min(1600, Number(e.target.value))))}
                style={{
                  background: '#27272a',
                  border: '1px solid #52525b',
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: '#fff',
                  width: 80,
                  textAlign: 'right',
                  fontSize: 12,
                }}
              />
              <span style={{ fontSize: 12 }}>%</span>
            </div>
          </div>

          {/* Quick Speed Multiplier Presets */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
            {[25, 50, 100, 200, 400].map((pct) => (
              <button
                key={pct}
                className="fx-chip-btn"
                style={{
                  padding: '3px 0',
                  fontSize: 10,
                  textAlign: 'center',
                  background: speedVal === pct ? 'rgba(77, 170, 252, 0.25)' : '#27272a',
                  borderColor: speedVal === pct ? '#4daafc' : '#3f3f46',
                  color: speedVal === pct ? '#4daafc' : '#a1a1aa',
                }}
                onClick={() => setSpeedVal(pct)}
              >
                {pct === 100 ? '1x Normal' : `${pct / 100}x`}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid #27272a' }}>
            <span style={{ fontSize: 12, color: '#d4d4d8' }}>Resulting Duration:</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8' }}>{calculatedDuration.toFixed(2)}s</span>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isReversed}
              onChange={(e) => setIsReversed(e.target.checked)}
            />
            <span>Reverse Playback</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={rippleTrailing}
              onChange={(e) => setRippleTrailing(e.target.checked)}
            />
            <span>Ripple Edit (Shift trailing clips on track)</span>
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button
              className="fx-chip-btn"
              onClick={onClose}
              style={{ padding: '6px 14px' }}
            >
              Cancel
            </button>
            <button
              className="fx-chip-btn"
              onClick={handleApply}
              style={{ padding: '6px 14px', background: '#0284c7', borderColor: '#38bdf8', color: '#fff', fontWeight: 600 }}
            >
              Apply Speed
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
