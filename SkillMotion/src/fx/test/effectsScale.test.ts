import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateEasing, evaluateProperty, setKeyframe, removeKeyframeAt, hasKeyframeAt } from '../keyframeEngine';
import { fxStore, RESOLUTION_PRESETS } from '../store';
import { Keyframe } from '../types';

describe('Effects Scale - Keyframe Engine', () => {
  it('evaluates cubic easing curves accurately', () => {
    expect(evaluateEasing(0, 'linear')).toBe(0);
    expect(evaluateEasing(1, 'linear')).toBe(1);
    expect(evaluateEasing(0.5, 'linear')).toBe(0.5);

    // Ease in: slow start
    expect(evaluateEasing(0.5, 'ease-in')).toBeCloseTo(0.125, 3);

    // Ease out: fast start, soft stop
    expect(evaluateEasing(0.5, 'ease-out')).toBeCloseTo(0.875, 3);

    // Ease in-out: S-curve
    expect(evaluateEasing(0.5, 'ease-in-out')).toBeCloseTo(0.5, 3);
  });

  it('interpolates property values between keyframes at timestamp t', () => {
    const keyframes: Keyframe[] = [
      { id: '1', time: 1.0, value: 100, easing: 'linear' },
      { id: '2', time: 3.0, value: 200, easing: 'linear' },
    ];

    // Before first keyframe
    expect(evaluateProperty(0, keyframes, 0.5)).toBe(100);

    // After last keyframe
    expect(evaluateProperty(0, keyframes, 4.0)).toBe(200);

    // Midway at t = 2.0 (50% progress)
    expect(evaluateProperty(0, keyframes, 2.0)).toBe(150);
  });

  it('adds, updates, and removes keyframes', () => {
    let kfs: Keyframe[] = [];
    kfs = setKeyframe(kfs, 1.5, 120, 'ease-in-out');
    expect(kfs.length).toBe(1);
    expect(kfs[0].value).toBe(120);

    // Update existing keyframe near 1.5
    kfs = setKeyframe(kfs, 1.51, 140, 'ease-in-out');
    expect(kfs.length).toBe(1);
    expect(kfs[0].value).toBe(140);

    // Add second keyframe
    kfs = setKeyframe(kfs, 4.0, 300, 'linear');
    expect(kfs.length).toBe(2);

    expect(hasKeyframeAt(kfs, 1.5)).toBe(true);
    expect(hasKeyframeAt(kfs, 9.9)).toBe(false);

    // Remove keyframe
    kfs = removeKeyframeAt(kfs, 1.5);
    expect(kfs.length).toBe(1);
    expect(kfs[0].time).toBe(4.0);
  });
});

describe('Effects Scale - 2-in-1 NLE & VFX Store', () => {
  beforeEach(() => {
    fxStore.loadPresetProject('cyberpunk');
  });

  it('initializes with default multi-track sequence', () => {
    const state = fxStore.getState();
    expect(state.tracks.length).toBeGreaterThanOrEqual(5);
    expect(state.clips.length).toBeGreaterThan(0);
    expect(state.projectName).toContain('Cyberpunk');
  });

  it('performs Premiere Pro Razor / Split operation at playhead', () => {
    fxStore.setCurrentTime(4.0);
    const clipToSplit = fxStore.getState().clips.find((c) => c.trackId === 'v1')!;
    const initialClipCount = fxStore.getState().clips.length;

    fxStore.splitClipAtPlayhead(clipToSplit.id);

    const nextClips = fxStore.getState().clips;
    expect(nextClips.length).toBe(initialClipCount + 1);

    const part1 = nextClips.find((c) => c.id === clipToSplit.id)!;
    expect(part1.duration).toBeCloseTo(4.0, 1);
  });

  it('supports ripple delete', () => {
    const clips = fxStore.getState().clips;
    const initialCount = clips.length;
    const clipId = clips[0].id;

    fxStore.rippleDeleteClip(clipId);
    expect(fxStore.getState().clips.length).toBe(initialCount - 1);
  });

  it('manages VFX stack on clips', () => {
    const clip = fxStore.getState().clips[0];
    const initialVfxCount = clip.vfxStack.length;

    fxStore.addVFX(clip.id, 'chromatic');
    const updatedClip = fxStore.getState().clips.find((c) => c.id === clip.id)!;
    expect(updatedClip.vfxStack.length).toBe(initialVfxCount + 1);

    const addedFx = updatedClip.vfxStack[updatedClip.vfxStack.length - 1];
    expect(addedFx.type).toBe('chromatic');

    // Toggle effect
    fxStore.toggleVFX(clip.id, addedFx.id);
    const toggled = fxStore.getState().clips.find((c) => c.id === clip.id)!;
    expect(toggled.vfxStack.find((f) => f.id === addedFx.id)!.enabled).toBe(false);

    // Remove effect
    fxStore.removeVFX(clip.id, addedFx.id);
    const removed = fxStore.getState().clips.find((c) => c.id === clip.id)!;
    expect(removed.vfxStack.length).toBe(initialVfxCount);
  });

  it('switches workspaces cleanly', () => {
    fxStore.setWorkspace('vfx');
    expect(fxStore.getState().workspace).toBe('vfx');

    fxStore.setWorkspace('color');
    expect(fxStore.getState().workspace).toBe('color');

    fxStore.setWorkspace('audio');
    expect(fxStore.getState().workspace).toBe('audio');

    fxStore.setWorkspace('deliver');
    expect(fxStore.getState().workspace).toBe('deliver');
  });

  it('updates project resolution and FPS presets', () => {
    const preset4k = RESOLUTION_PRESETS[1];
    fxStore.setResolution(preset4k);
    expect(fxStore.getState().resolution.width).toBe(3840);
    expect(fxStore.getState().resolution.height).toBe(2160);

    fxStore.setFps(60);
    expect(fxStore.getState().fps).toBe(60);
  });
});
