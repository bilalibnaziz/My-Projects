// Content-aware fill: multi-scale PatchMatch inpainting (Barnes et al. 2009 /
// Wexler et al. 2007). Pure functions on typed arrays so it can run in a worker
// and be unit tested.

const R = 3; // patch radius → 7×7 patches

interface Level {
  w: number;
  h: number;
  img: Float32Array; // RGBA
  hole: Uint8Array; // 1 = unknown
}

function downsample(L: Level): Level {
  const w = Math.max(1, Math.ceil(L.w / 2));
  const h = Math.max(1, Math.ceil(L.h / 2));
  const img = new Float32Array(w * h * 4);
  const hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      let anyHole = 0;
      const acc = [0, 0, 0, 0];
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(L.w - 1, x * 2 + dx);
          const sy = Math.min(L.h - 1, y * 2 + dy);
          const s = sy * L.w + sx;
          if (L.hole[s]) {
            anyHole = 1;
            continue;
          }
          for (let c = 0; c < 4; c++) acc[c] += L.img[s * 4 + c];
          n++;
        }
      const t = y * w + x;
      hole[t] = anyHole;
      if (n) for (let c = 0; c < 4; c++) img[t * 4 + c] = acc[c] / n;
    }
  }
  return { w, h, img, hole };
}

/** Onion-peel diffusion fill — the initial guess at the coarsest level. */
function diffuseFill(L: Level) {
  const { w, h, img } = L;
  const known = new Uint8Array(w * h);
  let remaining = 0;
  for (let i = 0; i < w * h; i++) {
    known[i] = L.hole[i] ? 0 : 1;
    if (!known[i]) remaining++;
  }
  let guard = 0;
  while (remaining > 0 && guard++ < w + h) {
    const next: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let n = 0;
        const acc = [0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (!known[j]) continue;
            for (let c = 0; c < 4; c++) acc[c] += img[j * 4 + c];
            n++;
          }
        if (n) {
          for (let c = 0; c < 4; c++) img[i * 4 + c] = acc[c] / n;
          next.push(i);
        }
      }
    if (!next.length) break;
    for (const i of next) known[i] = 1;
    remaining -= next.length;
  }
}

function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // Separable square dilation
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) last = x; else if (x - last <= r) tmp[y * w + x] = 1;
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) {
        last = x;
        tmp[y * w + x] = 1;
      } else if (last - x <= r) tmp[y * w + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) if (tmp[y * w + x]) last = y; else if (y - last <= r) out[y * w + x] = 1;
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) {
        last = y;
        out[y * w + x] = 1;
      } else if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Nnf {
  x: Int32Array;
  y: Int32Array;
  d: Float32Array;
}

function solveLevel(L: Level, prior: { nnf: Nnf; w: number; h: number } | null, iterations: number, rand: () => number): Nnf | null {
  const { w, h, img, hole } = L;
  const nearHole = dilate(hole, w, h, R);
  // Valid source centers: patch fully known and inside the image
  const valid = new Uint8Array(w * h);
  const validList: number[] = [];
  for (let y = R; y < h - R; y++)
    for (let x = R; x < w - R; x++) {
      const i = y * w + x;
      if (!nearHole[i]) {
        valid[i] = 1;
        validList.push(i);
      }
    }
  if (!validList.length) return null;

  const targets: number[] = [];
  for (let i = 0; i < w * h; i++) if (nearHole[i]) targets.push(i);

  const nnf: Nnf = { x: new Int32Array(w * h), y: new Int32Array(w * h), d: new Float32Array(w * h).fill(Infinity) };
  const clampX = (v: number) => (v < 0 ? 0 : v >= w ? w - 1 : v);
  const clampY = (v: number) => (v < 0 ? 0 : v >= h ? h - 1 : v);

  const dist = (px: number, py: number, qx: number, qy: number, best: number) => {
    let s = 0;
    for (let dy = -R; dy <= R; dy++) {
      const ty = clampY(py + dy);
      const sy = qy + dy;
      for (let dx = -R; dx <= R; dx++) {
        const t = (ty * w + clampX(px + dx)) * 4;
        const q = (sy * w + qx + dx) * 4;
        const a = img[t] - img[q];
        const b = img[t + 1] - img[q + 1];
        const c = img[t + 2] - img[q + 2];
        s += a * a + b * b + c * c;
      }
      if (s >= best) return s;
    }
    return s;
  };

  const randomValid = () => validList[(rand() * validList.length) | 0];

  for (const i of targets) {
    const px = i % w;
    const py = (i / w) | 0;
    let qx = -1, qy = -1;
    if (prior) {
      const cx = Math.min(prior.w - 1, px >> 1);
      const cy = Math.min(prior.h - 1, py >> 1);
      const ci = cy * prior.w + cx;
      qx = prior.nnf.x[ci] * 2 + (px & 1);
      qy = prior.nnf.y[ci] * 2 + (py & 1);
    }
    if (qx < 0 || qy < 0 || qx >= w || qy >= h || !valid[qy * w + qx]) {
      const v = randomValid();
      qx = v % w;
      qy = (v / w) | 0;
    }
    nnf.x[i] = qx;
    nnf.y[i] = qy;
    nnf.d[i] = dist(px, py, qx, qy, Infinity);
  }

  const isTarget = nearHole;
  const maxR = Math.max(w, h);

  for (let it = 0; it < iterations; it++) {
    const fwd = it % 2 === 0;
    const step = fwd ? 1 : -1;
    for (let k = 0; k < targets.length; k++) {
      const i = targets[fwd ? k : targets.length - 1 - k];
      const px = i % w;
      const py = (i / w) | 0;
      let bx = nnf.x[i], by = nnf.y[i], bd = nnf.d[i];

      const tryCand = (qx: number, qy: number) => {
        if (qx < R || qy < R || qx >= w - R || qy >= h - R) return;
        if (!valid[qy * w + qx] || (qx === bx && qy === by)) return;
        const d = dist(px, py, qx, qy, bd);
        if (d < bd) {
          bd = d;
          bx = qx;
          by = qy;
        }
      };

      // Propagation
      const ax = px - step;
      if (ax >= 0 && ax < w && isTarget[py * w + ax]) tryCand(nnf.x[py * w + ax] + step, nnf.y[py * w + ax]);
      const ay = py - step;
      if (ay >= 0 && ay < h && isTarget[ay * w + px]) tryCand(nnf.x[ay * w + px], nnf.y[ay * w + px] + step);

      // Random search with shrinking window
      for (let rad = maxR; rad >= 1; rad >>= 1) {
        tryCand(Math.round(bx + (rand() * 2 - 1) * rad), Math.round(by + (rand() * 2 - 1) * rad));
      }
      nnf.x[i] = bx;
      nnf.y[i] = by;
      nnf.d[i] = bd;
    }

    // Voting: each hole pixel = weighted mean of overlapping source patches
    const acc = new Float32Array(w * h * 4);
    const wsum = new Float32Array(w * h);
    const area = (2 * R + 1) * (2 * R + 1);
    for (const i of targets) {
      const px = i % w;
      const py = (i / w) | 0;
      const qx = nnf.x[i];
      const qy = nnf.y[i];
      const wt = 1 / (1 + nnf.d[i] / (area * 300));
      for (let dy = -R; dy <= R; dy++) {
        const ty = py + dy;
        if (ty < 0 || ty >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const tx = px + dx;
          if (tx < 0 || tx >= w) continue;
          const t = ty * w + tx;
          if (!hole[t]) continue;
          const q = ((qy + dy) * w + qx + dx) * 4;
          acc[t * 4] += img[q] * wt;
          acc[t * 4 + 1] += img[q + 1] * wt;
          acc[t * 4 + 2] += img[q + 2] * wt;
          acc[t * 4 + 3] += img[q + 3] * wt;
          wsum[t] += wt;
        }
      }
    }
    for (let t = 0; t < w * h; t++) {
      if (!hole[t] || wsum[t] <= 0) continue;
      const inv = 1 / wsum[t];
      img[t * 4] = acc[t * 4] * inv;
      img[t * 4 + 1] = acc[t * 4 + 1] * inv;
      img[t * 4 + 2] = acc[t * 4 + 2] * inv;
      img[t * 4 + 3] = acc[t * 4 + 3] * inv;
    }
    // Refresh distances for the new estimate
    for (const i of targets) nnf.d[i] = dist(i % w, (i / w) | 0, nnf.x[i], nnf.y[i], Infinity);
  }
  return nnf;
}

/**
 * Fills pixels where `mask` is non-zero using texture from the rest of the image.
 * Returns a new RGBA buffer; unmasked pixels are unchanged.
 */
export function inpaint(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  mask: Uint8Array,
  onProgress?: (f: number) => void,
  seed = 1234
): Uint8ClampedArray {
  const rand = rng(seed);
  const img = new Float32Array(w * h * 4);
  for (let i = 0; i < img.length; i++) img[i] = rgba[i];
  const hole = new Uint8Array(w * h);
  let holeCount = 0;
  for (let i = 0; i < w * h; i++)
    if (mask[i]) {
      hole[i] = 1;
      holeCount++;
    }
  const out = new Uint8ClampedArray(rgba);
  if (!holeCount) return out;

  const pyramid: Level[] = [{ w, h, img, hole }];
  while (true) {
    const top = pyramid[pyramid.length - 1];
    if (Math.min(top.w, top.h) < 4 * (2 * R + 1) || pyramid.length > 8) break;
    let holes = 0;
    for (let i = 0; i < top.hole.length; i++) holes += top.hole[i];
    if (holes < 12) break;
    pyramid.push(downsample(top));
  }

  const coarsest = pyramid[pyramid.length - 1];
  diffuseFill(coarsest);

  let prior: { nnf: Nnf; w: number; h: number } | null = null;
  for (let li = pyramid.length - 1; li >= 0; li--) {
    const L = pyramid[li];
    if (li < pyramid.length - 1) {
      // Upsample the coarser solution into this level's hole
      const C = pyramid[li + 1];
      for (let y = 0; y < L.h; y++)
        for (let x = 0; x < L.w; x++) {
          const t = y * L.w + x;
          if (!L.hole[t]) continue;
          const c = (Math.min(C.h - 1, y >> 1) * C.w + Math.min(C.w - 1, x >> 1)) * 4;
          for (let k = 0; k < 4; k++) L.img[t * 4 + k] = C.img[c + k];
        }
    }
    const iters = li === 0 ? 3 : li === pyramid.length - 1 ? 8 : 5;
    const nnf = solveLevel(L, prior, iters, rand);
    prior = nnf ? { nnf, w: L.w, h: L.h } : null;
    onProgress?.(1 - li / pyramid.length);
  }

  for (let i = 0; i < w * h; i++) {
    if (!hole[i]) continue;
    out[i * 4] = img[i * 4];
    out[i * 4 + 1] = img[i * 4 + 1];
    out[i * 4 + 2] = img[i * 4 + 2];
    out[i * 4 + 3] = img[i * 4 + 3];
  }
  return out;
}
