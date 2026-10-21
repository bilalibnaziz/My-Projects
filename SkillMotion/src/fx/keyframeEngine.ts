import { Keyframe, KeyframeEasing } from './types';

// Evaluates an easing curve from 0 to 1
export function evaluateEasing(t: number, easing: KeyframeEasing): number {
  const clampedT = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'linear':
      return clampedT;
    case 'ease-in':
      return clampedT * clampedT * clampedT; // Cubic ease in
    case 'ease-out':
      return 1 - Math.pow(1 - clampedT, 3); // Cubic ease out
    case 'ease-in-out':
      return clampedT < 0.5
        ? 4 * clampedT * clampedT * clampedT
        : 1 - Math.pow(-2 * clampedT + 2, 3) / 2; // Smooth S-curve
    case 'hold':
      return clampedT >= 1 ? 1 : 0;
    case 'easy-ease':
      return clampedT * clampedT * (3 - 2 * clampedT);
    case 'bounce': {
      let n1 = 7.5625, d1 = 2.75, x = clampedT;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
      if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
      return n1 * (x -= 2.625 / d1) * x + 0.984375;
    }
    case 'elastic': {
      if (clampedT === 0) return 0;
      if (clampedT === 1) return 1;
      return -Math.pow(2, 10 * clampedT - 10) * Math.sin((clampedT * 10 - 10.75) * ((2 * Math.PI) / 3));
    }
    case 'spring': {
      if (clampedT === 0) return 0;
      if (clampedT === 1) return 1;
      return 1 - Math.exp(-6 * clampedT) * Math.cos(12 * clampedT);
    }
    case 'overshoot': {
      const s = 1.70158;
      const x = clampedT - 1;
      return x * x * ((s + 1) * x + s) + 1;
    }
    case 'anticipate': {
      if (clampedT === 0) return 0;
      if (clampedT === 1) return 1;
      const s = 1.70158;
      if (clampedT < 0.5) {
        const x = clampedT * 2;
        return 0.5 * (x * x * ((s + 1) * x - s));
      } else {
        const x = clampedT * 2 - 2;
        return 0.5 * (x * x * ((s + 1) * x + s) + 2);
      }
    }
    case 'snappy': {
      if (clampedT === 0) return 0;
      if (clampedT === 1) return 1;
      return 1 - Math.exp(-7 * clampedT) * Math.cos(4 * clampedT);
    }
    default:
      return clampedT;
  }
}

// Evaluates the property value at a specific time relative to the clip
export function evaluateProperty(
  defaultValue: number,
  keyframes: Keyframe[] | undefined,
  clipTime: number
): number {
  if (!keyframes || keyframes.length === 0) {
    return defaultValue;
  }

  // Sort keyframes by time
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  // If time is before first keyframe
  if (clipTime <= sorted[0].time) {
    return sorted[0].value;
  }

  // If time is after last keyframe
  if (clipTime >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].value;
  }

  // Find the bounding keyframes
  for (let i = 0; i < sorted.length - 1; i++) {
    const k1 = sorted[i];
    const k2 = sorted[i + 1];

    if (clipTime >= k1.time && clipTime <= k2.time) {
      const dt = k2.time - k1.time;
      if (dt <= 0.0001) return k1.value;

      const progress = (clipTime - k1.time) / dt;
      const easedProgress = evaluateEasing(progress, k1.easing);
      return k1.value + (k2.value - k1.value) * easedProgress;
    }
  }

  return defaultValue;
}

// Adds or updates a keyframe at the given time
export function setKeyframe(
  keyframes: Keyframe[],
  time: number,
  value: number,
  easing: KeyframeEasing = 'ease-in-out'
): Keyframe[] {
  const existingIdx = keyframes.findIndex((k) => Math.abs(k.time - time) < 0.03);
  if (existingIdx >= 0) {
    const updated = [...keyframes];
    updated[existingIdx] = {
      ...updated[existingIdx],
      value,
      easing,
    };
    return updated.sort((a, b) => a.time - b.time);
  }

  const newKf: Keyframe = {
    id: 'kf_' + Math.random().toString(36).slice(2, 9),
    time: Math.max(0, time),
    value,
    easing,
  };

  return [...keyframes, newKf].sort((a, b) => a.time - b.time);
}

// Removes a keyframe near the given time
export function removeKeyframeAt(keyframes: Keyframe[], time: number): Keyframe[] {
  return keyframes.filter((k) => Math.abs(k.time - time) >= 0.04);
}

// Checks if a keyframe exists near the given time
export function hasKeyframeAt(keyframes: Keyframe[] | undefined, time: number): boolean {
  if (!keyframes || keyframes.length === 0) return false;
  return keyframes.some((k) => Math.abs(k.time - time) < 0.04);
}
