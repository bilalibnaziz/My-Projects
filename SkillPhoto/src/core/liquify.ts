/**
 * Liquify Engine (Forward Warp, Reconstruct, Twirl, Pucker, Bloat)
 * Uses a fine 2D displacement vector field with bilinear sampling.
 */
import { createCanvas, ctx2d } from './canvas';
import { store } from './store';
import { withLayer } from './types';

export type LiquifyMode = 'warp' | 'reconstruct' | 'twirl-cw' | 'twirl-ccw' | 'pucker' | 'bloat';

export interface LiquifyMesh {
  width: number;
  height: number;
  cols: number;
  rows: number;
  spacing: number;
  dx: Float32Array; // Displacements in X
  dy: Float32Array; // Displacements in Y
}

export function createLiquifyMesh(width: number, height: number, spacing = 8): LiquifyMesh {
  const cols = Math.ceil(width / spacing) + 1;
  const rows = Math.ceil(height / spacing) + 1;
  const size = cols * rows;
  return {
    width,
    height,
    cols,
    rows,
    spacing,
    dx: new Float32Array(size),
    dy: new Float32Array(size),
  };
}

export function applyLiquifyStroke(
  mesh: LiquifyMesh,
  mode: LiquifyMode,
  cx: number,
  cy: number,
  lastX: number,
  lastY: number,
  radius: number,
  strength: number
) {
  const { cols, rows, spacing, dx, dy } = mesh;
  const r2 = radius * radius;
  const mdx = cx - lastX;
  const mdy = cy - lastY;

  const minCol = Math.max(0, Math.floor((cx - radius) / spacing));
  const maxCol = Math.min(cols - 1, Math.ceil((cx + radius) / spacing));
  const minRow = Math.max(0, Math.floor((cy - radius) / spacing));
  const maxRow = Math.min(rows - 1, Math.ceil((cy + radius) / spacing));

  for (let r = minRow; r <= maxRow; r++) {
    const py = r * spacing;
    for (let c = minCol; c <= maxCol; c++) {
      const px = c * spacing;
      const dist2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (dist2 >= r2) continue;

      const dist = Math.sqrt(dist2);
      const factor = (1 - dist / radius) * strength;
      const idx = r * cols + c;

      switch (mode) {
        case 'warp':
          dx[idx] += mdx * factor;
          dy[idx] += mdy * factor;
          break;
        case 'pucker': {
          const vx = cx - px;
          const vy = cy - py;
          dx[idx] += vx * factor * 0.3;
          dy[idx] += vy * factor * 0.3;
          break;
        }
        case 'bloat': {
          const vx = px - cx;
          const vy = py - cy;
          dx[idx] += vx * factor * 0.3;
          dy[idx] += vy * factor * 0.3;
          break;
        }
        case 'twirl-cw': {
          const vx = px - cx;
          const vy = py - cy;
          const angle = factor * 0.5;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const nx = vx * cos - vy * sin;
          const ny = vx * sin + vy * cos;
          dx[idx] += nx - vx;
          dy[idx] += ny - vy;
          break;
        }
        case 'twirl-ccw': {
          const vx = px - cx;
          const vy = py - cy;
          const angle = -factor * 0.5;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const nx = vx * cos - vy * sin;
          const ny = vx * sin + vy * cos;
          dx[idx] += nx - vx;
          dy[idx] += ny - vy;
          break;
        }
        case 'reconstruct':
          dx[idx] *= Math.max(0, 1 - factor);
          dy[idx] *= Math.max(0, 1 - factor);
          break;
      }
    }
  }
}

/** Samples the displacement mesh at (x, y) with bilinear interpolation. */
export function sampleMeshDisplacement(mesh: LiquifyMesh, x: number, y: number): { x: number; y: number } {
  const { cols, rows, spacing, dx, dy } = mesh;
  const gx = x / spacing;
  const gy = y / spacing;
  const c0 = Math.max(0, Math.min(cols - 2, Math.floor(gx)));
  const r0 = Math.max(0, Math.min(rows - 2, Math.floor(gy)));
  const fx = gx - c0;
  const fy = gy - r0;

  const i00 = r0 * cols + c0;
  const i10 = r0 * cols + (c0 + 1);
  const i01 = (r0 + 1) * cols + c0;
  const i11 = (r0 + 1) * cols + (c0 + 1);

  const dxInterp =
    (1 - fx) * (1 - fy) * dx[i00] +
    fx * (1 - fy) * dx[i10] +
    (1 - fx) * fy * dx[i01] +
    fx * fy * dx[i11];

  const dyInterp =
    (1 - fx) * (1 - fy) * dy[i00] +
    fx * (1 - fy) * dy[i10] +
    (1 - fx) * fy * dy[i01] +
    fx * fy * dy[i11];

  return { x: dxInterp, y: dyInterp };
}

/** Renders the warped result of srcCanvas through mesh. */
export function renderLiquifiedCanvas(srcCanvas: HTMLCanvasElement, mesh: LiquifyMesh): HTMLCanvasElement {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const outCanvas = createCanvas(w, h);
  const sCtx = ctx2d(srcCanvas);
  const dCtx = ctx2d(outCanvas);

  const srcImg = sCtx.getImageData(0, 0, w, h);
  const dstImg = dCtx.createImageData(w, h);
  const src = srcImg.data;
  const dst = dstImg.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const disp = sampleMeshDisplacement(mesh, x, y);
      const sx = x - disp.x;
      const sy = y - disp.y;

      const dIdx = (y * w + x) * 4;

      if (sx < 0 || sx >= w - 1 || sy < 0 || sy >= h - 1) {
        // Clamp boundary
        const cx = Math.max(0, Math.min(w - 1, Math.round(sx)));
        const cy = Math.max(0, Math.min(h - 1, Math.round(sy)));
        const sIdx = (cy * w + cx) * 4;
        dst[dIdx] = src[sIdx];
        dst[dIdx + 1] = src[sIdx + 1];
        dst[dIdx + 2] = src[sIdx + 2];
        dst[dIdx + 3] = src[sIdx + 3];
      } else {
        // Bilinear interpolation
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        const fx = sx - x0;
        const fy = sy - y0;

        const i00 = (y0 * w + x0) * 4;
        const i10 = (y0 * w + x1) * 4;
        const i01 = (y1 * w + x0) * 4;
        const i11 = (y1 * w + x1) * 4;

        for (let c = 0; c < 4; c++) {
          const val =
            (1 - fx) * (1 - fy) * src[i00 + c] +
            fx * (1 - fy) * src[i10 + c] +
            (1 - fx) * fy * src[i01 + c] +
            fx * fy * src[i11 + c];
          dst[dIdx + c] = Math.round(val);
        }
      }
    }
  }

  dCtx.putImageData(dstImg, 0, 0);
  return outCanvas;
}

/** True when no point of the mesh has moved, so applying it would change nothing. */
export function meshIsIdentity(mesh: LiquifyMesh, eps = 0.01): boolean {
  for (let i = 0; i < mesh.dx.length; i++) if (Math.abs(mesh.dx[i]) > eps || Math.abs(mesh.dy[i]) > eps) return false;
  return true;
}

/**
 * Live preview: warps `src` (a copy of the layer scaled by `scale`) through the full-resolution mesh into
 * `dst`, only inside `rect` (preview pixels), so each brush dab redraws just the area it touched.
 */
export function renderLiquifyPreview(
  src: ImageData,
  dst: ImageData,
  mesh: LiquifyMesh,
  scale: number,
  rect = { x0: 0, y0: 0, x1: src.width, y1: src.height }
) {
  const w = src.width;
  const h = src.height;
  const s = src.data;
  const d = dst.data;
  const x0 = Math.max(0, Math.floor(rect.x0));
  const y0 = Math.max(0, Math.floor(rect.y0));
  const x1 = Math.min(w, Math.ceil(rect.x1));
  const y1 = Math.min(h, Math.ceil(rect.y1));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const disp = sampleMeshDisplacement(mesh, x / scale, y / scale);
      const sx = Math.max(0, Math.min(w - 1.001, x - disp.x * scale));
      const sy = Math.max(0, Math.min(h - 1.001, y - disp.y * scale));
      const xa = Math.floor(sx);
      const ya = Math.floor(sy);
      const fx = sx - xa;
      const fy = sy - ya;
      const i00 = (ya * w + xa) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + w * 4;
      const i11 = i01 + 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        d[o + c] = (1 - fx) * (1 - fy) * s[i00 + c] + fx * (1 - fy) * s[i10 + c] + (1 - fx) * fy * s[i01 + c] + fx * fy * s[i11 + c];
      }
    }
  }
}

/** Applies the mesh to the active layer as one undoable step. */
export function commitLiquify(layerId: string, mesh: LiquifyMesh) {
  const doc = store.doc;
  const layer = doc?.layers.find((l) => l.id === layerId);
  if (!doc || !layer?.canvas || meshIsIdentity(mesh)) return;
  return store.task('Liquify', () => {
    const out = renderLiquifiedCanvas(layer.canvas!, mesh);
    store.invalidateRender();
    store.commit('Liquify', { layers: store.replaceLayer(withLayer(layer, { canvas: out })) }, { icon: 'filter' });
  });
}
