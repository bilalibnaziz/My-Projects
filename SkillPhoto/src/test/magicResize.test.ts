import { describe, expect, it } from 'vitest';
import { classify, placeRect, planLayout, targetFrame } from '../core/magicResize';
import type { Item, Plan } from '../core/magicResize';
import type { Rect } from '../core/types';

const R = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const inside = (r: Rect, s: Rect, tol = 1) => r.x >= s.x - tol && r.y >= s.y - tol && r.x + r.width <= s.x + s.width + tol && r.y + r.height <= s.y + s.height + tol;
const at = (plan: Plan, items: Item[], id: string) => placeRect(plan.places.find((p) => p.id === id)!, items.find((i) => i.id === id)!.bounds);
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// A typical 1000×1000 product post: background, logo top-left, headline + CTA left, product right, bottom bar
const POST: Item[] = [
  { id: 'bg', bounds: R(0, 0, 1000, 1000) },
  { id: 'bar', bounds: R(0, 900, 1000, 100), shape: true },
  { id: 'logo', bounds: R(60, 60, 140, 70) },
  { id: 'head', bounds: R(80, 300, 380, 200), text: true },
  { id: 'cta-bg', bounds: R(80, 540, 220, 70), shape: true },
  { id: 'cta', bounds: R(110, 555, 160, 40), text: true },
  { id: 'product', bounds: R(520, 260, 420, 520) },
];

describe('magic resize: roles', () => {
  it('finds the background, the bar, the corner logo, text and the visual', () => {
    const r = classify(POST, 1000, 1000);
    expect(r.get('bg')!.role).toBe('background');
    expect(r.get('bar')!.role).toBe('band');
    expect(r.get('bar')!.edge).toBe('bottom');
    expect(r.get('logo')!.role).toBe('anchor');
    expect(r.get('logo')!.corner).toMatchObject({ h: 'l', v: 't' });
    expect(r.get('head')!.role).toBe('text');
    expect(r.get('product')!.role).toBe('visual');
    // The button shape belongs with its label
    expect(r.get('cta-bg')!.role).toBe('text');
  });

  it('a wide content block in a square frame stays as it is', () => {
    const plan = planLayout(POST, 1000, 1000, targetFrame(1080, 1080));
    expect(plan.mode).toBe('keep');
  });
});

describe('magic resize: layouts', () => {
  it('square → square keeps the arrangement inside the safe margin', () => {
    const f = targetFrame(1080, 1080);
    const plan = planLayout(POST, 1000, 1000, f);
    expect(plan.mode).toBe('keep');
    for (const id of ['head', 'cta', 'product', 'logo']) expect(inside(at(plan, POST, id), f.safe)).toBe(true);
    // Text stays left of the product
    expect(at(plan, POST, 'head').x).toBeLessThan(at(plan, POST, 'product').x);
  });

  it('LinkedIn banner: text and product side by side, off the profile photo, logo moved clear of it', () => {
    const f = targetFrame(1584, 396, 'li-banner');
    const plan = planLayout(POST, 1000, 1000, f);
    const head = at(plan, POST, 'head'), product = at(plan, POST, 'product'), logo = at(plan, POST, 'logo');
    expect(head.x + head.width).toBeLessThanOrEqual(product.x + 1);
    for (const r of [head, product, logo]) expect(inside(r, f.safe)).toBe(true);
    for (const a of f.avoid) for (const r of [head, product, logo]) expect(overlap(a, r)).toBe(false);
    // Uses the height: the product is at least 70% of the safe height
    expect(product.height).toBeGreaterThan(f.safe.height * 0.7);
  });

  it('YouTube banner: everything that matters lands in the 1546×423 centre', () => {
    const f = targetFrame(2560, 1440, 'yt-banner');
    const plan = planLayout(POST, 1000, 1000, f);
    const centre = R((2560 - 1546) / 2, (1440 - 423) / 2, 1546, 423);
    for (const id of ['head', 'cta', 'product', 'logo']) expect(inside(at(plan, POST, id), centre)).toBe(true);
    // The background still covers the whole banner
    const bg = at(plan, POST, 'bg');
    expect(bg.x).toBeLessThanOrEqual(0);
    expect(bg.y).toBeLessThanOrEqual(0);
    expect(bg.x + bg.width).toBeGreaterThanOrEqual(2560);
    expect(bg.y + bg.height).toBeGreaterThanOrEqual(1440);
  });

  it('story: text stacks above the product, both inside the story safe zone', () => {
    const f = targetFrame(1080, 1920, 'story');
    // A wide source (16:9) re-flowing into 9:16
    const wide: Item[] = [
      { id: 'bg', bounds: R(0, 0, 1600, 900) },
      { id: 'head', bounds: R(100, 250, 600, 300), text: true },
      { id: 'product', bounds: R(850, 120, 600, 660) },
    ];
    const plan = planLayout(wide, 1600, 900, f);
    expect(plan.mode).toBe('stack');
    const head = at(plan, wide, 'head'), product = at(plan, wide, 'product');
    expect(head.y + head.height).toBeLessThanOrEqual(product.y + 1);
    expect(inside(head, f.safe)).toBe(true);
    expect(inside(product, f.safe)).toBe(true);
    // Fills the limiting side well (here the height)
    const fillW = Math.max(head.width, product.width) / f.safe.width;
    const fillH = (product.y + product.height - head.y) / f.safe.height;
    expect(Math.max(fillW, fillH)).toBeGreaterThan(0.9);
  });

  it('small print on the bar rides on the bar; content stays clear of it', () => {
    const items: Item[] = [...POST, { id: 'url', bounds: R(420, 935, 160, 30), text: true }];
    const f = targetFrame(1600, 900);
    const plan = planLayout(items, 1000, 1000, f);
    const bar = at(plan, items, 'bar'), url = at(plan, items, 'url'), cta = at(plan, items, 'cta-bg');
    expect(url.y).toBeGreaterThanOrEqual(bar.y);
    expect(url.y + url.height).toBeLessThanOrEqual(bar.y + bar.height + 0.5);
    expect(cta.y + cta.height).toBeLessThanOrEqual(bar.y);
  });

  it('square → story stacks a side-by-side post', () => {
    const plan = planLayout(POST, 1000, 1000, targetFrame(1080, 1920, 'story'));
    expect(plan.mode).toBe('stack');
    expect(at(plan, POST, 'head').y).toBeLessThan(at(plan, POST, 'product').y);
  });

  it('the bottom bar stretches along the bottom edge and keeps its share of the height', () => {
    const plan = planLayout(POST, 1000, 1000, targetFrame(1584, 396, 'li-banner'));
    const bar = at(plan, POST, 'bar');
    expect(bar.x).toBeCloseTo(0);
    expect(bar.width).toBeCloseTo(1584);
    expect(bar.y + bar.height).toBeCloseTo(396);
    expect(bar.height / 396).toBeCloseTo(0.1, 1);
  });

  it('text and visuals keep one scale, so their relative sizes hold', () => {
    const plan = planLayout(POST, 1000, 1000, targetFrame(1500, 500, 'x-header'));
    const h = plan.places.find((p) => p.id === 'head')!, v = plan.places.find((p) => p.id === 'product')!;
    expect(h.sx).toBeCloseTo(v.sx);
    expect(h.sx).toBeCloseTo(h.sy);
  });

  it('a text-only quote post just fits, centred', () => {
    const quote: Item[] = [
      { id: 'bg', bounds: R(0, 0, 1080, 1080) },
      { id: 'q', bounds: R(140, 340, 800, 400), text: true },
    ];
    const f = targetFrame(1600, 900);
    const plan = planLayout(quote, 1080, 1080, f);
    expect(plan.mode).toBe('keep');
    const q = at(plan, quote, 'q');
    expect(Math.abs(q.x + q.width / 2 - 800)).toBeLessThan(2);
    expect(inside(q, f.safe)).toBe(true);
  });
});
