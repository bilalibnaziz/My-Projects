// Offline export: renders every frame at its exact time and encodes it with WebCodecs, faster than real
// time when frames are simple and never dropping or repeating a frame when they are heavy. The audio mix
// is rendered in an OfflineAudioContext with the same levels the live mixer uses.
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  Input,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_VERY_HIGH,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';
import type { TimelineClip, TimelineTrack } from './types';
import { clipMediaKind, mediaSettled, pauseAllMedia, syncMedia } from './media';
import { renderCompositionFrame } from './compositor';
import { clipSpeed, sourceTimeAt } from './clipTime';

export const SAMPLE_RATE = 48000;

/** One media file playing on the timeline, as the mixer hears it. */
export interface AudioPlacement {
  url: string;
  when: number; // seconds into the export
  offset: number; // seconds into the source file (start of the used range, also when reversed)
  duration: number; // seconds on the timeline
  rate: number; // clip speed: source seconds per timeline second
  reversed: boolean;
  gain: number;
  pan: number;
}

/** The built-in generated beat (kick on whole seconds, snare on the half seconds between). */
export interface BeatHit {
  when: number;
  kind: 'kick' | 'snare';
}

export interface AudioPlan {
  placements: AudioPlacement[];
  beats: BeatHit[];
  master: number; // master fader gain
}

function audibleTracks(tracks: TimelineTrack[]) {
  const anySolo = tracks.some((t) => t.solo);
  return new Map(tracks.filter((t) => !t.muted && (!anySolo || t.solo)).map((t) => [t.id, t]));
}

/** Everything that sounds between `start` and `end`, with times relative to `start`. */
export function planAudio(tracks: TimelineTrack[], clips: TimelineClip[], start: number, end: number, master = 1): AudioPlan {
  const audible = audibleTracks(tracks);
  const placements: AudioPlacement[] = [];
  for (const clip of clips) {
    const kind = clipMediaKind(clip);
    const track = audible.get(clip.trackId);
    if (!clip.sourceUrl || (kind !== 'audio' && kind !== 'video') || !track || clip.muted) continue;
    const from = Math.max(start, clip.startTime);
    const to = Math.min(end, clip.startTime + clip.duration);
    if (to <= from) continue;
    const a = sourceTimeAt(clip, from - clip.startTime);
    const b = sourceTimeAt(clip, to - clip.startTime);
    placements.push({
      url: clip.sourceUrl,
      when: from - start,
      offset: Math.min(a, b),
      duration: to - from,
      rate: clipSpeed(clip),
      reversed: !!clip.reversed,
      gain: clip.volume * track.volume,
      pan: Math.max(-1, Math.min(1, clip.pan + track.pan)),
    });
  }

  // Generated audio clips (no source file) play the timeline beat, on quarter-second steps
  const generated = clips.filter((c) => c.type === 'audio' && !c.sourceUrl && !c.muted && audible.has(c.trackId));
  const beats: BeatHit[] = [];
  for (let k = Math.ceil(start * 4 - 1e-9); k / 4 < end - 1e-9; k++) {
    const t = k / 4;
    if (k % 2 !== 0 || !generated.some((c) => t >= c.startTime && t < c.startTime + c.duration)) continue;
    beats.push({ when: t - start, kind: k % 4 === 0 ? 'kick' : 'snare' });
  }
  return { placements, beats, master };
}

const decoded = new Map<string, Promise<AudioBuffer | null>>();
const reversedBuffers = new Map<string, Promise<AudioBuffer | null>>();
let decoder: OfflineAudioContext | null = null;

/** The sound of a source file at 48 kHz, decoded once and shared by export, waveforms and loudness. */
export function decodeSource(url: string): Promise<AudioBuffer | null> {
  let p = decoded.get(url);
  if (!p) {
    decoder ??= new OfflineAudioContext(2, 1, SAMPLE_RATE);
    const ctx = decoder;
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .catch(() => null); // A file without an audio track (or one the browser can't decode) is silent
    decoded.set(url, p);
  }
  return p;
}

function reversedSource(url: string): Promise<AudioBuffer | null> {
  let p = reversedBuffers.get(url);
  if (!p) {
    p = decodeSource(url).then((buf) => {
      if (!buf) return null;
      const out = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
      for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).slice().reverse(), c);
      return out;
    });
    reversedBuffers.set(url, p);
  }
  return p;
}

export function channelsOf(buf: AudioBuffer): Float32Array[] {
  return Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
}

/** Renders the plan to a stereo buffer. */
export async function mixAudio(plan: AudioPlan, duration: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * SAMPLE_RATE)), SAMPLE_RATE);
  const out = ctx.createGain();
  out.gain.value = plan.master ?? 1;
  out.connect(ctx.destination);
  for (const p of plan.placements) {
    const buf = await (p.reversed ? reversedSource(p.url) : decodeSource(p.url));
    if (!buf || p.offset >= buf.duration) continue;
    const rate = p.rate ?? 1;
    const span = Math.min(p.duration * rate, buf.duration - p.offset); // source seconds used
    // A reversed buffer is read from its end: source [offset, offset + span] sits at length − offset − span
    const at = p.reversed ? Math.max(0, buf.duration - p.offset - span) : p.offset;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = p.gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = p.pan;
    src.connect(gain).connect(pan).connect(out);
    src.start(p.when, at, span);
  }
  // Same voices as the live beat in audioEngine.playTimelineAudioClock
  for (const b of plan.beats) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = b.when;
    if (b.kind === 'kick') {
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, t);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    }
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);
  }
  return ctx.startRendering();
}

export interface ExportFormat {
  container: 'mp4' | 'webm';
  video: 'avc' | 'vp9';
  audio: 'aac' | 'opus';
}

/** True when this browser can encode frames itself (Chrome, Edge, Safari 16.4+). */
export function offlineExportAvailable(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof OfflineAudioContext !== 'undefined';
}

/** MP4 (H.264 + AAC) when the browser can encode it, else WebM (VP9 + Opus), else null. */
export async function pickExportFormat(width: number, height: number, fps: number): Promise<ExportFormat | null> {
  if (!offlineExportAvailable()) return null;
  const v = { width, height, frameRate: fps, quality: QUALITY_VERY_HIGH };
  const a = { numberOfChannels: 2, sampleRate: SAMPLE_RATE, quality: QUALITY_HIGH };
  if ((await canEncodeVideo('avc', v)) && (await canEncodeAudio('aac', a))) return { container: 'mp4', video: 'avc', audio: 'aac' };
  if ((await canEncodeVideo('vp9', v)) && (await canEncodeAudio('opus', a))) return { container: 'webm', video: 'vp9', audio: 'opus' };
  return null;
}

export interface OfflineRenderOptions {
  width: number;
  height: number;
  fps: number;
  start: number;
  end: number;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  master?: number;
  format: ExportFormat;
  onProgress?: (frame: number, total: number) => void;
  isCancelled?: () => boolean;
}

/** Renders and encodes the range. Resolves to the file, or null when cancelled. */
export async function renderOffline(o: OfflineRenderOptions): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext('2d')!;
  const duration = Math.max(1 / o.fps, o.end - o.start);
  const total = Math.max(1, Math.round(duration * o.fps));

  const output = new Output({
    format: o.format.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, { codec: o.format.video, quality: QUALITY_VERY_HIGH, keyFrameInterval: 2 });
  const audio = new AudioBufferSource({ codec: o.format.audio, quality: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: o.fps });
  output.addAudioTrack(audio);
  await output.start();

  try {
    const mix = mixAudio(planAudio(o.tracks, o.clips, o.start, o.end, o.master ?? 1), total / o.fps);
    for (let n = 0; n < total; n++) {
      if (o.isCancelled?.()) {
        await output.cancel();
        return null;
      }
      const t = o.start + n / o.fps;
      // Paused seek to the exact frame, then wait until every source shows it
      syncMedia(o.tracks, o.clips, t, false, o.fps);
      await mediaSettled();
      renderCompositionFrame(ctx, o.width, o.height, o.tracks, o.clips, t, null, false);
      await video.add(n / o.fps, 1 / o.fps);
      o.onProgress?.(n + 1, total);
    }
    await audio.add(await mix);
    await output.finalize();
  } finally {
    pauseAllMedia();
  }
  const type = o.format.container === 'mp4' ? 'video/mp4' : 'video/webm';
  return new Blob([output.target.buffer!], { type });
}

/** Number of video frames in an exported file (used to check that no frame was dropped or repeated). */
export async function countVideoFrames(file: Blob): Promise<number> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  return track ? (await track.computePacketStats()).packetCount : 0;
}
