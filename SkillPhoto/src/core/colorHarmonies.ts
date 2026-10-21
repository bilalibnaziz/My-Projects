// Advanced Color Harmonies, History, and Curated Design Themes
// Inspired by Affinity Designer & Canva color science

import { hexToRgb, rgbToHex, rgbToHsb, hsbToRgb, type RGB } from './color';

export type HarmonyMode = 'none' | 'complementary' | 'analogous' | 'triadic' | 'split' | 'tetradic' | 'monochrome';

export interface HarmonyNode {
  angle: number;
  hex: string;
  label: string;
  isBase?: boolean;
}

export interface ColorTheme {
  id: string;
  name: string;
  category: 'Canva Trends' | 'Affinity Pro' | 'Design Systems' | 'Custom';
  colors: string[];
}

/** Pre-curated palettes inspired by Canva trend boards and Affinity studio palettes */
export const CURATED_COLOR_THEMES: ColorTheme[] = [
  // Canva Trends
  {
    id: 'pastel-bliss',
    name: 'Pastel Dream',
    category: 'Canva Trends',
    colors: ['#ffd1dc', '#ffdfba', '#ffffba', '#baffc9', '#bae1ff', '#e8d7ff'],
  },
  {
    id: 'cyberpunk-neon',
    name: 'Cyberpunk Neon',
    category: 'Canva Trends',
    colors: ['#0ff0fc', '#ff007f', '#7928ca', '#ffe600', '#00ff66', '#120024'],
  },
  {
    id: 'warm-sunset',
    name: 'Golden Hour Sunset',
    category: 'Canva Trends',
    colors: ['#2e0854', '#7d1935', '#eb4d4b', '#f0932b', '#ffbe76', '#f6e58d'],
  },
  {
    id: 'earthy-botanical',
    name: 'Earthy Botanical',
    category: 'Canva Trends',
    colors: ['#2d4a22', '#556b2f', '#8fbc8f', '#d2b48c', '#c19a6b', '#f5f5dc'],
  },
  {
    id: 'retro-synthwave',
    name: 'Retro 80s Synthwave',
    category: 'Canva Trends',
    colors: ['#241734', '#2e2157', '#fd3a69', '#fecd1a', '#05dfd7', '#931a25'],
  },
  {
    id: 'nordic-minimal',
    name: 'Nordic Clean Minimal',
    category: 'Canva Trends',
    colors: ['#2b2d42', '#8d99ae', '#edf2f4', '#ef233c', '#d90429'],
  },

  // Affinity Pro
  {
    id: 'dark-luxury',
    name: 'Editorial Luxury Gold',
    category: 'Affinity Pro',
    colors: ['#0d1117', '#161b22', '#c5a059', '#e5c158', '#f4ede4', '#30363d'],
  },
  {
    id: 'deep-jewel',
    name: 'Deep Jewel Tones',
    category: 'Affinity Pro',
    colors: ['#0c2340', '#1c3f60', '#005f73', '#0a9396', '#94d2bd', '#ee9b00'],
  },
  {
    id: 'bauhaus-primary',
    name: 'Bauhaus Master',
    category: 'Affinity Pro',
    colors: ['#111111', '#e63946', '#f1faee', '#a8dadc', '#457b9d', '#1d3557'],
  },
  {
    id: 'coastal-breeze',
    name: 'Pacific Coastal Breeze',
    category: 'Affinity Pro',
    colors: ['#03045e', '#023e8a', '#0077b6', '#0096c7', '#00b4d8', '#48cae4', '#90e0ef'],
  },
  {
    id: 'terracotta-clay',
    name: 'Mediterranean Terracotta',
    category: 'Affinity Pro',
    colors: ['#582f0e', '#7f4f24', '#936639', '#a68a64', '#b6ad90', '#c2c5aa', '#a4ac86'],
  },

  // Design Systems
  {
    id: 'tailwind-core',
    name: 'Tailwind Palette',
    category: 'Design Systems',
    colors: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'],
  },
  {
    id: 'material-you',
    name: 'Material Design 3',
    category: 'Design Systems',
    colors: ['#6750a4', '#625b71', '#7d5260', '#b3261e', '#21005d', '#1d192b', '#e8def8'],
  },
  {
    id: 'apple-system',
    name: 'Apple HIG Accents',
    category: 'Design Systems',
    colors: ['#007aff', '#34c759', '#ff9500', '#ff2d55', '#af52de', '#5856d6', '#ffcc00', '#5ac8fa'],
  },
];

const HISTORY_KEY = 'skill_color_history_v2';
const SAVED_SWATCHES_KEY = 'skill_saved_swatches_v2';

/** Get recent color history from storage */
export function getColorHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch {}
  return ['#000000', '#ffffff', '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
}

/** Record a color into persistent history (up to 32 items, deduplicated) */
export function pushColorHistory(hex: string): string[] {
  const norm = hex.toLowerCase();
  const current = getColorHistory().filter((c) => c.toLowerCase() !== norm);
  const updated = [norm, ...current].slice(0, 32);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {}
  return updated;
}

/** Get user-saved favorite swatches */
export function getSavedSwatches(): string[] {
  try {
    const raw = localStorage.getItem(SAVED_SWATCHES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch {}
  return ['#1e293b', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
}

/** Save or toggle a user swatch */
export function addSavedSwatch(hex: string): string[] {
  const norm = hex.toLowerCase();
  const current = getSavedSwatches();
  if (current.includes(norm)) return current;
  const updated = [norm, ...current].slice(0, 48);
  try {
    localStorage.setItem(SAVED_SWATCHES_KEY, JSON.stringify(updated));
  } catch {}
  return updated;
}

/** Remove a user saved swatch */
export function removeSavedSwatch(hex: string): string[] {
  const norm = hex.toLowerCase();
  const updated = getSavedSwatches().filter((c) => c.toLowerCase() !== norm);
  try {
    localStorage.setItem(SAVED_SWATCHES_KEY, JSON.stringify(updated));
  } catch {}
  return updated;
}

/** Calculate full mathematical harmony nodes and angles for Affinity-style Wheel */
export function getHarmonyNodes(baseHex: string, mode: HarmonyMode): HarmonyNode[] {
  const [h, s, v] = rgbToHsb(hexToRgb(baseHex));

  const makeColor = (degOffset: number, sOffset = 0, vOffset = 0): string => {
    const targetH = (h + degOffset + 360) % 360;
    const targetS = Math.max(5, Math.min(100, s + sOffset));
    const targetV = Math.max(10, Math.min(100, v + vOffset));
    return rgbToHex(hsbToRgb(targetH, targetS, targetV));
  };

  const nodes: HarmonyNode[] = [
    { angle: h, hex: baseHex, label: 'Base', isBase: true },
  ];

  switch (mode) {
    case 'none':
      break;
    case 'complementary':
      nodes.push({ angle: (h + 180) % 360, hex: makeColor(180), label: 'Complement' });
      break;
    case 'analogous':
      nodes.push({ angle: (h - 30 + 360) % 360, hex: makeColor(-30), label: 'Analogous −30°' });
      nodes.push({ angle: (h + 30) % 360, hex: makeColor(30), label: 'Analogous +30°' });
      break;
    case 'triadic':
      nodes.push({ angle: (h + 120) % 360, hex: makeColor(120), label: 'Triadic +120°' });
      nodes.push({ angle: (h + 240) % 360, hex: makeColor(240), label: 'Triadic +240°' });
      break;
    case 'split':
      nodes.push({ angle: (h + 150) % 360, hex: makeColor(150), label: 'Split +150°' });
      nodes.push({ angle: (h + 210) % 360, hex: makeColor(210), label: 'Split +210°' });
      break;
    case 'tetradic':
      nodes.push({ angle: (h + 90) % 360, hex: makeColor(90), label: 'Square +90°' });
      nodes.push({ angle: (h + 180) % 360, hex: makeColor(180), label: 'Square +180°' });
      nodes.push({ angle: (h + 270) % 360, hex: makeColor(270), label: 'Square +270°' });
      break;
    case 'monochrome':
      nodes.push({ angle: h, hex: makeColor(0, -35, 15), label: 'Tint' });
      nodes.push({ angle: h, hex: makeColor(0, 0, -35), label: 'Shade' });
      nodes.push({ angle: h, hex: makeColor(0, -50, -20), label: 'Tone' });
      break;
  }

  return nodes;
}
