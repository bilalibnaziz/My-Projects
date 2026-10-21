// Font library for SkillMotion with 1,800+ World Best Google Fonts and dynamic loader
import {
  WORLD_BEST_FONTS,
  TOP_1000_GOOGLE_FONTS,
  PREBUILT_COLLECTIONS,
  loadGoogleFont,
  type GoogleFontCategory,
  type GoogleFontEntry,
  type FontCollection,
} from './googleFonts';

export type FontCategory =
  | 'sans'
  | 'serif'
  | 'display'
  | 'mono'
  | 'script'
  | 'tech'
  | 'vintage'
  | 'luxury'
  | 'world';

export interface FontInfo {
  family: string;
  category: FontCategory;
}

export {
  loadGoogleFont,
  WORLD_BEST_FONTS,
  TOP_1000_GOOGLE_FONTS,
  PREBUILT_COLLECTIONS,
  type GoogleFontCategory,
  type GoogleFontEntry,
  type FontCollection,
};

const FAV_KEY = 'skill.motion.fonts.favorites';
const RECENT_KEY = 'skill.motion.fonts.recent';

export function favoriteFonts(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function toggleFavorite(family: string): string[] {
  const list = favoriteFonts();
  const idx = list.indexOf(family);
  const next = idx >= 0 ? list.filter((f) => f !== family) : [...list, family];
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function recentFonts(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function markFontUsed(family: string) {
  const list = recentFonts().filter((f) => f !== family);
  const next = [family, ...list].slice(0, 20);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

export function allFonts(): FontInfo[] {
  return WORLD_BEST_FONTS as FontInfo[];
}
