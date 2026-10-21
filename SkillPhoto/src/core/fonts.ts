// Font library: the fonts installed on this computer, fonts the user adds from files, favourites
// and recently used fonts. Everything stays local — added fonts are kept in IndexedDB and
// registered with the page (FontFace) on start-up, so text keeps its font between sessions.

import { store } from './store';
import { clearVectorCache, syncTextBounds } from './render';
import { withLayer } from './types';

export type FontCategory =
  | 'sans'
  | 'serif'
  | 'display'
  | 'mono'
  | 'script'
  | 'tech'
  | 'vintage'
  | 'luxury'
  | 'world'
  | 'custom'
  | 'system';

export interface FontInfo {
  family: string;
  category: FontCategory;
}

/** Well-known families across macOS, Windows and Linux, by style. Only the installed ones are listed. */
const KNOWN: [FontCategory, string[]][] = [
  ['sans', [
    'Inter', 'Helvetica Neue', 'Helvetica', 'Arial', 'SF Pro Display', 'SF Pro Text', 'Avenir', 'Avenir Next', 'Futura', 'Gill Sans',
    'Optima', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri', 'Candara', 'Corbel', 'Franklin Gothic Medium',
    'Lucida Grande', 'Geneva', 'Montserrat', 'Roboto', 'Open Sans', 'Lato', 'Poppins', 'Source Sans Pro', 'Noto Sans', 'Ubuntu',
    'DejaVu Sans', 'Arial Rounded MT Bold', 'Century Gothic', 'Gotham', 'Proxima Nova', 'Myriad Pro', 'PT Sans', 'Work Sans',
    'Raleway', 'Nunito', 'Manrope', 'DM Sans', 'Outfit', 'Barlow', 'Kanit', 'Heebo',
  ]],
  ['serif', [
    'Georgia', 'Times New Roman', 'Times', 'Baskerville', 'Didot', 'Bodoni 72', 'Garamond', 'EB Garamond', 'Palatino', 'Palatino Linotype',
    'Hoefler Text', 'Big Caslon', 'Charter', 'Iowan Old Style', 'Cambria', 'Constantia', 'Book Antiqua', 'Rockwell', 'Playfair Display',
    'Merriweather', 'Lora', 'PT Serif', 'Libre Baskerville', 'Noto Serif', 'DejaVu Serif', 'Georgia Pro', 'Cochin', 'Superclarendon',
  ]],
  ['display', [
    'Impact', 'Copperplate', 'Bebas Neue', 'Oswald', 'Anton', 'Haettenschweiler', 'Arial Black', 'Avenir Next Condensed', 'Futura Condensed',
    'DIN Condensed', 'DIN Alternate', 'Phosphate', 'Rockwell Extra Bold', 'Stencil', 'Chalkduster', 'Papyrus', 'Herculanum', 'Trattatello',
    'Luminari', 'Bahnschrift', 'Gill Sans Ultra Bold', 'Abril Fatface', 'Archivo Black', 'Alfa Slab One', 'Righteous', 'Lobster',
  ]],
  ['mono', [
    'Menlo', 'Monaco', 'SF Mono', 'Courier New', 'Courier', 'Consolas', 'Lucida Console', 'Cascadia Code', 'JetBrains Mono', 'Fira Code',
    'Source Code Pro', 'Roboto Mono', 'IBM Plex Mono', 'Ubuntu Mono', 'DejaVu Sans Mono', 'Andale Mono', 'PT Mono',
  ]],
  ['script', [
    'Snell Roundhand', 'Brush Script MT', 'Marker Felt', 'Noteworthy', 'Chalkboard SE', 'Bradley Hand', 'Apple Chancery', 'Zapfino',
    'Savoye LET', 'Comic Sans MS', 'Segoe Script', 'Segoe Print', 'Lucida Handwriting', 'Mistral', 'Pacifico', 'Dancing Script',
    'Great Vibes', 'Caveat', 'Satisfy', 'Kalam',
  ]],
  ['tech', [
    'Orbitron', 'Audiowide', 'Exo 2', 'Rajdhani', 'Michroma', 'Oxanium', 'Chakra Petch', 'Bruno Ace',
    'Electrolize', 'Nova Square', 'Share Tech', 'Black Ops One', 'Russo One', 'Silkscreen', 'Press Start 2P',
  ]],
  ['vintage', [
    'Abril Fatface', 'Shrikhand', 'Rye', 'Bungee Shade', 'Monoton', 'Megrim', 'Sancreek', 'Special Elite',
    'Fredericka the Great', 'Ultra', 'Smokum', 'Limelight', 'Faster One', 'Alfa Slab One',
  ]],
  ['luxury', [
    'Playfair Display', 'Bodoni Moda', 'Cormorant Garamond', 'Cinzel', 'Didot', 'Italiana', 'Bellefair',
    'Tenor Sans', 'Forum', 'Prata', 'Marcellus', 'Julius Sans One', 'Federo', 'Castoro',
  ]],
  ['world', [
    'Amiri', 'Cairo', 'Tajawal', 'Almarai', 'Readex Pro', 'Vazirmatn', 'Noto Sans JP', 'Noto Serif JP',
    'Zen Kaku Gothic New', 'Shippori Mincho', 'Noto Sans KR', 'Black Han Sans', 'Noto Sans SC', 'Noto Serif SC',
    'Ma Shan Zheng', 'Kalam', 'Rubik', 'Heebo', 'Kanit', 'Prompt',
  ]],
];

const listeners = new Set<() => void>();
let version = 0;
const bump = () => {
  version++;
  listeners.forEach((l) => l());
};
export const fontsVersion = () => version;
export function onFontsChanged(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let detected: FontInfo[] | null = null;
const custom: FontInfo[] = [];
const system: FontInfo[] = [];

// ---------------------------------------------------------------- detection

/**
 * True when `family` is installed: text set in it measures differently from every generic
 * fallback. (Browsers hide the font list without a permission prompt; this check needs none.)
 */
export function isInstalled(family: string): boolean {
  if (typeof document === 'undefined') return false;
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return false;
  const sample = 'mmmmmmmmmmlli1WQ@#&gyAg 0123';
  for (const base of ['monospace', 'serif', 'sans-serif']) {
    c.font = `72px ${base}`;
    const w0 = c.measureText(sample).width;
    c.font = `72px ${JSON.stringify(family)}, ${base}`;
    if (c.measureText(sample).width !== w0) return true;
  }
  return false;
}

function detect(): FontInfo[] {
  if (detected) return detected;
  const seen = new Set<string>();
  const out: FontInfo[] = [];
  for (const [category, names] of KNOWN) {
    for (const family of names) {
      if (seen.has(family)) continue;
      seen.add(family);
      // Inter ships with the app's UI fonts; the rest must be on this computer
      if (family === 'Inter' || isInstalled(family)) out.push({ family, category });
    }
  }
  detected = out;
  return out;
}

import {
  WORLD_BEST_FONTS,
  TOP_1000_GOOGLE_FONTS,
  PREBUILT_COLLECTIONS,
  loadGoogleFont,
  type FontCollection,
} from './googleFonts';
export {
  loadGoogleFont,
  WORLD_BEST_FONTS,
  TOP_1000_GOOGLE_FONTS,
  PREBUILT_COLLECTIONS,
  type FontCollection,
};

/** Every font the pickers offer: added fonts, detected fonts, top 1,000 Google fonts, then the full system list if loaded. */
export function allFonts(): FontInfo[] {
  const seen = new Set<string>();
  const out: FontInfo[] = [];
  for (const f of [...custom, ...detect(), ...TOP_1000_GOOGLE_FONTS, ...system]) {
    if (seen.has(f.family)) continue;
    seen.add(f.family);
    out.push(f as FontInfo);
  }
  return out;
}

/** Whether the browser can list every installed font (Chromium's Local Font Access, after a prompt). */
export const canListSystemFonts = () => typeof window !== 'undefined' && 'queryLocalFonts' in window;

/** Lists every installed font family (asks for permission once). Returns how many were added. */
export async function loadSystemFonts(): Promise<number> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (!q) return 0;
  const list = await q();
  const known = new Set(allFonts().map((f) => f.family));
  let added = 0;
  for (const f of list) {
    if (known.has(f.family)) continue;
    known.add(f.family);
    system.push({ family: f.family, category: 'system' });
    added++;
  }
  system.sort((a, b) => a.family.localeCompare(b.family));
  bump();
  return added;
}

// ---------------------------------------------------------------- favourites & recent

const FAV_KEY = 'skill.fonts.favorites';
const RECENT_KEY = 'skill.fonts.recent';

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export const favoriteFonts = () => readList(FAV_KEY);
export const recentFonts = () => readList(RECENT_KEY);

export function toggleFavorite(family: string) {
  const list = favoriteFonts();
  writeList(FAV_KEY, list.includes(family) ? list.filter((f) => f !== family) : [...list, family]);
  bump();
}

export function markFontUsed(family: string) {
  writeList(RECENT_KEY, [family, ...recentFonts().filter((f) => f !== family)].slice(0, 10));
  bump();
}

// ---------------------------------------------------------------- added font files

const DB = 'skill-fonts';
const FONT_EXT = /\.(ttf|otf|woff2?|ttc)$/i;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('fonts');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** A family name from the file name: "Montserrat-BoldItalic.ttf" → "Montserrat". */
export function familyFromFileName(name: string): string {
  const base = name.replace(FONT_EXT, '').replace(/[_]+/g, ' ');
  const family = base.split('-')[0].replace(/(Variable|VF|\[.*\])$/i, '').trim();
  return family || base || 'Custom Font';
}

/** Weight and style from the file name (Bold, Light, Italic…), so several files form one family. */
export function faceFromFileName(name: string): { weight: string; style: string } {
  const n = name.toLowerCase();
  const style = /italic|oblique/.test(n) ? 'italic' : 'normal';
  const weights: [RegExp, string][] = [
    [/thin|hairline/, '100'], [/extra-?light|ultra-?light/, '200'], [/light/, '300'], [/medium/, '500'],
    [/semi-?bold|demi-?bold/, '600'], [/extra-?bold|ultra-?bold/, '800'], [/black|heavy/, '900'], [/bold/, '700'],
  ];
  const w = weights.find(([re]) => re.test(n.replace(FONT_EXT, '').split('-').slice(1).join('-')));
  // Variable fonts cover the whole weight range
  const weight = /variable|vf|\[wght/.test(n) ? '100 900' : w?.[1] ?? '400';
  return { weight, style };
}

async function register(family: string, data: ArrayBuffer, fileName: string) {
  const face = new FontFace(family, data, faceFromFileName(fileName));
  await face.load();
  document.fonts.add(face);
  if (!custom.some((f) => f.family === family)) custom.push({ family, category: 'custom' });
}

/** Adds font files (TTF, OTF, WOFF, WOFF2): usable at once and kept for next time. Returns the families. */
export async function addFontFiles(files: File[]): Promise<string[]> {
  const families: string[] = [];
  const bad: string[] = [];
  for (const file of files) {
    if (!FONT_EXT.test(file.name)) {
      bad.push(file.name);
      continue;
    }
    const family = familyFromFileName(file.name);
    const data = await file.arrayBuffer();
    try {
      await register(family, data, file.name);
    } catch {
      bad.push(file.name);
      continue;
    }
    if (!families.includes(family)) families.push(family);
    try {
      const d = await db();
      d.transaction('fonts', 'readwrite').objectStore('fonts').put({ family, name: file.name, data }, file.name);
    } catch {
      /* the font works now; it just won't be remembered */
    }
  }
  if (families.length) {
    refreshText(families);
    bump();
  }
  if (bad.length) store.toast(`Couldn't read ${bad.join(', ')} — use TTF, OTF, WOFF or WOFF2 files`, 'error');
  return families;
}

/** Removes an added font (it stays usable until the app restarts). */
export async function removeCustomFont(family: string) {
  const i = custom.findIndex((f) => f.family === family);
  if (i >= 0) custom.splice(i, 1);
  try {
    const d = await db();
    const os = d.transaction('fonts', 'readwrite').objectStore('fonts');
    const req = os.getAll();
    await new Promise<void>((resolve) => {
      req.onsuccess = () => {
        for (const rec of req.result as { family: string; name: string }[]) if (rec.family === family) os.delete(rec.name);
        resolve();
      };
      req.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
  bump();
}

/** Registers the fonts added in earlier sessions. Call once at start-up. */
export async function loadSavedFonts() {
  if (typeof indexedDB === 'undefined') return;
  try {
    const d = await db();
    const recs = await new Promise<{ family: string; name: string; data: ArrayBuffer }[]>((resolve) => {
      const req = d.transaction('fonts').objectStore('fonts').getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => resolve([]);
    });
    const families = new Set<string>();
    for (const r of recs) {
      try {
        await register(r.family, r.data, r.name);
        families.add(r.family);
      } catch {
        /* skip a damaged entry */
      }
    }
    if (families.size) {
      refreshText([...families]);
      bump();
    }
  } catch {
    /* fonts are optional */
  }
}

/** Text drawn before its font was ready is measured and drawn again. */
export function refreshText(families?: string[]) {
  clearVectorCache();
  const uses = (f: string) => !families || families.includes(f);
  for (const doc of store.state.docs) {
    doc.layers = doc.layers.map((l) => {
      if (l.kind !== 'text' || !l.text) return l;
      if (!uses(l.text.font) && !l.text.runs?.some((r) => r.font && uses(r.font))) return l;
      return withLayer(l, syncTextBounds(l));
    });
  }
  store.invalidateRender();
  store.emit();
}

// Web fonts used by the UI (Inter) can finish loading after the first text render
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.addEventListener?.('loadingdone', () => refreshText());
}
