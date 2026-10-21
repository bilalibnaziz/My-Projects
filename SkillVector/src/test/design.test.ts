import { describe, it, expect } from 'vitest';
import { alignDelta, offsetPatch } from '../core/align';
import { DOC_PRESETS, SAFE_ZONES, TEMPLATES, presetById, safeZoneFor } from '../core/social';
import { shapeDraftRect } from '../core/tools';
import { makeLayer, shownText } from '../core/types';
import type { TextProps } from '../core/types';
import { luminance } from '../ui/theme';

describe('align', () => {
  const canvas = { x: 0, y: 0, width: 1080, height: 1350 };
  const box = { x: 100, y: 200, width: 301, height: 50 };

  it('aligns each edge exactly to the target', () => {
    expect(alignDelta(box, canvas, 'left')).toEqual({ dx: -100, dy: 0 });
    expect(alignDelta(box, canvas, 'right')).toEqual({ dx: 1080 - 401, dy: 0 });
    expect(alignDelta(box, canvas, 'top')).toEqual({ dx: 0, dy: -200 });
    expect(alignDelta(box, canvas, 'bottom')).toEqual({ dx: 0, dy: 1350 - 250 });
  });

  it('centres to whole pixels', () => {
    const { dx } = alignDelta(box, canvas, 'hcenter');
    expect(Number.isInteger(dx)).toBe(true);
    // Centre lands within half a pixel of the canvas centre
    expect(Math.abs(box.x + dx + box.width / 2 - 540)).toBeLessThanOrEqual(0.5);
    const { dy } = alignDelta(box, canvas, 'vcenter');
    expect(box.y + dy + box.height / 2).toBe(675);
  });

  it('aligns to a selection, not just the canvas', () => {
    const sel = { x: 500, y: 500, width: 200, height: 100 };
    expect(alignDelta(box, sel, 'left').dx).toBe(400);
    expect(alignDelta(box, sel, 'bottom').dy).toBe(600 - 250);
  });

  it('moves the mask with the layer', () => {
    const l = makeLayer({ kind: 'raster', name: 'L', x: 10, y: 20 });
    l.mask = { canvas: document.createElement('canvas'), x: 5, y: 6, enabled: true };
    const p = offsetPatch(l, 3, -4);
    expect([p.x, p.y, p.mask?.x, p.mask?.y]).toEqual([13, 16, 8, 2]);
  });
});

describe('shape drafting', () => {
  it('draws corner to corner by default', () => {
    expect(shapeDraftRect({ a: { x: 10, y: 10 }, b: { x: 50, y: 30 } })).toEqual({ x: 10, y: 10, w: 40, h: 20 });
  });
  it('Alt draws from the centre', () => {
    expect(shapeDraftRect({ a: { x: 100, y: 100 }, b: { x: 130, y: 120 }, center: true })).toEqual({ x: 70, y: 80, w: 60, h: 40 });
  });
});

describe('social presets', () => {
  it('every preset has a positive size and a known safe zone', () => {
    for (const p of DOC_PRESETS) {
      expect(p.w).toBeGreaterThan(0);
      expect(p.h).toBeGreaterThan(0);
      if (p.safeZone) expect(SAFE_ZONES[p.safeZone]).toBeTruthy();
    }
    expect(new Set(DOC_PRESETS.map((p) => p.id)).size).toBe(DOC_PRESETS.length);
  });

  it('uses current platform sizes', () => {
    expect(presetById('ig-portrait')).toMatchObject({ w: 1080, h: 1350 });
    expect(presetById('ig-story')).toMatchObject({ w: 1080, h: 1920 });
    expect(presetById('yt-thumb')).toMatchObject({ w: 1280, h: 720 });
    expect(presetById('x-header')).toMatchObject({ w: 1500, h: 500 });
    expect(presetById('li-banner')).toMatchObject({ w: 1584, h: 396 });
    expect(presetById('pin')).toMatchObject({ w: 1000, h: 1500 });
  });

  it('safe zones leave a usable centre', () => {
    for (const [id, z] of Object.entries(SAFE_ZONES)) {
      expect(z.left + z.right, id).toBeLessThan(0.8);
      expect(z.top + z.bottom, id).toBeLessThan(0.8);
      for (const v of [z.top, z.bottom, z.left, z.right]) expect(v, id).toBeGreaterThanOrEqual(0);
    }
    // Story zone matches the 250 px / 340 px guidance on a 1080×1920 frame
    expect(Math.round(SAFE_ZONES.story.top * 1920)).toBe(250);
    expect(Math.round(SAFE_ZONES.story.bottom * 1920)).toBe(340);
    // YouTube banner: the 1546×423 area visible on every device
    const b = SAFE_ZONES['yt-banner'];
    expect(Math.round(2560 * (1 - b.left - b.right))).toBe(1546);
    expect(Math.round(1440 * (1 - b.top - b.bottom))).toBe(423);
  });

  it('finds the platform zone for a matching custom size', () => {
    expect(safeZoneFor(1080, 1920)).toBe('story');
    expect(safeZoneFor(1234, 567)).toBe('margin');
  });

  it('every template points at a real preset', () => {
    for (const t of TEMPLATES) expect(presetById(t.preset), t.id).toBeTruthy();
  });
});

describe('text', () => {
  it('caps changes what is drawn, not what was typed', () => {
    const t = { text: 'Sale ends Friday', caps: true } as TextProps;
    expect(shownText(t)).toBe('SALE ENDS FRIDAY');
    expect(t.text).toBe('Sale ends Friday');
    expect(shownText({ ...t, caps: false })).toBe('Sale ends Friday');
  });
});

describe('theme', () => {
  it('measures accent luminance for readable button text', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(luminance('#eab308')).toBeGreaterThan(0.45); // yellow → dark text
    expect(luminance('#3b82f6')).toBeLessThan(0.45); // blue → white text
  });
});
