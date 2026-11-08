import type { Adjust, CurvePoint } from './types';
import { createCanvas, ctx2d, pixelsLike, spaceOf, workingSpace, type ColorSpaceId } from './canvas';
import { curveFn, levelsFn, curveLut16, toneLut16 } from './curves';
import { wbMultipliers } from './gl';

export type BitDepth = 8 | 16 | 32;
export type BitDepthInput = BitDepth | '8' | '16' | '32' | '32f';

export type PixelData = Uint8ClampedArray | Uint16Array | Float32Array;

export const DEFAULT_TILE_SIZE = 256;

export function normalizeBitDepth(d: BitDepthInput): BitDepth {
  if (d === 8 || d === '8') return 8;
  if (d === 16 || d === '16') return 16;
  if (d === 32 || d === '32' || d === '32f') return 32;
  return 8;
}

export function bytesPerChannel(depth: BitDepthInput): number {
  const d = normalizeBitDepth(depth);
  return d === 8 ? 1 : d === 16 ? 2 : 4;
}

export function maxChannelValue(depth: BitDepthInput): number {
  const d = normalizeBitDepth(depth);
  return d === 8 ? 255 : d === 16 ? 65535 : 1.0;
}

export function createPixelArray(depth: BitDepthInput, length: number): PixelData {
  const d = normalizeBitDepth(depth);
  if (d === 8) return new Uint8ClampedArray(length);
  if (d === 16) return new Uint16Array(length);
  return new Float32Array(length);
}

/**
 * FNV-1a 32-bit checksum for byte-level verification of PixelBuffers.
 */
export function computeChecksum(data: PixelData): number {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 7) {
    h = Math.imul(h ^ bytes[i], 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic spatial hash in [0, 1) for pixel dithering.
 * Generates high-frequency noise that is stable across frames and reproducible in tests.
 */
export function spatialHash(x: number, y: number, c: number): number {
  let h = (x * 374761393 + y * 668265263 + c * 3266489917) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296.0;
}

/**
 * Triangular Probability Density Function (TPDF) dither noise in (-1.0, 1.0).
 * Sum of two uniform independent random variables minus 1.0.
 * Eliminates quantization distortion and banding with optimal perceptual noise.
 */
export function tpdfNoise(x: number, y: number, c: number): number {
  const u1 = spatialHash(x, y, c);
  const u2 = spatialHash(x + 19, y + 31, c + 7);
  return u1 + u2 - 1.0;
}

/**
 * High precision bit-depth conversion for pixel arrays (RGBA interleaved).
 * Supports 8-bit (0..255) <-> 16-bit (0..65535) <-> 32-bit float (0..1+ HDR).
 * Applies TPDF dithering when reducing depth to prevent posterization and banding.
 */
export function convertDepth(
  src: PixelData,
  srcDepthInput: BitDepthInput,
  dstDepthInput: BitDepthInput,
  dither = false,
  width?: number,
  height?: number
): PixelData {
  const srcDepth = normalizeBitDepth(srcDepthInput);
  const dstDepth = normalizeBitDepth(dstDepthInput);

  if (srcDepth === dstDepth) {
    return src.slice() as PixelData;
  }

  const numPixels = src.length / 4;
  const w = width ?? numPixels;
  const dst = createPixelArray(dstDepth, src.length);

  if (srcDepth === 8 && dstDepth === 16) {
    // Exact bit replication: 0 -> 0, 255 -> 65535
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[i] * 257;
    }
  } else if (srcDepth === 8 && dstDepth === 32) {
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[i] / 255.0;
    }
  } else if (srcDepth === 16 && dstDepth === 32) {
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[i] / 65535.0;
    }
  } else if (srcDepth === 16 && dstDepth === 8) {
    // 16-bit to 8-bit
    for (let p = 0; p < numPixels; p++) {
      const idx = p * 4;
      const x = p % w;
      const y = Math.floor(p / w);
      for (let c = 0; c < 3; c++) {
        const v = src[idx + c] / 257.0;
        // Dither only spreads real rounding error: values already on the target grid stay exact
        const noise = dither && Math.abs(v - Math.round(v)) > 1e-6 ? tpdfNoise(x, y, c) : 0;
        dst[idx + c] = Math.max(0, Math.min(255, Math.round(v + noise)));
      }
      // Alpha is not dithered to keep clean transparency edges
      dst[idx + 3] = Math.max(0, Math.min(255, Math.round(src[idx + 3] / 257.0)));
    }
  } else if (srcDepth === 32 && dstDepth === 16) {
    // 32-bit float to 16-bit
    for (let p = 0; p < numPixels; p++) {
      const idx = p * 4;
      const x = p % w;
      const y = Math.floor(p / w);
      for (let c = 0; c < 3; c++) {
        const v = src[idx + c] * 65535.0;
        // Dither only spreads real rounding error: values already on the target grid stay exact
        const noise = dither && Math.abs(v - Math.round(v)) > 1e-6 ? tpdfNoise(x, y, c) : 0;
        dst[idx + c] = Math.max(0, Math.min(65535, Math.round(v + noise)));
      }
      dst[idx + 3] = Math.max(0, Math.min(65535, Math.round(src[idx + 3] * 65535.0)));
    }
  } else if (srcDepth === 32 && dstDepth === 8) {
    // 32-bit float to 8-bit
    for (let p = 0; p < numPixels; p++) {
      const idx = p * 4;
      const x = p % w;
      const y = Math.floor(p / w);
      for (let c = 0; c < 3; c++) {
        const v = src[idx + c] * 255.0;
        // Dither only spreads real rounding error: values already on the target grid stay exact
        const noise = dither && Math.abs(v - Math.round(v)) > 1e-6 ? tpdfNoise(x, y, c) : 0;
        dst[idx + c] = Math.max(0, Math.min(255, Math.round(v + noise)));
      }
      dst[idx + 3] = Math.max(0, Math.min(255, Math.round(src[idx + 3] * 255.0)));
    }
  }

  return dst;
}

export interface PixelTile {
  readonly tx: number;
  readonly ty: number;
  readonly width: number;
  readonly height: number;
  data: PixelData;
}

export interface PixelTileDelta {
  tx: number;
  ty: number;
  data: PixelData;
}

export interface PixelBufferDelta {
  width: number;
  height: number;
  depth: BitDepth;
  tileSize: number;
  tiles: PixelTileDelta[];
  sum: number;
}

/**
 * PixelBuffer: High-bit-depth image buffer (8 | 16 | 32f bits per channel)
 * with 256x256 tiled storage, copy-on-write tile deltas for undo, and continuous-math adjustments.
 */
export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly depth: BitDepth;
  readonly tileSize: number;
  readonly cols: number;
  readonly rows: number;
  private tiles = new Map<number, PixelTile>();

  constructor(width: number, height: number, depth: BitDepthInput = 8, tileSize = DEFAULT_TILE_SIZE) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.depth = normalizeBitDepth(depth);
    this.tileSize = Math.max(16, Math.round(tileSize));
    this.cols = Math.ceil(this.width / this.tileSize);
    this.rows = Math.ceil(this.height / this.tileSize);
  }

  tileKey(tx: number, ty: number): number {
    return ty * this.cols + tx;
  }

  tileDimensions(tx: number, ty: number): { width: number; height: number } {
    const w = Math.min(this.tileSize, this.width - tx * this.tileSize);
    const h = Math.min(this.tileSize, this.height - ty * this.tileSize);
    return { width: Math.max(0, w), height: Math.max(0, h) };
  }

  hasTile(tx: number, ty: number): boolean {
    return this.tiles.has(this.tileKey(tx, ty));
  }

  getTile(tx: number, ty: number): PixelTile | undefined {
    return this.tiles.get(this.tileKey(tx, ty));
  }

  getOrCreateTile(tx: number, ty: number): PixelTile {
    const key = this.tileKey(tx, ty);
    let tile = this.tiles.get(key);
    if (!tile) {
      const dim = this.tileDimensions(tx, ty);
      tile = {
        tx,
        ty,
        width: dim.width,
        height: dim.height,
        data: createPixelArray(this.depth, dim.width * dim.height * 4),
      };
      this.tiles.set(key, tile);
    }
    return tile;
  }

  setTile(tx: number, ty: number, data: PixelData): void {
    const dim = this.tileDimensions(tx, ty);
    const key = this.tileKey(tx, ty);
    this.tiles.set(key, {
      tx,
      ty,
      width: dim.width,
      height: dim.height,
      data,
    });
  }

  clearTile(tx: number, ty: number): void {
    this.tiles.delete(this.tileKey(tx, ty));
  }

  get allocatedTileCount(): number {
    return this.tiles.size;
  }

  getPixel(x: number, y: number): [number, number, number, number] {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return [0, 0, 0, 0];
    const tx = Math.floor(x / this.tileSize);
    const ty = Math.floor(y / this.tileSize);
    const tile = this.getTile(tx, ty);
    if (!tile) return [0, 0, 0, 0];
    const lx = x - tx * this.tileSize;
    const ly = y - ty * this.tileSize;
    const idx = (ly * tile.width + lx) * 4;
    return [tile.data[idx], tile.data[idx + 1], tile.data[idx + 2], tile.data[idx + 3]];
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const tx = Math.floor(x / this.tileSize);
    const ty = Math.floor(y / this.tileSize);
    const tile = this.getOrCreateTile(tx, ty);
    const lx = x - tx * this.tileSize;
    const ly = y - ty * this.tileSize;
    const idx = (ly * tile.width + lx) * 4;
    tile.data[idx] = r;
    tile.data[idx + 1] = g;
    tile.data[idx + 2] = b;
    tile.data[idx + 3] = a;
  }

  /**
   * Reads a pixel with channel values normalized to [0.0, 1.0].
   */
  getPixelNorm(x: number, y: number): [number, number, number, number] {
    const [r, g, b, a] = this.getPixel(x, y);
    if (this.depth === 8) return [r / 255.0, g / 255.0, b / 255.0, a / 255.0];
    if (this.depth === 16) return [r / 65535.0, g / 65535.0, b / 65535.0, a / 65535.0];
    return [r, g, b, a];
  }

  /**
   * Writes a pixel with channel values specified in normalized [0.0, 1.0].
   */
  setPixelNorm(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (this.depth === 8) {
      this.setPixel(
        x,
        y,
        Math.max(0, Math.min(255, Math.round(r * 255.0))),
        Math.max(0, Math.min(255, Math.round(g * 255.0))),
        Math.max(0, Math.min(255, Math.round(b * 255.0))),
        Math.max(0, Math.min(255, Math.round(a * 255.0)))
      );
    } else if (this.depth === 16) {
      this.setPixel(
        x,
        y,
        Math.max(0, Math.min(65535, Math.round(r * 65535.0))),
        Math.max(0, Math.min(65535, Math.round(g * 65535.0))),
        Math.max(0, Math.min(65535, Math.round(b * 65535.0))),
        Math.max(0, Math.min(65535, Math.round(a * 65535.0)))
      );
    } else {
      this.setPixel(x, y, r, g, b, a);
    }
  }

  /**
   * Extracts a contiguous full-image RGBA array.
   */
  getContiguousArray(): PixelData {
    const out = createPixelArray(this.depth, this.width * this.height * 4);
    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < this.cols; tx++) {
        const tile = this.getTile(tx, ty);
        if (!tile) continue;
        const startX = tx * this.tileSize;
        const startY = ty * this.tileSize;
        const tw = tile.width;
        const th = tile.height;
        for (let row = 0; row < th; row++) {
          const srcOffset = row * tw * 4;
          const dstOffset = ((startY + row) * this.width + startX) * 4;
          out.set(tile.data.subarray(srcOffset, srcOffset + tw * 4), dstOffset);
        }
      }
    }
    return out;
  }

  /**
   * Loads a contiguous full-image RGBA array into tiles.
   */
  setContiguousArray(data: PixelData): void {
    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < this.cols; tx++) {
        const dim = this.tileDimensions(tx, ty);
        const tile = this.getOrCreateTile(tx, ty);
        const startX = tx * this.tileSize;
        const startY = ty * this.tileSize;
        const tw = dim.width;
        const th = dim.height;
        for (let row = 0; row < th; row++) {
          const srcOffset = ((startY + row) * this.width + startX) * 4;
          const dstOffset = row * tw * 4;
          tile.data.set(data.subarray(srcOffset, srcOffset + tw * 4), dstOffset);
        }
      }
    }
  }

  clone(): PixelBuffer {
    const copy = new PixelBuffer(this.width, this.height, this.depth, this.tileSize);
    for (const [key, tile] of this.tiles.entries()) {
      copy.tiles.set(key, {
        tx: tile.tx,
        ty: tile.ty,
        width: tile.width,
        height: tile.height,
        data: tile.data.slice() as PixelData,
      });
    }
    return copy;
  }

  /**
   * Converts the entire buffer to another bit depth, optionally applying TPDF dithering.
   */
  convert(targetDepthInput: BitDepthInput, dither = false): PixelBuffer {
    const targetDepth = normalizeBitDepth(targetDepthInput);
    if (targetDepth === this.depth) return this.clone();

    const result = new PixelBuffer(this.width, this.height, targetDepth, this.tileSize);
    for (let ty = 0; ty < this.rows; ty++) {
      for (let tx = 0; tx < this.cols; tx++) {
        const tile = this.getTile(tx, ty);
        if (!tile) continue;
        const convertedData = convertDepth(
          tile.data,
          this.depth,
          targetDepth,
          dither,
          tile.width,
          tile.height
        );
        result.setTile(tx, ty, convertedData);
      }
    }
    return result;
  }

  /**
   * Converts the buffer into an 8-bit ImageData for canvas drawing or display.
   */
  toImageData(dither = true, space: ColorSpaceId = 'srgb'): ImageData {
    const contiguous = this.getContiguousArray();
    const converted8 = convertDepth(contiguous, this.depth, 8, dither, this.width, this.height) as Uint8ClampedArray;
    return pixelsLike(space, converted8, this.width, this.height);
  }

  /**
   * Renders the buffer into an HTMLCanvasElement in the requested colour space.
   */
  toCanvas(space: ColorSpaceId = workingSpace(), dither = true): HTMLCanvasElement {
    const canvas = createCanvas(this.width, this.height, space);
    const ctx = ctx2d(canvas);
    const imgData = this.toImageData(dither, space);
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  checksum(): number {
    const contiguous = this.getContiguousArray();
    return computeChecksum(contiguous);
  }

  static fromArray(data: PixelData, width: number, height: number, depth: BitDepthInput = 8, tileSize = DEFAULT_TILE_SIZE): PixelBuffer {
    const buf = new PixelBuffer(width, height, depth, tileSize);
    buf.setContiguousArray(data);
    return buf;
  }

  static fromImageData(imageData: ImageData, depth: BitDepthInput = 8, tileSize = DEFAULT_TILE_SIZE): PixelBuffer {
    const d = normalizeBitDepth(depth);
    const buf = new PixelBuffer(imageData.width, imageData.height, d, tileSize);
    const raw8 = new Uint8ClampedArray(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
    const data = d === 8 ? raw8 : convertDepth(raw8, 8, d, false, imageData.width, imageData.height);
    buf.setContiguousArray(data);
    return buf;
  }

  static fromCanvas(canvas: HTMLCanvasElement, depth: BitDepthInput = 8, tileSize = DEFAULT_TILE_SIZE): PixelBuffer {
    const ctx = ctx2d(canvas);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return PixelBuffer.fromImageData(imgData, depth, tileSize);
  }
}

/**
 * Creates a tile delta representing the differences of `older` against `newer`.
 * Reuses the tile delta undo architecture to achieve compact history for 16-bit and 32-bit layers.
 */
export function createTileDelta(
  older: PixelBuffer,
  newer: PixelBuffer,
  maxChangedRatio = 0.6
): PixelBufferDelta | null {
  if (older.width !== newer.width || older.height !== newer.height || older.depth !== newer.depth) {
    return null;
  }

  const cols = older.cols;
  const rows = older.rows;
  const totalTiles = cols * rows;
  const changed: PixelTileDelta[] = [];

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const ot = older.getTile(tx, ty);
      const nt = newer.getTile(tx, ty);

      if (!ot && !nt) continue;

      let isDiff = false;
      if (!ot || !nt) {
        isDiff = true;
      } else {
        const od = ot.data;
        const nd = nt.data;
        if (od.length !== nd.length) {
          isDiff = true;
        } else {
          for (let i = 0; i < od.length; i++) {
            if (od[i] !== nd[i]) {
              isDiff = true;
              break;
            }
          }
        }
      }

      if (isDiff) {
        const dim = older.tileDimensions(tx, ty);
        const data = ot ? (ot.data.slice() as PixelData) : createPixelArray(older.depth, dim.width * dim.height * 4);
        changed.push({ tx, ty, data });
      }
    }
  }

  if (changed.length > totalTiles * maxChangedRatio) {
    return null; // More than maxChangedRatio changed, keep full snapshot
  }

  return {
    width: older.width,
    height: older.height,
    depth: older.depth,
    tileSize: older.tileSize,
    tiles: changed,
    sum: newer.checksum(),
  };
}

/**
 * Restores an exact copy of the older PixelBuffer by applying delta tiles on top of `newer`.
 */
export function applyTileDelta(newer: PixelBuffer, delta: PixelBufferDelta): PixelBuffer {
  if (newer.width !== delta.width || newer.height !== delta.height || newer.depth !== delta.depth) {
    throw new Error('PixelBuffer delta geometry or depth mismatch');
  }

  const restored = newer.clone();
  for (const t of delta.tiles) {
    restored.setTile(t.tx, t.ty, t.data.slice() as PixelData);
  }
  return restored;
}

/**
 * Applies a Monotone Cubic curve directly to a PixelBuffer at full bit depth precision.
 * For 16-bit: uses a 65536-entry 16-bit LUT.
 * For 32-bit: evaluates the continuous curve function directly on float values.
 * For 8-bit: uses a 256-entry table.
 */
export function applyCurveToBuffer(
  buf: PixelBuffer,
  points: CurvePoint[],
  channel: 'all' | 'r' | 'g' | 'b' = 'all'
): void {
  const f = curveFn(points);

  if (buf.depth === 16) {
    const lut16 = curveLut16(points);
    for (let ty = 0; ty < buf.rows; ty++) {
      for (let tx = 0; tx < buf.cols; tx++) {
        const tile = buf.getTile(tx, ty);
        if (!tile) continue;
        const d = tile.data as Uint16Array;
        const n = d.length;
        if (channel === 'all') {
          for (let i = 0; i < n; i += 4) {
            d[i] = lut16[d[i]];
            d[i + 1] = lut16[d[i + 1]];
            d[i + 2] = lut16[d[i + 2]];
          }
        } else {
          const offset = channel === 'r' ? 0 : channel === 'g' ? 1 : 2;
          for (let i = offset; i < n; i += 4) {
            d[i] = lut16[d[i]];
          }
        }
      }
    }
  } else if (buf.depth === 32) {
    for (let ty = 0; ty < buf.rows; ty++) {
      for (let tx = 0; tx < buf.cols; tx++) {
        const tile = buf.getTile(tx, ty);
        if (!tile) continue;
        const d = tile.data as Float32Array;
        const n = d.length;
        if (channel === 'all') {
          for (let i = 0; i < n; i += 4) {
            d[i] = Math.max(0, Math.min(1, f(d[i] * 255.0) / 255.0));
            d[i + 1] = Math.max(0, Math.min(1, f(d[i + 1] * 255.0) / 255.0));
            d[i + 2] = Math.max(0, Math.min(1, f(d[i + 2] * 255.0) / 255.0));
          }
        } else {
          const offset = channel === 'r' ? 0 : channel === 'g' ? 1 : 2;
          for (let i = offset; i < n; i += 4) {
            d[i] = Math.max(0, Math.min(1, f(d[i] * 255.0) / 255.0));
          }
        }
      }
    }
  } else {
    // 8-bit
    const lut8 = new Uint8Array(256);
    for (let i = 0; i < 256; i++) lut8[i] = Math.max(0, Math.min(255, Math.round(f(i))));
    for (let ty = 0; ty < buf.rows; ty++) {
      for (let tx = 0; tx < buf.cols; tx++) {
        const tile = buf.getTile(tx, ty);
        if (!tile) continue;
        const d = tile.data as Uint8ClampedArray;
        const n = d.length;
        if (channel === 'all') {
          for (let i = 0; i < n; i += 4) {
            d[i] = lut8[d[i]];
            d[i + 1] = lut8[d[i + 1]];
            d[i + 2] = lut8[d[i + 2]];
          }
        } else {
          const offset = channel === 'r' ? 0 : channel === 'g' ? 1 : 2;
          for (let i = offset; i < n; i += 4) {
            d[i] = lut8[d[i]];
          }
        }
      }
    }
  }
}

/**
 * Applies full tone adjustments (Levels + Master Curves + Channel Curves) to a PixelBuffer
 * at 16-bit or 32-bit float without 8-bit clamping.
 */
export function applyToneToBuffer(buf: PixelBuffer, adj: Adjust): void {
  if (buf.depth === 16) {
    const { r, g, b } = toneLut16(adj);
    for (let ty = 0; ty < buf.rows; ty++) {
      for (let tx = 0; tx < buf.cols; tx++) {
        const tile = buf.getTile(tx, ty);
        if (!tile) continue;
        const d = tile.data as Uint16Array;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = r[d[i]];
          d[i + 1] = g[d[i + 1]];
          d[i + 2] = b[d[i + 2]];
        }
      }
    }
  } else if (buf.depth === 32) {
    const lv = levelsFn(adj.levels);
    const master = curveFn(adj.curves.rgb);
    const cr = curveFn(adj.curves.r);
    const cg = curveFn(adj.curves.g);
    const cb = curveFn(adj.curves.b);
    const evalChannel = (fn: (x: number) => number, val: number) =>
      Math.max(0, Math.min(1, fn(Math.max(0, Math.min(255, master(Math.max(0, Math.min(255, lv(val * 255.0)))))))) / 255.0);

    for (let ty = 0; ty < buf.rows; ty++) {
      for (let tx = 0; tx < buf.cols; tx++) {
        const tile = buf.getTile(tx, ty);
        if (!tile) continue;
        const d = tile.data as Float32Array;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = evalChannel(cr, d[i]);
          d[i + 1] = evalChannel(cg, d[i + 1]);
          d[i + 2] = evalChannel(cb, d[i + 2]);
        }
      }
    }
  } else {
    // 8-bit
    const lv = levelsFn(adj.levels);
    const master = curveFn(adj.curves.rgb);
    const cr = curveFn(adj.curves.r);
    const cg = curveFn(adj.curves.g);
    const cb = curveFn(adj.curves.b);
    const rLut = new Uint8Array(256);
    const gLut = new Uint8Array(256);
    const bLut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const base = Math.max(0, Math.min(255, master(Math.max(0, Math.min(255, lv(i))))));
      rLut[i] = Math.max(0, Math.min(255, Math.round(cr(base))));
      gLut[i] = Math.max(0, Math.min(255, Math.round(cg(base))));
      bLut[i] = Math.max(0, Math.min(255, Math.round(cb(base))));
    }
    for (let ty = 0; ty < buf.rows; ty++) {
      for (let tx = 0; tx < buf.cols; tx++) {
        const tile = buf.getTile(tx, ty);
        if (!tile) continue;
        const d = tile.data as Uint8ClampedArray;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = rLut[d[i]];
          d[i + 1] = gLut[d[i + 1]];
          d[i + 2] = bLut[d[i + 2]];
        }
      }
    }
  }
}

/**
 * CPU math path for color adjustments (exposure, contrast, temperature, tint, vibrance, saturation, etc.)
 * evaluated in continuous float math without 8-bit clamping.
 */
export function applyAdjustToBuffer(buf: PixelBuffer, adj: Adjust): void {
  const expMult = Math.pow(2, adj.exposure);
  const [wbR, wbG, wbB] = wbMultipliers(adj.temperature, adj.tint);
  const contrastFactor =
    adj.contrast !== 0 ? Math.tan(((adj.contrast + 100) * Math.PI) / 400) : 1;
  const satFactor = 1 + adj.saturation / 100;
  const vibAmount = adj.vibrance / 100;

  for (let ty = 0; ty < buf.rows; ty++) {
    for (let tx = 0; tx < buf.cols; tx++) {
      const tile = buf.getTile(tx, ty);
      if (!tile) continue;
      const tw = tile.width;
      const th = tile.height;
      for (let ly = 0; ly < th; ly++) {
        for (let lx = 0; lx < tw; lx++) {
          const gx = tx * buf.tileSize + lx;
          const gy = ty * buf.tileSize + ly;
          let [r, g, b, a] = buf.getPixelNorm(gx, gy);

          // White Balance
          r *= wbR;
          g *= wbG;
          b *= wbB;

          // Exposure
          r *= expMult;
          g *= expMult;
          b *= expMult;

          // Contrast
          if (adj.contrast !== 0) {
            r = (r - 0.5) * contrastFactor + 0.5;
            g = (g - 0.5) * contrastFactor + 0.5;
            b = (b - 0.5) * contrastFactor + 0.5;
          }

          // Invert
          if (adj.invert) {
            r = 1.0 - r;
            g = 1.0 - g;
            b = 1.0 - b;
          }

          // Saturation & Vibrance
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (adj.saturation !== 0) {
            r = luma + (r - luma) * satFactor;
            g = luma + (g - luma) * satFactor;
            b = luma + (b - luma) * satFactor;
          }
          if (adj.vibrance !== 0) {
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = maxC - minC;
            const vf = 1 + vibAmount * (1.0 - Math.min(1.0, Math.max(0, sat)));
            r = luma + (r - luma) * vf;
            g = luma + (g - luma) * vf;
            b = luma + (b - luma) * vf;
          }

          // Black and White
          if (adj.bw) {
            r = luma;
            g = luma;
            b = luma;
          }

          buf.setPixelNorm(gx, gy, r, g, b, a);
        }
      }
    }
  }

  // Apply Tone Curves & Levels
  applyToneToBuffer(buf, adj);
}

// ---------------------------------------------------------------- WebGL2 mappings

export const GL_RGBA = 0x1908;
export const GL_RGBA8 = 0x8058;
export const GL_RGBA16F = 0x881a;
export const GL_RGBA32F = 0x8814;
export const GL_UNSIGNED_BYTE = 0x1401;
export const GL_HALF_FLOAT = 0x140b;
export const GL_FLOAT = 0x1406;

export interface WebGLTextureFormat {
  readonly internalFormat: number;
  readonly format: number;
  readonly type: number;
  readonly bytesPerPixel: number;
}

/**
 * Returns the WebGL2 texture format descriptor for the given BitDepth.
 * Maps 8-bit to RGBA8 / UNSIGNED_BYTE, 16-bit to RGBA16F / HALF_FLOAT, and 32-bit to RGBA32F / FLOAT.
 */
export function getWebGLTextureFormat(
  gl: WebGL2RenderingContext | null | undefined,
  depthInput: BitDepthInput
): WebGLTextureFormat {
  const depth = normalizeBitDepth(depthInput);
  const rgba = gl ? gl.RGBA : GL_RGBA;

  if (depth === 16) {
    return {
      internalFormat: gl ? gl.RGBA16F : GL_RGBA16F,
      format: rgba,
      type: gl ? gl.HALF_FLOAT : GL_HALF_FLOAT,
      bytesPerPixel: 8,
    };
  }

  if (depth === 32) {
    return {
      internalFormat: gl ? gl.RGBA32F : GL_RGBA32F,
      format: rgba,
      type: gl ? gl.FLOAT : GL_FLOAT,
      bytesPerPixel: 16,
    };
  }

  return {
    internalFormat: gl ? gl.RGBA8 : GL_RGBA8,
    format: rgba,
    type: gl ? gl.UNSIGNED_BYTE : GL_UNSIGNED_BYTE,
    bytesPerPixel: 4,
  };
}

/**
 * Checks if the WebGL2 context supports float and half-float render targets (EXT_color_buffer_float).
 */
export function isFloatColorBufferSupported(gl: WebGL2RenderingContext): boolean {
  return !!gl.getExtension('EXT_color_buffer_float');
}

/**
 * Uploads a PixelBuffer into a WebGL2 texture at full bit depth.
 */
export function uploadPixelBufferToTexture(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  buf: PixelBuffer
): void {
  const fmt = getWebGLTextureFormat(gl, buf.depth);
  const contiguous = buf.getContiguousArray();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  if (buf.depth === 8) {
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internalFormat, buf.width, buf.height, 0, fmt.format, fmt.type, contiguous as Uint8ClampedArray);
  } else if (buf.depth === 16) {
    // For half float upload, convert 16-bit integer (0..65535) to float array for texImage2D with FLOAT source,
    // which WebGL2 converts to RGBA16F internal storage
    const floatData = convertDepth(contiguous, 16, 32, false, buf.width, buf.height) as Float32Array;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, buf.width, buf.height, 0, gl.RGBA, gl.FLOAT, floatData);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, buf.width, buf.height, 0, gl.RGBA, gl.FLOAT, contiguous as Float32Array);
  }
}

/**
 * Reads pixels from the current WebGL2 framebuffer into a PixelBuffer at the requested depth.
 */
export function readWebGLFramebufferToBuffer(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  depthInput: BitDepthInput
): PixelBuffer {
  const depth = normalizeBitDepth(depthInput);
  const buf = new PixelBuffer(width, height, depth);

  if (depth === 8) {
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    buf.setContiguousArray(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength));
  } else if (depth === 16) {
    const floatPixels = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, floatPixels);
    const uint16Pixels = convertDepth(floatPixels, 32, 16, false, width, height) as Uint16Array;
    buf.setContiguousArray(uint16Pixels);
  } else {
    const floatPixels = new Float32Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, floatPixels);
    buf.setContiguousArray(floatPixels);
  }

  return buf;
}
