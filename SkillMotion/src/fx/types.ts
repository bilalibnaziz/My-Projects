export type WorkspaceMode = 'edit' | 'vfx' | 'color' | 'audio' | 'deliver';

export type ToolType = 'select' | 'razor' | 'ripple' | 'slip' | 'hand' | 'zoom' | 'text' | 'shape';

// What an imported source file holds; drives how the compositor and media sync treat a clip
export type MediaKind = 'video' | 'image' | 'audio';

export type ClipType = 
  | 'video' 
  | 'audio' 
  | 'text' 
  | 'shape' 
  | 'solid' 
  | 'adjustment' 
  | 'particles' 
  | 'visualizer';

export type KeyframeEasing =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'hold'
  | 'easy-ease'
  | 'bounce'
  | 'elastic'
  | 'spring'
  | 'overshoot'
  | 'anticipate'
  | 'snappy';

export interface Keyframe {
  id: string;
  time: number; // In seconds relative to clip start
  value: number;
  easing: KeyframeEasing;
}

export interface TransformProperties {
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
  uniformScale: boolean;
  rotation: number; // In degrees
  opacity: number; // 0 to 100
  anchorX: number; // 0 to 1 (normalized to clip center)
  anchorY: number; // 0 to 1
}

export type VFXType = 
  | 'glow' 
  | 'chromatic' 
  | 'glitch' 
  | 'film-grain' 
  | 'lens-flare' 
  | 'chroma-key' 
  | 'blur' 
  | 'camera-shake' 
  | 'vignette' 
  | 'letterbox' 
  | 'lumetri';

export interface VFXEffect {
  id: string;
  type: VFXType;
  name: string;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export type TransitionType = 'none' | 'cross-dissolve' | 'dip-black' | 'dip-white' | 'whip-pan' | 'glitch' | 'zoom-blur' | 'wipe-left';

export interface Transition {
  type: TransitionType;
  duration: number; // In seconds
}

export interface TextClipData {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  align: 'left' | 'center' | 'right';
  animation: 'none' | 'typewriter' | 'pop-in' | 'slide-up' | 'glow-pulse';
}

export interface ShapeClipData {
  shapeType: 'rectangle' | 'circle' | 'star' | 'polygon' | 'lower-third' | 'badge';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  label?: string;
}

export interface SolidClipData {
  color: string;
  gradient?: {
    type: 'linear' | 'radial';
    stops: [number, string][];
  };
}

export interface ParticleClipData {
  preset: 'sparks' | 'dust' | 'bokeh' | 'stars' | 'digital-rain' | 'snow';
  count: number;
  speed: number;
  size: number;
  color: string;
}

export interface VisualizerClipData {
  type: 'bars' | 'wave' | 'circle' | 'glow-spectrum';
  barCount: number;
  color1: string;
  color2: string;
}

export interface TimelineClip {
  id: string;
  name: string;
  trackId: string;
  type: ClipType;
  startTime: number; // In seconds on timeline
  duration: number; // In seconds
  offset: number; // In seconds (trim start offset)
  speed?: number; // Playback speed multiplier (0.25 to 16, default 1.0)
  reversed?: boolean; // Reverse clip playback
  color: string; // Color tag for timeline clip
  volume: number; // 0 to 2 (1.0 = 0dB)
  pan: number; // -1 to 1
  muted: boolean;
  locked: boolean;
  blendMode: GlobalCompositeOperation;
  sourceUrl?: string;
  mediaKind?: MediaKind;
  mediaWidth?: number;
  mediaHeight?: number;
  sourceDuration?: number; // Length of the source file; trims can't run past it
  
  // Transform defaults
  transform: TransformProperties;

  // Keyframed properties: key is property name, value is array of keyframes
  keyframes: Record<string, Keyframe[]>;

  // VFX stack
  vfxStack: VFXEffect[];

  // Transitions
  transitionIn: Transition;
  transitionOut: Transition;

  // Type-specific data
  textData?: TextClipData;
  shapeData?: ShapeClipData;
  solidData?: SolidClipData;
  particleData?: ParticleClipData;
  visualizerData?: VisualizerClipData;
}

export interface TimelineTrack {
  id: string;
  name: string;
  type: 'video' | 'audio';
  visible: boolean;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  volume: number; // 0 to 1.5 (default 1.0)
  pan: number; // -1 to 1
  height: number; // In pixels
}

export interface Marker {
  id: string;
  time: number;
  color: string;
  label: string;
}

export interface ResolutionPreset {
  name: string;
  width: number;
  height: number;
  aspectRatio: string;
}

export interface MediaAsset {
  id: string;
  name: string;
  type: ClipType;
  url?: string;
  mediaKind?: MediaKind;
  duration: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  category: 'video' | 'audio' | 'graphics' | 'preset';
}
