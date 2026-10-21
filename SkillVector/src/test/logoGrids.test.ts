import { describe, expect, it } from 'vitest';
import { createLogoGridLayers, LOGO_GRID_CATALOG } from '../core/logoGrids';
import type { LogoGridType } from '../core/logoGrids';

describe('Logo Design Studio: 10 Construction Grids', () => {
  it('has all 10 defined logo grids in catalog', () => {
    expect(LOGO_GRID_CATALOG.length).toBe(10);
  });

  const gridTypes: LogoGridType[] = [
    'golden-ratio',
    'modular-matrix',
    'isometric-hex',
    'polar-radial',
    'triangular-delta',
    'monogram-lettermark',
    'diagonal-dynamic',
    'concentric-rings',
    'diamond-rhombus',
    'sacred-flower',
  ];

  for (const type of gridTypes) {
    it(`generates valid vector layers for ${type}`, () => {
      const layers = createLogoGridLayers(type, 200, 200, { size: 300 });
      expect(layers.length).toBeGreaterThanOrEqual(3);
      expect(layers.every((l) => l.kind === 'shape')).toBe(true);
      expect(layers.every((l) => l.shape?.stroke === '#00d2ff')).toBe(true);
    });
  }
});
