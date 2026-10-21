import { 
  TimelineClip, 
  TimelineTrack, 
  WorkspaceMode, 
  ToolType, 
  ResolutionPreset, 
  Keyframe, 
  KeyframeEasing,
  VFXEffect, 
  VFXType,
  MediaAsset,
  Marker,
  TextClipData,
} from './types';
import { setKeyframe, removeKeyframeAt } from './keyframeEngine';
import { audioEngine } from './audioEngine';
import { clipMediaKind } from './media';
import { clipSpeed, keptParts, maxDurationFor, splitOffsets } from './clipTime';

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  { name: '1080p Full HD (16:9)', width: 1920, height: 1080, aspectRatio: '16:9' },
  { name: '4K Ultra HD (16:9)', width: 3840, height: 2160, aspectRatio: '16:9' },
  { name: 'TikTok / Reels / Shorts (9:16)', width: 1080, height: 1920, aspectRatio: '9:16' },
  { name: 'Square Post (1:1)', width: 1080, height: 1080, aspectRatio: '1:1' },
  { name: 'Cinema Scope (2.39:1)', width: 2560, height: 1080, aspectRatio: '21:9' },
  { name: '720p HD Ready', width: 1280, height: 720, aspectRatio: '16:9' },
];

export interface EffectsScaleState {
  projectName: string;
  workspace: WorkspaceMode;
  activeTool: ToolType;
  resolution: ResolutionPreset;
  fps: number; // 24, 30, 60
  duration: number; // In seconds
  currentTime: number; // In seconds
  isPlaying: boolean;
  isLooping: boolean;
  inPoint: number | null;
  outPoint: number | null;
  zoomLevel: number; // Pixels per second (e.g. 50 to 300)
  scrollLeft: number;

  tracks: TimelineTrack[];
  clips: TimelineClip[];
  selectedClipId: string | null;
  selectedTrackId: string | null;

  // Markers & YouTube Chapters
  markers: Marker[];

  // Keyframe Graph Editor
  showGraphEditor: boolean;
  graphProperty: string; // e.g. 'scaleX' or 'positionY'

  // Monitors
  dualMonitor: boolean; // Source + Program dual view
  showSafeGuides: boolean;

  // Media Bin
  mediaAssets: MediaAsset[];

  // Export Dialog
  isExporting: boolean;
  exportProgress: number; // 0 to 100
  exportStatusText: string;

  // Master bus fader (linear gain; 1 = 0 dB). Loudness normalize sets it.
  masterVolume: number;

  // History
  canUndo: boolean;
  canRedo: boolean;
}

// Preset Projects
export function createDefaultClips(): { tracks: TimelineTrack[]; clips: TimelineClip[] } {
  const tracks: TimelineTrack[] = [
    { id: 'v3', name: 'V3 · FX & Titles', type: 'video', visible: true, muted: false, solo: false, locked: false, volume: 1.0, pan: 0, height: 48 },
    { id: 'v2', name: 'V2 · Adjustment & Overlays', type: 'video', visible: true, muted: false, solo: false, locked: false, volume: 1.0, pan: 0, height: 48 },
    { id: 'v1', name: 'V1 · Main Footage', type: 'video', visible: true, muted: false, solo: false, locked: false, volume: 1.0, pan: 0, height: 56 },
    { id: 'a1', name: 'A1 · SFX & Foley', type: 'audio', visible: true, muted: false, solo: false, locked: false, volume: 1.0, pan: -0.2, height: 44 },
    { id: 'a2', name: 'A2 · Music Soundtrack', type: 'audio', visible: true, muted: false, solo: false, locked: false, volume: 0.9, pan: 0, height: 44 },
  ];

  const clips: TimelineClip[] = [
    // V1: Cyberpunk Footage
    {
      id: 'clip_v1_main',
      name: 'Cyberpunk Synthwave Base',
      trackId: 'v1',
      type: 'video',
      startTime: 0,
      duration: 12,
      offset: 0,
      color: '#6366f1',
      volume: 1.0,
      pan: 0,
      muted: false,
      locked: false,
      blendMode: 'source-over',
      transform: {
        positionX: 0,
        positionY: 0,
        scaleX: 100,
        scaleY: 100,
        uniformScale: true,
        rotation: 0,
        opacity: 100,
        anchorX: 0.5,
        anchorY: 0.5,
      },
      keyframes: {
        scaleX: [
          { id: 'kf1', time: 0, value: 100, easing: 'linear' },
          { id: 'kf2', time: 12, value: 115, easing: 'linear' },
        ],
      },
      vfxStack: [
        {
          id: 'vfx_lum1',
          type: 'lumetri',
          name: 'Lumetri Color (Teal & Orange)',
          enabled: true,
          params: { exposure: 0.15, contrast: 25, saturation: 120, temperature: 10, lutPreset: 'teal-orange' },
        },
      ],
      transitionIn: { type: 'cross-dissolve', duration: 0.8 },
      transitionOut: { type: 'dip-black', duration: 1.0 },
    },

    // V2: Adjustment Layer with Glitch & Chromatic Aberration
    {
      id: 'clip_v2_adj',
      name: 'VFX Adjustment Layer',
      trackId: 'v2',
      type: 'adjustment',
      startTime: 2,
      duration: 7,
      offset: 0,
      color: '#ec4899',
      volume: 1.0,
      pan: 0,
      muted: false,
      locked: false,
      blendMode: 'source-over',
      transform: {
        positionX: 0,
        positionY: 0,
        scaleX: 100,
        scaleY: 100,
        uniformScale: true,
        rotation: 0,
        opacity: 100,
        anchorX: 0.5,
        anchorY: 0.5,
      },
      keyframes: {},
      vfxStack: [
        {
          id: 'vfx_chroma',
          type: 'chromatic',
          name: 'RGB Split / Chromatic Aberration',
          enabled: true,
          params: { offset: 7 },
        },
        {
          id: 'vfx_grain',
          type: 'film-grain',
          name: 'Cinematic 35mm Grain',
          enabled: true,
          params: { amount: 0.18 },
        },
        {
          id: 'vfx_flare',
          type: 'lens-flare',
          name: 'Anamorphic Blue Streak',
          enabled: true,
          params: { x: 50, y: 35, color: '#38bdf8', brightness: 0.6 },
        },
      ],
      transitionIn: { type: 'cross-dissolve', duration: 0.5 },
      transitionOut: { type: 'cross-dissolve', duration: 0.5 },
    },

    // V3: Kinetic Animated Title
    {
      id: 'clip_v3_title',
      name: 'SKILL MOTION · 2-in-1',
      trackId: 'v3',
      type: 'text',
      startTime: 1,
      duration: 6,
      offset: 0,
      color: '#f59e0b',
      volume: 1.0,
      pan: 0,
      muted: false,
      locked: false,
      blendMode: 'source-over',
      transform: {
        positionX: 0,
        positionY: -40,
        scaleX: 100,
        scaleY: 100,
        uniformScale: true,
        rotation: 0,
        opacity: 100,
        anchorX: 0.5,
        anchorY: 0.5,
      },
      keyframes: {
        scaleX: [
          { id: 'kf_t1', time: 0, value: 50, easing: 'ease-out' },
          { id: 'kf_t2', time: 0.8, value: 110, easing: 'ease-in-out' },
          { id: 'kf_t3', time: 1.2, value: 100, easing: 'ease-in-out' },
          { id: 'kf_t4', time: 5.5, value: 120, easing: 'ease-in' },
        ],
        opacity: [
          { id: 'kf_op1', time: 0, value: 0, easing: 'ease-out' },
          { id: 'kf_op2', time: 0.5, value: 100, easing: 'linear' },
          { id: 'kf_op3', time: 5.2, value: 100, easing: 'linear' },
          { id: 'kf_op4', time: 6.0, value: 0, easing: 'ease-in' },
        ],
      },
      vfxStack: [
        {
          id: 'vfx_glow_text',
          type: 'glow',
          name: 'Optical Bloom Glow',
          enabled: true,
          params: { intensity: 0.9, radius: 24, color: '#38bdf8' },
        },
      ],
      transitionIn: { type: 'none', duration: 0 },
      transitionOut: { type: 'none', duration: 0 },
      textData: {
        text: 'SKILL MOTION',
        fontFamily: 'Inter',
        fontSize: 74,
        fontWeight: '800',
        color: '#ffffff',
        strokeColor: '#38bdf8',
        strokeWidth: 3,
        align: 'center',
        animation: 'pop-in',
      },
    },

    // V3: Lower Third Subtitle
    {
      id: 'clip_v3_sub',
      name: 'Premiere + After Effects Unified',
      trackId: 'v3',
      type: 'text',
      startTime: 2,
      duration: 5,
      offset: 0,
      color: '#10b981',
      volume: 1.0,
      pan: 0,
      muted: false,
      locked: false,
      blendMode: 'source-over',
      transform: {
        positionX: 0,
        positionY: 55,
        scaleX: 100,
        scaleY: 100,
        uniformScale: true,
        rotation: 0,
        opacity: 100,
        anchorX: 0.5,
        anchorY: 0.5,
      },
      keyframes: {},
      vfxStack: [],
      transitionIn: { type: 'cross-dissolve', duration: 0.4 },
      transitionOut: { type: 'cross-dissolve', duration: 0.4 },
      textData: {
        text: 'PREMIERE PRO  ×  AFTER EFFECTS  UNIFIED',
        fontFamily: 'JetBrains Mono',
        fontSize: 22,
        fontWeight: '600',
        color: '#38bdf8',
        strokeColor: 'transparent',
        strokeWidth: 0,
        align: 'center',
        animation: 'typewriter',
      },
    },

    // A1: SFX Whoosh & Boom
    {
      id: 'clip_a1_boom',
      name: 'Cinematic Sub Bass Drop',
      trackId: 'a1',
      type: 'audio',
      startTime: 1,
      duration: 3,
      offset: 0,
      color: '#06b6d4',
      volume: 1.2,
      pan: 0,
      muted: false,
      locked: false,
      blendMode: 'source-over',
      transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, uniformScale: true, rotation: 0, opacity: 100, anchorX: 0.5, anchorY: 0.5 },
      keyframes: {},
      vfxStack: [],
      transitionIn: { type: 'none', duration: 0 },
      transitionOut: { type: 'none', duration: 0 },
    },

    // A2: Synth Soundtrack
    {
      id: 'clip_a2_beat',
      name: 'Cyberpunk Electro Groove 120BPM',
      trackId: 'a2',
      type: 'audio',
      startTime: 0,
      duration: 12,
      offset: 0,
      color: '#8b5cf6',
      volume: 0.85,
      pan: 0,
      muted: false,
      locked: false,
      blendMode: 'source-over',
      transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, uniformScale: true, rotation: 0, opacity: 100, anchorX: 0.5, anchorY: 0.5 },
      keyframes: {},
      vfxStack: [],
      transitionIn: { type: 'cross-dissolve', duration: 1.0 },
      transitionOut: { type: 'cross-dissolve', duration: 1.5 },
    },
  ];

  return { tracks, clips };
}

type Listener = () => void;

class EffectsScaleStore {
  private state: EffectsScaleState;
  private listeners: Set<Listener> = new Set();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private animFrameId: number | null = null;
  private lastTimestamp: number = 0;
  private gestureSnapshot: string | null = null; // State before a drag began, pushed on commit

  constructor() {
    const { tracks, clips } = createDefaultClips();

    this.state = {
      projectName: 'Cyberpunk 2-in-1 Sequence',
      workspace: 'edit',
      activeTool: 'select',
      resolution: RESOLUTION_PRESETS[0], // 1080p
      fps: 30,
      duration: 16,
      currentTime: 2.5,
      isPlaying: false,
      isLooping: true,
      inPoint: 0,
      outPoint: 12,
      zoomLevel: 90,
      scrollLeft: 0,

      tracks,
      clips,
      selectedClipId: 'clip_v3_title',
      selectedTrackId: 'v3',

      showGraphEditor: false,
      graphProperty: 'scaleX',

      dualMonitor: false,
      showSafeGuides: true,

      mediaAssets: [
        { id: 'm1', name: 'Cyberpunk Skyline (4K)', type: 'video', duration: 16, category: 'video' },
        { id: 'm2', name: 'Studio Portrait Raw', type: 'video', url: '/samples/portrait.jpg', duration: 10, category: 'video' },
        { id: 'm3', name: 'Alpine Vista Film', type: 'video', url: '/samples/landscape.jpg', duration: 10, category: 'video' },
        { id: 'm4', name: 'Cyberpunk Beat 120BPM', type: 'audio', duration: 16, category: 'audio' },
        { id: 'm5', name: 'Kinetic 3D Title Lower Third', type: 'text', duration: 6, category: 'graphics' },
        { id: 'm6', name: 'Particle Star Field', type: 'particles', duration: 12, category: 'preset' },
      ],

      markers: [
        { id: 'm_intro', time: 0, color: '#38bdf8', label: 'Intro & Title' },
        { id: 'm_drop', time: 4.5, color: '#ec4899', label: 'Bass Drop & Glitch' },
        { id: 'm_outro', time: 10.0, color: '#10b981', label: 'Outro & Credits' },
      ],

      isExporting: false,
      exportProgress: 0,
      exportStatusText: '',

      masterVolume: 1,

      canUndo: false,
      canRedo: false,
    };
  }

  getState(): EffectsScaleState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  private snapshot(): string {
    return JSON.stringify({
      tracks: this.state.tracks,
      clips: this.state.clips,
      duration: this.state.duration,
      projectName: this.state.projectName,
      resolution: this.state.resolution,
      markers: this.state.markers,
      masterVolume: this.state.masterVolume,
    });
  }

  private pushUndo(snap = this.snapshot()) {
    this.undoStack.push(snap);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.state.canUndo = true;
    this.state.canRedo = false;
  }

  undo() {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.snapshot());

    const prevSnap = this.undoStack.pop()!;
    const parsed = JSON.parse(prevSnap);
    this.state = {
      ...this.state,
      tracks: parsed.tracks,
      clips: parsed.clips,
      duration: parsed.duration,
      projectName: parsed.projectName,
      resolution: parsed.resolution,
      markers: parsed.markers || this.state.markers,
      masterVolume: parsed.masterVolume ?? 1,
      canUndo: this.undoStack.length > 0,
      canRedo: true,
    };
    if (!this.state.clips.some((c) => c.id === this.state.selectedClipId)) {
      this.state = { ...this.state, selectedClipId: null }; // The selected clip no longer exists
    }
    audioEngine.setMasterVolume(this.state.masterVolume);
    this.notify();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.snapshot());

    const nextSnap = this.redoStack.pop()!;
    const parsed = JSON.parse(nextSnap);
    this.state = {
      ...this.state,
      tracks: parsed.tracks,
      clips: parsed.clips,
      duration: parsed.duration,
      projectName: parsed.projectName,
      resolution: parsed.resolution,
      markers: parsed.markers || this.state.markers,
      masterVolume: parsed.masterVolume ?? 1,
      canUndo: true,
      canRedo: this.redoStack.length > 0,
    };
    if (!this.state.clips.some((c) => c.id === this.state.selectedClipId)) {
      this.state = { ...this.state, selectedClipId: null }; // The selected clip no longer exists
    }
    audioEngine.setMasterVolume(this.state.masterVolume);
    this.notify();
  }

  // Markers & YouTube Chapters (§5.1 item 8)
  addMarker(time?: number, label?: string, color: string = '#38bdf8'): Marker {
    this.pushUndo();
    const markerTime = time !== undefined ? Math.max(0, time) : this.state.currentTime;
    const markerLabel = label?.trim() || `Marker ${this.state.markers.length + 1}`;
    const newMarker: Marker = {
      id: 'm_' + Math.random().toString(36).slice(2, 9),
      time: Number(markerTime.toFixed(2)),
      label: markerLabel,
      color,
    };
    const nextMarkers = [...this.state.markers, newMarker].sort((a, b) => a.time - b.time);
    this.state = {
      ...this.state,
      markers: nextMarkers,
    };
    this.notify();
    return newMarker;
  }

  removeMarker(id: string) {
    this.pushUndo();
    this.state = {
      ...this.state,
      markers: this.state.markers.filter((m) => m.id !== id),
    };
    this.notify();
  }

  updateMarker(id: string, patch: Partial<Omit<Marker, 'id'>>) {
    this.pushUndo();
    const nextMarkers = this.state.markers
      .map((m) => (m.id === id ? { ...m, ...patch } : m))
      .sort((a, b) => a.time - b.time);
    this.state = {
      ...this.state,
      markers: nextMarkers,
    };
    this.notify();
  }

  exportYouTubeChapters(): string {
    const markers = [...this.state.markers].sort((a, b) => a.time - b.time);
    if (markers.length === 0) {
      return '00:00 Intro';
    }

    const lines: string[] = [];
    let hasStart = false;

    for (const m of markers) {
      const totalSec = Math.max(0, Math.floor(m.time));
      const hours = Math.floor(totalSec / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;

      let timecode: string;
      if (hours > 0) {
        timecode = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      } else {
        timecode = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }

      if (totalSec === 0) {
        hasStart = true;
      }

      lines.push(`${timecode} ${m.label.trim()}`);
    }

    if (!hasStart) {
      lines.unshift('00:00 Introduction');
    }

    return lines.join('\n');
  }

  // Workspaces
  setWorkspace(mode: WorkspaceMode) {
    this.state = { ...this.state, workspace: mode };
    this.notify();
  }

  // Tools
  setActiveTool(tool: ToolType) {
    this.state = { ...this.state, activeTool: tool };
    this.notify();
  }

  // Project Settings
  setResolution(preset: ResolutionPreset) {
    this.pushUndo();
    this.state = { ...this.state, resolution: preset };
    this.notify();
  }

  setFps(fps: number) {
    this.state = { ...this.state, fps };
    this.notify();
  }

  setProjectName(name: string) {
    this.state = { ...this.state, projectName: name };
    this.notify();
  }

  // Playback Transport
  togglePlay() {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  play() {
    audioEngine.resume();
    this.state = { ...this.state, isPlaying: true };
    this.lastTimestamp = performance.now();
    this.runPlaybackLoop();
    this.notify();
  }

  pause() {
    this.state = { ...this.state, isPlaying: false };
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.notify();
  }

  private runPlaybackLoop = () => {
    if (!this.state.isPlaying) return;

    const now = performance.now();
    const dt = (now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;

    let nextTime = this.state.currentTime + dt;

    // Check In / Out loop range
    const loopEnd = this.state.outPoint ?? this.state.duration;
    const loopStart = this.state.inPoint ?? 0;

    if (nextTime >= loopEnd) {
      if (this.state.isLooping) {
        nextTime = loopStart;
      } else {
        nextTime = loopEnd;
        this.pause();
        return;
      }
    }

    // The built-in beat only plays under a generated music clip; real files play through media sync
    const beatTrack = this.generatedAudioTrackAt(nextTime);
    if (beatTrack) audioEngine.playTimelineAudioClock(nextTime, true, beatTrack);

    this.state = { ...this.state, currentTime: nextTime };
    this.notify();

    this.animFrameId = requestAnimationFrame(this.runPlaybackLoop);
  };

  hasGeneratedAudioAt(time: number): boolean {
    return this.generatedAudioTrackAt(time) !== null;
  }

  // Track of the generated music clip sounding at `time`, if any
  generatedAudioTrackAt(time: number): string | null {
    const { tracks, clips } = this.state;
    const anySolo = tracks.some((t) => t.solo);
    const hit = clips.find((c) => {
      if (c.type !== 'audio' || c.sourceUrl || c.muted) return false;
      const t = tracks.find((x) => x.id === c.trackId);
      if (!t || t.muted || (anySolo && !t.solo)) return false;
      return time >= c.startTime && time < c.startTime + c.duration;
    });
    return hit ? hit.trackId : null;
  }

  setCurrentTime(time: number) {
    const clamped = Math.max(0, Math.min(this.state.duration, time));
    this.state = { ...this.state, currentTime: clamped };
    this.notify();
  }

  stepFrames(count: number) {
    const frameDuration = 1 / this.state.fps;
    this.setCurrentTime(this.state.currentTime + count * frameDuration);
  }

  jumpToStart() {
    this.setCurrentTime(this.state.inPoint ?? 0);
  }

  jumpToEnd() {
    this.setCurrentTime(this.state.outPoint ?? this.state.duration);
  }

  setInPoint() {
    this.state = { ...this.state, inPoint: this.state.currentTime };
    this.notify();
  }

  setOutPoint() {
    this.state = { ...this.state, outPoint: this.state.currentTime };
    this.notify();
  }

  clearInOut() {
    this.state = { ...this.state, inPoint: null, outPoint: null };
    this.notify();
  }

  toggleLoop() {
    this.state = { ...this.state, isLooping: !this.state.isLooping };
    this.notify();
  }

  setZoomLevel(zoom: number) {
    this.state = { ...this.state, zoomLevel: Math.max(20, Math.min(400, zoom)) };
    this.notify();
  }

  setScrollLeft(scroll: number) {
    this.state = { ...this.state, scrollLeft: Math.max(0, scroll) };
    this.notify();
  }

  toggleDualMonitor() {
    this.state = { ...this.state, dualMonitor: !this.state.dualMonitor };
    this.notify();
  }

  toggleSafeGuides() {
    this.state = { ...this.state, showSafeGuides: !this.state.showSafeGuides };
    this.notify();
  }

  toggleGraphEditor(prop?: string) {
    this.state = {
      ...this.state,
      showGraphEditor: !this.state.showGraphEditor,
      graphProperty: prop || this.state.graphProperty,
    };
    this.notify();
  }

  // Clip Selection & Management
  selectClip(clipId: string | null) {
    this.state = { ...this.state, selectedClipId: clipId };
    this.notify();
  }

  selectTrack(trackId: string | null) {
    this.state = { ...this.state, selectedTrackId: trackId };
    this.notify();
  }

  // Premiere Pro Editing Operations
  // 1. Razor / Split Clip at current playhead
  splitClipAtPlayhead(clipId?: string) {
    const targetClipId = clipId || this.state.selectedClipId;
    if (!targetClipId) return;

    const clip = this.state.clips.find((c) => c.id === targetClipId);
    if (!clip) return;

    const splitTime = this.state.currentTime;
    if (splitTime <= clip.startTime || splitTime >= clip.startTime + clip.duration) return;

    this.pushUndo();

    const firstHalfDuration = splitTime - clip.startTime;
    const secondHalfDuration = clip.duration - firstHalfDuration;
    const offsets = splitOffsets(clip, firstHalfDuration); // speed / reverse keep every frame in place

    // Update original clip
    const updatedClips = this.state.clips.map((c) => {
      if (c.id === clip.id) {
        return {
          ...c,
          duration: firstHalfDuration,
          offset: offsets.left,
        };
      }
      return c;
    });

    // Create split right half
    const newClip: TimelineClip = {
      ...clip,
      id: 'clip_' + Math.random().toString(36).slice(2, 9),
      name: `${clip.name} (Part 2)`,
      startTime: splitTime,
      duration: secondHalfDuration,
      offset: offsets.right,
      // clone transform and VFX
      transform: { ...clip.transform },
      keyframes: JSON.parse(JSON.stringify(clip.keyframes || {})),
      vfxStack: JSON.parse(JSON.stringify(clip.vfxStack || [])),
    };

    this.state = {
      ...this.state,
      clips: [...updatedClips, newClip],
      selectedClipId: newClip.id,
    };
    this.notify();
  }

  // 2. Ripple Delete (removes clip and pulls downstream clips forward)
  rippleDeleteClip(clipId?: string) {
    const targetId = clipId || this.state.selectedClipId;
    if (!targetId) return;

    const clip = this.state.clips.find((c) => c.id === targetId);
    if (!clip) return;

    this.pushUndo();

    const gap = clip.duration;
    const clipStart = clip.startTime;

    const updated = this.state.clips
      .filter((c) => c.id !== targetId)
      .map((c) => {
        if (c.trackId === clip.trackId && c.startTime > clipStart) {
          return {
            ...c,
            startTime: Math.max(0, c.startTime - gap),
          };
        }
        return c;
      });

    this.state = {
      ...this.state,
      clips: updated,
      selectedClipId: null,
    };
    this.notify();
  }

  // 3. Delete Clip
  deleteClip(clipId?: string) {
    const targetId = clipId || this.state.selectedClipId;
    if (!targetId) return;

    this.pushUndo();
    this.state = {
      ...this.state,
      clips: this.state.clips.filter((c) => c.id !== targetId),
      selectedClipId: null,
    };
    this.notify();
  }

  // 4. Duplicate Clip
  duplicateClip(clipId?: string) {
    const targetId = clipId || this.state.selectedClipId;
    if (!targetId) return;

    const clip = this.state.clips.find((c) => c.id === targetId);
    if (!clip) return;

    this.pushUndo();
    const cloned: TimelineClip = {
      ...clip,
      id: 'clip_' + Math.random().toString(36).slice(2, 9),
      name: `${clip.name} (Copy)`,
      startTime: clip.startTime + clip.duration + 0.5,
      transform: { ...clip.transform },
      keyframes: JSON.parse(JSON.stringify(clip.keyframes || {})),
      vfxStack: JSON.parse(JSON.stringify(clip.vfxStack || [])),
    };

    this.state = {
      ...this.state,
      clips: [...this.state.clips, cloned],
      selectedClipId: cloned.id,
    };
    this.notify();
  }

  private clipClipboard: TimelineClip | null = null;

  copyClip(clipId?: string) {
    const targetId = clipId || this.state.selectedClipId;
    if (!targetId) return;
    const clip = this.state.clips.find((c) => c.id === targetId);
    if (!clip) return;

    const cloned: TimelineClip = {
      ...clip,
      transform: { ...clip.transform },
      keyframes: JSON.parse(JSON.stringify(clip.keyframes || {})),
      vfxStack: JSON.parse(JSON.stringify(clip.vfxStack || [])),
    };
    this.clipClipboard = cloned;
    try {
      localStorage.setItem('skillsuite_motion_clip', JSON.stringify(cloned));
    } catch {}
  }

  cutClip(clipId?: string) {
    const targetId = clipId || this.state.selectedClipId;
    if (!targetId) return;
    this.copyClip(targetId);
    this.deleteClip(targetId);
  }

  pasteClip() {
    let clip = this.clipClipboard;
    if (!clip) {
      try {
        const raw = localStorage.getItem('skillsuite_motion_clip');
        if (raw) clip = JSON.parse(raw);
      } catch {}
    }
    if (!clip) return;

    this.pushUndo();
    const targetTrackId = this.state.selectedTrackId || clip.trackId || this.state.tracks[0]?.id;
    const pasted: TimelineClip = {
      ...clip,
      id: 'clip_' + Math.random().toString(36).slice(2, 9),
      trackId: targetTrackId,
      startTime: this.state.currentTime,
      transform: { ...clip.transform },
      keyframes: JSON.parse(JSON.stringify(clip.keyframes || {})),
      vfxStack: JSON.parse(JSON.stringify(clip.vfxStack || [])),
    };

    this.state = {
      ...this.state,
      clips: [...this.state.clips, pasted],
      selectedClipId: pasted.id,
    };
    this.notify();
  }

  moveClipToTrack(clipId: string, targetTrackId: string) {
    const clip = this.state.clips.find((c) => c.id === clipId);
    const track = this.state.tracks.find((t) => t.id === targetTrackId);
    if (!clip || !track || clip.trackId === targetTrackId) return;

    // Check media kind compatibility: audio to audio, video/graphic to video
    const isAudioClip = clip.mediaKind === 'audio';
    const isAudioTrack = track.type === 'audio';
    if (isAudioClip !== isAudioTrack) return;

    this.pushUndo();
    this.state = {
      ...this.state,
      clips: this.state.clips.map((c) => (c.id === clipId ? { ...c, trackId: targetTrackId } : c)),
      selectedTrackId: targetTrackId,
    };
    this.notify();
  }

  // 4b. Clip Speed & Duration (Cmd+R)
  setClipSpeed(clipId: string, newSpeed: number, options?: { ripple?: boolean; reversed?: boolean }) {
    if (newSpeed <= 0) return;
    const clip = this.state.clips.find((c) => c.id === clipId);
    if (!clip) return;

    this.pushUndo();
    const oldSpeed = clip.speed ?? 1.0;
    const speedRatio = oldSpeed / newSpeed;
    const newDuration = Math.max(0.1, Number((clip.duration * speedRatio).toFixed(3)));
    const delta = newDuration - clip.duration;

    const updatedClips = this.state.clips.map((c) => {
      if (c.id === clipId) {
        return {
          ...c,
          speed: newSpeed,
          duration: newDuration,
          reversed: options?.reversed !== undefined ? options.reversed : c.reversed,
        };
      }
      if (options?.ripple && c.trackId === clip.trackId && c.startTime > clip.startTime) {
        return {
          ...c,
          startTime: Math.max(0, Number((c.startTime + delta).toFixed(3))),
        };
      }
      return c;
    });

    const maxEnd = Math.max(12, ...updatedClips.map((c) => c.startTime + c.duration));
    this.state = {
      ...this.state,
      clips: updatedClips,
      duration: Math.max(this.state.duration, Math.ceil(maxEnd)),
    };
    this.notify();
  }

  // 5. Update Clip Timing & Position (drag / trim)
  updateClipTiming(
    clipId: string,
    updates: Partial<Pick<TimelineClip, 'startTime' | 'duration' | 'offset' | 'trackId'>>
  ) {
    this.state = {
      ...this.state,
      clips: this.state.clips.map((c) => (c.id === clipId ? clampToSource({ ...c, ...updates }) : c)),
    };
    this.notify();
  }

  // Drags (clip move / trim, canvas transform) record one undo step for the whole gesture
  beginGesture() {
    this.gestureSnapshot = this.snapshot();
  }

  commitGesture() {
    const before = this.gestureSnapshot;
    this.gestureSnapshot = null;
    if (!before || before === this.snapshot()) return;
    this.pushUndo(before);
    this.notify();
  }

  // After Effects Keyframing & Inspector Controls
  updateTransform(clipId: string, updates: Partial<TimelineClip['transform']>) {
    const clip = this.state.clips.find((c) => c.id === clipId);
    if (!clip) return;

    const updatedClips = this.state.clips.map((c) => {
      if (c.id === clipId) {
        return {
          ...c,
          transform: { ...c.transform, ...updates },
        };
      }
      return c;
    });

    this.state = { ...this.state, clips: updatedClips };
    this.notify();
  }

  // Typography & Text Clip Property Updates
  updateTextData(clipId: string, updates: Partial<TextClipData>) {
    const clip = this.state.clips.find((c) => c.id === clipId);
    if (!clip || !clip.textData) return;

    this.pushUndo();
    const updatedClips = this.state.clips.map((c) => {
      if (c.id === clipId && c.textData) {
        return {
          ...c,
          textData: { ...c.textData, ...updates },
        };
      }
      return c;
    });

    this.state = { ...this.state, clips: updatedClips };
    this.notify();
  }

  // Toggles keyframe stopwatch or adds a keyframe at current playhead
  toggleKeyframe(clipId: string, prop: string, value: number) {
    const clip = this.state.clips.find((c) => c.id === clipId);
    if (!clip) return;

    this.pushUndo();
    const localTime = Math.max(0, this.state.currentTime - clip.startTime + clip.offset);
    const existingKfs = clip.keyframes[prop] || [];

    let nextKfs: Keyframe[];
    const hasKf = existingKfs.some((k) => Math.abs(k.time - localTime) < 0.05);

    if (hasKf) {
      nextKfs = removeKeyframeAt(existingKfs, localTime);
    } else {
      nextKfs = setKeyframe(existingKfs, localTime, value, 'ease-in-out');
    }

    const updatedClips = this.state.clips.map((c) => {
      if (c.id === clipId) {
        return {
          ...c,
          keyframes: {
            ...c.keyframes,
            [prop]: nextKfs,
          },
        };
      }
      return c;
    });

    this.state = { ...this.state, clips: updatedClips };
    this.notify();
  }

  setKeyframeEasing(clipId: string, prop: string, easing: KeyframeEasing) {
    const clip = this.state.clips.find((c) => c.id === clipId);
    if (!clip || !clip.keyframes[prop] || clip.keyframes[prop].length === 0) return;

    this.pushUndo();
    const updatedKfs = clip.keyframes[prop].map((k) => ({ ...k, easing }));
    const updatedClips = this.state.clips.map((c) =>
      c.id === clipId
        ? {
            ...c,
            keyframes: {
              ...c.keyframes,
              [prop]: updatedKfs,
            },
          }
        : c
    );
    this.state = { ...this.state, clips: updatedClips };
    this.notify();
  }

  // Automatic Sound-to-Marker Beat & Transient Generator
  autoDetectBeatMarkers(bpm = 120) {
    this.pushUndo();
    const beatInterval = 60 / bpm; // e.g. 0.5s for 120 BPM
    const duration = this.state.duration;
    const newMarkers: Marker[] = [];

    // Filter out previous auto-beat markers
    const nonBeatMarkers = this.state.markers.filter((m) => !m.label.startsWith('Beat '));

    let beatNum = 1;
    for (let t = 0; t <= duration; t += beatInterval) {
      const isKick = beatNum % 2 === 1;
      newMarkers.push({
        id: 'm_beat_' + beatNum + '_' + Math.random().toString(36).slice(2, 7),
        time: Number(t.toFixed(2)),
        label: isKick ? `Beat ${beatNum} (Kick)` : `Beat ${beatNum} (Snare)`,
        color: isKick ? '#ec4899' : '#38bdf8',
      });
      beatNum++;
    }

    const merged = [...nonBeatMarkers, ...newMarkers].sort((a, b) => a.time - b.time);
    this.state = {
      ...this.state,
      markers: merged,
    };
    this.notify();
    return newMarkers.length;
  }

  // 1-Click Social Media Vertical Reel Reframer (16:9 to 9:16 with Smart Ambient Blurred Backdrop)
  reframeToVerticalReel(smartBlur = true) {
    this.pushUndo();
    const reelPreset = RESOLUTION_PRESETS.find((p) => p.aspectRatio === '9:16') || {
      name: 'TikTok / Reels / Shorts (9:16)',
      width: 1080,
      height: 1920,
      aspectRatio: '9:16',
    };

    let nextTracks = [...this.state.tracks];
    let nextClips = [...this.state.clips];

    // Find or create backdrop track below V1
    let backdropTrack = nextTracks.find((t) => t.id === 'v0_backdrop');
    if (!backdropTrack && smartBlur) {
      backdropTrack = {
        id: 'v0_backdrop',
        name: 'V0 · Ambient Blur Backdrop',
        type: 'video',
        visible: true,
        muted: true,
        solo: false,
        locked: false,
        volume: 0,
        pan: 0,
        height: 48,
      };
      // Insert right after v1 or at bottom of video tracks
      const v1Index = nextTracks.findIndex((t) => t.id === 'v1');
      if (v1Index >= 0) {
        nextTracks.splice(v1Index + 1, 0, backdropTrack);
      } else {
        nextTracks.unshift(backdropTrack);
      }
    }

    if (smartBlur && backdropTrack) {
      // Find main video or image clips on v1
      const foregroundClips = nextClips.filter(
        (c) => c.trackId === 'v1' && (c.type === 'video' || c.type === 'solid')
      );

      // Remove existing backdrop clips
      nextClips = nextClips.filter((c) => c.trackId !== 'v0_backdrop');

      for (const fg of foregroundClips) {
        const blurEffect: VFXEffect = {
          id: 'vfx_blur_' + Math.random().toString(36).slice(2, 7),
          type: 'blur',
          name: 'Ambient Gaussian Blur',
          enabled: true,
          params: { amount: 35, direction: 0 },
        };
        const backdropClip: TimelineClip = {
          ...JSON.parse(JSON.stringify(fg)),
          id: 'clip_bg_' + fg.id + '_' + Math.random().toString(36).slice(2, 7),
          name: `${fg.name} (Blurred Backdrop)`,
          trackId: backdropTrack.id,
          transform: {
            ...fg.transform,
            scaleX: 320,
            scaleY: 320,
            opacity: 70,
          },
          vfxStack: [blurEffect],
        };
        nextClips.push(backdropClip);
      }
    }

    this.state = {
      ...this.state,
      resolution: reelPreset,
      tracks: nextTracks,
      clips: nextClips,
    };
    this.notify();
  }

  // VFX Stack Management
  addVFX(clipId: string, type: VFXType) {
    const clip = this.state.clips.find((c) => c.id === clipId);
    if (!clip) return;

    this.pushUndo();
    const effectNames: Record<VFXType, string> = {
      glow: 'Optical Bloom Glow',
      chromatic: 'RGB Chromatic Aberration',
      glitch: 'Cyberpunk VHS Glitch',
      'film-grain': '35mm Cinematic Film Grain',
      'lens-flare': 'Anamorphic Lens Flare',
      'chroma-key': 'Green Screen Chroma Key',
      blur: 'Directional Gaussian Blur',
      'camera-shake': 'Handheld Camera Shake',
      vignette: 'Cinematic Radial Vignette',
      letterbox: '2.39:1 Cinema Scope Bars',
      lumetri: 'Lumetri Color Grading',
    };

    const defaultParams: Record<VFXType, Record<string, any>> = {
      glow: { intensity: 0.8, radius: 25, color: '#38bdf8' },
      chromatic: { offset: 8 },
      glitch: { intensity: 0.6 },
      'film-grain': { amount: 0.22 },
      'lens-flare': { x: 50, y: 35, color: '#38bdf8', brightness: 0.7 },
      'chroma-key': { tolerance: 45, keyColor: 'green' },
      blur: { radius: 12 },
      'camera-shake': { intensity: 5, frequency: 8 },
      vignette: { darkness: 0.6, radius: 0.85 },
      letterbox: { ratio: 2.39 },
      lumetri: { exposure: 0.2, contrast: 20, saturation: 110, temperature: 15, tint: 0, lutPreset: 'teal-orange' },
    };

    const newEffect: VFXEffect = {
      id: 'vfx_' + Math.random().toString(36).slice(2, 9),
      type,
      name: effectNames[type],
      enabled: true,
      params: defaultParams[type] || {},
    };

    const updatedClips = this.state.clips.map((c) => {
      if (c.id === clipId) {
        return {
          ...c,
          vfxStack: [...c.vfxStack, newEffect],
        };
      }
      return c;
    });

    this.state = { ...this.state, clips: updatedClips };
    this.notify();
  }

  removeVFX(clipId: string, effectId: string) {
    this.pushUndo();
    const updatedClips = this.state.clips.map((c) => {
      if (c.id === clipId) {
        return {
          ...c,
          vfxStack: c.vfxStack.filter((e) => e.id !== effectId),
        };
      }
      return c;
    });

    this.state = { ...this.state, clips: updatedClips };
    this.notify();
  }

  toggleVFX(clipId: string, effectId: string) {
    const updatedClips = this.state.clips.map((c) => {
      if (c.id === clipId) {
        return {
          ...c,
          vfxStack: c.vfxStack.map((e) => (e.id === effectId ? { ...e, enabled: !e.enabled } : e)),
        };
      }
      return c;
    });

    this.state = { ...this.state, clips: updatedClips };
    this.notify();
  }

  updateVFXParam(clipId: string, effectId: string, paramKey: string, value: any) {
    const updatedClips = this.state.clips.map((c) => {
      if (c.id === clipId) {
        return {
          ...c,
          vfxStack: c.vfxStack.map((e) => {
            if (e.id === effectId) {
              return {
                ...e,
                params: { ...e.params, [paramKey]: value },
              };
            }
            return e;
          }),
        };
      }
      return c;
    });

    this.state = { ...this.state, clips: updatedClips };
    this.notify();
  }

  // Tracks Management
  toggleTrackVisible(trackId: string) {
    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((t) => (t.id === trackId ? { ...t, visible: !t.visible } : t)),
    };
    this.notify();
  }

  toggleTrackMute(trackId: string) {
    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
    };
    this.notify();
  }

  toggleTrackSolo(trackId: string) {
    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((t) => (t.id === trackId ? { ...t, solo: !t.solo } : t)),
    };
    this.notify();
  }

  // Master fader; pass `undoable` for one-shot changes (normalize), drags use begin/commitGesture
  setMasterVolume(volume: number, undoable = false) {
    const v = Math.max(0, Math.min(MAX_MASTER, volume));
    if (undoable) this.pushUndo();
    this.state = { ...this.state, masterVolume: v };
    audioEngine.setMasterVolume(v);
    this.notify();
  }

  /**
   * Cuts the silent source ranges out of a clip and closes the gaps (ripple on its track). Returns the
   * number of pauses removed and the seconds saved.
   */
  removeSilence(clipId: string, silent: Array<[number, number]>, opts?: { pad?: number; minSilence?: number }): { cuts: number; saved: number } {
    const clip = this.state.clips.find((c) => c.id === clipId);
    if (!clip || clip.locked) return { cuts: 0, saved: 0 };
    const parts = keptParts(clip, silent, opts);
    const kept = parts.reduce((n, [a, b]) => n + (b - a), 0);
    const saved = clip.duration - kept;
    if (parts.length === 0 || saved < 1e-3) return { cuts: 0, saved: 0 };

    this.pushUndo();
    let at = clip.startTime;
    const pieces: TimelineClip[] = parts.map(([a, b], i) => {
      // Earliest source second the part uses (a reversed part ends, in source time, where it starts)
      const offset = clip.offset + (clip.reversed ? clip.duration - b : a) * clipSpeed(clip);
      const piece: TimelineClip = {
        ...clip,
        id: i === 0 ? clip.id : 'clip_' + Math.random().toString(36).slice(2, 9),
        name: i === 0 ? clip.name : `${clip.name} (${i + 1})`,
        startTime: Number(at.toFixed(4)),
        duration: Number((b - a).toFixed(4)),
        offset,
        transitionIn: i === 0 ? clip.transitionIn : { type: 'none', duration: 0 },
        transitionOut: i === parts.length - 1 ? clip.transitionOut : { type: 'none', duration: 0 },
        keyframes: i === 0 ? clip.keyframes : {},
        vfxStack: JSON.parse(JSON.stringify(clip.vfxStack || [])),
        transform: { ...clip.transform },
      };
      at += b - a;
      return piece;
    });
    const end = clip.startTime + clip.duration;
    const clips = this.state.clips.flatMap((c) => {
      if (c.id === clip.id) return pieces;
      if (c.trackId === clip.trackId && c.startTime >= end - 1e-6) return [{ ...c, startTime: Number((c.startTime - saved).toFixed(4)) }];
      return [c];
    });
    this.state = { ...this.state, clips, selectedClipId: clip.id };
    this.notify();
    return { cuts: parts.length - 1 + (parts[0][0] > 0 ? 1 : 0) + (parts[parts.length - 1][1] < clip.duration ? 1 : 0), saved };
  }

  toggleTrackLock(trackId: string) {
    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((t) => (t.id === trackId ? { ...t, locked: !t.locked } : t)),
    };
    this.notify();
  }

  setTrackVolume(trackId: string, volume: number) {
    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((t) => (t.id === trackId ? { ...t, volume } : t)),
    };
    this.notify();
  }

  setTrackPan(trackId: string, pan: number) {
    this.state = {
      ...this.state,
      tracks: this.state.tracks.map((t) => (t.id === trackId ? { ...t, pan } : t)),
    };
    this.notify();
  }

  importMedia(assets: MediaAsset[]) {
    if (assets.length === 0) return;
    this.state = { ...this.state, mediaAssets: [...this.state.mediaAssets, ...assets] };
    this.notify();
  }

  // Places a bin item on the timeline. Without a time it goes at the playhead, or after the
  // track's last clip when the playhead spot is taken. Returns the new clip's id.
  addAssetClip(asset: MediaAsset, trackId?: string, startTime?: number): string | null {
    if (!asset.url) {
      // Built-in generators (procedural footage, titles, particles)
      this.addNewClip(asset.type, trackId);
      return this.state.selectedClipId;
    }
    const kind = asset.mediaKind ?? clipMediaKind({ sourceUrl: asset.url });
    const wantType = kind === 'audio' ? 'audio' : 'video';
    let track = this.state.tracks.find((t) => t.id === trackId);
    if (!track || track.type !== wantType) {
      // Video goes on the bottom video track (main footage), audio on the first audio track
      const ofType = this.state.tracks.filter((t) => t.type === wantType);
      track = wantType === 'video' ? ofType[ofType.length - 1] : ofType[0];
    }
    if (!track) return null;

    const duration = asset.duration;
    let start = Math.max(0, startTime ?? this.state.currentTime);
    const onTrack = this.state.clips.filter((c) => c.trackId === track!.id);
    const overlaps = onTrack.some((c) => start < c.startTime + c.duration && start + duration > c.startTime);
    if (overlaps && startTime === undefined) {
      start = Math.max(0, ...onTrack.map((c) => c.startTime + c.duration));
    }

    this.pushUndo();
    const clip: TimelineClip = {
      id: 'clip_' + Math.random().toString(36).slice(2, 9),
      name: asset.name,
      trackId: track.id,
      type: wantType,
      startTime: start,
      duration,
      offset: 0,
      color: wantType === 'audio' ? '#a855f7' : '#0ea5e9',
      volume: 1.0,
      pan: 0,
      muted: false,
      locked: false,
      blendMode: 'source-over',
      sourceUrl: asset.url,
      mediaKind: kind ?? undefined,
      mediaWidth: asset.width,
      mediaHeight: asset.height,
      sourceDuration: kind === 'image' ? undefined : asset.duration,
      transform: {
        positionX: 0,
        positionY: 0,
        scaleX: 100,
        scaleY: 100,
        uniformScale: true,
        rotation: 0,
        opacity: 100,
        anchorX: 0.5,
        anchorY: 0.5,
      },
      keyframes: {},
      vfxStack: [],
      transitionIn: { type: 'none', duration: 0 },
      transitionOut: { type: 'none', duration: 0 },
    };

    const end = start + duration;
    const extended = end > this.state.duration;
    this.state = {
      ...this.state,
      clips: [...this.state.clips, clip],
      selectedClipId: clip.id,
      selectedTrackId: track.id,
      duration: Math.max(this.state.duration, Math.ceil(end)),
      // A work area that would cut the new footage short is cleared
      ...(extended && this.state.outPoint !== null && this.state.outPoint < end ? { inPoint: null, outPoint: null } : {}),
    };
    this.notify();
    return clip.id;
  }

  // ⌘K: cuts the selected clip at the playhead, or every unlocked clip under it
  splitAtPlayhead() {
    const t = this.state.currentTime;
    const under = (c: TimelineClip) => t > c.startTime && t < c.startTime + c.duration;
    const sel = this.state.clips.find((c) => c.id === this.state.selectedClipId);
    if (sel && under(sel)) {
      this.splitClipAtPlayhead(sel.id);
      return;
    }
    const locked = new Set(this.state.tracks.filter((tr) => tr.locked).map((tr) => tr.id));
    const targets = this.state.clips.filter((c) => under(c) && !c.locked && !locked.has(c.trackId));
    if (targets.length === 0) return;
    const before = this.snapshot();
    for (const c of targets) this.splitClipAtPlayhead(c.id);
    // One undo step for the whole cut
    this.undoStack.splice(this.undoStack.length - targets.length, targets.length, before);
    this.state = { ...this.state, canUndo: true };
    this.notify();
  }

  // Adding New Items (Text, Shape, Adjustment, Video, Audio)
  addNewClip(type: TimelineClip['type'], trackId?: string) {
    this.pushUndo();
    const targetTrackId = trackId || (type === 'audio' ? 'a1' : 'v3');
    const start = this.state.currentTime;
    const duration = 4.0;

    const baseTransform = {
      positionX: 0,
      positionY: 0,
      scaleX: 100,
      scaleY: 100,
      uniformScale: true,
      rotation: 0,
      opacity: 100,
      anchorX: 0.5,
      anchorY: 0.5,
    };

    let newClip: TimelineClip = {
      id: 'clip_' + Math.random().toString(36).slice(2, 9),
      name: `New ${type.toUpperCase()}`,
      trackId: targetTrackId,
      type,
      startTime: start,
      duration,
      offset: 0,
      color: type === 'text' ? '#f59e0b' : type === 'adjustment' ? '#ec4899' : '#38bdf8',
      volume: 1.0,
      pan: 0,
      muted: false,
      locked: false,
      blendMode: 'source-over',
      transform: baseTransform,
      keyframes: {},
      vfxStack: [],
      transitionIn: { type: 'none', duration: 0 },
      transitionOut: { type: 'none', duration: 0 },
    };

    if (type === 'text') {
      newClip.textData = {
        text: 'CINEMATIC TITLE',
        fontFamily: 'Inter',
        fontSize: 64,
        fontWeight: '700',
        color: '#ffffff',
        strokeColor: '#38bdf8',
        strokeWidth: 2,
        align: 'center',
        animation: 'pop-in',
      };
    } else if (type === 'shape') {
      newClip.shapeData = {
        shapeType: 'lower-third',
        fill: 'rgba(15, 23, 42, 0.85)',
        stroke: '#38bdf8',
        strokeWidth: 2,
        cornerRadius: 12,
        label: 'PRESENTER NAME · TITLE',
      };
    } else if (type === 'adjustment') {
      newClip.name = 'Adjustment VFX Layer';
      newClip.vfxStack = [
        {
          id: 'vfx_adj_glow',
          type: 'glow',
          name: 'Optical Bloom Glow',
          enabled: true,
          params: { intensity: 0.7, radius: 20, color: '#38bdf8' },
        },
      ];
    } else if (type === 'particles') {
      newClip.name = 'Floating Bokeh Particles';
      newClip.particleData = {
        preset: 'bokeh',
        count: 60,
        speed: 1.2,
        size: 4,
        color: '#38bdf8',
      };
    } else if (type === 'visualizer') {
      newClip.name = 'Audio Reactive Spectrum';
      newClip.visualizerData = {
        type: 'bars',
        barCount: 48,
        color1: '#38bdf8',
        color2: '#c084fc',
      };
    }

    this.state = {
      ...this.state,
      clips: [...this.state.clips, newClip],
      selectedClipId: newClip.id,
    };
    this.notify();
  }

  // Load Presets
  loadPresetProject(presetId: 'cyberpunk' | 'cinematic' | 'tiktok' | 'edm') {
    this.pushUndo();
    if (presetId === 'cyberpunk') {
      const { tracks, clips } = createDefaultClips();
      this.state = {
        ...this.state,
        projectName: 'Cyberpunk 2-in-1 Sequence',
        resolution: RESOLUTION_PRESETS[0],
        tracks,
        clips,
        selectedClipId: clips[2].id,
      };
    } else if (presetId === 'cinematic') {
      const { tracks } = createDefaultClips();
      const cinematicClips: TimelineClip[] = [
        {
          id: 'c_base',
          name: 'Alpine Film Shot (Kodak 500T)',
          trackId: 'v1',
          type: 'video',
          sourceUrl: '/samples/landscape.jpg',
          mediaKind: 'image',
          startTime: 0,
          duration: 14,
          offset: 0,
          color: '#10b981',
          volume: 1.0,
          pan: 0,
          muted: false,
          locked: false,
          blendMode: 'source-over',
          transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, uniformScale: true, rotation: 0, opacity: 100, anchorX: 0.5, anchorY: 0.5 },
          keyframes: {},
          vfxStack: [
            { id: 'v_lut', type: 'lumetri', name: 'Lumetri Kodak Look', enabled: true, params: { exposure: 0.1, contrast: 30, saturation: 95, temperature: 20, lutPreset: 'vintage-35mm' } },
            { id: 'v_grain', type: 'film-grain', name: '35mm Halation & Grain', enabled: true, params: { amount: 0.28 } },
            { id: 'v_bars', type: 'letterbox', name: '2.39:1 Cinema Letterbox', enabled: true, params: { ratio: 2.39 } },
          ],
          transitionIn: { type: 'cross-dissolve', duration: 1.0 },
          transitionOut: { type: 'cross-dissolve', duration: 1.0 },
        },
        {
          id: 'c_title',
          name: 'THE HORIZON · Film Opener',
          trackId: 'v3',
          type: 'text',
          startTime: 2,
          duration: 8,
          offset: 0,
          color: '#eab308',
          volume: 1.0,
          pan: 0,
          muted: false,
          locked: false,
          blendMode: 'source-over',
          transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, uniformScale: true, rotation: 0, opacity: 100, anchorX: 0.5, anchorY: 0.5 },
          keyframes: {
            scaleX: [
              { id: 'k1', time: 0, value: 95, easing: 'ease-out' },
              { id: 'k2', time: 8, value: 108, easing: 'linear' },
            ],
            opacity: [
              { id: 'ko1', time: 0, value: 0, easing: 'linear' },
              { id: 'ko2', time: 1.2, value: 100, easing: 'linear' },
              { id: 'ko3', time: 6.8, value: 100, easing: 'linear' },
              { id: 'ko4', time: 8.0, value: 0, easing: 'linear' },
            ],
          },
          vfxStack: [],
          transitionIn: { type: 'none', duration: 0 },
          transitionOut: { type: 'none', duration: 0 },
          textData: {
            text: 'T H E   H O R I Z O N',
            fontFamily: 'Inter',
            fontSize: 58,
            fontWeight: '300',
            color: '#fef08a',
            strokeColor: 'transparent',
            strokeWidth: 0,
            align: 'center',
            animation: 'none',
          },
        },
      ];
      this.state = {
        ...this.state,
        projectName: 'Cinematic 35mm Teaser',
        resolution: RESOLUTION_PRESETS[4], // Cinema Scope
        tracks,
        clips: cinematicClips,
        selectedClipId: 'c_title',
      };
    } else if (presetId === 'tiktok') {
      const { tracks } = createDefaultClips();
      this.state = {
        ...this.state,
        projectName: 'TikTok 9:16 Viral Reel',
        resolution: RESOLUTION_PRESETS[2], // 9:16 Vertical
        tracks,
        clips: [
          {
            id: 'tt_title',
            name: 'Viral Kinetic Headline',
            trackId: 'v3',
            type: 'text',
            startTime: 0.5,
            duration: 8,
            offset: 0,
            color: '#ec4899',
            volume: 1.0,
            pan: 0,
            muted: false,
            locked: false,
            blendMode: 'source-over',
            transform: { positionX: 0, positionY: -120, scaleX: 100, scaleY: 100, uniformScale: true, rotation: 0, opacity: 100, anchorX: 0.5, anchorY: 0.5 },
            keyframes: {
              scaleX: [
                { id: 'tt_k1', time: 0, value: 40, easing: 'ease-out' },
                { id: 'tt_k2', time: 0.4, value: 110, easing: 'ease-in-out' },
                { id: 'tt_k3', time: 0.7, value: 100, easing: 'ease-in-out' },
              ],
            },
            vfxStack: [
              { id: 'v_tt_glow', type: 'glow', name: 'Neon Glow', enabled: true, params: { intensity: 1.0, radius: 30, color: '#ec4899' } },
            ],
            transitionIn: { type: 'none', duration: 0 },
            transitionOut: { type: 'none', duration: 0 },
            textData: {
              text: 'STOP SCROLLING 🔥',
              fontFamily: 'Inter',
              fontSize: 68,
              fontWeight: '900',
              color: '#ffffff',
              strokeColor: '#ec4899',
              strokeWidth: 4,
              align: 'center',
              animation: 'pop-in',
            },
          },
          {
            id: 'tt_lower',
            name: 'Follow Badge Lower Third',
            trackId: 'v2',
            type: 'shape',
            startTime: 1.0,
            duration: 7,
            offset: 0,
            color: '#38bdf8',
            volume: 1.0,
            pan: 0,
            muted: false,
            locked: false,
            blendMode: 'source-over',
            transform: { positionX: 0, positionY: 280, scaleX: 100, scaleY: 100, uniformScale: true, rotation: 0, opacity: 100, anchorX: 0.5, anchorY: 0.5 },
            keyframes: {},
            vfxStack: [],
            transitionIn: { type: 'cross-dissolve', duration: 0.5 },
            transitionOut: { type: 'cross-dissolve', duration: 0.5 },
            shapeData: {
              shapeType: 'lower-third',
              fill: 'rgba(236, 72, 153, 0.9)',
              stroke: '#ffffff',
              strokeWidth: 2,
              cornerRadius: 24,
              label: 'SUBSCRIBE FOR DAILY VFX TIPS',
            },
          },
        ],
        selectedClipId: 'tt_title',
      };
    }

    this.notify();
  }

  // Export State
  setExportProgress(progress: number, text: string) {
    this.state = {
      ...this.state,
      isExporting: progress < 100,
      exportProgress: progress,
      exportStatusText: text,
    };
    this.notify();
  }
}

// Keeps a real-media clip inside its source file: no negative in-point, no trimming past the end
export const MAX_MASTER = 4; // +12 dB

function clampToSource(c: TimelineClip): TimelineClip {
  if (!c.sourceDuration) return c;
  const offset = Math.max(0, Math.min(c.offset, c.sourceDuration - 0.1));
  const duration = Math.max(0.1, Math.min(c.duration, maxDurationFor({ ...c, offset }, c.sourceDuration)));
  return offset === c.offset && duration === c.duration ? c : { ...c, offset, duration };
}

export const fxStore = new EffectsScaleStore();
