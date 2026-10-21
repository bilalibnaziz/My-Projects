// Applies interface preferences (theme, accent, pasteboard) as CSS custom properties.
import type { Prefs } from '../core/store';

export const ACCENTS = ['#0078d4', '#4daafc', '#2ea043', '#a855f7', '#ff3d6e', '#ff6b00', '#eab308'];

const PASTEBOARD: Record<Exclude<Prefs['pasteboard'], 'theme'>, string> = {
  black: '#000000',
  dark: '#1e1e1e',
  mid: '#535353',
  light: '#b8b8b8',
};

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xff6b00;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance (WCAG), used to keep text on accent-filled buttons readable. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

let lastScale = 1;

export const UI_SCALES = [0.75, 0.85, 0.9, 1, 1.1, 1.25, 1.4, 1.5];

let cssZoom = 1;

/**
 * Zoom applied with CSS (in a browser). Positions from pointer events and getBoundingClientRect
 * are in screen pixels, while CSS lengths inside the zoomed page are not: divide by this.
 * In the desktop app the whole window zooms natively and this stays 1.
 */
export const uiZoom = () => cssZoom;

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Interface size: the desktop app zooms its window natively (like ⌘+ in a browser), a browser tab uses CSS zoom. */
export async function applyUiScale(scale: number, root: HTMLElement = document.documentElement) {
  const s = Math.max(0.5, Math.min(2, scale || 1));
  if (inTauri()) {
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      await getCurrentWebview().setZoom(s);
      cssZoom = 1;
      root.style.removeProperty('zoom');
      root.style.setProperty('--uiz', '1');
      window.dispatchEvent(new Event('resize'));
      return;
    } catch {
      /* fall back to CSS zoom */
    }
  }
  cssZoom = s;
  if (s === 1) root.style.removeProperty('zoom');
  else root.style.setProperty('zoom', String(s));
  // Viewport units (vh / vw) are not zoomed: CSS divides by this to keep popups on screen
  root.style.setProperty('--uiz', String(s));
  window.dispatchEvent(new Event('resize'));
}

export function applyPrefs(p: Prefs, root: HTMLElement = document.documentElement) {
  root.dataset.theme = p.theme;
  const scale = p.uiScale ?? 1;
  if (scale !== lastScale) {
    lastScale = scale;
    void applyUiScale(scale, root);
  }
  const [r, g, b] = rgb(p.accent);
  const lift = (v: number) => Math.round(v + (255 - v) * 0.3);
  root.style.setProperty('--accent', `rgb(${r}, ${g}, ${b})`);
  // VS Code pairs its button blue with link blue #4daafc; other accents get a lighter tint of themselves
  const vscodeBlue = p.accent.toLowerCase() === '#0078d4';
  root.style.setProperty('--accent-2', vscodeBlue ? '#4daafc' : `rgb(${lift(r)}, ${lift(g)}, ${lift(b)})`);
  root.style.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.18)`);
  root.style.setProperty('--accent-line', `rgba(${r}, ${g}, ${b}, 0.55)`);
  root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.45)`);
  // Yellow or cyan accents need dark text on top of them
  root.style.setProperty('--on-accent', luminance(p.accent) > 0.45 ? '#111111' : '#ffffff');
  if (p.pasteboard === 'theme') root.style.removeProperty('--canvas-bg');
  else root.style.setProperty('--canvas-bg', PASTEBOARD[p.pasteboard]);
}
