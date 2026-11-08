// The separations shown on the canvas (Overprint Preview / Separations Preview), shared by the viewport,
// which computes them, and the Separations panel, which reads inks under the cursor.
import type { Separations } from '../core/separations';

let current: Separations | null = null;
let key = '';
const listeners = new Set<() => void>();

export const currentSeparations = () => current;
export function setSeparations(s: Separations | null, k = '') {
  current = s;
  key = k;
  listeners.forEach((f) => f());
}
export const separationsKey = () => key;
export function onSeparations(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
