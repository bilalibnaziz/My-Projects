// Post kit for social media design: layouts that drop onto the open photo as one editable group, ready-made
// elements (buttons, badges, price tags, ribbons…), text styles and brand palettes. Everything stays live:
// text is text, shapes keep their corners / gradients, buttons hug their labels (hug.ts).

import type { Layer, ShapeProps, TextProps } from './types';
import { makeLayer, withLayer } from './types';
import { store } from './store';
import { groupLayers } from './groups';
import { shapeLayer, textLayer } from './social';
import { buttonPadding } from './hug';

// ================================================================ palettes

export interface PostPalette {
  id: string;
  name: string;
  /** Panel / card colour. */
  bg: string;
  /** Main text on the panel. */
  ink: string;
  /** Text over photos. */
  light: string;
  /** Buttons, badges, highlights. */
  accent: string;
  /** Text on the accent. */
  onAccent: string;
  /** Second highlight. */
  accent2: string;
}

export const POST_PALETTES: PostPalette[] = [
  { id: 'clean', name: 'Clean', bg: '#ffffff', ink: '#111111', light: '#ffffff', accent: '#0078d4', onAccent: '#ffffff', accent2: '#2ea043' },
  { id: 'bold', name: 'Bold', bg: '#111111', ink: '#ffffff', light: '#ffffff', accent: '#ffd60a', onAccent: '#111111', accent2: '#ff3b30' },
  { id: 'food', name: 'Food', bg: '#fff6e9', ink: '#3b2414', light: '#fffaf2', accent: '#e4572e', onAccent: '#ffffff', accent2: '#f3a712' },
  { id: 'fresh', name: 'Fresh', bg: '#f1faee', ink: '#1d3557', light: '#ffffff', accent: '#2a9d8f', onAccent: '#ffffff', accent2: '#e9c46a' },
  { id: 'luxe', name: 'Luxe', bg: '#0f0f12', ink: '#f2e6c9', light: '#f2e6c9', accent: '#c9a227', onAccent: '#0f0f12', accent2: '#8a6d1d' },
  { id: 'pastel', name: 'Pastel', bg: '#fdf0f5', ink: '#4a3355', light: '#ffffff', accent: '#ff8fab', onAccent: '#ffffff', accent2: '#a0c4ff' },
  { id: 'neon', name: 'Neon', bg: '#0b0221', ink: '#ffffff', light: '#ffffff', accent: '#ff2e88', onAccent: '#ffffff', accent2: '#00e5ff' },
  { id: 'earth', name: 'Earth', bg: '#f4efe6', ink: '#2f2a24', light: '#fbf8f2', accent: '#7a8450', onAccent: '#ffffff', accent2: '#c56b3e' },
];

export const paletteById = (id: string) => POST_PALETTES.find((p) => p.id === id) ?? POST_PALETTES[0];

/** `#rrggbb` + alpha (0..1) as `#rrggbbaa`. */
const alpha = (hex: string, a: number) => `${hex.slice(0, 7)}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;

// ================================================================ building blocks

type Ctx = { w: number; h: number; u: number; p: PostPalette };

const T = (c: Ctx, name: string, props: Partial<TextProps>, ax: number, y: number) =>
  textLayer(name, { ...props, size: Math.round((props.size ?? 64) * c.u), boxPad: props.boxPad !== undefined ? Math.round(props.boxPad * c.u) : undefined, boxRadius: props.boxRadius !== undefined ? Math.round(props.boxRadius * c.u) : undefined, boxWidth: props.boxWidth ? Math.round(props.boxWidth * c.u) : undefined, tracking: Math.round((props.tracking ?? 0) * c.u) }, Math.round(ax), Math.round(y));

const R = (name: string, props: Partial<ShapeProps>, x: number, y: number, w: number, h: number, opacity = 1) => shapeLayer(name, props, Math.round(x), Math.round(y), Math.round(w), Math.round(h), opacity);

/** A label with a shape that hugs it (grows as you type). Returns [shape, text]. */
function button(c: Ctx, label: string, cx: number, y: number, opts: { size?: number; fill?: string; color?: string; radius?: 'pill' | number; stroke?: string } = {}): Layer[] {
  const size = opts.size ?? 40;
  const t = T(c, `Button label`, { text: label, size, weight: 700, color: opts.color ?? c.p.onAccent, align: 'center' }, cx, y);
  const { padX, padY } = buttonPadding(t.text!.size);
  const h = t.height + padY * 2;
  const s = makeLayer({
    kind: 'shape',
    name: 'Button',
    x: t.x - padX,
    y: t.y - padY,
    width: t.width + padX * 2,
    height: h,
    shape: {
      shape: 'rectangle', fill: opts.fill ?? c.p.accent, fillEnabled: !!(opts.fill ?? c.p.accent) && opts.fill !== 'none', stroke: opts.stroke ?? '#000000', strokeWidth: opts.stroke ? Math.max(2, Math.round(3 * c.u)) : 0,
      radius: opts.radius === 'pill' || opts.radius === undefined ? Math.round(h / 2) : Math.round(opts.radius * c.u),
    },
    hug: { target: t.id, padX, padY },
  });
  return [s, t];
}

/** Five live stars in a row, centred on cx. */
function stars(c: Ctx, cx: number, y: number, size = 44, color = c.p.accent2): Layer[] {
  const s = size * c.u;
  const gap = s * 0.25;
  const total = s * 5 + gap * 4;
  return Array.from({ length: 5 }, (_, i) => R(`Star ${i + 1}`, { shape: 'star', sides: 5, innerRatio: 0.48, pointRadius: Math.round(s * 0.04), fill: color }, cx - total / 2 + i * (s + gap), y, s, s));
}

/** Darkening gradient over part of the photo so light text reads on any image. */
const scrim = (c: Ctx, from: 'top' | 'bottom', share = 0.55, strength = 0.75) =>
  R('Scrim', {
    fill: '#000000',
    gradient: from === 'bottom'
      ? { type: 'linear', x0: 0.5, y0: 0, x1: 0.5, y1: 1, stops: [{ offset: 0, color: '#00000000' }, { offset: 1, color: alpha('#000000', strength) }] }
      : { type: 'linear', x0: 0.5, y0: 1, x1: 0.5, y1: 0, stops: [{ offset: 0, color: '#00000000' }, { offset: 1, color: alpha('#000000', strength) }] },
  }, 0, from === 'bottom' ? c.h * (1 - share) : 0, c.w, c.h * share);

// ================================================================ layouts

export interface PostLayout {
  id: string;
  name: string;
  /** What it's for (shown in the picker). */
  hint: string;
  tags: ('promo' | 'food' | 'quote' | 'info' | 'event' | 'video' | 'minimal')[];
  /** Layers bottom → top, in document pixels for a w × h canvas. */
  build: (c: Ctx) => Layer[];
}

export const POST_LAYOUTS: PostLayout[] = [
  {
    id: 'headline-bottom',
    name: 'Headline',
    hint: 'Big headline over a soft dark fade at the bottom',
    tags: ['minimal', 'promo'],
    build: (c) => [
      scrim(c, 'bottom', 0.55, 0.8),
      T(c, 'Kicker', { text: 'NEW THIS WEEK', size: 28, weight: 700, color: c.p.accent2 === '#ffffff' ? c.p.accent : c.p.accent2, tracking: 4, caps: true }, c.w * 0.07, c.h - 380 * c.u),
      T(c, 'Headline', { text: 'Your headline\ngoes right here', size: 88, weight: 800, color: c.p.light, lineHeight: 1.05 }, c.w * 0.07, c.h - 330 * c.u),
      T(c, 'Subline', { text: 'A short line that sells it', size: 34, weight: 500, color: alpha(c.p.light, 0.85) }, c.w * 0.07, c.h - 110 * c.u),
    ],
  },
  {
    id: 'quote-card',
    name: 'Quote Card',
    hint: 'A frosted card with a quote and its author',
    tags: ['quote', 'minimal'],
    build: (c) => {
      const cw = c.w * 0.82, ch = Math.min(c.h * 0.62, 760 * c.u);
      const x = (c.w - cw) / 2, y = (c.h - ch) / 2;
      return [
        R('Card', { fill: c.p.bg, fillOpacity: 0.9, radius: Math.round(36 * c.u), cornerStyle: 'smooth' }, x, y, cw, ch),
        T(c, 'Quote mark', { text: '“', size: 200, weight: 800, color: c.p.accent, font: 'Georgia' }, c.w / 2 - 50 * c.u, y + 10 * c.u),
        T(c, 'Quote', { text: 'Make it simple,\nmake it memorable.', size: 60, weight: 700, color: c.p.ink, align: 'center', lineHeight: 1.15 }, c.w / 2, y + ch * 0.38),
        T(c, 'Author', { text: '— Your Name', size: 32, weight: 500, color: alpha(c.p.ink, 0.7), align: 'center' }, c.w / 2, y + ch - 110 * c.u),
      ];
    },
  },
  {
    id: 'sale-burst',
    name: 'Sale Burst',
    hint: 'Price burst badge, bold offer and a Shop button',
    tags: ['promo'],
    build: (c) => {
      const b = 300 * c.u;
      return [
        scrim(c, 'bottom', 0.45, 0.7),
        R('Burst', { shape: 'star', sides: 14, innerRatio: 0.78, fill: c.p.accent }, c.w - b - 50 * c.u, 50 * c.u, b, b),
        T(c, 'Burst text', { text: '50%\nOFF', size: 72, weight: 900, color: c.p.onAccent, align: 'center', lineHeight: 0.95 }, c.w - b / 2 - 50 * c.u, 50 * c.u + b * 0.28),
        T(c, 'Offer', { text: 'WEEKEND SALE', size: 96, weight: 900, color: c.p.light, caps: true }, c.w * 0.07, c.h - 300 * c.u),
        ...button(c, 'Shop now', c.w * 0.07 + 150 * c.u, c.h - 150 * c.u, { size: 36 }),
      ];
    },
  },
  {
    id: 'product-spotlight',
    name: 'Product',
    hint: 'Photo on top, product name, price pill and button below',
    tags: ['promo', 'food'],
    build: (c) => {
      const ph = c.h * 0.3;
      return [
        R('Panel', { fill: c.p.bg, radii: [Math.round(40 * c.u), Math.round(40 * c.u), 0, 0] }, 0, c.h - ph, c.w, ph),
        T(c, 'Product name', { text: 'Product Name', size: 64, weight: 800, color: c.p.ink }, c.w * 0.07, c.h - ph + 60 * c.u),
        T(c, 'Details', { text: 'One line about why it is great', size: 30, weight: 500, color: alpha(c.p.ink, 0.65) }, c.w * 0.07, c.h - ph + 150 * c.u),
        ...button(c, '$24.99', c.w * 0.07 + 110 * c.u, c.h - 110 * c.u, { size: 34, fill: c.p.accent2, color: c.p.ink }),
        ...button(c, 'Order now', c.w * 0.93 - 150 * c.u, c.h - 110 * c.u, { size: 34 }),
      ];
    },
  },
  {
    id: 'recipe-card',
    name: 'Recipe',
    hint: 'Food post: dish name, time and serving badges',
    tags: ['food', 'info'],
    build: (c) => {
      const y0 = c.h * 0.62;
      return [
        R('Card', { fill: c.p.bg, fillOpacity: 0.94, radius: Math.round(32 * c.u) }, c.w * 0.05, y0, c.w * 0.9, c.h - y0 - c.w * 0.05),
        T(c, 'Dish', { text: 'Creamy Tomato Pasta', size: 60, weight: 800, color: c.p.ink }, c.w * 0.1, y0 + 40 * c.u),
        T(c, 'Description', { text: 'Ready in 20 minutes · 5 ingredients', size: 30, weight: 500, color: alpha(c.p.ink, 0.7) }, c.w * 0.1, y0 + 125 * c.u),
        ...button(c, '⏱ 20 min', c.w * 0.1 + 95 * c.u, y0 + 210 * c.u, { size: 28, fill: c.p.accent, radius: 'pill' }),
        ...button(c, '🍽 Serves 2', c.w * 0.1 + 330 * c.u, y0 + 210 * c.u, { size: 28, fill: c.p.accent2, color: c.p.ink, radius: 'pill' }),
      ];
    },
  },
  {
    id: 'event-poster',
    name: 'Event',
    hint: 'Date block, big title and details — posters and stories',
    tags: ['event'],
    build: (c) => [
      R('Tint', { fill: '#000000', fillOpacity: 0.35 }, 0, 0, c.w, c.h),
      R('Date block', { fill: c.p.accent, radius: Math.round(20 * c.u) }, c.w * 0.07, c.h * 0.07, 190 * c.u, 210 * c.u),
      T(c, 'Day', { text: '24', size: 100, weight: 900, color: c.p.onAccent, align: 'center' }, c.w * 0.07 + 95 * c.u, c.h * 0.07 + 20 * c.u),
      T(c, 'Month', { text: 'OCT', size: 36, weight: 800, color: c.p.onAccent, align: 'center', tracking: 4 }, c.w * 0.07 + 95 * c.u, c.h * 0.07 + 140 * c.u),
      T(c, 'Title', { text: 'LIVE MUSIC\nNIGHT', size: 120, weight: 900, color: c.p.light, lineHeight: 0.95 }, c.w * 0.07, c.h * 0.5 - 120 * c.u),
      R('Rule', { shape: 'line', stroke: c.p.accent, strokeWidth: Math.max(2, Math.round(6 * c.u)), strokeCap: 'round' }, c.w * 0.07, c.h * 0.5 + 150 * c.u, 160 * c.u, 0),
      T(c, 'Details', { text: '8 PM · The Venue · Free entry', size: 34, weight: 600, color: c.p.light }, c.w * 0.07, c.h * 0.5 + 190 * c.u),
    ],
  },
  {
    id: 'tips-list',
    name: 'Tips List',
    hint: 'Title and three numbered points on a side panel',
    tags: ['info'],
    build: (c) => {
      const pw = c.w * 0.62;
      const out: Layer[] = [
        R('Panel', { fill: c.p.bg, fillOpacity: 0.95 }, 0, 0, pw, c.h),
        T(c, 'Title', { text: '3 tips for\nbetter photos', size: 66, weight: 800, color: c.p.ink, lineHeight: 1.05 }, 60 * c.u, c.h * 0.12),
      ];
      ['Shoot in soft light', 'Fill the frame', 'Edit with one look'].forEach((tip, i) => {
        const y = c.h * 0.42 + i * 150 * c.u;
        out.push(R(`Number ${i + 1} badge`, { shape: 'ellipse', fill: c.p.accent }, 60 * c.u, y, 76 * c.u, 76 * c.u));
        out.push(T(c, `Number ${i + 1}`, { text: String(i + 1), size: 40, weight: 800, color: c.p.onAccent, align: 'center' }, 98 * c.u, y + 14 * c.u));
        out.push(T(c, `Tip ${i + 1}`, { text: tip, size: 36, weight: 600, color: c.p.ink }, 160 * c.u, y + 16 * c.u));
      });
      return out;
    },
  },
  {
    id: 'testimonial',
    name: 'Review',
    hint: 'Five stars, a customer quote and their name',
    tags: ['quote', 'promo'],
    build: (c) => [
      R('Tint', { fill: c.p.bg, fillOpacity: 0.88 }, 0, c.h * 0.45, c.w, c.h * 0.55),
      ...stars(c, c.w / 2, c.h * 0.45 + 60 * c.u),
      T(c, 'Review', { text: '“Best coffee in town.\nI come back every day.”', size: 52, weight: 700, color: c.p.ink, align: 'center', lineHeight: 1.2 }, c.w / 2, c.h * 0.45 + 150 * c.u),
      T(c, 'Customer', { text: 'SARAH K. · VERIFIED BUYER', size: 26, weight: 700, color: alpha(c.p.ink, 0.6), align: 'center', tracking: 3 }, c.w / 2, c.h - 120 * c.u),
    ],
  },
  {
    id: 'carousel-cover',
    name: 'Carousel Cover',
    hint: 'First slide: big title, slide count and a Swipe cue',
    tags: ['info'],
    build: (c) => [
      R('Tint', { fill: '#000000', fillOpacity: 0.3 }, 0, 0, c.w, c.h),
      T(c, 'Counter', { text: '01 / 05', size: 28, weight: 700, color: c.p.light, tracking: 2 }, c.w * 0.07, c.h * 0.07),
      T(c, 'Title', { text: 'Everything you\nneed to know', size: 92, weight: 900, color: c.p.light, lineHeight: 1.02 }, c.w * 0.07, c.h * 0.36),
      ...button(c, 'Swipe  →', c.w * 0.93 - 120 * c.u, c.h - 130 * c.u, { size: 32, fill: c.p.light, color: '#111111' }),
    ],
  },
  {
    id: 'announcement-band',
    name: 'Announcement',
    hint: 'A bold band across the middle',
    tags: ['promo', 'event'],
    build: (c) => [
      R('Band', { fill: c.p.accent }, 0, c.h / 2 - 120 * c.u, c.w, 240 * c.u),
      T(c, 'Announcement', { text: 'WE ARE OPEN', size: 110, weight: 900, color: c.p.onAccent, align: 'center', caps: true }, c.w / 2, c.h / 2 - 66 * c.u),
    ],
  },
  {
    id: 'thumbnail-bold',
    name: 'Thumbnail',
    hint: 'YouTube-style: huge outlined text, arrow and circle highlight',
    tags: ['video'],
    build: (c) => [
      T(c, 'Title', { text: 'I TRIED IT!', size: 150, weight: 900, color: c.p.accent === '#0078d4' ? '#ffd60a' : c.p.accent, stroke: Math.round(10 * c.u), strokeColor: '#000000', caps: true }, c.w * 0.05, c.h * 0.08),
      R('Highlight circle', { shape: 'ellipse', fillEnabled: false, stroke: '#ff3b30', strokeWidth: Math.max(4, Math.round(14 * c.u)) }, c.w * 0.6, c.h * 0.35, 320 * c.u, 320 * c.u),
      R('Arrow', { shape: 'arrow', stroke: '#ff3b30', strokeWidth: Math.max(4, Math.round(18 * c.u)), strokeCap: 'round' }, c.w * 0.35, c.h * 0.75, c.w * 0.22, -c.h * 0.2),
    ],
  },
  {
    id: 'before-after',
    name: 'Before / After',
    hint: 'Split line with labels — retouching and makeovers',
    tags: ['minimal'],
    build: (c) => [
      R('Divider', { shape: 'line', stroke: '#ffffff', strokeWidth: Math.max(3, Math.round(8 * c.u)) }, c.w / 2, 0, 0, c.h),
      ...button(c, 'BEFORE', c.w * 0.25, c.h - 120 * c.u, { size: 30, fill: '#111111', color: '#ffffff', radius: 8 }),
      ...button(c, 'AFTER', c.w * 0.75, c.h - 120 * c.u, { size: 30, fill: '#ffffff', color: '#111111', radius: 8 }),
    ],
  },
  {
    id: 'frame-handle',
    name: 'Frame',
    hint: 'Rounded inset border with your handle — clean feed look',
    tags: ['minimal'],
    build: (c) => {
      const m = Math.round(40 * c.u);
      return [
        R('Frame', { fillEnabled: false, stroke: c.p.light, strokeWidth: Math.max(2, Math.round(6 * c.u)), strokeAlign: 'inside', radius: Math.round(28 * c.u) }, m, m, c.w - 2 * m, c.h - 2 * m),
        ...button(c, '@yourhandle', c.w / 2, c.h - m - 110 * c.u, { size: 28, fill: alpha('#000000', 0.55), color: '#ffffff' }),
      ];
    },
  },
  {
    id: 'minimal-caption',
    name: 'Caption',
    hint: 'Small caption on a highlight box, bottom left',
    tags: ['minimal'],
    build: (c) => [T(c, 'Caption', { text: 'Sunday mornings ☕', size: 40, weight: 700, color: c.p.ink, box: true, boxColor: c.p.bg, boxPad: 18, boxRadius: 10 }, c.w * 0.07, c.h - 150 * c.u)],
  },
];

// ================================================================ elements

export interface PostElement {
  id: string;
  name: string;
  /** Layers bottom → top, centred on (cx, cy). */
  build: (c: Ctx, cx: number, cy: number) => Layer[];
}

export const POST_ELEMENTS: PostElement[] = [
  { id: 'cta', name: 'Button', build: (c, x, y) => button(c, 'Learn more', x, y - 25 * c.u) },
  { id: 'cta-outline', name: 'Outline Button', build: (c, x, y) => button(c, 'Book now', x, y - 25 * c.u, { fill: 'none', color: c.p.light, stroke: c.p.light }) },
  { id: 'price', name: 'Price Tag', build: (c, x, y) => button(c, '$19', x, y - 30 * c.u, { size: 48, fill: c.p.accent2, color: c.p.ink, radius: 14 }) },
  {
    id: 'burst', name: 'Sale Burst', build: (c, x, y) => {
      const s = 260 * c.u;
      return [R('Burst', { shape: 'star', sides: 16, innerRatio: 0.8, fill: c.p.accent }, x - s / 2, y - s / 2, s, s), T(c, 'Burst text', { text: 'SALE', size: 56, weight: 900, color: c.p.onAccent, align: 'center' }, x, y - 34 * c.u)];
    },
  },
  {
    id: 'badge', name: 'New Badge', build: (c, x, y) => {
      const s = 180 * c.u;
      return [R('Badge', { shape: 'ellipse', fill: c.p.accent2 }, x - s / 2, y - s / 2, s, s), T(c, 'Badge text', { text: 'NEW', size: 48, weight: 900, color: c.p.ink, align: 'center' }, x, y - 28 * c.u)];
    },
  },
  {
    id: 'seal', name: 'Seal', build: (c, x, y) => {
      const s = 220 * c.u;
      return [R('Seal', { shape: 'star', sides: 24, innerRatio: 0.9, pointRadius: Math.max(1, Math.round(3 * c.u)), fill: c.p.accent }, x - s / 2, y - s / 2, s, s), T(c, 'Seal text', { text: 'BEST\nSELLER', size: 34, weight: 900, color: c.p.onAccent, align: 'center', lineHeight: 1 }, x, y - 34 * c.u)];
    },
  },
  {
    id: 'ribbon', name: 'Ribbon', build: (c, x, y) => {
      const w = 520 * c.u, h = 96 * c.u;
      return [R('Ribbon', { fill: c.p.accent, radii: [0, Math.round(h / 2), Math.round(h / 2), 0] }, x - w / 2, y - h / 2, w, h), T(c, 'Ribbon text', { text: 'LIMITED OFFER', size: 40, weight: 800, color: c.p.onAccent, align: 'center' }, x, y - 24 * c.u)];
    },
  },
  {
    id: 'bubble', name: 'Speech Bubble', build: (c, x, y) => {
      const w = 460 * c.u, h = 200 * c.u;
      return [R('Bubble', { fill: c.p.bg, radii: [Math.round(40 * c.u), Math.round(40 * c.u), Math.round(40 * c.u), 0] }, x - w / 2, y - h / 2, w, h), T(c, 'Bubble text', { text: 'Wait for it…', size: 46, weight: 700, color: c.p.ink, align: 'center' }, x, y - 28 * c.u)];
    },
  },
  { id: 'stars', name: 'Star Rating', build: (c, x, y) => stars(c, x, y - 22 * c.u) },
  { id: 'arrow', name: 'Arrow', build: (c, x, y) => [R('Arrow', { shape: 'arrow', stroke: c.p.accent, strokeWidth: Math.max(4, Math.round(14 * c.u)), strokeCap: 'round' }, x - 150 * c.u, y + 60 * c.u, 300 * c.u, -120 * c.u)] },
  { id: 'circle', name: 'Circle Highlight', build: (c, x, y) => [R('Circle highlight', { shape: 'ellipse', fillEnabled: false, stroke: c.p.accent, strokeWidth: Math.max(4, Math.round(12 * c.u)) }, x - 160 * c.u, y - 160 * c.u, 320 * c.u, 320 * c.u)] },
  { id: 'divider', name: 'Divider', build: (c, x, y) => [R('Divider', { shape: 'line', stroke: c.p.accent, strokeWidth: Math.max(2, Math.round(6 * c.u)), strokeCap: 'round' }, x - 120 * c.u, y, 240 * c.u, 0)] },
  { id: 'handle', name: 'Handle', build: (c, x, y) => button(c, '@yourhandle', x, y - 20 * c.u, { size: 30, fill: alpha('#000000', 0.55), color: '#ffffff' }) },
  { id: 'swipe', name: 'Swipe Cue', build: (c, x, y) => button(c, 'Swipe  →', x, y - 20 * c.u, { size: 30, fill: c.p.light, color: '#111111' }) },
  {
    id: 'photo-frame', name: 'Photo Frame', build: (c, x, y) => {
      const s = 420 * c.u;
      return [R('Photo frame', { fill: '#d9d9d9', radius: Math.round(28 * c.u) }, x - s / 2, y - s / 2, s, s)];
    },
  },
  {
    id: 'logo-spot', name: 'Logo Spot', build: (c, x, y) => {
      const s = 140 * c.u;
      return [R('Logo spot', { shape: 'ellipse', fill: c.p.bg, stroke: c.p.accent, strokeWidth: Math.max(2, Math.round(4 * c.u)) }, x - s / 2, y - s / 2, s, s), T(c, 'Logo text', { text: 'LOGO', size: 30, weight: 800, color: c.p.ink, align: 'center' }, x, y - 18 * c.u)];
    },
  },
];

// ================================================================ text styles

export interface TextStylePreset {
  id: string;
  name: string;
  props: (c: Ctx) => Partial<TextProps>;
  sample: string;
}

export const TEXT_STYLES: TextStylePreset[] = [
  { id: 'headline', name: 'Headline', sample: 'Big headline', props: (c) => ({ size: 96, weight: 900, color: c.p.light, lineHeight: 1.02 }) },
  { id: 'subhead', name: 'Subheading', sample: 'A subheading', props: (c) => ({ size: 48, weight: 700, color: c.p.light }) },
  { id: 'body', name: 'Body', sample: 'Body text that explains a little more.', props: (c) => ({ size: 32, weight: 500, color: c.p.light, boxWidth: 700, lineHeight: 1.35 }) },
  { id: 'kicker', name: 'Kicker', sample: 'LIMITED TIME', props: (c) => ({ size: 28, weight: 800, color: c.p.accent, tracking: 5, caps: true }) },
  { id: 'caption', name: 'Caption Box', sample: 'Caption on a box', props: (c) => ({ size: 40, weight: 700, color: c.p.ink, box: true, boxColor: c.p.bg, boxPad: 18, boxRadius: 10 }) },
  { id: 'outline', name: 'Outline Title', sample: 'OUTLINE', props: () => ({ size: 120, weight: 900, color: '#ffd60a', stroke: 10, strokeColor: '#000000', caps: true }) },
  { id: 'serif', name: 'Elegant Serif', sample: 'Elegant & classic', props: (c) => ({ size: 72, weight: 600, font: 'Georgia', italic: true, color: c.p.light }) },
  { id: 'quote', name: 'Quote', sample: '“Say it well.”', props: (c) => ({ size: 60, weight: 700, color: c.p.light, align: 'center' as const }) },
];

// ================================================================ placing

const ctxFor = (w: number, h: number, paletteId: string): Ctx => ({ w, h, u: Math.min(w, h) / 1080, p: paletteById(paletteId) });

/** Builds a layout for a w × h canvas (pure; used for previews and tests). */
export const buildLayout = (id: string, w: number, h: number, paletteId = 'clean'): Layer[] => POST_LAYOUTS.find((l) => l.id === id)?.build(ctxFor(w, h, paletteId)) ?? [];
export const buildElement = (id: string, w: number, h: number, paletteId = 'clean', at?: { x: number; y: number }): Layer[] =>
  POST_ELEMENTS.find((e) => e.id === id)?.build(ctxFor(w, h, paletteId), at?.x ?? w / 2, at?.y ?? h / 2) ?? [];

/** Inserts layers above the active layer as one named, selected group. */
function insertGroup(parts: Layer[], name: string, label: string, top = false): string | null {
  const doc = store.doc;
  if (!doc || !parts.length) return null;
  // Keep every part at the top level of wherever it lands
  const clean = parts.map((l) => (l.parent ? withLayer(l, { parent: undefined }) : l));
  const at = top ? doc.layers.length - 1 : doc.layers.findIndex((l) => l.id === doc.activeId);
  const active = top ? undefined : doc.layers[at];
  const layers = [...doc.layers];
  const index = at < 0 ? layers.length : at + 1;
  // Inside a group: land in the same group
  const parented = active?.parent ? clean.map((l) => withLayer(l, { parent: active.parent })) : clean;
  layers.splice(index, 0, ...parented);
  if (parented.length === 1) {
    store.commit(label, { layers, activeId: parented[0].id }, { icon: 'shape' });
    store.setSelectedLayers([parented[0].id]);
    return parented[0].id;
  }
  const g = groupLayers(layers, parented.map((l) => l.id), name);
  if (!g) return null;
  store.commit(label, { layers: g.layers, activeId: g.group.id }, { icon: 'shape' });
  store.setSelectedLayers([g.group.id]);
  return g.group.id;
}

export function addLayout(id: string, paletteId = 'clean'): string | null {
  const doc = store.doc;
  const def = POST_LAYOUTS.find((l) => l.id === id);
  if (!doc || !def) return null;
  // Layouts go on top of everything, so they sit over the photo
  const r = insertGroup(def.build(ctxFor(doc.width, doc.height, paletteId)), `Layout · ${def.name}`, `Add Layout · ${def.name}`, true);
  if (r) store.toast(`${def.name} layout added — double-click any text to edit it`, 'success');
  return r;
}

export function addElement(id: string, paletteId = 'clean', at?: { x: number; y: number }): string | null {
  const doc = store.doc;
  const def = POST_ELEMENTS.find((e) => e.id === id);
  if (!doc || !def) return null;
  return insertGroup(def.build(ctxFor(doc.width, doc.height, paletteId), at?.x ?? doc.width / 2, at?.y ?? doc.height / 2), def.name, `Add ${def.name}`);
}

export function addTextStyle(id: string, paletteId = 'clean'): string | null {
  const doc = store.doc;
  const def = TEXT_STYLES.find((t) => t.id === id);
  if (!doc || !def) return null;
  const c = ctxFor(doc.width, doc.height, paletteId);
  const props = def.props(c);
  const align = props.align ?? 'center';
  const l = T(c, def.name, { text: def.sample, align, ...props }, align === 'center' ? doc.width / 2 : doc.width * 0.08, doc.height * 0.45);
  return insertGroup([l], def.name, `Add ${def.name}`);
}
