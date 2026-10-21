// 3D color lookup tables: Adobe / Resolve `.cube` parsing, compact base64 storage format
// (16-bit RGB) so a LUT can live inside an adjustment layer, its history and the project file,
// plus a rich built-in library of professionally calibrated, categorized 3D LUT presets.

import { LOOKS, gradeFunction, type LookCategory } from './looks';

export interface Lut3D {
  size: number;
  /** RGB triplets, red changing fastest, then green, then blue (the .cube order). 0..1. */
  data: Float32Array;
}

export type LutCategory = LookCategory;

export interface BuiltinLutPreset {
  id: string;
  name: string;
  category: LutCategory;
  description: string;
  tint: string;
  transform: (r: number, g: number, b: number) => [number, number, number];
}

const MAX_SIZE = 65;

export function parseCube(text: string): Lut3D {
  let size = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'TITLE') continue;
    if (key === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported, use a 3D .cube');
    if (key === 'LUT_3D_SIZE') {
      size = parseInt(parts[1], 10);
      if (!(size >= 2 && size <= MAX_SIZE)) throw new Error(`Unsupported LUT size ${parts[1]}`);
      continue;
    }
    if (key === 'DOMAIN_MIN') {
      min = parts.slice(1, 4).map(Number);
      continue;
    }
    if (key === 'DOMAIN_MAX') {
      max = parts.slice(1, 4).map(Number);
      continue;
    }
    if (/^[A-Z_]+$/.test(key)) continue; // other keywords (LUT_3D_INPUT_RANGE…)
    if (parts.length < 3) throw new Error('Malformed LUT line');
    for (let i = 0; i < 3; i++) {
      const v = Number(parts[i]);
      if (!Number.isFinite(v)) throw new Error('Malformed LUT value');
      values.push((v - min[i]) / (max[i] - min[i] || 1));
    }
  }
  if (!size) throw new Error('Missing LUT_3D_SIZE');
  if (values.length !== size * size * size * 3) throw new Error(`Expected ${size ** 3} entries, found ${values.length / 3}`);
  return { size, data: Float32Array.from(values, (v) => Math.max(0, Math.min(1, v))) };
}

export function encodeLut(lut: Lut3D): string {
  const u16 = new Uint16Array(lut.data.length);
  for (let i = 0; i < u16.length; i++) u16[i] = Math.round(lut.data[i] * 65535);
  const bytes = new Uint8Array(u16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function decodeLut(data: string, size: number): Float32Array {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const u16 = new Uint16Array(bytes.buffer, 0, Math.min(bytes.length >> 1, size * size * size * 3));
  return Float32Array.from(u16, (v) => v / 65535);
}

/** Exact .cube text for a LUT (for exporting the current look). */
export function writeCube(lut: Lut3D, title = 'Skill Photo'): string {
  const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${lut.size}`];
  for (let i = 0; i < lut.data.length; i += 3) lines.push(`${lut.data[i].toFixed(6)} ${lut.data[i + 1].toFixed(6)} ${lut.data[i + 2].toFixed(6)}`);
  return lines.join('\n') + '\n';
}

/* Helper clamp */
function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

// ---------------------------------------------------------------------------
// Built-in Categorized 3D LUT Presets
// ---------------------------------------------------------------------------

/** The Looks library (looks.ts) as Color Lookup presets. */
export const BUILTIN_LUTS: BuiltinLutPreset[] = LOOKS.map((l) => ({
  id: l.id,
  name: l.name,
  category: l.category,
  description: l.description,
  tint: l.tint,
  transform: gradeFunction(l.recipe),
}));

/** Bakes a preset into a 3D LUT (33³ by default, the usual grading size). */
export function generateBuiltinLut(preset: BuiltinLutPreset, size = 33): Lut3D {
  const data = new Float32Array(size * size * size * 3);
  let idx = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [nr, ng, nb] = preset.transform(r / (size - 1), g / (size - 1), b / (size - 1));
        data[idx++] = clamp(nr);
        data[idx++] = clamp(ng);
        data[idx++] = clamp(nb);
      }
    }
  }
  return { size, data };
}

/** Baked presets, encoded for the Color Lookup adjustment. */
const LUT_CACHE = new Map<string, { size: number; data: string }>();

export function getBuiltinLutData(presetId: string): { name: string; size: number; data: string } | null {
  const preset = BUILTIN_LUTS.find((p) => p.id === presetId);
  if (!preset) return null;
  let cached = LUT_CACHE.get(presetId);
  if (!cached) {
    const lut = generateBuiltinLut(preset);
    cached = { size: lut.size, data: encodeLut(lut) };
    LUT_CACHE.set(presetId, cached);
  }
  return { name: preset.name, size: cached.size, data: cached.data };
}
