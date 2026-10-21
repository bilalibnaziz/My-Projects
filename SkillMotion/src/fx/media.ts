// Real footage: probes imported files, and keeps one <video>/<audio> element per source in step with
// the timeline so the compositor can draw the current frame and the mixer can hear it.
import { audioEngine } from './audioEngine';
import { clipSpeed, sourceTimeAt } from './clipTime';
import type { MediaAsset, MediaKind, TimelineClip, TimelineTrack } from './types';

const STILL_DURATION = 5; // Seconds a still image lasts when first placed
const PLAY_DRIFT = 0.25; // Re-seek a playing element once it drifts this far from the timeline
const THUMB_W = 160;
const THUMB_H = 90;

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'ogv'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus', 'aif', 'aiff'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

export function mediaKindOf(file: { type: string; name: string }): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (IMAGE_EXT.includes(ext)) return 'image';
  return null;
}

// Kind of a clip's source: imported clips say so, older sample clips are recognised by extension
export function clipMediaKind(clip: Pick<TimelineClip, 'sourceUrl' | 'mediaKind'>): MediaKind | null {
  if (!clip.sourceUrl) return null;
  if (clip.mediaKind) return clip.mediaKind;
  return mediaKindOf({ type: '', name: clip.sourceUrl.split('?')[0] });
}

function once(el: EventTarget, event: string, ms = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener('error', onErr);
      if (ok) resolve();
      else reject(new Error(`media ${event} failed`));
    };
    const onOk = () => done(true);
    const onErr = () => done(false);
    const timer = setTimeout(() => done(false), ms);
    el.addEventListener(event, onOk);
    el.addEventListener('error', onErr);
  });
}

function thumbnailOf(src: CanvasImageSource, w: number, h: number): string | undefined {
  if (!w || !h) return undefined;
  const c = document.createElement('canvas');
  c.width = THUMB_W;
  c.height = THUMB_H;
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  const r = containRect(w, h, THUMB_W, THUMB_H);
  ctx.drawImage(src, r.x, r.y, r.w, r.h);
  try {
    return c.toDataURL('image/jpeg', 0.7);
  } catch {
    return undefined;
  }
}

// Reads duration, size and a thumbnail from a dropped / picked file
export async function probeFile(file: File): Promise<MediaAsset | null> {
  const kind = mediaKindOf(file);
  if (!kind) return null;
  const url = URL.createObjectURL(file);
  const base = {
    id: 'asset_' + Math.random().toString(36).slice(2, 9),
    name: file.name,
    url,
    mediaKind: kind,
    type: kind === 'audio' ? ('audio' as const) : ('video' as const),
    category: kind === 'audio' ? ('audio' as const) : ('video' as const),
  };
  try {
    if (kind === 'image') {
      const img = new Image();
      img.src = url;
      await img.decode();
      return {
        ...base,
        duration: STILL_DURATION,
        width: img.naturalWidth,
        height: img.naturalHeight,
        thumbnail: thumbnailOf(img, img.naturalWidth, img.naturalHeight),
      };
    }
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    el.preload = 'auto';
    el.muted = true;
    el.src = url;
    await once(el, 'loadedmetadata');
    let duration = el.duration;
    if (!Number.isFinite(duration)) {
      // Recorder-made WebM files report Infinity until the end has been seen
      el.currentTime = 1e9;
      await once(el, 'seeked').catch(() => {});
      duration = el.duration;
    }
    if (!Number.isFinite(duration) || duration <= 0) duration = STILL_DURATION;
    if (el instanceof HTMLVideoElement) {
      el.currentTime = Math.min(1, duration * 0.1);
      await once(el, 'seeked').catch(() => {});
      return {
        ...base,
        duration,
        width: el.videoWidth,
        height: el.videoHeight,
        thumbnail: thumbnailOf(el, el.videoWidth, el.videoHeight),
      };
    }
    return { ...base, duration };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

export async function probeFiles(files: Iterable<File>): Promise<{ assets: MediaAsset[]; rejected: string[] }> {
  const assets: MediaAsset[] = [];
  const rejected: string[] = [];
  for (const f of files) {
    const a = await probeFile(f);
    if (a) assets.push(a);
    else rejected.push(f.name);
  }
  return { assets, rejected };
}

// Largest rect of aspect w:h that fits inside boxW × boxH, centred
export function containRect(w: number, h: number, boxW: number, boxH: number) {
  const s = Math.min(boxW / w, boxH / h);
  const rw = w * s;
  const rh = h * s;
  return { x: (boxW - rw) / 2, y: (boxH - rh) / 2, w: rw, h: rh };
}

// ---------------------------------------------------------------- element pool

const elements = new Map<string, HTMLMediaElement>();
const routes = new Map<HTMLMediaElement, { gain: GainNode; panner: StereoPannerNode } | null>();
const clipKeys = new Map<string, string>(); // clip id → element key it is currently using
const images = new Map<string, HTMLImageElement>();
const frameListeners = new Set<() => void>();
let activeKeys = new Set<string>(); // Elements the last sync needed

const notifyFrame = () => frameListeners.forEach((fn) => fn());

// Called when a paused seek lands or an image finishes loading, so the monitor can redraw
export function onMediaFrame(fn: () => void): () => void {
  frameListeners.add(fn);
  return () => frameListeners.delete(fn);
}

export function imageFor(url: string): HTMLImageElement | null {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.onload = notifyFrame;
    img.src = url;
    images.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

function elementFor(key: string, url: string, kind: 'video' | 'audio'): HTMLMediaElement {
  let el = elements.get(key);
  if (!el) {
    el = document.createElement(kind);
    el.preload = 'auto';
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    el.addEventListener('seeked', notifyFrame);
    el.addEventListener('loadeddata', notifyFrame);
    el.src = url;
    elements.set(key, el);
  }
  return el;
}

// Current decoded frame of a video clip, or null while it is still loading
export function videoFrameFor(clip: TimelineClip): HTMLVideoElement | null {
  const key = clipKeys.get(clip.id) ?? clip.sourceUrl;
  const el = key ? elements.get(key) : undefined;
  return el instanceof HTMLVideoElement && el.readyState >= 2 && el.videoWidth > 0 ? el : null;
}

function setLevel(el: HTMLMediaElement, gain: number, pan: number, trackId: string) {
  if (!routes.has(el)) routes.set(el, audioEngine.attachMediaElement(el));
  const route = routes.get(el);
  if (route) {
    route.gain.gain.value = gain;
    route.panner.pan.value = Math.max(-1, Math.min(1, pan));
    audioEngine.routeToTrack(route.panner, trackId); // per-track meter in the mixer
  } else {
    el.volume = Math.max(0, Math.min(1, gain));
  }
}

// Seeks / plays / pauses every source so it shows and sounds the timeline at `time`
export function syncMedia(tracks: TimelineTrack[], clips: TimelineClip[], time: number, playing: boolean, fps = 30) {
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const anySolo = tracks.some((t) => t.solo);
  const active = new Set<string>();

  for (const clip of clips) {
    const kind = clipMediaKind(clip);
    if (!clip.sourceUrl || (kind !== 'video' && kind !== 'audio')) continue;
    const track = trackById.get(clip.trackId);
    const local = time - clip.startTime;
    if (!track || local < 0 || local >= clip.duration) continue;

    let key = clip.sourceUrl;
    if (active.has(key)) key += '#' + clip.id; // Same file twice at once needs its own element
    active.add(key);
    clipKeys.set(clip.id, key);

    const el = elementFor(key, clip.sourceUrl, kind);
    const audible = !clip.muted && !track.muted && (!anySolo || track.solo);
    setLevel(el, audible ? clip.volume * track.volume : 0, clip.pan + track.pan, track.id);

    // Speed / reverse: the element plays at the clip's rate (pitch follows, as in the export mix);
    // a reversed clip can't play backwards, so it is stepped by seeking every frame instead
    const speed = clipSpeed(clip);
    const target = Math.min(sourceTimeAt(clip, local), (clip.sourceDuration ?? Infinity) - 1e-3);
    if (el.playbackRate !== speed) el.playbackRate = speed;
    el.preservesPitch = false;
    if (playing && !clip.reversed) {
      if (Math.abs(el.currentTime - target) > PLAY_DRIFT * Math.max(1, speed)) el.currentTime = target;
      if (el.paused) el.play().catch(() => {});
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - target) > 0.5 / fps) el.currentTime = target;
    }
  }

  for (const [key, el] of elements) if (!active.has(key) && !el.paused) el.pause();
  activeKeys = active;
}

export function pauseAllMedia() {
  for (const el of elements.values()) if (!el.paused) el.pause();
}

// Resolves once every source the timeline needs at `time` has a frame ready (or after `ms`)
export async function mediaSettled(ms = 4000): Promise<void> {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const busy = [...activeKeys].some((k) => {
      const el = elements.get(k);
      return !!el && !el.error && (el.seeking || el.readyState < 2);
    });
    if (!busy) return;
    await new Promise((r) => setTimeout(r, 30));
  }
}
