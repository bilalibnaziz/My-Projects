import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateEasing } from '../keyframeEngine';
import { fxStore } from '../store';

describe('SkillMotion Superpowers: Physics Spring & Modern Motion Curves', () => {
  it('correctly calculates physics-based spring damped harmonic oscillator', () => {
    expect(evaluateEasing(0, 'spring')).toBe(0);
    expect(evaluateEasing(1, 'spring')).toBe(1);

    // Damped spring overshoots 1.0 around mid-range
    const midVal = evaluateEasing(0.25, 'spring');
    expect(midVal).toBeGreaterThan(1.0);
  });

  it('correctly calculates overshoot curve', () => {
    expect(evaluateEasing(0, 'overshoot')).toBeCloseTo(0, 1);
    expect(evaluateEasing(1, 'overshoot')).toBe(1);

    // Back overshoot peaks slightly above 1.0 before settling
    const peak = evaluateEasing(0.8, 'overshoot');
    expect(peak).toBeGreaterThan(1.0);
  });

  it('correctly calculates anticipate curve pulling back before propulsion', () => {
    expect(evaluateEasing(0, 'anticipate')).toBe(0);
    expect(evaluateEasing(1, 'anticipate')).toBe(1);

    // Anticipate dips below 0 at initial pull-back
    const dip = evaluateEasing(0.15, 'anticipate');
    expect(dip).toBeLessThan(0);
  });

  it('correctly calculates snappy high-velocity curve', () => {
    expect(evaluateEasing(0, 'snappy')).toBe(0);
    expect(evaluateEasing(1, 'snappy')).toBe(1);

    // Reaches > 75% progress by 25% duration
    const fastProgress = evaluateEasing(0.25, 'snappy');
    expect(fastProgress).toBeGreaterThan(0.7);
  });
});

describe('SkillMotion Superpowers: Sound-to-Marker & Reel Reframer', () => {
  beforeEach(() => {
    fxStore.loadPresetProject('cyberpunk');
  });

  it('updates keyframe easing curve across a clip property', () => {
    const clip = fxStore.getState().clips[0];
    fxStore.toggleKeyframe(clip.id, 'scaleX', 100);

    fxStore.setKeyframeEasing(clip.id, 'scaleX', 'spring');
    const updatedClip = fxStore.getState().clips.find((c) => c.id === clip.id);
    expect(updatedClip?.keyframes['scaleX']?.[0]?.easing).toBe('spring');
  });

  it('auto-detects and places rhythmic beat markers across the timeline', () => {
    const initialMarkers = fxStore.getState().markers.length;
    const generated = fxStore.autoDetectBeatMarkers(120);

    expect(generated).toBeGreaterThan(0);
    const markers = fxStore.getState().markers;
    expect(markers.length).toBeGreaterThan(initialMarkers);

    const kick = markers.find((m) => m.label.includes('Kick'));
    const snare = markers.find((m) => m.label.includes('Snare'));
    expect(kick).toBeDefined();
    expect(snare).toBeDefined();
    expect(kick?.color).toBe('#ec4899');
    expect(snare?.color).toBe('#38bdf8');
  });

  it('reframes 16:9 sequence into 9:16 vertical reel with smart ambient blurred backdrop', () => {
    expect(fxStore.getState().resolution.aspectRatio).toBe('16:9');

    fxStore.reframeToVerticalReel(true);

    const state = fxStore.getState();
    expect(state.resolution.aspectRatio).toBe('9:16');
    expect(state.resolution.width).toBe(1080);
    expect(state.resolution.height).toBe(1920);

    // Verify ambient blur backdrop track was created
    const backdropTrack = state.tracks.find((t) => t.id === 'v0_backdrop');
    expect(backdropTrack).toBeDefined();

    // Verify ambient backdrop clip was created with blur VFX and 320% scale
    const backdropClip = state.clips.find((c) => c.trackId === 'v0_backdrop');
    expect(backdropClip).toBeDefined();
    expect(backdropClip?.transform.scaleX).toBe(320);
    expect(backdropClip?.vfxStack.some((v) => v.type === 'blur')).toBe(true);
  });
});
