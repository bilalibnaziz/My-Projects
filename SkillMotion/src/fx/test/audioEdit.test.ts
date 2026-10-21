import { describe, it, expect, beforeEach } from 'vitest';
import { fxStore } from '../store';
import { sourceTimeAt } from '../clipTime';
import type { TimelineClip } from '../types';

const s = fxStore as unknown as { state: ReturnType<typeof fxStore.getState>; notify(): void };

function voice(patch: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'voice',
    name: 'Voice',
    trackId: 'a1',
    type: 'audio',
    startTime: 2,
    duration: 10,
    offset: 0,
    color: '#fff',
    volume: 1,
    pan: 0,
    muted: false,
    locked: false,
    blendMode: 'source-over',
    sourceUrl: 'blob:voice',
    mediaKind: 'audio',
    sourceDuration: 30,
    transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, uniformScale: true, rotation: 0, opacity: 100, anchorX: 0.5, anchorY: 0.5 },
    keyframes: {},
    vfxStack: [],
    transitionIn: { type: 'none', duration: 0 },
    transitionOut: { type: 'none', duration: 0 },
    ...patch,
  };
}

const after = (patch: Partial<TimelineClip> = {}): TimelineClip => voice({ id: 'after', name: 'After', startTime: 12, duration: 2, offset: 0, ...patch });

beforeEach(() => {
  s.state = { ...s.state, clips: [voice(), after()], selectedClipId: 'voice', masterVolume: 1, currentTime: 0 };
});

describe('audio editing', () => {
  it('Remove Silence cuts the pauses and pulls later clips on the track forward', () => {
    // Source 4–6 s and 9–10 s are quiet: timeline 6–8 and 11–12
    const r = fxStore.removeSilence('voice', [[4, 6], [9, 10]], { pad: 0 });
    const clips = fxStore.getState().clips.filter((c) => c.trackId === 'a1').sort((a, b) => a.startTime - b.startTime);
    expect(r.saved).toBeCloseTo(3, 6);
    expect(r.cuts).toBe(2);
    expect(clips.map((c) => [c.startTime, c.duration, c.offset])).toEqual([
      [2, 4, 0],
      [6, 3, 6],
      [9, 2, 0], // the next clip, moved up by the 3 s saved
    ]);
    fxStore.undo();
    expect(fxStore.getState().clips.map((c) => c.startTime).sort()).toEqual([12, 2]);
  });

  it('Remove Silence on a 2× reversed clip keeps the same source seconds', () => {
    s.state = { ...s.state, clips: [voice({ speed: 2, reversed: true, duration: 5, offset: 0 })] };
    const before = voice({ speed: 2, reversed: true, duration: 5, offset: 0 });
    fxStore.removeSilence('voice', [[4, 6]], { pad: 0 }); // local 2–3
    const parts = fxStore.getState().clips.sort((a, b) => a.startTime - b.startTime);
    expect(parts).toHaveLength(2);
    // First piece = local 0–2 of the original: source 10 → 6
    expect(sourceTimeAt(parts[0], 0)).toBeCloseTo(sourceTimeAt(before, 0), 6);
    expect(sourceTimeAt(parts[0], 1.999)).toBeCloseTo(sourceTimeAt(before, 1.999), 6);
    // Second piece = local 3–5 of the original, now starting right after the first
    expect(parts[1].startTime).toBeCloseTo(parts[0].startTime + 2, 6);
    expect(sourceTimeAt(parts[1], 0.5)).toBeCloseTo(sourceTimeAt(before, 3.5), 6);
  });

  it('splitting a 2× clip keeps the second half on the right frames', () => {
    s.state = { ...s.state, clips: [voice({ speed: 2, duration: 5 })], currentTime: 4 };
    fxStore.splitClipAtPlayhead('voice');
    const [l, r] = fxStore.getState().clips.sort((a, b) => a.startTime - b.startTime);
    expect([l.offset, l.duration, r.offset, r.duration]).toEqual([0, 2, 4, 3]);
  });

  it('trims stop at the end of the source at the clip speed', () => {
    s.state = { ...s.state, clips: [voice({ speed: 2, offset: 20 })] };
    fxStore.updateClipTiming('voice', { duration: 50 });
    expect(fxStore.getState().clips[0].duration).toBe(5); // (30 − 20) / 2
  });

  it('master fader is undoable when set in one go, and solo toggles', () => {
    fxStore.setMasterVolume(2, true);
    expect(fxStore.getState().masterVolume).toBe(2);
    fxStore.undo();
    expect(fxStore.getState().masterVolume).toBe(1);
    fxStore.setMasterVolume(99);
    expect(fxStore.getState().masterVolume).toBe(4);
    const id = fxStore.getState().tracks[0].id;
    fxStore.toggleTrackSolo(id);
    expect(fxStore.getState().tracks[0].solo).toBe(true);
    fxStore.toggleTrackSolo(id);
    expect(fxStore.getState().tracks[0].solo).toBe(false);
  });
});
