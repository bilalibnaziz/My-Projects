// WebGL2 adjustment pipeline. One fragment shader implements the full develop stack,
// so dragging any slider re-renders in a few milliseconds even on large images.

import type { Adjust } from './types';
import { HSL_BANDS, SEL_RANGES, defaultAdjust } from './types';
import { toneLut } from './curves';
import { decodeLut } from './lut';

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_src;
uniform sampler2D u_lut;
uniform vec2 u_size;
uniform float u_lod;
uniform float u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks;
uniform vec3 u_wb;
uniform float u_vibrance, u_saturation, u_hue;
uniform float u_clarity, u_dehaze, u_sharpen;
uniform float u_vignette, u_grain, u_fade;
uniform float u_bw, u_invert, u_threshold, u_posterize;
uniform vec3 u_hsl[8];
uniform vec4 u_grade;
uniform float u_balance;
uniform float u_useLut;
uniform vec3 u_mixR, u_mixG, u_mixB;
uniform float u_useMix, u_mixMono;
uniform vec4 u_sel[9];
uniform float u_useSel;
uniform vec3 u_pfColor;
uniform float u_pfDensity, u_pfPreserve;
uniform vec3 u_gm0, u_gm1, u_gm2;
uniform float u_gmAmount, u_gmMid;
uniform vec3 u_cbS, u_cbM, u_cbH;
uniform float u_useCb, u_cbPreserve;
uniform float u_useBw;
uniform vec3 u_bwPrim; // reds, greens, blues
uniform vec3 u_bwSec;  // yellows, cyans, magentas
uniform vec3 u_bwTint;
uniform float u_bwUseTint;
uniform highp sampler3D u_lut3;
uniform float u_lutAmount, u_lutSize;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float CENTERS[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 275.0, 315.0);

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec3 localMean(vec2 uv) {
  vec2 t = exp2(u_lod) / u_size;
  vec3 s = textureLod(u_src, uv, u_lod).rgb * 0.4;
  s += textureLod(u_src, uv + vec2(t.x, 0.0), u_lod).rgb * 0.15;
  s += textureLod(u_src, uv - vec2(t.x, 0.0), u_lod).rgb * 0.15;
  s += textureLod(u_src, uv + vec2(0.0, t.y), u_lod).rgb * 0.15;
  s += textureLod(u_src, uv - vec2(0.0, t.y), u_lod).rgb * 0.15;
  return s;
}

void main() {
  vec4 src = texture(u_src, v_uv);
  if (src.a <= 0.0) { outColor = vec4(0.0); return; }
  vec3 c = src.rgb;

  // Sharpen (unsharp against 4-neighbour mean of the source)
  if (u_sharpen > 0.0) {
    vec2 px = 1.0 / u_size;
    vec3 n = texture(u_src, v_uv + vec2(px.x, 0.0)).rgb + texture(u_src, v_uv - vec2(px.x, 0.0)).rgb
           + texture(u_src, v_uv + vec2(0.0, px.y)).rgb + texture(u_src, v_uv - vec2(0.0, px.y)).rgb;
    c += (c - n * 0.25) * u_sharpen * 2.0;
  }

  // White balance + exposure in linear light
  vec3 lin = pow(max(c, 0.0), vec3(2.2));
  lin *= u_wb * exp2(u_exposure);
  c = pow(max(lin, 0.0), vec3(1.0 / 2.2));

  vec3 blurC = localMean(v_uv);
  float Lb = dot(blurC, LUMA);

  // Dehaze (dark-channel style haze removal on the local mean)
  if (u_dehaze != 0.0) {
    float dark = min(min(blurC.r, blurC.g), blurC.b);
    if (u_dehaze > 0.0) {
      float t = max(1.0 - u_dehaze * 0.85 * dark, 0.2);
      c = (c - vec3(0.92) * (1.0 - t)) / t;
    } else {
      c = mix(c, vec3(0.78), -u_dehaze * 0.45);
    }
  }

  // Tonal regions
  float L = dot(c, LUMA);
  float Lm = mix(L, Lb, 0.6);
  float dL = 0.0;
  float shMask = 1.0 - smoothstep(0.0, 0.6, Lm);
  float hiMask = smoothstep(0.4, 1.0, Lm);
  dL += u_shadows * 0.45 * shMask * (u_shadows > 0.0 ? (1.0 - L) : L);
  dL += u_highlights * 0.45 * hiMask * (u_highlights > 0.0 ? (1.0 - L) : L);
  dL += u_whites * 0.3 * smoothstep(0.45, 1.0, L);
  dL += u_blacks * 0.3 * (1.0 - smoothstep(0.0, 0.5, L));
  if (dL != 0.0) {
    float nL = clamp(L + dL, 0.0, 1.5);
    c *= min(nL / max(L, 0.002), 6.0);
    if (L < 0.002) c += vec3(nL);
  }

  // Clarity: midtone local contrast
  if (u_clarity != 0.0) {
    float L2 = dot(c, LUMA);
    float mid = 1.0 - pow(abs(L2 - 0.5) * 2.0, 2.0);
    c += (L2 - Lb) * u_clarity * 1.6 * mid;
  }

  // Contrast (filmic S-curve)
  if (u_contrast > 0.0) {
    vec3 cc = clamp(c, 0.0, 1.0);
    vec3 s = cc * cc * (3.0 - 2.0 * cc);
    c = mix(c, s, u_contrast);
  } else if (u_contrast < 0.0) {
    c = mix(c, vec3(0.5) + (c - 0.5) * 0.4, -u_contrast);
  }

  c = clamp(c, 0.0, 1.0);

  // Saturation + vibrance (vibrance protects already-saturated colors)
  float L3 = dot(c, LUMA);
  if (u_saturation != 0.0) c = mix(vec3(L3), c, 1.0 + u_saturation);
  if (u_vibrance != 0.0) {
    float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
    c = mix(vec3(L3), c, 1.0 + u_vibrance * (1.0 - sat) * 1.2);
  }
  c = clamp(c, 0.0, 1.0);

  // Hue + 8-band HSL mixer
  vec3 hsv = rgb2hsv(c);
  float hdeg = hsv.x * 360.0;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 8; i++) {
    float d = abs(hdeg - CENTERS[i]);
    d = min(d, 360.0 - d);
    float w = max(0.0, 1.0 - d / 42.0);
    acc += u_hsl[i] * w;
    wsum += w;
  }
  if (wsum > 0.0) acc /= max(wsum, 1.0);
  float hueShift = u_hue + acc.x * 30.0;
  if (hueShift != 0.0 || acc.y != 0.0 || acc.z != 0.0) {
    hsv.x = fract(hsv.x + hueShift / 360.0);
    hsv.y = clamp(hsv.y * (1.0 + acc.y), 0.0, 1.0);
    hsv.z = clamp(hsv.z * (1.0 + acc.z * 0.5 * hsv.y), 0.0, 1.0);
    c = hsv2rgb(hsv);
  }

  // Color grading (split toning)
  if (u_grade.y > 0.0 || u_grade.w > 0.0) {
    float L4 = dot(c, LUMA);
    float pivot = 0.5 + u_balance * 0.3;
    float ws = 1.0 - smoothstep(0.0, pivot, L4);
    float wh = smoothstep(pivot, 1.0, L4);
    vec3 sh = hsv2rgb(vec3(u_grade.x / 360.0, 1.0, 1.0)) - 0.5;
    vec3 hi = hsv2rgb(vec3(u_grade.z / 360.0, 1.0, 1.0)) - 0.5;
    c += sh * u_grade.y * ws * 0.35 + hi * u_grade.w * wh * 0.35;
  }
  c = clamp(c, 0.0, 1.0);

  // Levels + curves
  if (u_useLut > 0.5) {
    c.r = texture(u_lut, vec2((c.r * 255.0 + 0.5) / 256.0, 0.5)).r;
    c.g = texture(u_lut, vec2((c.g * 255.0 + 0.5) / 256.0, 0.5)).g;
    c.b = texture(u_lut, vec2((c.b * 255.0 + 0.5) / 256.0, 0.5)).b;
  }

  // Color balance: per tonal range, shifts along the cyan-red, magenta-green, yellow-blue axes
  if (u_useCb > 0.5) {
    float L0 = dot(c, LUMA);
    float wS = 1.0 - smoothstep(0.0, 0.5, L0);
    float wH = smoothstep(0.5, 1.0, L0);
    float wM = clamp(1.0 - wS - wH, 0.0, 1.0);
    c += (u_cbS * wS + u_cbM * wM + u_cbH * wH) * 0.4;
    c = clamp(c, 0.0, 1.0);
    if (u_cbPreserve > 0.5) c = clamp(c * (L0 / max(dot(c, LUMA), 0.001)), 0.0, 1.0);
  }

  // Black & White mixer (Photoshop's model: gray = min + secondary·(mid − min) + primary·(max − mid))
  if (u_useBw > 0.5) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float md = c.r + c.g + c.b - mx - mn;
    float prim = c.r >= mx ? u_bwPrim.x : (c.g >= mx ? u_bwPrim.y : u_bwPrim.z);
    // Secondary: the two largest channels — r+g = yellow, g+b = cyan, r+b = magenta
    float sec = c.b <= mn ? u_bwSec.x : (c.r <= mn ? u_bwSec.y : u_bwSec.z);
    float gray = clamp(mn + sec * (md - mn) + prim * (mx - md), 0.0, 1.0);
    c = u_bwUseTint > 0.5 ? clamp(u_bwTint * (gray / max(dot(u_bwTint, LUMA), 0.001)), 0.0, 1.0) : vec3(gray);
  }

  // Color lookup (3D LUT)
  if (u_lutAmount > 0.0) {
    vec3 lc = texture(u_lut3, c * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize).rgb;
    c = mix(c, clamp(lc, 0.0, 1.0), u_lutAmount);
  }

  // Channel mixer
  if (u_useMix > 0.5) {
    vec3 m = vec3(dot(c, u_mixR), dot(c, u_mixG), dot(c, u_mixB));
    c = clamp(u_mixMono > 0.5 ? vec3(m.r) : m, 0.0, 1.0);
  }

  // Selective color: each range's weight comes from how strongly the pixel belongs to it
  if (u_useSel > 0.5) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float md = c.r + c.g + c.b - mx - mn;
    float w[9];
    w[0] = c.r >= mx ? mx - md : 0.0;   // reds
    w[1] = c.b <= mn ? md - mn : 0.0;   // yellows
    w[2] = c.g >= mx ? mx - md : 0.0;   // greens
    w[3] = c.r <= mn ? md - mn : 0.0;   // cyans
    w[4] = c.b >= mx ? mx - md : 0.0;   // blues
    w[5] = c.g <= mn ? md - mn : 0.0;   // magentas
    w[6] = max(0.0, mn - 0.5) * 2.0;    // whites
    w[7] = max(0.0, 1.0 - (abs(mx - 0.5) + abs(mn - 0.5)));  // neutrals
    w[8] = max(0.0, 0.5 - mx) * 2.0;    // blacks
    vec3 ink = vec3(0.0);
    for (int i = 0; i < 9; i++) ink += w[i] * (u_sel[i].xyz + vec3(u_sel[i].w));
    c = clamp(c - ink, 0.0, 1.0);
  }

  // Photo filter
  if (u_pfDensity > 0.0) {
    float L0 = dot(c, LUMA);
    vec3 f = c * mix(vec3(1.0), u_pfColor, u_pfDensity);
    if (u_pfPreserve > 0.5) f *= L0 / max(dot(f, LUMA), 0.001);
    c = clamp(f, 0.0, 1.0);
  }

  // Gradient map
  if (u_gmAmount > 0.0) {
    float Lg = clamp(dot(c, LUMA), 0.0, 1.0);
    vec3 g = u_gmMid > 0.5
      ? (Lg < 0.5 ? mix(u_gm0, u_gm1, Lg * 2.0) : mix(u_gm1, u_gm2, Lg * 2.0 - 1.0))
      : mix(u_gm0, u_gm2, Lg);
    c = mix(c, g, u_gmAmount);
  }

  if (u_bw > 0.5) c = vec3(dot(c, vec3(0.3, 0.59, 0.11)));
  if (u_invert > 0.5) c = 1.0 - c;
  if (u_threshold > 0.0) c = vec3(step(u_threshold, dot(c, LUMA)));
  if (u_posterize > 1.0) c = floor(c * (u_posterize - 1.0) + 0.5) / (u_posterize - 1.0);

  // Vignette
  if (u_vignette != 0.0) {
    vec2 p = (v_uv - 0.5) * 2.0;
    float v = smoothstep(0.45, 1.45, length(p));
    if (u_vignette < 0.0) c *= 1.0 + u_vignette * v;
    else c = mix(c, vec3(1.0), u_vignette * v);
  }
  // Grain (luminance weighted)
  if (u_grain > 0.0) {
    float n = hash(floor(v_uv * u_size)) - 0.5;
    float Lg = dot(c, LUMA);
    c += n * u_grain * 0.22 * (1.0 - abs(Lg - 0.5));
  }
  if (u_fade > 0.0) c = mix(c, vec3(0.09) + c * 0.84, u_fade);

  outColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

export function isIdentityAdjust(a: Adjust): boolean {
  // Older projects lack the newer stages; fill them in so an untouched layer still counts as identity
  return JSON.stringify({ ...DEFAULTS, ...a }) === IDENTITY;
}
const DEFAULTS = defaultAdjust();
const IDENTITY = JSON.stringify(DEFAULTS);

function identityLut(n: number): Float32Array {
  const out = new Float32Array(n * n * n * 4);
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const i = ((b * n + g) * n + r) * 4;
        out.set([r / (n - 1), g / (n - 1), b / (n - 1), 1], i);
      }
  return out;
}

function rgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function wbMultipliers(temp: number, tint: number): [number, number, number] {
  const t = temp / 100;
  const m = tint / 100;
  let r = 1 + 0.32 * t + 0.08 * m;
  const g = 1 - 0.22 * m;
  let b = 1 - 0.32 * t + 0.08 * m;
  r = Math.max(0.2, r);
  b = Math.max(0.2, b);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / lum, g / lum, b / lum];
}

class AdjustEngine {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private srcTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private lastSrcKey: string | null = null;
  private lastLutKey = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.prog = this.link(VERT, FRAG);
    gl.useProgram(this.prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.srcTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.lutTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.lut3Tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, this.lut3Tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    // A 2³ identity until a LUT is loaded, so the sampler is always complete
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, 2, 2, 2, 0, gl.RGBA, gl.FLOAT, identityLut(2));

    gl.uniform1i(this.u('u_src'), 0);
    gl.uniform1i(this.u('u_lut'), 1);
    gl.uniform1i(this.u('u_lut3'), 2);
  }

  private lut3Tex: WebGLTexture;
  private lastLut3 = '';

  private bindLut(lut: { size: number; data: string }) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, this.lut3Tex);
    // Key on size + length + a sample of the data: cheap and unique enough per LUT
    const key = `${lut.size}:${lut.data.length}:${lut.data.slice(0, 64)}:${lut.data.slice(-64)}`;
    if (key === this.lastLut3) return;
    const n = lut.size;
    const rgb = decodeLut(lut.data, n);
    const rgba = new Float32Array(n * n * n * 4);
    for (let i = 0; i < n * n * n; i++) {
      rgba[i * 4] = rgb[i * 3];
      rgba[i * 4 + 1] = rgb[i * 3 + 1];
      rgba[i * 4 + 2] = rgb[i * 3 + 2];
      rgba[i * 4 + 3] = 1;
    }
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, n, n, n, 0, gl.RGBA, gl.FLOAT, rgba);
    this.lastLut3 = key;
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link error');
    return p;
  }

  private u(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.uniforms.get(name)!;
  }

  /**
   * Runs the adjustment stack over `src`. `srcKey` identifies the source content; when it
   * matches the previous call the texture upload is skipped (the slider-drag fast path).
   */
  process(src: HTMLCanvasElement, adj: Adjust, srcKey: string | null): HTMLCanvasElement {
    const gl = this.gl;
    const { width, height } = src;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.lastSrcKey = null;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    if (srcKey === null || srcKey !== this.lastSrcKey) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.lastSrcKey = srcKey;
    }

    const lutKey = JSON.stringify([adj.levels, adj.curves]);
    const useLut = lutKey !== IDENTITY_LUT_KEY;
    if (useLut && lutKey !== this.lastLutKey) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, toneLut(adj));
      this.lastLutKey = lutKey;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);

    const f = (n: string, v: number) => gl.uniform1f(this.u(n), v);
    gl.uniform2f(this.u('u_size'), width, height);
    f('u_lod', Math.max(1, Math.min(9, Math.log2(Math.max(width, height) / 160))));
    f('u_exposure', adj.exposure);
    f('u_contrast', adj.contrast / 100);
    f('u_highlights', adj.highlights / 100);
    f('u_shadows', adj.shadows / 100);
    f('u_whites', adj.whites / 100);
    f('u_blacks', adj.blacks / 100);
    gl.uniform3f(this.u('u_wb'), ...wbMultipliers(adj.temperature, adj.tint));
    f('u_vibrance', adj.vibrance / 100);
    f('u_saturation', adj.saturation / 100);
    f('u_hue', adj.hue);
    f('u_clarity', adj.clarity / 100);
    f('u_dehaze', adj.dehaze / 100);
    f('u_sharpen', adj.sharpen / 100);
    f('u_vignette', adj.vignette / 100);
    f('u_grain', adj.grain / 100);
    f('u_fade', adj.fade / 100);
    f('u_bw', adj.bw ? 1 : 0);
    f('u_invert', adj.invert ? 1 : 0);
    f('u_threshold', adj.threshold > 0 ? adj.threshold / 255 : 0);
    f('u_posterize', adj.posterize);
    f('u_useLut', useLut ? 1 : 0);
    const hsl = new Float32Array(24);
    HSL_BANDS.forEach((b, i) => {
      hsl[i * 3] = adj.hsl[b].h / 100;
      hsl[i * 3 + 1] = adj.hsl[b].s / 100;
      hsl[i * 3 + 2] = adj.hsl[b].l / 100;
    });
    gl.uniform3fv(this.u('u_hsl[0]'), hsl);
    gl.uniform4f(
      this.u('u_grade'),
      adj.grade.shadowHue,
      adj.grade.shadowSat / 100,
      adj.grade.highlightHue,
      adj.grade.highlightSat / 100
    );
    f('u_balance', adj.grade.balance / 100);

    // Newer stages: older projects may not have them, so fall back to the defaults
    const d = DEFAULTS;
    const mix = adj.mixer ?? d.mixer;
    const mixOn = JSON.stringify(mix) !== JSON.stringify(d.mixer);
    f('u_useMix', mixOn ? 1 : 0);
    gl.uniform3f(this.u('u_mixR'), mix.r[0] / 100, mix.r[1] / 100, mix.r[2] / 100);
    gl.uniform3f(this.u('u_mixG'), mix.g[0] / 100, mix.g[1] / 100, mix.g[2] / 100);
    gl.uniform3f(this.u('u_mixB'), mix.b[0] / 100, mix.b[1] / 100, mix.b[2] / 100);
    f('u_mixMono', mix.mono ? 1 : 0);
    const sel = adj.selective ?? d.selective;
    const selArr = new Float32Array(36);
    let selOn = false;
    SEL_RANGES.forEach((r, i) => {
      const v = sel[r] ?? { c: 0, m: 0, y: 0, k: 0 };
      selArr.set([v.c / 100, v.m / 100, v.y / 100, v.k / 100], i * 4);
      if (v.c || v.m || v.y || v.k) selOn = true;
    });
    f('u_useSel', selOn ? 1 : 0);
    gl.uniform4fv(this.u('u_sel[0]'), selArr);
    const pf = adj.photoFilter ?? d.photoFilter;
    gl.uniform3f(this.u('u_pfColor'), ...rgb01(pf.color));
    f('u_pfDensity', pf.density / 100);
    f('u_pfPreserve', pf.preserve ? 1 : 0);
    const gm = adj.gradientMap ?? d.gradientMap;
    gl.uniform3f(this.u('u_gm0'), ...rgb01(gm.shadow));
    gl.uniform3f(this.u('u_gm1'), ...rgb01(gm.mid));
    gl.uniform3f(this.u('u_gm2'), ...rgb01(gm.highlight));
    f('u_gmAmount', gm.amount / 100);
    f('u_gmMid', gm.useMid ? 1 : 0);
    const cb = adj.colorBalance ?? d.colorBalance;
    const cbOn = [...cb.shadows, ...cb.midtones, ...cb.highlights].some((v) => v !== 0);
    f('u_useCb', cbOn ? 1 : 0);
    gl.uniform3f(this.u('u_cbS'), cb.shadows[0] / 100, cb.shadows[1] / 100, cb.shadows[2] / 100);
    gl.uniform3f(this.u('u_cbM'), cb.midtones[0] / 100, cb.midtones[1] / 100, cb.midtones[2] / 100);
    gl.uniform3f(this.u('u_cbH'), cb.highlights[0] / 100, cb.highlights[1] / 100, cb.highlights[2] / 100);
    f('u_cbPreserve', cb.preserve ? 1 : 0);
    const bw = adj.bwMix ?? d.bwMix;
    f('u_useBw', bw.enabled ? 1 : 0);
    gl.uniform3f(this.u('u_bwPrim'), bw.reds / 100, bw.greens / 100, bw.blues / 100);
    gl.uniform3f(this.u('u_bwSec'), bw.yellows / 100, bw.cyans / 100, bw.magentas / 100);
    gl.uniform3f(this.u('u_bwTint'), ...rgb01(bw.tintColor));
    f('u_bwUseTint', bw.tint ? 1 : 0);
    const lut = adj.lut ?? null;
    if (lut && lut.amount > 0) {
      this.bindLut(lut);
      f('u_lutAmount', lut.amount / 100);
      f('u_lutSize', lut.size);
    } else f('u_lutAmount', 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}

const IDENTITY_LUT_KEY = (() => {
  const d = defaultAdjust();
  return JSON.stringify([d.levels, d.curves]);
})();

let engine: AdjustEngine | null | undefined;

/** Lazily created shared engine; null if WebGL2 is unavailable. */
export function getAdjustEngine(): AdjustEngine | null {
  if (engine === undefined) {
    try {
      engine = new AdjustEngine();
    } catch (err) {
      console.warn('Skill Photo: GPU adjustments unavailable', err);
      engine = null;
    }
  }
  return engine;
}
