// 3D color lookup tables: Adobe / Resolve `.cube` parsing, compact base64 storage format
// (16-bit RGB) so a LUT can live inside an adjustment layer, its history and the project file,
// plus a rich built-in library of professionally calibrated, categorized 3D LUT presets.

export interface Lut3D {
  size: number;
  /** RGB triplets, red changing fastest, then green, then blue (the .cube order). 0..1. */
  data: Float32Array;
}

export type LutCategory = 'Food' | 'Person' | 'Product' | 'Cinematic' | 'Vintage';

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
export function writeCube(lut: Lut3D, title = 'Skill Vector'): string {
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

export const BUILTIN_LUTS: BuiltinLutPreset[] = [
  // --- 1. Food & Culinary ---
  {
    id: 'food-warm-gourmet',
    name: 'Warm Gourmet',
    category: 'Food',
    description: 'Appetizing warm highlights and rich golden-brown contrast for pastries & dining',
    tint: '#f59e0b',
    transform: (r, g, b) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const nr = clamp(r * 1.12 + 0.03 * (1 - lum));
      const ng = clamp(g * 1.04);
      const nb = clamp(b * 0.88 - 0.02 * (1 - lum));
      return [nr, ng, nb];
    },
  },
  {
    id: 'food-fresh-greens',
    name: 'Fresh & Crisp',
    category: 'Food',
    description: 'Vibrant organic greens and natural clean whites for salads & fresh produce',
    tint: '#10b981',
    transform: (r, g, b) => {
      const nr = clamp(r * 0.96);
      const ng = clamp(g * 1.15 + (g > r && g > b ? 0.06 : 0));
      const nb = clamp(b * 0.98);
      return [nr, ng, nb];
    },
  },
  {
    id: 'food-rich-coffee',
    name: 'Rich Roast & Cafe',
    category: 'Food',
    description: 'Deep espresso shadows and velvety roasted caramel midtones',
    tint: '#78350f',
    transform: (r, g, b) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const nr = clamp(r * 1.08 + (lum < 0.5 ? 0.04 : 0));
      const ng = clamp(g * 0.96);
      const nb = clamp(b * 0.84 - 0.02);
      return [nr, ng, nb];
    },
  },
  {
    id: 'food-citrus-punch',
    name: 'Citrus Pop',
    category: 'Food',
    description: 'Juicy saturated oranges, yellows & reds with high dynamic clarity for drinks',
    tint: '#f97316',
    transform: (r, g, b) => {
      const nr = clamp(r * 1.18);
      const ng = clamp(g * 1.08);
      const nb = clamp(b * 0.92);
      return [nr, ng, nb];
    },
  },
  {
    id: 'food-moody-dining',
    name: 'Moody Gastronomy',
    category: 'Food',
    description: 'Candlelit dining chiaroscuro with deep shadows and warm selective glow',
    tint: '#b45309',
    transform: (r, g, b) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const s = lum < 0.4 ? 0.82 : 1.1;
      return [clamp(r * s * 1.15), clamp(g * s * 0.98), clamp(b * s * 0.82)];
    },
  },

  // --- 2. Person & Model / Portrait ---
  {
    id: 'portrait-natural-skin',
    name: 'Natural Skin Glow',
    category: 'Person',
    description: 'Soft, healthy skin tone graduation preserving authentic melanin and peach tones',
    tint: '#f43f5e',
    transform: (r, g, b) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const skinMask = r > g && g > b ? 1 : 0.4;
      const nr = clamp(r + 0.04 * skinMask * (1 - lum));
      const ng = clamp(g + 0.01 * skinMask);
      const nb = clamp(b - 0.02 * skinMask);
      return [nr, ng, nb];
    },
  },
  {
    id: 'portrait-model-editorial',
    name: 'Editorial Runway',
    category: 'Person',
    description: 'High-fashion editorial contrast with clean desaturated background tones',
    tint: '#ec4899',
    transform: (r, g, b) => {
      const sCurve = (v: number) => (v < 0.5 ? 2 * v * v : 1 - 2 * (1 - v) * (1 - v));
      const nr = clamp(sCurve(r) * 1.04);
      const ng = clamp(sCurve(g) * 0.98);
      const nb = clamp(sCurve(b) * 0.95);
      const fLum = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
      return [clamp(fLum + (nr - fLum) * 0.9), clamp(fLum + (ng - fLum) * 0.9), clamp(fLum + (nb - fLum) * 0.9)];
    },
  },
  {
    id: 'portrait-warm-amber',
    name: 'Golden Hour Portrait',
    category: 'Person',
    description: 'Sun-kissed radiance on skin with soft rolled-off specular highlights',
    tint: '#eab308',
    transform: (r, g, b) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const nr = clamp(r * 1.1 + 0.05 * lum);
      const ng = clamp(g * 1.02);
      const nb = clamp(b * 0.88 - 0.03 * (1 - lum));
      return [nr, ng, nb];
    },
  },
  {
    id: 'portrait-porcelain-glow',
    name: 'Porcelain Beauty',
    category: 'Person',
    description: 'Delicate soft-key beauty lighting with luminous airy midtones',
    tint: '#cbd5e1',
    transform: (r, g, b) => {
      const nr = clamp(Math.pow(r, 0.88) * 1.02);
      const ng = clamp(Math.pow(g, 0.88) * 1.0);
      const nb = clamp(Math.pow(b, 0.88) * 1.02);
      return [nr, ng, nb];
    },
  },
  {
    id: 'portrait-melanin-rich',
    name: 'Melanin Rich & Deep',
    category: 'Person',
    description: 'Lustrous bronze highlights and deep rich contrast preventing skin ashening',
    tint: '#92400e',
    transform: (r, g, b) => {
      const nr = clamp(r * 1.14 + 0.02);
      const ng = clamp(g * 1.02);
      const nb = clamp(b * 0.92);
      return [nr, ng, nb];
    },
  },
  {
    id: 'portrait-studio-bw',
    name: 'Panchromatic Studio B&W',
    category: 'Person',
    description: 'Panchromatic studio portrait monochrome with silky smooth skin gradation',
    tint: '#94a3b8',
    transform: (r, g, b) => {
      const lum = clamp(0.35 * r + 0.55 * g + 0.1 * b);
      const s = lum < 0.5 ? 2 * lum * lum : 1 - 2 * (1 - lum) * (1 - lum);
      return [s, s, s];
    },
  },

  // --- 3. Product & Commercial ---
  {
    id: 'product-clean-studio',
    name: 'Clean White Studio',
    category: 'Product',
    description: '5500K daylight-balanced clean whites and authentic e-commerce color fidelity',
    tint: '#0284c7',
    transform: (r, g, b) => {
      const nr = clamp(r > 0.85 ? r * 1.08 : r * 1.02);
      const ng = clamp(g > 0.85 ? g * 1.08 : g * 1.02);
      const nb = clamp(b > 0.85 ? b * 1.08 : b * 1.02);
      return [nr, ng, nb];
    },
  },
  {
    id: 'product-luxury-dark',
    name: 'Luxury Obsidian & Gold',
    category: 'Product',
    description: 'Deep blacks and champagne metallic highlights for jewelry, watches & fragrances',
    tint: '#d97706',
    transform: (r, g, b) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 0.3) {
        return [clamp(r * 0.75), clamp(g * 0.75), clamp(b * 0.8)];
      }
      return [clamp(r * 1.15 + 0.03), clamp(g * 1.06 + 0.01), clamp(b * 0.88)];
    },
  },
  {
    id: 'product-tech-minimalist',
    name: 'Tech Anodized Matte',
    category: 'Product',
    description: 'Cool aluminum slate tones with sharp micro-contrast for electronics & gadgets',
    tint: '#64748b',
    transform: (r, g, b) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const nr = clamp(r * 0.95);
      const ng = clamp(g * 0.98);
      const nb = clamp(b * 1.06 + 0.02 * (1 - lum));
      return [nr, ng, nb];
    },
  },
  {
    id: 'product-vibrant-ecommerce',
    name: 'E-Commerce Pop',
    category: 'Product',
    description: 'High micro-contrast and saturated punch that stands out in online shopping feeds',
    tint: '#8b5cf6',
    transform: (r, g, b) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sat = 1.25;
      const nr = clamp(lum + (r - lum) * sat);
      const ng = clamp(lum + (g - lum) * sat);
      const nb = clamp(lum + (b - lum) * sat);
      return [nr, ng, nb];
    },
  },
  {
    id: 'product-matte-cosmetic',
    name: 'Cosmetic Pastel Matte',
    category: 'Product',
    description: 'Velvety matte pastel tones with anti-glare highlights for skincare & cosmetics',
    tint: '#f472b6',
    transform: (r, g, b) => {
      const nr = clamp(Math.pow(r, 0.92) * 1.04);
      const ng = clamp(Math.pow(g, 0.94) * 0.98);
      const nb = clamp(Math.pow(b, 0.94) * 0.96);
      return [nr, ng, nb];
    },
  },

  // --- 4. Cinematic & Film ---
  {
    id: 'cine-teal-orange',
    name: 'Teal & Orange',
    category: 'Cinematic',
    description: 'Blockbuster complementary color split: warm skin highlights and deep teal shadows',
    tint: '#06b6d4',
    transform: (r, g, b) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let nr = r;
      let ng = g;
      let nb = b;
      if (lum > 0.45) {
        nr = clamp(r * 1.16);
        ng = clamp(g * 1.04);
        nb = clamp(b * 0.84);
      } else {
        nr = clamp(r * 0.82);
        ng = clamp(g * 1.05);
        nb = clamp(b * 1.25);
      }
      return [nr, ng, nb];
    },
  },
  {
    id: 'cine-kodak-portra',
    name: 'Kodak Portra 400',
    category: 'Cinematic',
    description: 'Legendary 35mm analog stock with pastel warmth and creamy highlight roll-off',
    tint: '#f59e0b',
    transform: (r, g, b) => {
      const nr = clamp(Math.pow(r, 0.92) * 1.06 + 0.02);
      const ng = clamp(Math.pow(g, 0.96) * 1.01);
      const nb = clamp(Math.pow(b, 1.04) * 0.92);
      return [nr, ng, nb];
    },
  },
  {
    id: 'cine-fuji-400h',
    name: 'Fuji Pro 400H',
    category: 'Cinematic',
    description: 'Cool airy shadows, signature cyan-tinted green flora, and gentle contrast',
    tint: '#14b8a6',
    transform: (r, g, b) => {
      const nr = clamp(r * 0.96);
      const ng = clamp(g * 1.05);
      const nb = clamp(b * 1.1 + 0.03);
      return [nr, ng, nb];
    },
  },
  {
    id: 'cine-bleach-bypass',
    name: 'Bleach Bypass Silver',
    category: 'Cinematic',
    description: 'Silver retention simulation: high contrast, desaturated midtones and gritty punch',
    tint: '#94a3b8',
    transform: (r, g, b) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const c = (v: number) => clamp((v - 0.5) * 1.45 + 0.5);
      const nr = c(r);
      const ng = c(g);
      const nb = c(b);
      return [clamp(nr * 0.5 + lum * 0.5), clamp(ng * 0.5 + lum * 0.5), clamp(nb * 0.5 + lum * 0.5)];
    },
  },
  {
    id: 'cine-cyberpunk',
    name: 'Cyberpunk Neon',
    category: 'Cinematic',
    description: 'Electric magenta highlights, deep midnight shadows and radiant cyan highlights',
    tint: '#d946ef',
    transform: (r, g, b) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const nr = clamp(r * 1.25 + 0.08);
      const ng = clamp(g * 0.85);
      const nb = clamp(b * 1.35 + 0.12 * (1 - lum));
      return [nr, ng, nb];
    },
  },

  // --- 5. Vintage & Retro ---
  {
    id: 'vintage-polaroid',
    name: 'Vintage Polaroid 600',
    category: 'Vintage',
    description: 'Faded instant camera print emulsion with cyan shadows and warm highlights',
    tint: '#e2e8f0',
    transform: (r, g, b) => {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const nr = clamp(r * 0.92 + 0.06);
      const ng = clamp(g * 0.94 + 0.04);
      const nb = clamp(b * 0.88 + 0.09 * (1 - lum));
      return [nr, ng, nb];
    },
  },
];

export function generateBuiltinLut(preset: BuiltinLutPreset, size = 17): Lut3D {
  const data = new Float32Array(size * size * size * 3);
  let idx = 0;
  for (let b = 0; b < size; b++) {
    const bVal = b / (size - 1);
    for (let g = 0; g < size; g++) {
      const gVal = g / (size - 1);
      for (let r = 0; r < size; r++) {
        const rVal = r / (size - 1);
        const [nr, ng, nb] = preset.transform(rVal, gVal, bVal);
        data[idx++] = clamp(nr);
        data[idx++] = clamp(ng);
        data[idx++] = clamp(nb);
      }
    }
  }
  return { size, data };
}

const LUT_CACHE = new Map<string, { size: number; data: string }>();

export function getBuiltinLutData(presetId: string): { name: string; size: number; data: string } | null {
  const preset = BUILTIN_LUTS.find((p) => p.id === presetId);
  if (!preset) return null;
  const cached = LUT_CACHE.get(presetId);
  if (cached) {
    return { name: preset.name, size: cached.size, data: cached.data };
  }
  const lut = generateBuiltinLut(preset, 17);
  const encoded = encodeLut(lut);
  LUT_CACHE.set(presetId, { size: lut.size, data: encoded });
  return { name: preset.name, size: lut.size, data: encoded };
}
