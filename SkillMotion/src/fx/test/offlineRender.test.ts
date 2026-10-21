import { describe, it, expect } from 'vitest';
import { planAudio } from '../offlineRender';
import type { TimelineClip, TimelineTrack } from '../types';

const track = (id: string, patch: Partial<TimelineTrack> = {}): TimelineTrack => ({
  id,
  name: id,
  type: 'audio',
  visible: true,
  muted: false,
  solo: false,
  locked: false,
  volume: 1,
  pan: 0,
  height: 40,
  ...patch,
});

const clip = (id: string, trackId: string, patch: Partial<TimelineClip>): TimelineClip =>
  ({
    id,
    name: id,
    trackId,
    type: 'audio',
    startTime: 0,
    duration: 4,
    offset: 0,
    color: '#fff',
    volume: 1,
    pan: 0,
    muted: false,
    locked: false,
    blendMode: 'source-over',
    keyframes: {},
    vfxStack: [],
    ...patch,
  }) as TimelineClip;

describe('offline export - audio plan', () => {
  it('places a trimmed clip at its timeline time with clip × track level and pan', () => {
    const plan = planAudio(
      [track('a1', { volume: 0.5, pan: 0.25 })],
      [clip('song', 'a1', { sourceUrl: 'blob:song', mediaKind: 'audio', startTime: 2, duration: 5, offset: 3, volume: 0.8, pan: 0.5 })],
      0,
      10
    );
    expect(plan.placements).toEqual([{ url: 'blob:song', when: 2, offset: 3, duration: 5, rate: 1, reversed: false, gain: 0.4, pan: 0.75 }]);
  });

  it('speed and reverse map the export range onto the right source seconds', () => {
    const fast = planAudio([track('a1')], [clip('s', 'a1', { sourceUrl: 'blob:s', mediaKind: 'audio', startTime: 0, duration: 4, offset: 1, speed: 2 })], 1, 3);
    expect(fast.placements[0]).toMatchObject({ when: 0, offset: 3, duration: 2, rate: 2, reversed: false });
    // Reversed 4 s clip over source 1–9: timeline 1–3 hears source 7 → 3, i.e. the range 3–7
    const back = planAudio([track('a1')], [clip('s', 'a1', { sourceUrl: 'blob:s', mediaKind: 'audio', startTime: 0, duration: 4, offset: 1, speed: 2, reversed: true })], 1, 3);
    expect(back.placements[0]).toMatchObject({ when: 0, offset: 3, duration: 2, rate: 2, reversed: true });
  });

  it('carries the master fader', () => {
    expect(planAudio([track('a1')], [], 0, 1, 0.5).master).toBe(0.5);
  });

  it('cuts clips to the export range', () => {
    const plan = planAudio([track('a1')], [clip('song', 'a1', { sourceUrl: 'blob:song', mediaKind: 'audio', startTime: 1, duration: 10, offset: 0 })], 4, 6);
    expect(plan.placements[0]).toMatchObject({ when: 0, offset: 3, duration: 2 });
  });

  it('includes the sound of video clips, and drops muted clips, muted tracks and non-solo tracks', () => {
    const tracks = [track('v1', { type: 'video' }), track('a1', { muted: true }), track('a2'), track('a3', { solo: true })];
    const clips = [
      clip('film', 'v1', { type: 'video', sourceUrl: 'blob:film', mediaKind: 'video' }),
      clip('muted-track', 'a1', { sourceUrl: 'blob:x', mediaKind: 'audio' }),
      clip('muted-clip', 'a3', { sourceUrl: 'blob:y', mediaKind: 'audio', muted: true }),
      clip('solo', 'a3', { sourceUrl: 'blob:solo', mediaKind: 'audio' }),
      clip('not-solo', 'a2', { sourceUrl: 'blob:z', mediaKind: 'audio' }),
    ];
    expect(planAudio(tracks, clips, 0, 4).placements.map((p) => p.url)).toEqual(['blob:solo']);
    expect(planAudio(tracks.map((t) => ({ ...t, solo: false })), clips, 0, 4).placements.map((p) => p.url)).toEqual(['blob:film', 'blob:solo', 'blob:z']);
  });

  it('plays the generated beat: kick on whole seconds, snare on the halves, only inside generated clips', () => {
    const plan = planAudio([track('a1')], [clip('beat', 'a1', { startTime: 1, duration: 2 })], 0, 5);
    expect(plan.beats).toEqual([
      { when: 1, kind: 'kick' },
      { when: 1.5, kind: 'snare' },
      { when: 2, kind: 'kick' },
      { when: 2.5, kind: 'snare' },
    ]);
  });

  it('times beats relative to the start of the export range', () => {
    const plan = planAudio([track('a1')], [clip('beat', 'a1', { startTime: 0, duration: 10 })], 3.2, 4.1);
    expect(plan.beats).toEqual([
      { when: 0.5 - 0.2, kind: 'snare' },
      { when: 1 - 0.2, kind: 'kick' },
    ].map((b) => ({ ...b, when: expect.closeTo(b.when, 9) })));
  });
});
