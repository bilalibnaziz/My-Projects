// Free Transform geometry: the matrix and corners of a transform box, and rendering the source
// through it (affine via Canvas 2D, or projective via warp.ts once corners move freely).

import type { TransformState } from './store';
import { createCanvas, ctx2d } from './canvas';
import { warpToQuad } from './warp';

/** The parts of a transform needed to render it (no layer / UI state). */
export type TransformGeometry = Pick<TransformState, 'source' | 'sx' | 'sy' | 'tx' | 'ty' | 'scaleX' | 'scaleY' | 'angle' | 'quad' | 'mesh'>;

export function transformMatrix(t: TransformGeometry): DOMMatrix {
  const cx = t.sx + t.source.width / 2;
  const cy = t.sy + t.source.height / 2;
  return new DOMMatrix()
    .translate(cx + t.tx, cy + t.ty)
    .rotate((t.angle * 180) / Math.PI)
    .scale(t.scaleX, t.scaleY)
    .translate(-cx, -cy);
}

export function transformCorners(t: TransformGeometry): DOMPoint[] {
  if (t.mesh) return [t.mesh[0], t.mesh[3], t.mesh[15], t.mesh[12]].map((p) => new DOMPoint(p.x, p.y));
  if (t.quad) return t.quad.map((p) => new DOMPoint(p.x, p.y));
  const m = transformMatrix(t);
  const { sx, sy } = t;
  const w = t.source.width;
  const h = t.source.height;
  return [
    m.transformPoint(new DOMPoint(sx, sy)),
    m.transformPoint(new DOMPoint(sx + w, sy)),
    m.transformPoint(new DOMPoint(sx + w, sy + h)),
    m.transformPoint(new DOMPoint(sx, sy + h)),
  ];
}

export function renderTransformed(t: TransformGeometry): { canvas: HTMLCanvasElement; x: number; y: number } {
  if (t.mesh) return renderMesh(t.source, t.mesh);
  if (t.quad) {
    const { width: w, height: h } = t.source;
    const r = warpToQuad(ctx2d(t.source).getImageData(0, 0, w, h).data, w, h, t.quad);
    const c = createCanvas(r.width, r.height);
    ctx2d(c).putImageData(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 0, 0);
    return { canvas: c, x: r.x, y: r.y };
  }
  const pts = transformCorners(t);
  const minX = Math.floor(Math.min(...pts.map((p) => p.x)));
  const minY = Math.floor(Math.min(...pts.map((p) => p.y)));
  const maxX = Math.ceil(Math.max(...pts.map((p) => p.x)));
  const maxY = Math.ceil(Math.max(...pts.map((p) => p.y)));
  const c = createCanvas(Math.max(1, maxX - minX), Math.max(1, maxY - minY));
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  const m = new DOMMatrix().translate(-minX, -minY).multiply(transformMatrix(t));
  ctx.setTransform(m);
  ctx.drawImage(t.source, t.sx, t.sy);
  return { canvas: c, x: minX, y: minY };
}


// ---------------------------------------------------------------- warp mesh

type Pt = { x: number; y: number };

const bern = (t: number) => {
  const u = 1 - t;
  return [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
};

/** Point on the bicubic Bézier patch defined by 16 control points (rows top → bottom). */
export function meshPoint(mesh: Pt[], u: number, v: number): Pt {
  const bu = bern(u);
  const bv = bern(v);
  let x = 0;
  let y = 0;
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const w = bu[i] * bv[j];
      x += mesh[j * 4 + i].x * w;
      y += mesh[j * 4 + i].y * w;
    }
  return { x, y };
}

/** A flat 4×4 control grid spanning a quad (nw, ne, se, sw): the identity warp. */
export function meshFromCorners(c: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const u = i / 3;
      const v = j / 3;
      const top = { x: c[0].x + (c[1].x - c[0].x) * u, y: c[0].y + (c[1].y - c[0].y) * u };
      const bot = { x: c[3].x + (c[2].x - c[3].x) * u, y: c[3].y + (c[2].y - c[3].y) * u };
      out.push({ x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v });
    }
  return out;
}

/** Affine map taking triangle (a, b, c) onto (A, B, C). */
function triAffine(a: Pt, b: Pt, c: Pt, A: Pt, B: Pt, C: Pt): DOMMatrix | null {
  const den = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(den) < 1e-9) return null;
  const m11 = ((B.x - A.x) * (c.y - a.y) - (C.x - A.x) * (b.y - a.y)) / den;
  const m21 = ((C.x - A.x) * (b.x - a.x) - (B.x - A.x) * (c.x - a.x)) / den;
  const m12 = ((B.y - A.y) * (c.y - a.y) - (C.y - A.y) * (b.y - a.y)) / den;
  const m22 = ((C.y - A.y) * (b.x - a.x) - (B.y - A.y) * (c.x - a.x)) / den;
  return new DOMMatrix([m11, m12, m21, m22, A.x - m11 * a.x - m21 * a.y, A.y - m12 * a.x - m22 * a.y]);
}

/**
 * Renders `source` through the warp mesh: the patch is cut into a fine grid and each cell is
 * drawn as two affine-mapped triangles (slightly grown so neighbours overlap without seams).
 */
export function renderMesh(source: HTMLCanvasElement, mesh: Pt[], cells = 24): { canvas: HTMLCanvasElement; x: number; y: number } {
  const n = cells;
  const G: Pt[][] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j <= n; j++) {
    const row: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const p = meshPoint(mesh, i / n, j / n);
      row.push(p);
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    G.push(row);
  }
  const ox = Math.floor(x0) - 1;
  const oy = Math.floor(y0) - 1;
  const c = createCanvas(Math.ceil(x1) - ox + 2, Math.ceil(y1) - oy + 2);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  const sw = source.width / n;
  const sh = source.height / n;
  const tri = (s: Pt[], d: Pt[]) => {
    const dd = d.map((p) => ({ x: p.x - ox, y: p.y - oy }));
    const m = triAffine(s[0], s[1], s[2], dd[0], dd[1], dd[2]);
    if (!m) return;
    // Grow the clip triangle ~0.6 px around its centroid to hide hairline seams
    const cx = (dd[0].x + dd[1].x + dd[2].x) / 3;
    const cy = (dd[0].y + dd[1].y + dd[2].y) / 3;
    ctx.save();
    ctx.beginPath();
    dd.forEach((p, k) => {
      const len = Math.hypot(p.x - cx, p.y - cy) || 1;
      const gx = p.x + ((p.x - cx) / len) * 0.6;
      const gy = p.y + ((p.y - cy) / len) * 0.6;
      if (k) ctx.lineTo(gx, gy);
      else ctx.moveTo(gx, gy);
    });
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(m);
    // Only the cell's neighbourhood of the source is drawn
    const bx = Math.max(0, Math.min(s[0].x, s[1].x, s[2].x) - 2);
    const by = Math.max(0, Math.min(s[0].y, s[1].y, s[2].y) - 2);
    const bw = Math.min(source.width - bx, sw + 4);
    const bh = Math.min(source.height - by, sh + 4);
    if (bw > 0 && bh > 0) ctx.drawImage(source, bx, by, bw, bh, bx, by, bw, bh);
    ctx.restore();
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const s00 = { x: i * sw, y: j * sh };
      const s10 = { x: (i + 1) * sw, y: j * sh };
      const s01 = { x: i * sw, y: (j + 1) * sh };
      const s11 = { x: (i + 1) * sw, y: (j + 1) * sh };
      tri([s00, s10, s11], [G[j][i], G[j][i + 1], G[j + 1][i + 1]]);
      tri([s00, s11, s01], [G[j][i], G[j + 1][i + 1], G[j + 1][i]]);
    }
  return { canvas: c, x: ox, y: oy };
}
