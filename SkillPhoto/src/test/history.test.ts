import { describe, it, expect } from 'vitest';
import { historyBytes } from '../core/store';
import { makeLayer } from '../core/types';
import type { Snapshot } from '../core/types';

const canvas = (w: number, h: number) => ({ width: w, height: h }) as HTMLCanvasElement;

const step = (layers: Snapshot['layers']): Snapshot =>
  ({ label: 'step', icon: 'edit', layers, activeId: layers[0].id, width: 4000, height: 3000, selection: null, time: 0 }) as Snapshot;

describe('history memory', () => {
  it('counts a layer shared by many steps once', () => {
    const big = makeLayer({ kind: 'raster', name: 'Photo', canvas: canvas(4000, 3000) });
    const history = Array.from({ length: 50 }, () => step([big]));
    expect(historyBytes(history)).toBe(4000 * 3000 * 4);
  });

  it('adds only the pixels each step changed', () => {
    const photo = makeLayer({ kind: 'raster', name: 'Photo', canvas: canvas(4000, 3000) });
    const v1 = makeLayer({ kind: 'raster', name: 'Paint', canvas: canvas(1000, 1000) });
    const v2 = { ...v1, canvas: canvas(1000, 1000) };
    const history = [step([photo, v1]), step([photo, v2]), step([photo, v2])];
    expect(historyBytes(history)).toBe((4000 * 3000 + 2 * 1000 * 1000) * 4);
  });
});
