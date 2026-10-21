/**
 * Print Tiling: splits the artboard into printer pages (1 document px = 1 pt, as in Illustrator).
 * The Print Tiling tool shows the pages and drags their origin; File ▸ Export Tiled PDF prints them.
 */

import type { Doc } from './types';

export type PaperId = 'letter' | 'legal' | 'tabloid' | 'a5' | 'a4' | 'a3';

/** Paper sizes in points (portrait). */
export const PAPERS: { id: PaperId; label: string; w: number; h: number }[] = [
  { id: 'letter', label: 'US Letter (8.5 × 11 in)', w: 612, h: 792 },
  { id: 'legal', label: 'US Legal (8.5 × 14 in)', w: 612, h: 1008 },
  { id: 'tabloid', label: 'Tabloid (11 × 17 in)', w: 792, h: 1224 },
  { id: 'a5', label: 'A5 (148 × 210 mm)', w: 420, h: 595 },
  { id: 'a4', label: 'A4 (210 × 297 mm)', w: 595, h: 842 },
  { id: 'a3', label: 'A3 (297 × 420 mm)', w: 842, h: 1191 },
];

export interface TileSettings {
  paper: PaperId;
  landscape: boolean;
  /** Overlap between neighbouring pages, in points (for trimming and taping). */
  overlap: number;
}

export interface Tile {
  /** 1-based page number, row by row. */
  n: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DEFAULT_TILES: TileSettings = { paper: 'letter', landscape: false, overlap: 0 };

export function pageSize(s: TileSettings): { w: number; h: number } {
  const p = PAPERS.find((q) => q.id === s.paper) ?? PAPERS[0];
  return s.landscape ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * Pages covering `area`, laid out from `origin` (the top-left corner of one page). Pages that miss
 * the area are left out, so moving the origin changes how many pages it takes.
 */
export function printTiles(area: Box, s: TileSettings, origin: { x: number; y: number }): Tile[] {
  const { w, h } = pageSize(s);
  const ov = Math.max(0, Math.min(s.overlap, Math.min(w, h) / 2));
  const sx = w - ov;
  const sy = h - ov;
  if (area.w <= 0 || area.h <= 0) return [];
  // A page counts when its own step (the page minus the overlap it shares with the next) meets the area
  const c0 = Math.floor((area.x - origin.x) / sx);
  const r0 = Math.floor((area.y - origin.y) / sy);
  const tiles: Tile[] = [];
  for (let r = r0; origin.y + r * sy < area.y + area.h; r++) {
    for (let c = c0; origin.x + c * sx < area.x + area.w; c++) {
      tiles.push({ n: tiles.length + 1, x: origin.x + c * sx, y: origin.y + r * sy, w, h });
    }
  }
  return tiles;
}

// Tile origin per document (session only, like Illustrator's page origin)
const origins = new Map<string, { x: number; y: number }>();
let settings: TileSettings = { ...DEFAULT_TILES };

export const tileSettings = (): TileSettings => ({ ...settings });
export const setTileSettings = (s: Partial<TileSettings>) => {
  settings = { ...settings, ...s };
};
export const tileOrigin = (docId: string, area: Box) => origins.get(docId) ?? { x: area.x, y: area.y };
export const setTileOrigin = (docId: string, p: { x: number; y: number } | null) => {
  if (p) origins.set(docId, p);
  else origins.delete(docId);
};

/** What gets tiled: the active artboard, else the whole document. */
export function tilingArea(doc: Pick<Doc, 'width' | 'height' | 'artboards' | 'activeArtboardId'>): Box {
  const ab = doc.artboards?.find((a) => a.id === doc.activeArtboardId) ?? doc.artboards?.[0];
  return ab ? { x: ab.x, y: ab.y, w: ab.width, h: ab.height } : { x: 0, y: 0, w: doc.width, h: doc.height };
}
