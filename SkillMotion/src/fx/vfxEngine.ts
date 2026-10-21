import { VFXEffect } from './types';

// Applies an array of VFX effects sequentially to a canvas context
export function applyVFXStack(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  effects: VFXEffect[],
  time: number
) {
  for (const fx of effects) {
    if (!fx.enabled) continue;

    switch (fx.type) {
      case 'glow':
        applyGlow(ctx, width, height, fx.params);
        break;
      case 'chromatic':
        applyChromaticAberration(ctx, width, height, fx.params);
        break;
      case 'glitch':
        applyGlitch(ctx, width, height, fx.params, time);
        break;
      case 'film-grain':
        applyFilmGrain(ctx, width, height, fx.params, time);
        break;
      case 'lens-flare':
        applyLensFlare(ctx, width, height, fx.params);
        break;
      case 'chroma-key':
        applyChromaKey(ctx, width, height, fx.params);
        break;
      case 'blur':
        applyBlur(ctx, width, height, fx.params);
        break;
      case 'camera-shake':
        // Camera shake is applied to transform matrix prior to rendering
        break;
      case 'vignette':
        applyVignette(ctx, width, height, fx.params);
        break;
      case 'letterbox':
        applyLetterbox(ctx, width, height, fx.params);
        break;
      case 'lumetri':
        applyLumetri(ctx, width, height, fx.params);
        break;
    }
  }
}

// 1. Glow / Optical Bloom Effect
export function applyGlow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: Record<string, any>
) {
  const intensity = Math.max(0, Number(params.intensity ?? 0.8));
  const radius = Math.max(0, Number(params.radius ?? 20));
  const color = String(params.color ?? '#38bdf8');
  if (intensity === 0) return;

  // Bloom: keep only the bright parts, blur them at quarter size, tint, then screen back on top.
  // Dark and mid tones stay untouched, so the frame isn't washed out.
  const k = 4;
  const bw = Math.max(1, Math.round(width / k));
  const bh = Math.max(1, Math.round(height / k));
  const bloom = document.createElement('canvas');
  bloom.width = bw;
  bloom.height = bh;
  const b = bloom.getContext('2d');
  if (!b) return;
  b.filter = `brightness(0.7) contrast(3) blur(${radius / k}px)`;
  b.drawImage(ctx.canvas, 0, 0, bw, bh);
  b.filter = 'none';
  b.globalCompositeOperation = 'multiply';
  b.globalAlpha = 0.6;
  b.fillStyle = color;
  b.fillRect(0, 0, bw, bh);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = Math.min(1, intensity);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bloom, 0, 0, width, height);
  ctx.restore();
}

// 2. Chromatic Aberration / RGB Split
export function applyChromaticAberration(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: Record<string, any>
) {
  const offset = Number(params.offset ?? 6);
  if (offset <= 0) return;

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const copy = new Uint8ClampedArray(data);

  const rowStride = width * 4;
  const shift = Math.floor(offset) * 4;

  for (let y = 0; y < height; y++) {
    const rowStart = y * rowStride;
    for (let x = 0; x < width; x++) {
      const idx = rowStart + x * 4;

      // Red channel shifted left
      const redIdx = idx - shift;
      if (redIdx >= rowStart) {
        data[idx] = copy[redIdx];
      }

      // Blue channel shifted right
      const blueIdx = idx + shift;
      if (blueIdx < rowStart + rowStride) {
        data[idx + 2] = copy[blueIdx + 2];
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// 3. Cyberpunk Glitch & VHS scanlines
export function applyGlitch(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: Record<string, any>,
  time: number
) {
  const intensity = Number(params.intensity ?? 0.5);
  if (intensity <= 0) return;

  // Occasional random glitch bursts
  const trigger = (Math.sin(time * 8.5) + Math.cos(time * 23.1)) * 0.5;
  if (Math.abs(trigger) < 0.25 && intensity < 0.8) return;

  ctx.save();
  const numSlices = Math.floor(4 + intensity * 12);
  for (let i = 0; i < numSlices; i++) {
    const sliceY = (Math.random() * height) | 0;
    const sliceH = Math.floor(2 + Math.random() * (16 * intensity));
    const shiftX = (Math.random() - 0.5) * 36 * intensity;

    ctx.drawImage(
      ctx.canvas,
      0, sliceY, width, sliceH,
      shiftX, sliceY, width, sliceH
    );
  }

  // Scanlines overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  for (let y = 0; y < height; y += 4) {
    ctx.fillRect(0, y, width, 1.5);
  }
  ctx.restore();
}

// 4. Cinematic Film Grain & Halation
export function applyFilmGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: Record<string, any>,
  time: number
) {
  const amount = Number(params.amount ?? 0.25);
  if (amount <= 0) return;

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const factor = amount * 80;

  // Pseudo-random seeded by time to prevent static patterns
  const seed = (Math.sin(time * 43.12) * 10000) % 1;
  const step = 2; // Step for fast processing

  for (let y = 0; y < height; y += step) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += step) {
      const idx = row + x * 4;
      const noise = ((Math.random() + seed) % 1 - 0.5) * factor;

      data[idx] = Math.min(255, Math.max(0, data[idx] + noise));
      data[idx + 1] = Math.min(255, Math.max(0, data[idx + 1] + noise));
      data[idx + 2] = Math.min(255, Math.max(0, data[idx + 2] + noise));
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// 5. Anamorphic Lens Flare
export function applyLensFlare(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: Record<string, any>
) {
  const posX = (Number(params.x ?? 50) / 100) * width;
  const posY = (Number(params.y ?? 40) / 100) * height;
  const color = String(params.color ?? '#38bdf8');
  const brightness = Number(params.brightness ?? 0.7);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = Math.min(1, brightness);

  // Horizontal anamorphic streak
  const streakGrad = ctx.createLinearGradient(0, posY, width, posY);
  streakGrad.addColorStop(0, 'rgba(0,0,0,0)');
  streakGrad.addColorStop(Math.max(0, (posX - 300) / width), 'rgba(0,0,0,0)');
  streakGrad.addColorStop(posX / width, color);
  streakGrad.addColorStop(Math.min(1, (posX + 300) / width), 'rgba(0,0,0,0)');
  streakGrad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = streakGrad;
  ctx.fillRect(0, posY - 4, width, 8);

  // Central bright star/glow
  const radial = ctx.createRadialGradient(posX, posY, 2, posX, posY, 120);
  radial.addColorStop(0, '#ffffff');
  radial.addColorStop(0.2, color);
  radial.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = radial;
  ctx.beginPath();
  ctx.arc(posX, posY, 120, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// 6. Chroma Key (Green / Blue screen transparency)
export function applyChromaKey(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: Record<string, any>
) {
  const tolerance = Number(params.tolerance ?? 45);
  const targetKey = String(params.keyColor ?? 'green').toLowerCase();

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let isMatch = false;
    if (targetKey === 'green') {
      // Green dominant
      if (g > 80 && g - r > tolerance && g - b > tolerance) {
        isMatch = true;
      }
    } else if (targetKey === 'blue') {
      // Blue dominant
      if (b > 80 && b - r > tolerance && b - g > tolerance) {
        isMatch = true;
      }
    }

    if (isMatch) {
      data[i + 3] = 0; // Transparent
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// 7. Gaussian Blur
export function applyBlur(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: Record<string, any>
) {
  const radius = Number(params.radius ?? 8);
  if (radius <= 0) return;

  ctx.save();
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(ctx.canvas, 0, 0, width, height);
  ctx.restore();
}

// 8. Vignette (Dark cinematic edges)
export function applyVignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: Record<string, any>
) {
  const darkness = Number(params.darkness ?? 0.65);
  const radiusRatio = Number(params.radius ?? 0.85);

  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.sqrt(cx * cx + cy * cy) * radiusRatio;

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const grad = ctx.createRadialGradient(cx, cy, maxRadius * 0.4, cx, cy, maxRadius);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${Math.min(1, darkness)})`);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// 9. Letterbox (Cinematic Aspect Ratio 2.39:1 bars)
export function applyLetterbox(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: Record<string, any>
) {
  const ratio = Number(params.ratio ?? 2.39);
  const targetH = width / ratio;
  const barH = Math.max(0, (height - targetH) / 2);

  if (barH <= 1) return;

  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, barH);
  ctx.fillRect(0, height - barH, width, barH);
  ctx.restore();
}

// 10. Lumetri Color Grading & 3D LUT Presets
export function applyLumetri(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: Record<string, any>
) {
  const exposure = Number(params.exposure ?? 0); // -2 to +2 EV
  const contrast = Number(params.contrast ?? 0); // -100 to +100
  const saturation = Number(params.saturation ?? 100); // 0 to 200
  const temperature = Number(params.temperature ?? 0); // -100 (cool) to +100 (warm)
  const tint = Number(params.tint ?? 0); // -100 (green) to +100 (magenta)
  const lut = String(params.lutPreset ?? 'none');

  if (
    exposure === 0 &&
    contrast === 0 &&
    saturation === 100 &&
    temperature === 0 &&
    tint === 0 &&
    lut === 'none'
  ) {
    return;
  }

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  // Contrast lookup multiplier
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const expMult = Math.pow(2, exposure);
  const satFactor = saturation / 100;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Exposure
    r *= expMult;
    g *= expMult;
    b *= expMult;

    // Temperature & Tint
    r += temperature * 0.35;
    b -= temperature * 0.35;
    g -= tint * 0.25;
    r += tint * 0.15;
    b += tint * 0.15;

    // Contrast
    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;

    // Saturation (Rec.709 Luminance)
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = gray + satFactor * (r - gray);
    g = gray + satFactor * (g - gray);
    b = gray + satFactor * (b - gray);

    // Apply Categorized 3D LUT preset color transformation
    // --- Cinematic & Film ---
    if (lut === 'teal-orange' || lut === 'cine-teal-orange') {
      // Hollywood Blockbuster: Highlights warm/orange, Shadows cool/cyan
      if (gray > 120) {
        r *= 1.15;
        g *= 1.05;
        b *= 0.88;
      } else {
        r *= 0.85;
        g *= 1.04;
        b *= 1.25;
      }
    } else if (lut === 'cyberpunk' || lut === 'cine-cyberpunk') {
      // Neon Magenta & Electric Blue
      r = r * 1.25 + 15;
      b = b * 1.35 + 25;
      g *= 0.85;
    } else if (lut === 'vintage-35mm' || lut === 'vintage-polaroid') {
      // Warm muted nostalgic 70s look
      r = r * 1.08 + 12;
      g = g * 1.02 + 6;
      b = b * 0.92;
    } else if (lut === 'noir' || lut === 'portrait-studio-bw') {
      // High contrast dramatic monochrome
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = lum > 128 ? Math.min(255, lum * 1.2) : lum * 0.85;
    } else if (lut === 'golden-hour' || lut === 'portrait-warm-amber') {
      // Sunset golden glow
      r = r * 1.2 + 20;
      g = g * 1.1 + 10;
      b *= 0.85;
    } else if (lut === 'kodak-portra') {
      // Analog Kodak Portra warm pastel highlights
      r = r * 1.08 + 8;
      g = g * 1.02;
      b = b * 0.94;
    } else if (lut === 'fuji-400h') {
      // Fuji airy cyan-tinted film
      r *= 0.96;
      g = g * 1.06 + 4;
      b = b * 1.12 + 10;
    } else if (lut === 'bleach-bypass') {
      // Gritty silver retention
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = r * 0.6 + lum * 0.45;
      g = g * 0.6 + lum * 0.45;
      b = b * 0.6 + lum * 0.45;
    }
    // --- Food & Culinary ---
    else if (lut === 'food-warm-gourmet') {
      // Warm appetizing highlights and rich golden-brown contrast
      r = r * 1.14 + 10;
      g = g * 1.05 + 4;
      b = b * 0.88;
    } else if (lut === 'food-fresh-greens') {
      // Crisp organic greens & clean whites
      r *= 0.95;
      g = g * 1.18 + 8;
      b = b * 0.98;
    } else if (lut === 'food-rich-coffee') {
      // Deep espresso shadows & caramel midtones
      r = r * 1.09 + 6;
      g = g * 0.97;
      b = b * 0.84;
    } else if (lut === 'food-citrus-punch') {
      // Juicy punchy orange & yellow pop
      r = r * 1.2 + 12;
      g = g * 1.1 + 6;
      b *= 0.9;
    }
    // --- Person & Model / Portrait ---
    else if (lut === 'portrait-natural-skin') {
      // Flattering healthy skin glow
      if (r > g && g > b) {
        r = r * 1.08 + 4;
        g = g * 1.02;
        b = b * 0.96;
      }
    } else if (lut === 'portrait-model-editorial') {
      // High-fashion runway contrast
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum > 120 ? r * 1.12 : r * 0.92;
      g = lum > 120 ? g * 1.05 : g * 0.94;
      b = lum > 120 ? b * 0.96 : b * 0.96;
    } else if (lut === 'portrait-melanin-rich') {
      // Bronze highlights & deep rich contrast
      r = r * 1.16 + 8;
      g = g * 1.03;
      b = b * 0.9;
    } else if (lut === 'portrait-porcelain-glow') {
      // Soft-key beauty lighting
      r = r * 1.06 + 12;
      g = g * 1.04 + 10;
      b = b * 1.06 + 12;
    }
    // --- Product & Commercial ---
    else if (lut === 'product-clean-studio') {
      // 5500K daylight balanced clean whites
      if (gray > 180) {
        r = Math.min(255, r * 1.08);
        g = Math.min(255, g * 1.08);
        b = Math.min(255, b * 1.08);
      }
    } else if (lut === 'product-luxury-dark') {
      // Obsidian blacks & champagne highlights
      if (gray < 80) {
        r *= 0.75;
        g *= 0.75;
        b *= 0.78;
      } else {
        r = r * 1.15 + 10;
        g = g * 1.06 + 5;
        b *= 0.88;
      }
    } else if (lut === 'product-tech-minimalist') {
      // Cool anodized aluminum
      r *= 0.94;
      g *= 0.98;
      b = b * 1.08 + 8;
    } else if (lut === 'product-vibrant-ecommerce') {
      // High saturation & clarity pop
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (r - lum) * 1.3;
      g = lum + (g - lum) * 1.3;
      b = lum + (b - lum) * 1.3;
    }

    data[i] = Math.min(255, Math.max(0, r));
    data[i + 1] = Math.min(255, Math.max(0, g));
    data[i + 2] = Math.min(255, Math.max(0, b));
  }

  ctx.putImageData(imgData, 0, 0);
}
