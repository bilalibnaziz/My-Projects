// Social media and design presets: document sizes, platform safe zones and editable templates.
//
// Sizes follow the 2026 platform specs. Safe zones are fractions of the frame (so they hold at
// any export scale) and mark where the app's own UI — captions, buttons, the action rail — covers
// the post. They are guidance overlays only and never render into exports.

import type { Layer, ShapeProps, TextProps } from './types';
import { makeLayer, withLayer } from './types';
import { createCanvas, ctx2d } from './canvas';
import { syncTextBounds } from './render';
import { store } from './store';

export type PresetCategory = 'Social' | 'Video' | 'Print' | 'Packaging' | 'Screen';

export interface DocPreset {
  id: string;
  label: string;
  w: number;
  h: number;
  category: PresetCategory;
  safeZone?: string;
}

export const DOC_PRESETS: DocPreset[] = [
  { id: 'ig-portrait', label: 'Instagram Post 4:5', w: 1080, h: 1350, category: 'Social', safeZone: 'ig-grid' },
  { id: 'ig-tall', label: 'Instagram Post 3:4', w: 1080, h: 1440, category: 'Social', safeZone: 'margin' },
  { id: 'ig-square', label: 'Instagram Square', w: 1080, h: 1080, category: 'Social', safeZone: 'margin' },
  { id: 'ig-story', label: 'Instagram / FB Story', w: 1080, h: 1920, category: 'Social', safeZone: 'story' },
  { id: 'fb-post', label: 'Facebook Post', w: 1200, h: 1500, category: 'Social', safeZone: 'margin' },
  { id: 'fb-cover', label: 'Facebook Cover', w: 1640, h: 924, category: 'Social', safeZone: 'fb-cover' },
  { id: 'x-post', label: 'X Post 16:9', w: 1600, h: 900, category: 'Social', safeZone: 'margin' },
  { id: 'x-header', label: 'X Header', w: 1500, h: 500, category: 'Social', safeZone: 'x-header' },
  { id: 'li-post', label: 'LinkedIn Post', w: 1200, h: 627, category: 'Social', safeZone: 'margin' },
  { id: 'li-square', label: 'LinkedIn Square', w: 1200, h: 1200, category: 'Social', safeZone: 'margin' },
  { id: 'li-banner', label: 'LinkedIn Banner', w: 1584, h: 396, category: 'Social', safeZone: 'li-banner' },
  { id: 'pin', label: 'Pinterest Pin 2:3', w: 1000, h: 1500, category: 'Social', safeZone: 'margin' },
  { id: 'threads', label: 'Threads Post', w: 1080, h: 1350, category: 'Social', safeZone: 'margin' },
  { id: 'reel', label: 'Reel / TikTok / Short', w: 1080, h: 1920, category: 'Video', safeZone: 'reel' },
  { id: 'yt-thumb', label: 'YouTube Thumbnail', w: 1280, h: 720, category: 'Video', safeZone: 'yt-thumb' },
  { id: 'yt-banner', label: 'YouTube Channel Banner', w: 2560, h: 1440, category: 'Video', safeZone: 'yt-banner' },
  { id: 'fhd', label: 'Full HD', w: 1920, h: 1080, category: 'Screen' },
  { id: '4k', label: '4K UHD', w: 3840, h: 2160, category: 'Screen' },
  { id: 'desktop', label: 'Desktop Wallpaper', w: 2560, h: 1600, category: 'Screen' },
  { id: 'phone', label: 'Phone Wallpaper', w: 1290, h: 2796, category: 'Screen' },
  { id: 'icon', label: 'App Icon', w: 1024, h: 1024, category: 'Screen' },
  { id: 'a4', label: 'A4 @ 300 dpi', w: 2480, h: 3508, category: 'Print' },
  { id: 'letter', label: 'US Letter @ 300 dpi', w: 2550, h: 3300, category: 'Print' },
  { id: 'a5-flyer', label: 'A5 Flyer @ 300 dpi', w: 1748, h: 2480, category: 'Print' },
  { id: 'poster', label: 'Poster 18×24 in @ 150 dpi', w: 2700, h: 3600, category: 'Print' },
  { id: 'card', label: 'Business Card @ 300 dpi', w: 1050, h: 600, category: 'Print', safeZone: 'print-bleed' },
  { id: 'postcard', label: 'Postcard 6×4 in @ 300 dpi', w: 1800, h: 1200, category: 'Print' },
  { id: 'a3', label: 'A3 Poster @ 300 dpi', w: 3508, h: 4961, category: 'Print' },
  { id: 'trifold', label: 'Tri-fold Letter (open) @ 300 dpi', w: 3300, h: 2550, category: 'Print' },
  { id: 'pkg-label', label: 'Product Label 4×6 in', w: 1200, h: 1800, category: 'Packaging' },
  { id: 'pkg-bottle', label: 'Bottle Wrap Label 8×3 in', w: 2400, h: 900, category: 'Packaging' },
  { id: 'pkg-sticker', label: 'Round Sticker 3×3 in', w: 900, h: 900, category: 'Packaging' },
  { id: 'pkg-box-front', label: 'Box Front Panel 4×6 in', w: 1200, h: 1800, category: 'Packaging' },
  { id: 'pkg-box-flat', label: 'Tuck Box Dieline Sheet (A3)', w: 4961, h: 3508, category: 'Packaging' },
  { id: 'pkg-pouch', label: 'Stand-up Pouch 5×8 in', w: 1500, h: 2400, category: 'Packaging' },
  { id: 'pkg-tag', label: 'Hang Tag 2×3.5 in', w: 600, h: 1050, category: 'Packaging' },
  { id: 'pkg-mailer', label: 'Mailer Box Lid 9×6 in', w: 2700, h: 1800, category: 'Packaging' },
  { id: 'vid-4k', label: '4K UHD Video', w: 3840, h: 2160, category: 'Video' },
  { id: 'vid-fhd', label: 'Full HD Video', w: 1920, h: 1080, category: 'Video' },
  { id: 'vid-square', label: 'Square Video 1:1', w: 1080, h: 1080, category: 'Video' },
  { id: 'vid-lower-third', label: 'Lower Third (FHD overlay)', w: 1920, h: 1080, category: 'Video' },
];

export interface SafeZone {
  label: string;
  /** Fractions of the frame covered by platform UI on each side. */
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Extra covered areas (fractions of the frame), e.g. the Reels action rail or a profile photo. */
  extra?: { x: number; y: number; w: number; h: number; label: string; round?: boolean }[];
  note: string;
}

export const SAFE_ZONES: Record<string, SafeZone> = {
  margin: { label: 'Safe margin', top: 0.05, bottom: 0.05, left: 0.05, right: 0.05, note: 'Keep text 5% in from the edges' },
  'ig-grid': {
    label: 'Instagram grid crop',
    // The profile grid shows 3:4 tiles, so a 4:5 post loses ~34 px on each side
    top: 0.04,
    bottom: 0.04,
    left: (1080 - 1350 * 0.75) / 2 / 1080,
    right: (1080 - 1350 * 0.75) / 2 / 1080,
    note: 'Profile grid crops the sides to 3:4 · keep text inside',
  },
  story: { label: 'Story safe zone', top: 250 / 1920, bottom: 340 / 1920, left: 65 / 1080, right: 65 / 1080, note: 'Top: profile & progress bar · Bottom: reply bar' },
  reel: {
    label: 'Reel / TikTok safe zone',
    top: 270 / 1920,
    bottom: 670 / 1920,
    left: 60 / 1080,
    right: 60 / 1080,
    extra: [{ x: 1 - 140 / 1080, y: 0.42, w: 140 / 1080, h: 0.58 - 670 / 1920 + 0.001, label: 'Buttons' }],
    note: 'Bottom: caption & audio · Right: like / comment / share',
  },
  'yt-thumb': {
    label: 'YouTube thumbnail',
    top: 0.04,
    bottom: 0.04,
    left: 0.04,
    right: 0.04,
    extra: [{ x: 1 - 0.13, y: 1 - 0.14, w: 0.11, h: 0.1, label: 'Duration' }],
    note: 'Bottom-right is covered by the video length',
  },
  'yt-banner': { label: 'Visible on all devices', top: (1440 - 423) / 2 / 1440, bottom: (1440 - 423) / 2 / 1440, left: (2560 - 1546) / 2 / 2560, right: (2560 - 1546) / 2 / 2560, note: 'Only the centre 1546 × 423 shows on every device' },
  'x-header': {
    label: 'X header',
    top: 60 / 500,
    bottom: 60 / 500,
    left: 0.03,
    right: 0.03,
    extra: [{ x: 0.03, y: 0.62, w: 0.2, h: 0.6, label: 'Profile photo', round: true }],
    note: 'Edges crop on some screens · profile photo overlaps bottom-left',
  },
  'li-banner': {
    label: 'LinkedIn banner',
    top: 0.06,
    bottom: 0.06,
    left: 0.03,
    right: 0.03,
    extra: [{ x: 0.04, y: 0.45, w: 0.2, h: 0.8, label: 'Profile photo', round: true }],
    note: 'Profile photo covers the lower left',
  },
  'fb-cover': { label: 'Facebook cover', top: 0.08, bottom: 0.08, left: 0.12, right: 0.12, note: 'Mobile crops the sides' },
  'print-bleed': { label: 'Print safe area', top: 0.0625, bottom: 0.0625, left: 0.0357, right: 0.0357, note: 'Keep text ⅛ in from the trim' },
};

export function presetById(id: string | undefined) {
  return DOC_PRESETS.find((p) => p.id === id);
}

/** Safe zone for an arbitrary size: a matching preset's zone, else the generic margin. */
export function safeZoneFor(w: number, h: number): string {
  return DOC_PRESETS.find((p) => p.w === w && p.h === h && p.safeZone)?.safeZone ?? 'margin';
}

// ================================================================ templates

export interface Template {
  id: string;
  label: string;
  preset: string;
  /** Two-colour preview swatch for the picker. */
  swatch: [string, string];
  build: (w: number, h: number) => Layer[];
}

function gradientLayer(w: number, h: number, stops: string[], angle = 135, name = 'Background'): Layer {
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  const a = (angle * Math.PI) / 180;
  const r = Math.abs((w / 2) * Math.cos(a)) + Math.abs((h / 2) * Math.sin(a));
  const g = ctx.createLinearGradient(w / 2 - Math.cos(a) * r, h / 2 - Math.sin(a) * r, w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
  stops.forEach((s, i) => g.addColorStop(i / Math.max(1, stops.length - 1), s));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return makeLayer({ kind: 'raster', name, canvas: c, width: w, height: h });
}

const TEXT_BASE: TextProps = {
  text: '',
  font: 'Inter',
  size: 64,
  weight: 700,
  italic: false,
  color: '#ffffff',
  align: 'left',
  lineHeight: 1.15,
  tracking: 0,
  shadow: false,
  stroke: 0,
  strokeColor: '#000000',
};

/** Text layer positioned by its anchor: `ax` is the left edge, centre or right edge depending on `align`. */
function text(name: string, props: Partial<TextProps>, ax: number, y: number): Layer {
  const t = { ...TEXT_BASE, ...props };
  let layer = makeLayer({ kind: 'text', name, text: t, x: ax, y });
  layer = withLayer(layer, syncTextBounds(layer));
  const x = t.align === 'center' ? ax - layer.width / 2 : t.align === 'right' ? ax - layer.width : ax;
  return withLayer(layer, { x: Math.round(x) });
}

function shape(name: string, props: Partial<ShapeProps>, x: number, y: number, w: number, h: number, opacity = 1): Layer {
  const s: ShapeProps = { shape: 'rectangle', fill: '#ffffff', fillEnabled: true, stroke: '#ffffff', strokeWidth: 0, radius: 0, sides: 6, ...props };
  return makeLayer({ kind: 'shape', name, shape: s, x, y, width: w, height: h, opacity });
}

const PHOTO_HINT = 'Photo frame — select it, then File ▸ Place Image to fill it';

export const TEMPLATES: Template[] = [
  {
    id: 'quote',
    label: 'Quote Post',
    preset: 'ig-portrait',
    swatch: ['#1e1b4b', '#f472b6'],
    build: (w, h) => [
      gradientLayer(w, h, ['#1e1b4b', '#5b21b6', '#db2777']),
      text('Quote mark', { text: '“', size: 320, font: 'Georgia', color: '#f9a8d4', weight: 700 }, 90, 60),
      text('Quote', { text: 'Design is not just\nwhat it looks like.\nDesign is how\nit works.', size: 84, weight: 800, lineHeight: 1.12 }, 96, 420),
      shape('Accent line', { fill: '#f9a8d4' }, 100, h - 300, 120, 10),
      text('Author', { text: '— STEVE JOBS', size: 34, weight: 600, tracking: 4, color: '#fbcfe8' }, 100, h - 250),
      text('Handle', { text: '@yourbrand', size: 28, weight: 500, color: '#e9d5ff', align: 'right' }, w - 96, h - 110),
    ],
  },
  {
    id: 'sale',
    label: 'Sale Announcement',
    preset: 'ig-square',
    swatch: ['#ff6b00', '#111111'],
    build: (w, h) => [
      gradientLayer(w, h, ['#ff8a00', '#ff3d00'], 90),
      shape('Circle', { shape: 'ellipse', fill: '#ffffff' }, w - 420, -200, 640, 640, 0.12),
      shape('Circle 2', { shape: 'ellipse', fill: '#000000' }, -180, h - 360, 520, 520, 0.08),
      text('Kicker', { text: 'LIMITED TIME', size: 40, weight: 700, tracking: 10, align: 'center', color: '#fff7ed' }, w / 2, 230),
      text('Headline', { text: 'SUMMER\nSALE', size: 190, weight: 900, align: 'center', lineHeight: 0.95, shadow: true }, w / 2, 310),
      text('Offer', { text: 'UP TO 50% OFF', size: 54, weight: 800, align: 'center', color: '#ff3d00', box: true, boxColor: '#ffffff', boxPad: 22, boxRadius: 40 }, w / 2, 760),
      text('Footer', { text: 'yourstore.com', size: 32, weight: 500, align: 'center', color: '#fff7ed' }, w / 2, h - 120),
    ],
  },
  {
    id: 'thumbnail',
    label: 'YouTube Thumbnail',
    preset: 'yt-thumb',
    swatch: ['#0f172a', '#facc15'],
    build: (w, h) => [
      gradientLayer(w, h, ['#020617', '#1e293b'], 0),
      shape('Photo frame', { shape: 'ellipse', fill: '#334155' }, w - 560, 80, 520, 520),
      text('Frame hint', { text: 'Your face here', size: 30, weight: 600, align: 'center', color: '#94a3b8' }, w - 300, 320),
      text('Title', { text: 'I TRIED IT\nFOR 30 DAYS', size: 118, weight: 900, lineHeight: 1, stroke: 6, strokeColor: '#000000', shadow: true }, 60, 150),
      text('Badge', { text: 'SHOCKING', size: 46, weight: 900, color: '#000000', box: true, boxColor: '#facc15', boxPad: 16, boxRadius: 8 }, 76, 470),
    ],
  },
  {
    id: 'event-story',
    label: 'Event Story',
    preset: 'ig-story',
    swatch: ['#064e3b', '#a7f3d0'],
    build: (w, h) => [
      gradientLayer(w, h, ['#022c22', '#065f46', '#10b981'], 100),
      shape('Ring', { shape: 'ellipse', fillEnabled: false, stroke: '#a7f3d0', strokeWidth: 6 }, w / 2 - 350, 430, 700, 700, 0.35),
      text('Date', { text: 'SAT · 14 NOV', size: 46, weight: 700, tracking: 8, align: 'center', color: '#a7f3d0' }, w / 2, 520),
      text('Title', { text: 'Rooftop\nSessions', size: 150, weight: 900, align: 'center', lineHeight: 1 }, w / 2, 630),
      text('Details', { text: 'Live music · 8 PM\nDowntown Terrace', size: 44, weight: 500, align: 'center', color: '#d1fae5', lineHeight: 1.4 }, w / 2, 1200),
      text('CTA', { text: 'TAP TO RSVP', size: 44, weight: 800, tracking: 4, align: 'center', color: '#064e3b', box: true, boxColor: '#ffffff', boxPad: 28, boxRadius: 60 }, w / 2, 1440),
    ],
  },
  {
    id: 'product',
    label: 'Product Showcase',
    preset: 'ig-portrait',
    swatch: ['#f5f5f4', '#1c1917'],
    build: (w, h) => {
      const bg = createCanvas(w, h);
      const ctx = ctx2d(bg);
      ctx.fillStyle = '#f5f5f4';
      ctx.fillRect(0, 0, w, h);
      return [
        makeLayer({ kind: 'raster', name: 'Background', canvas: bg, width: w, height: h }),
        shape('Photo frame', { fill: '#d6d3d1', radius: 36 }, 70, 70, w - 140, 860),
        text('Frame hint', { text: PHOTO_HINT, size: 26, weight: 500, align: 'center', color: '#78716c' }, w / 2, 480),
        text('Name', { text: 'The Everyday Tote', size: 70, weight: 800, color: '#1c1917' }, 80, 990),
        text('Price', { text: '$49', size: 70, weight: 300, color: '#1c1917', align: 'right' }, w - 80, 990),
        text('Tagline', { text: 'Organic canvas · Made to last', size: 34, weight: 500, color: '#57534e' }, 80, 1090),
        text('CTA', { text: 'SHOP NOW', size: 30, weight: 800, tracking: 4, color: '#ffffff', box: true, boxColor: '#1c1917', boxPad: 20, boxRadius: 30 }, 100, 1190),
      ];
    },
  },
  {
    id: 'linkedin',
    label: 'LinkedIn Announcement',
    preset: 'li-post',
    swatch: ['#0a66c2', '#ffffff'],
    build: (w, h) => [
      gradientLayer(w, h, ['#0a66c2', '#004182'], 160),
      shape('Panel', { fill: '#ffffff', radius: 28 }, 60, 60, 640, h - 120),
      text('Kicker', { text: "WE'RE HIRING", size: 30, weight: 800, tracking: 6, color: '#0a66c2' }, 110, 120),
      text('Title', { text: 'Senior Product\nDesigner', size: 74, weight: 800, color: '#0f172a', lineHeight: 1.05 }, 110, 180),
      text('Details', { text: 'Remote · Full-time\nApply via the link in comments', size: 30, weight: 500, color: '#475569', lineHeight: 1.45 }, 110, 400),
      shape('Photo frame', { shape: 'ellipse', fill: '#ffffff' }, 780, 110, 380, 380, 0.18),
      text('Frame hint', { text: 'Logo or photo', size: 28, weight: 600, align: 'center', color: '#dbeafe' }, 970, 285),
    ],
  },
];

/** Opens a template as a new, fully editable document. */
export function newFromTemplate(id: string) {
  const t = TEMPLATES.find((x) => x.id === id);
  const p = presetById(t?.preset);
  if (!t || !p) return null;
  const layers = t.build(p.w, p.h);
  const doc = store.addDoc({ title: t.label, width: p.w, height: p.h, layers });
  doc.safeZone = p.safeZone;
  store.set({ showSafeZones: true });
  return doc;
}
