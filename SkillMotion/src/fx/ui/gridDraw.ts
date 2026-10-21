// Draws the document grid and layout grids over the viewport, in screen space, crisp at any zoom.
// Identical copy in SkillVector, SkillPhoto and SkillDesign (Skill Motion's imports '../grids'): change all.

import type { Box, DocGridPrefs, GridPattern, GridSpec } from '../grids';
import { gridGeometry, gridLevels } from '../grids';

interface View {
  zoom: number;
  panX: number;
  panY: number;
  /** Viewport size in CSS px. */
  w: number;
  h: number;
}

const crisp = (v: number) => Math.round(v) + 0.5;

/**
 * Super-zoom document grid: every visible level of the grid, finer levels fading in as they open
 * up, so there are always useful lines 8–80 px apart however far you zoom.
 */
export function drawDocGrid(ctx: CanvasRenderingContext2D, p: DocGridPrefs, v: View, area?: Box) {
  const levels = gridLevels(p, v.zoom);
  if (!levels.length) return;
  // Document-space visible range (optionally limited to an area such as the page)
  let x0 = -v.panX / v.zoom;
  let y0 = -v.panY / v.zoom;
  let x1 = (v.w - v.panX) / v.zoom;
  let y1 = (v.h - v.panY) / v.zoom;
  if (area) {
    x0 = Math.max(x0, area.x);
    y0 = Math.max(y0, area.y);
    x1 = Math.min(x1, area.x + area.w);
    y1 = Math.min(y1, area.y + area.h);
  }
  if (x1 <= x0 || y1 <= y0) return;
  const sx = (x: number) => v.panX + x * v.zoom;
  const sy = (y: number) => v.panY + y * v.zoom;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = p.color;
  ctx.fillStyle = p.color;
  if (p.style === 'dots') {
    // Dots at the finest level that stays readable
    const lv = levels.find((l) => (x1 - x0) / l.step * ((y1 - y0) / l.step) < 60000) ?? levels[levels.length - 1];
    ctx.globalAlpha = Math.min(1, lv.alpha + 0.25);
    const r = lv.step * v.zoom > 24 ? 1.5 : 1;
    for (let gx = Math.ceil(x0 / lv.step) * lv.step; gx <= x1; gx += lv.step) {
      for (let gy = Math.ceil(y0 / lv.step) * lv.step; gy <= y1; gy += lv.step) ctx.fillRect(Math.round(sx(gx)) - r / 2, Math.round(sy(gy)) - r / 2, r, r);
    }
    ctx.restore();
    return;
  }
  levels.forEach((lv, i) => {
    const next = levels[i + 1];
    ctx.globalAlpha = lv.alpha;
    ctx.beginPath();
    for (let k = Math.ceil(x0 / lv.step); k * lv.step <= x1; k++) {
      // Lines a coarser level draws are left to it
      if (next && Math.abs((k * lv.step) / next.step - Math.round((k * lv.step) / next.step)) < 1e-6) continue;
      const x = crisp(sx(k * lv.step));
      ctx.moveTo(x, sy(y0));
      ctx.lineTo(x, sy(y1));
    }
    for (let k = Math.ceil(y0 / lv.step); k * lv.step <= y1; k++) {
      if (next && Math.abs((k * lv.step) / next.step - Math.round((k * lv.step) / next.step)) < 1e-6) continue;
      const y = crisp(sy(k * lv.step));
      ctx.moveTo(sx(x0), y);
      ctx.lineTo(sx(x1), y);
    }
    ctx.stroke();
  });
  ctx.restore();
}

/** Repeating pattern grid, thinned out (every 2nd, 5th …) when its lines would crowd together. */
function drawPattern(ctx: CanvasRenderingContext2D, pat: GridPattern, ox: number, oy: number, v: View) {
  let step = pat.step;
  const mult = [2, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (let i = 0; step * v.zoom < 6 && i < mult.length; i++) step = pat.step * mult[i];
  if (step * v.zoom < 6) return;
  const b = pat.box;
  const X0 = ox + b.x;
  const Y0 = oy + b.y;
  // Visible part of the box, document space
  const vx0 = Math.max(X0, -v.panX / v.zoom);
  const vy0 = Math.max(Y0, -v.panY / v.zoom);
  const vx1 = Math.min(X0 + b.w, (v.w - v.panX) / v.zoom);
  const vy1 = Math.min(Y0 + b.h, (v.h - v.panY) / v.zoom);
  if (vx1 <= vx0 || vy1 <= vy0) return;
  const sx = (x: number) => v.panX + x * v.zoom;
  const sy = (y: number) => v.panY + y * v.zoom;
  ctx.beginPath();
  if (pat.kind === 'dots') {
    const count = ((vx1 - vx0) / step) * ((vy1 - vy0) / step);
    if (count > 80000) return;
    for (let x = X0 + Math.ceil((vx0 - X0) / step) * step; x <= vx1; x += step) {
      for (let y = Y0 + Math.ceil((vy0 - Y0) / step) * step; y <= vy1; y += step) ctx.rect(Math.round(sx(x)) - 1, Math.round(sy(y)) - 1, 2, 2);
    }
    ctx.fill();
    return;
  }
  if (pat.kind === 'square') {
    for (let x = X0 + Math.ceil((vx0 - X0) / step) * step; x <= vx1; x += step) {
      ctx.moveTo(crisp(sx(x)), sy(vy0));
      ctx.lineTo(crisp(sx(x)), sy(vy1));
    }
  }
  if (pat.kind === 'square' || pat.kind === 'baseline') {
    const y0 = Y0 + pat.oy;
    for (let y = y0 + Math.ceil((vy0 - y0) / step) * step; y <= vy1; y += step) {
      ctx.moveTo(sx(vx0), crisp(sy(y)));
      ctx.lineTo(sx(vx1), crisp(sy(y)));
    }
  }
  if (pat.kind === 'isometric') {
    // Three families: verticals and lines at ±30°, `step` apart measured across the lines
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx(vx0), sy(vy0), (vx1 - vx0) * v.zoom, (vy1 - vy0) * v.zoom);
    ctx.clip();
    ctx.beginPath();
    for (const deg of [90, 30, 150]) {
      const a = (deg * Math.PI) / 180;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const nx = -dy;
      const ny = dx;
      const ds = [vx0 * nx + vy0 * ny, vx1 * nx + vy0 * ny, vx0 * nx + vy1 * ny, vx1 * nx + vy1 * ny];
      const base = X0 * nx + Y0 * ny;
      const reach = Math.hypot(vx1 - vx0, vy1 - vy0);
      const cx = (vx0 + vx1) / 2;
      const cy = (vy0 + vy1) / 2;
      for (let k = Math.ceil((Math.min(...ds) - base) / step); base + k * step <= Math.max(...ds); k++) {
        // Point on this line nearest the visible centre, then extend both ways
        const d = base + k * step - (cx * nx + cy * ny);
        const px = cx + nx * d;
        const py = cy + ny * d;
        ctx.moveTo(sx(px - dx * reach), sy(py - dy * reach));
        ctx.lineTo(sx(px + dx * reach), sy(py + dy * reach));
      }
    }
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.stroke();
}

/** Layout grids of each artboard (screen space). */
export function drawLayoutGrids(ctx: CanvasRenderingContext2D, pages: { box: Box; grids: GridSpec[] }[], v: View) {
  ctx.save();
  ctx.lineWidth = 1;
  for (const page of pages) {
    const ox = page.box.x;
    const oy = page.box.y;
    const sx = (x: number) => v.panX + (ox + x) * v.zoom;
    const sy = (y: number) => v.panY + (oy + y) * v.zoom;
    const small = Math.min(page.box.w, page.box.h) * v.zoom < 160;
    for (const spec of page.grids) {
      if (!spec.visible) continue;
      const g = gridGeometry(spec, page.box.w, page.box.h);
      ctx.strokeStyle = spec.color;
      ctx.fillStyle = spec.color;
      if (g.shade.length) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        for (const r of g.shade) ctx.fillRect(sx(r.x), sy(r.y), r.w * v.zoom, r.h * v.zoom);
        ctx.restore();
      }
      if (g.bands.length) {
        ctx.globalAlpha = spec.kind === 'region' ? 0.12 : 0.1;
        for (const r of g.bands) ctx.fillRect(sx(r.x), sy(r.y), r.w * v.zoom, r.h * v.zoom);
        if (spec.kind !== 'region' && !small) {
          ctx.globalAlpha = 0.35;
          ctx.beginPath();
          for (const r of g.bands) {
            if (spec.kind === 'columns') {
              ctx.moveTo(crisp(sx(r.x)), sy(r.y));
              ctx.lineTo(crisp(sx(r.x)), sy(r.y + r.h));
              ctx.moveTo(crisp(sx(r.x + r.w)), sy(r.y));
              ctx.lineTo(crisp(sx(r.x + r.w)), sy(r.y + r.h));
            } else {
              ctx.moveTo(sx(r.x), crisp(sy(r.y)));
              ctx.lineTo(sx(r.x + r.w), crisp(sy(r.y)));
              ctx.moveTo(sx(r.x), crisp(sy(r.y + r.h)));
              ctx.lineTo(sx(r.x + r.w), crisp(sy(r.y + r.h)));
            }
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 0.8;
      if (g.lines.length) {
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of g.lines) {
          // Axis-aligned lines sit on whole pixels so they stay one sharp pixel wide
          const a = x1 === x2 ? crisp(sx(x1)) : sx(x1);
          const b = y1 === y2 ? crisp(sy(y1)) : sy(y1);
          const c = x1 === x2 ? a : sx(x2);
          const d = y1 === y2 ? b : sy(y2);
          ctx.moveTo(a, b);
          ctx.lineTo(c, d);
        }
        if (spec.kind === 'panels') ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (const pts of g.polys) {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(pts[i]), sy(pts[i + 1]));
        ctx.stroke();
      }
      if (g.circles.length) {
        ctx.beginPath();
        for (const c of g.circles) {
          ctx.moveTo(sx(c.cx + c.r), sy(c.cy));
          ctx.arc(sx(c.cx), sy(c.cy), c.r * v.zoom, 0, Math.PI * 2);
        }
        ctx.stroke();
      }
      for (const r of g.rects) {
        if (r.dash) ctx.setLineDash([5, 4]);
        ctx.strokeRect(crisp(sx(r.x)), crisp(sy(r.y)), Math.round(r.w * v.zoom), Math.round(r.h * v.zoom));
        ctx.setLineDash([]);
      }
      for (const pat of g.patterns) {
        ctx.globalAlpha = 0.6;
        drawPattern(ctx, pat, ox, oy, v);
      }
      if (g.labels.length && !small) {
        ctx.globalAlpha = 0.95;
        ctx.font = '600 9.5px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'top';
        for (const l of g.labels) {
          const x = sx(l.x) + 3;
          const y = sy(l.y) + 3;
          const tw = ctx.measureText(l.text).width;
          ctx.save();
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = 'rgba(24,24,24,0.85)';
          ctx.fillRect(x - 2, y - 1, tw + 4, 12);
          ctx.restore();
          ctx.fillText(l.text, x, y);
        }
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}
