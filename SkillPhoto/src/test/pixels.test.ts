import { describe, it, expect, beforeAll } from 'vitest';
import {
  PixelBuffer,
  convertDepth,
  createTileDelta,
  applyTileDelta,
  applyCurveToBuffer,
  applyAdjustToBuffer,
  getWebGLTextureFormat,
  GL_RGBA8,
  GL_RGBA16F,
  GL_RGBA32F,
  GL_RGBA,
  GL_UNSIGNED_BYTE,
  GL_HALF_FLOAT,
  GL_FLOAT,
} from '../core/pixels';
import { toneLut16 } from '../core/curves';
import { defaultAdjust, type CurvePoint } from '../core/types';
import { store } from '../core/store';
import * as ops from '../core/ops';

if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as Record<string, unknown>).ImageData = class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  };
}

describe('P0.1 High-Bit-Depth Pipeline (PixelBuffer)', () => {
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = function (this: any, type: string) {
      if (type !== '2d') return null;
      const self = this as any;
      const w = this.width || 100;
      const h = this.height || 100;
      if (!self._pixels || self._pixelsW !== w || self._pixelsH !== h) {
        self._pixels = new Uint8ClampedArray(w * h * 4);
        self._pixelsW = w;
        self._pixelsH = h;
      }
      if (self._ctx) return self._ctx;
      self._ctx = {
        canvas: this,
        fillStyle: '#000000',
        globalCompositeOperation: 'source-over',
        getImageData: (x: number, y: number, sw: number, sh: number) => ({
          data: self._pixels,
          width: sw,
          height: sh,
        }),
        putImageData: (img: any) => {
          if (img?.data) self._pixels.set(img.data);
        },
        fillRect: () => {},
        clearRect: () => {},
        drawImage: () => {},
      };
      return self._ctx;
    };
  });
  // ----------------------------------------------------------------
  // Acceptance Test: 4096 px gradient pushed through steep Curves
  // ----------------------------------------------------------------
  describe('Acceptance Test: Steep Curves & Banding', () => {
    it('steep curve on 4096 px gradient yields >3,000 distinct values at 16-bit vs <30 at 8-bit with no banding', () => {
      // Steep curve: input 0.45..0.55 -> output 0..1
      // In 0..255 space: (0, 0), (0.45 * 255 = 114.75, 0), (0.55 * 255 = 140.25, 255), (255, 255)
      const steepPoints: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.45 * 255, y: 0 },
        { x: 0.55 * 255, y: 255 },
        { x: 255, y: 255 },
      ];

      const N = 4096;

      // 1. 8-bit buffer: gradient across input 0.45..0.55
      const buf8 = new PixelBuffer(N, 1, 8);
      for (let i = 0; i < N; i++) {
        const norm = 0.45 + 0.1 * (i / (N - 1));
        const val8 = Math.max(0, Math.min(255, Math.round(norm * 255)));
        buf8.setPixel(i, 0, val8, val8, val8, 255);
      }

      // Check how many distinct input values 8-bit can physically represent in 0.45..0.55
      const inputValues8 = new Set<number>();
      for (let i = 0; i < N; i++) inputValues8.add(buf8.getPixel(i, 0)[0]);
      expect(inputValues8.size).toBeLessThan(30); // Exactly 26 integer levels in 115..140!

      // Push 8-bit buffer through steep curve
      applyCurveToBuffer(buf8, steepPoints, 'all');

      const outputValues8 = new Set<number>();
      for (let i = 0; i < N; i++) outputValues8.add(buf8.getPixel(i, 0)[0]);

      // 8-bit can yield AT MOST 26 distinct output levels across 4096 pixels (< 30)
      expect(outputValues8.size).toBeLessThan(30);

      // 2. 16-bit buffer: gradient across input 0.45..0.55
      const buf16 = new PixelBuffer(N, 1, 16);
      for (let i = 0; i < N; i++) {
        const norm = 0.45 + 0.1 * (i / (N - 1));
        const val16 = Math.max(0, Math.min(65535, Math.round(norm * 65535)));
        buf16.setPixel(i, 0, val16, val16, val16, 65535);
      }

      // Check input distinct values at 16-bit
      const inputValues16 = new Set<number>();
      for (let i = 0; i < N; i++) inputValues16.add(buf16.getPixel(i, 0)[0]);
      expect(inputValues16.size).toBeGreaterThan(3500);

      // Push 16-bit buffer through steep curve
      applyCurveToBuffer(buf16, steepPoints, 'all');

      const outputValues16 = new Set<number>();
      for (let i = 0; i < N; i++) outputValues16.add(buf16.getPixel(i, 0)[0]);

      // 16-bit yields > 3,000 distinct output values!
      expect(outputValues16.size).toBeGreaterThan(3000);

      // 3. Banding test: compare 8-bit stepped output vs 16-bit dithered to 8-bit
      // In 8-bit, the step width between level jumps is large (4096 / 26 ≈ 157 pixels of identical values).
      let longestFlatRun8 = 0;
      let currentRun8 = 1;
      for (let i = 1; i < N; i++) {
        if (buf8.getPixel(i, 0)[0] === buf8.getPixel(i - 1, 0)[0]) {
          currentRun8++;
          if (currentRun8 > longestFlatRun8) longestFlatRun8 = currentRun8;
        } else {
          currentRun8 = 1;
        }
      }
      expect(longestFlatRun8).toBeGreaterThan(100); // Obvious wide bands

      // When 16-bit buffer is converted to 8-bit with dithering:
      // Dithering breaks up the massive 157-pixel flat bands into fine noise, eliminating banding!
      const dithered8 = buf16.convert(8, true);
      let longestFlatRun16Dithered = 0;
      let currentRunDithered = 1;
      for (let i = 1; i < N; i++) {
        if (dithered8.getPixel(i, 0)[0] === dithered8.getPixel(i - 1, 0)[0]) {
          currentRunDithered++;
          if (currentRunDithered > longestFlatRun16Dithered) longestFlatRun16Dithered = currentRunDithered;
        } else {
          currentRunDithered = 1;
        }
      }
      expect(longestFlatRun16Dithered).toBeLessThan(35); // No massive banding
    });

    it('gradient of 32768 px through steep curves produces >3000 distinct values in the 0.45..0.55 region at 16-bit', () => {
      const steepPoints: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 0.45 * 255, y: 0 },
        { x: 0.55 * 255, y: 255 },
        { x: 255, y: 255 },
      ];
      const W = 32768;
      const buf16 = new PixelBuffer(W, 1, 16);
      for (let i = 0; i < W; i++) {
        const val16 = Math.round((i / (W - 1)) * 65535);
        buf16.setPixel(i, 0, val16, val16, val16, 65535);
      }
      applyCurveToBuffer(buf16, steepPoints, 'all');

      // Check values in the 0.45..0.55 region
      const startX = Math.round(0.45 * (W - 1));
      const endX = Math.round(0.55 * (W - 1));
      const regionValues = new Set<number>();
      for (let i = startX; i <= endX; i++) {
        regionValues.add(buf16.getPixel(i, 0)[0]);
      }
      expect(regionValues.size).toBeGreaterThan(3000);
    });
  });

  // ----------------------------------------------------------------
  // Exact Round-Trip Conversion Tests
  // ----------------------------------------------------------------
  describe('Exact Round-Trip Bit-Depth Conversions', () => {
    it('8-bit <-> 16-bit round trip is exact for all 256 values', () => {
      const src8 = new Uint8ClampedArray(256 * 4);
      for (let i = 0; i < 256; i++) {
        src8[i * 4] = i;
        src8[i * 4 + 1] = i;
        src8[i * 4 + 2] = i;
        src8[i * 4 + 3] = 255;
      }

      const to16 = convertDepth(src8, 8, 16, false) as Uint16Array;
      // 0 -> 0, 255 -> 65535
      expect(to16[0]).toBe(0);
      expect(to16[255 * 4]).toBe(65535);

      const back8 = convertDepth(to16, 16, 8, false) as Uint8ClampedArray;
      for (let i = 0; i < 256 * 4; i++) {
        expect(back8[i]).toBe(src8[i]);
      }
    });

    it('16-bit <-> 32-bit float round trip is exact for all 65,536 values', () => {
      const src16 = new Uint16Array(65536 * 4);
      for (let i = 0; i < 65536; i++) {
        src16[i * 4] = i;
        src16[i * 4 + 1] = i;
        src16[i * 4 + 2] = i;
        src16[i * 4 + 3] = 65535;
      }

      const to32 = convertDepth(src16, 16, 32, false) as Float32Array;
      expect(to32[0]).toBe(0.0);
      expect(to32[65535 * 4]).toBe(1.0);

      const back16 = convertDepth(to32, 32, 16, false) as Uint16Array;
      // One assertion over all 262,144 channels (an expect per value timed out under load)
      let mismatches = 0;
      for (let i = 0; i < 65536 * 4; i++) if (back16[i] !== src16[i]) mismatches++;
      expect(mismatches).toBe(0);
    });

    it('8-bit <-> 32-bit float round trip is exact for all 256 values', () => {
      const src8 = new Uint8ClampedArray(256 * 4);
      for (let i = 0; i < 256; i++) {
        src8[i * 4] = i;
        src8[i * 4 + 1] = i;
        src8[i * 4 + 2] = i;
        src8[i * 4 + 3] = 255;
      }

      const to32 = convertDepth(src8, 8, 32, false) as Float32Array;
      expect(to32[0]).toBe(0.0);
      expect(to32[255 * 4]).toBe(1.0);

      const back8 = convertDepth(to32, 32, 8, false) as Uint8ClampedArray;
      for (let i = 0; i < 256 * 4; i++) {
        expect(back8[i]).toBe(src8[i]);
      }
    });
  });

  // ----------------------------------------------------------------
  // Tile Delta Undo Integration
  // ----------------------------------------------------------------
  describe('Tile-Delta Undo Integration', () => {
    it('creates delta with only modified tiles and restores exact 16-bit values', () => {
      const width = 512;
      const height = 512;
      const older = new PixelBuffer(width, height, 16, 256);

      // Populate older with continuous pattern across all 4 tiles
      const data = new Uint16Array(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        const v = i % 65535;
        data[i * 4] = v;
        data[i * 4 + 1] = (v * 2) % 65535;
        data[i * 4 + 2] = (v * 3) % 65535;
        data[i * 4 + 3] = 65535;
      }
      older.setContiguousArray(data);

      const newer = older.clone();

      // Modify only tile (0, 0) in newer
      for (let y = 10; y < 50; y++) {
        for (let x = 10; x < 50; x++) {
          newer.setPixel(x, y, 65535, 0, 0, 65535);
        }
      }

      // Compute tile delta
      const delta = createTileDelta(older, newer);
      expect(delta).not.toBeNull();
      expect(delta!.tiles.length).toBe(1);
      expect(delta!.tiles[0].tx).toBe(0);
      expect(delta!.tiles[0].ty).toBe(0);
      expect(delta!.sum).toBe(newer.checksum());

      // Apply delta to restore older
      const restored = applyTileDelta(newer, delta!);
      expect(restored.width).toBe(older.width);
      expect(restored.height).toBe(older.height);
      expect(restored.depth).toBe(older.depth);

      // Verify exact bit-for-bit identity across all pixels
      const olderArray = older.getContiguousArray() as Uint16Array;
      const restoredArray = restored.getContiguousArray() as Uint16Array;
      expect(restoredArray.length).toBe(olderArray.length);

      let mismatch = -1;
      for (let i = 0; i < olderArray.length; i++) {
        if (restoredArray[i] !== olderArray[i]) {
          mismatch = i;
          break;
        }
      }
      expect(mismatch).toBe(-1);
      expect(restored.checksum()).toBe(older.checksum());
    });

    it('returns null when more than maxChangedRatio tiles are changed', () => {
      const buf1 = new PixelBuffer(512, 512, 16, 256); // 4 tiles
      const buf2 = buf1.clone();

      // Modify 3 of 4 tiles (75% > 60%)
      buf2.setPixel(10, 10, 100, 100, 100, 65535); // Tile (0, 0)
      buf2.setPixel(300, 10, 100, 100, 100, 65535); // Tile (1, 0)
      buf2.setPixel(10, 300, 100, 100, 100, 65535); // Tile (0, 1)

      const delta = createTileDelta(buf1, buf2, 0.6);
      expect(delta).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // Tiled Storage & Buffer Features
  // ----------------------------------------------------------------
  describe('Tiled Storage & Sparse Handling', () => {
    it('handles non-multiple dimensions and edge tiles properly', () => {
      const buf = new PixelBuffer(500, 300, 16, 256);
      expect(buf.cols).toBe(2);
      expect(buf.rows).toBe(2);

      expect(buf.tileDimensions(0, 0)).toEqual({ width: 256, height: 256 });
      expect(buf.tileDimensions(1, 0)).toEqual({ width: 244, height: 256 });
      expect(buf.tileDimensions(0, 1)).toEqual({ width: 256, height: 44 });
      expect(buf.tileDimensions(1, 1)).toEqual({ width: 244, height: 44 });
    });

    it('unallocated tiles read as zeroes and allocate on write', () => {
      const buf = new PixelBuffer(512, 512, 16, 256);
      expect(buf.allocatedTileCount).toBe(0);

      // Reading unallocated tile returns zeros
      expect(buf.getPixel(10, 10)).toEqual([0, 0, 0, 0]);
      expect(buf.allocatedTileCount).toBe(0);

      // Writing allocates only the target tile
      buf.setPixel(10, 10, 1000, 2000, 3000, 65535);
      expect(buf.allocatedTileCount).toBe(1);
      expect(buf.hasTile(0, 0)).toBe(true);
      expect(buf.hasTile(1, 1)).toBe(false);

      expect(buf.getPixel(10, 10)).toEqual([1000, 2000, 3000, 65535]);
    });

    it('contiguous array export and import round-trips exactly', () => {
      const buf = new PixelBuffer(100, 100, 32, 64);
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < 100; x++) {
          buf.setPixelNorm(x, y, x / 100, y / 100, 0.5, 1.0);
        }
      }

      const arr = buf.getContiguousArray() as Float32Array;
      const buf2 = PixelBuffer.fromArray(arr, 100, 100, 32, 64);

      expect(buf2.checksum()).toBe(buf.checksum());
      expect(buf2.getPixelNorm(50, 50)).toEqual(buf.getPixelNorm(50, 50));
    });
  });

  // ----------------------------------------------------------------
  // Color Operations on High-Bit-Depth Buffers
  // ----------------------------------------------------------------
  describe('Continuous Color Adjustments', () => {
    it('applies exposure doubling without 8-bit clamping', () => {
      const buf = new PixelBuffer(10, 10, 16);
      // Half gray in 16-bit: ~32768
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          buf.setPixel(x, y, 16384, 16384, 16384, 65535);
        }
      }

      const adj = defaultAdjust();
      adj.exposure = 1.0; // +1 EV = exactly double linear radiance

      applyAdjustToBuffer(buf, adj);

      const [r, g, b] = buf.getPixel(5, 5);
      expect(r).toBeCloseTo(32768, -2);
      expect(g).toBeCloseTo(32768, -2);
      expect(b).toBeCloseTo(32768, -2);
    });

    it('toneLut16 combines levels and curves into 65,536 entries without intermediate quantization', () => {
      const adj = defaultAdjust();
      adj.levels = { inBlack: 20, inWhite: 235, gamma: 1.2, outBlack: 10, outWhite: 245 };
      adj.curves.rgb = [
        { x: 0, y: 0 },
        { x: 100, y: 130 },
        { x: 255, y: 255 },
      ];

      const { r, g, b } = toneLut16(adj);
      expect(r.length).toBe(65536);
      expect(g.length).toBe(65536);
      expect(b.length).toBe(65536);

      // Verify monotonicity
      let monotonic = true;
      for (let i = 1; i < 65536; i++) {
        if (r[i] < r[i - 1]) {
          monotonic = false;
          break;
        }
      }
      expect(monotonic).toBe(true);
    });

    it('evaluates curves directly on 32-bit float buffer with full float precision', () => {
      const buf = new PixelBuffer(100, 1, 32);
      for (let i = 0; i < 100; i++) {
        buf.setPixelNorm(i, 0, i / 99, i / 99, i / 99, 1.0);
      }

      const curvePoints: CurvePoint[] = [
        { x: 0, y: 0 },
        { x: 128, y: 180 },
        { x: 255, y: 255 },
      ];

      applyCurveToBuffer(buf, curvePoints, 'all');

      // The midpoint was boosted to 180 / 255 ≈ 0.70588
      const mid = buf.getPixelNorm(50, 0);
      expect(mid[0]).toBeGreaterThan(0.69);
      expect(mid[0]).toBeLessThan(0.72);
    });
  });

  // ----------------------------------------------------------------
  // WebGL2 Texture Format Mappings
  // ----------------------------------------------------------------
  describe('WebGL2 Texture Format Mappings', () => {
    it('maps 8, 16, 32 bit depth to proper WebGL2 texture formats', () => {
      const fmt8 = getWebGLTextureFormat(null, 8);
      expect(fmt8.internalFormat).toBe(GL_RGBA8);
      expect(fmt8.format).toBe(GL_RGBA);
      expect(fmt8.type).toBe(GL_UNSIGNED_BYTE);
      expect(fmt8.bytesPerPixel).toBe(4);

      const fmt16 = getWebGLTextureFormat(null, 16);
      expect(fmt16.internalFormat).toBe(GL_RGBA16F);
      expect(fmt16.format).toBe(GL_RGBA);
      expect(fmt16.type).toBe(GL_HALF_FLOAT);
      expect(fmt16.bytesPerPixel).toBe(8);

      const fmt32 = getWebGLTextureFormat(null, 32);
      expect(fmt32.internalFormat).toBe(GL_RGBA32F);
      expect(fmt32.format).toBe(GL_RGBA);
      expect(fmt32.type).toBe(GL_FLOAT);
      expect(fmt32.bytesPerPixel).toBe(16);
    });
  });

  // ----------------------------------------------------------------
  // Document Bit Depth Mode & Undo
  // ----------------------------------------------------------------
  describe('Document Bit Depth Mode & Undo', () => {
    it('converts document bit depth to 16-bit and restores on undo', () => {
      ops.newDocument(100, 100, 'white', 'BitDepthTest');
      const doc = store.doc!;
      expect(doc.depth ?? 8).toBe(8);

      // Convert to 16-bit
      ops.convertBitDepth(16);
      expect(doc.depth).toBe(16);
      expect(doc.layers[0].pixels).toBeDefined();
      expect(doc.layers[0].pixels!.depth).toBe(16);

      // Modify pixel in the 16-bit buffer
      doc.layers[0].pixels!.setPixel(50, 50, 12345, 23456, 34567, 65535);

      // Convert to 32-bit
      ops.convertBitDepth(32);
      expect(doc.depth).toBe(32);
      expect(doc.layers[0].pixels!.depth).toBe(32);

      // Undo back to 16-bit
      store.undo();
      expect(doc.depth).toBe(16);
      expect(doc.layers[0].pixels!.depth).toBe(16);

      // Undo back to 8-bit
      store.undo();
      expect(doc.depth ?? 8).toBe(8);
    });
  });
});
