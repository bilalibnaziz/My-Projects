// Window-size awareness: the room the interface really has (in its own CSS pixels, so the
// interface size setting counts too) and the breakpoints the layout adapts at.

import { useSyncExternalStore } from 'react';
import { uiZoom } from './theme';

export interface Room {
  /** Usable width / height in interface pixels. */
  w: number;
  h: number;
  /** Below 1200: tighter menu bar, slimmer panels. */
  narrow: boolean;
  /** Below 980: menus fold into one button, the panels become a slide-over drawer. */
  compact: boolean;
  /** Below 760: phone-sized window — only the essentials stay in the bars. */
  tiny: boolean;
  /** Under 760 / 600 tall: tool bar in two / three columns, shorter panels. */
  short: boolean;
  xshort: boolean;
}

function measure(): Room {
  const k = uiZoom();
  const w = Math.round((typeof window === 'undefined' ? 1440 : window.innerWidth) / k);
  const h = Math.round((typeof window === 'undefined' ? 900 : window.innerHeight) / k);
  return { w, h, narrow: w < 1200, compact: w < 980, tiny: w < 760, short: h < 760, xshort: h < 600 };
}

let room = measure();
const listeners = new Set<() => void>();

function update() {
  const next = measure();
  if (next.w === room.w && next.h === room.h) return;
  room = next;
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') window.addEventListener('resize', update);

/** Re-measures now (after the interface size changes). */
export const remeasure = update;

export function getRoom(): Room {
  return room;
}

export function useRoom(): Room {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => room
  );
}

/** Class names for the app root, so CSS can adapt too. */
export function roomClasses(r: Room): string {
  return [r.narrow && 'bp-narrow', r.compact && 'bp-compact', r.tiny && 'bp-tiny', r.short && 'bp-short', r.xshort && 'bp-xshort'].filter(Boolean).join(' ');
}
