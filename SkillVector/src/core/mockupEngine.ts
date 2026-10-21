/**
 * Smart Product Mockup & Perspective Mesh Engine for SkillVector.
 *
 * Generates photorealistic product presentations, apparel mockups on models,
 * food packaging, and 3D device frames directly on canvas with zero external
 * 3D engine or cloud dependencies.
 */

import { createCanvas, ctx2d } from './canvas';

export type MockupCategory = 'Food' | 'Person' | 'Product' | 'Device' | 'Print' | 'Outdoor';

export type MockupPresetId =
  // Food & Culinary Packaging
  | 'food-coffee-cup'
  | 'food-snack-pouch'
  | 'food-beverage-bottle'
  | 'food-can-beverage'
  | 'food-takeout-box'
  // Person / Model / Apparel
  | 'model-tshirt-chest'
  | 'model-hoodie-streetwear'
  | 'model-tote-bag'
  | 'model-cap-hat'
  // Product & Cosmetics
  | 'product-dropper-bottle'
  | 'product-cosmetic-jar'
  | 'product-shampoo-pump'
  | 'packaging-box'
  // Devices & Outdoors
  | 'iphone-16-pro'
  | 'macbook-pro'
  | 'framed-canvas'
  | 'billboard';

export interface MockupPreset {
  id: MockupPresetId;
  name: string;
  category: MockupCategory;
  width: number;
  height: number;
  description: string;
}

export const MOCKUP_PRESETS: MockupPreset[] = [
  // Food & Culinary
  { id: 'food-coffee-cup', name: 'Artisan Coffee Cup', category: 'Food', width: 1400, height: 1400, description: 'Eco craft takeaway paper cup with drinking lid and brand sleeve' },
  { id: 'food-snack-pouch', name: 'Stand-Up Foil Pouch', category: 'Food', width: 1400, height: 1400, description: 'Metallic food snack / coffee bean pouch with top zipper seal' },
  { id: 'food-beverage-bottle', name: 'Glass Beverage Bottle', category: 'Food', width: 1200, height: 1600, description: 'Sleek glass bottle with cylindrical wrap label & specular glare' },
  { id: 'food-can-beverage', name: '330ml Aluminum Soda Can', category: 'Food', width: 1200, height: 1500, description: 'Metallic drink can with cylindrical perspective warp & brushed rim' },
  { id: 'food-takeout-box', name: 'Artisan Bakery / Takeout Box', category: 'Food', width: 1500, height: 1200, description: 'Isometric kraft paper food box with folding tabs' },

  // Person / Model / Apparel
  { id: 'model-tshirt-chest', name: 'Model Crewneck T-Shirt', category: 'Person', width: 1400, height: 1600, description: 'Fashion model wearing relaxed-fit tee with fabric folds & chest print' },
  { id: 'model-hoodie-streetwear', name: 'Model Streetwear Hoodie', category: 'Person', width: 1400, height: 1600, description: 'Urban model in heavyweight hoodie with pocket seams & center artwork' },
  { id: 'model-tote-bag', name: 'Canvas Shoulder Tote Bag', category: 'Person', width: 1400, height: 1500, description: 'Natural unbleached cotton tote bag with organic fabric weave' },
  { id: 'model-cap-hat', name: 'Structured Baseball Cap', category: 'Person', width: 1400, height: 1200, description: '6-panel athletic cap with curved visor and front emblem placement' },

  // Product & Cosmetics
  { id: 'product-dropper-bottle', name: 'Cosmetic Dropper Serum', category: 'Product', width: 1300, height: 1600, description: 'Luxury amber glass serum bottle with rubber pipette and gold ring' },
  { id: 'product-cosmetic-jar', name: 'Frosted Glass Cream Jar', category: 'Product', width: 1400, height: 1200, description: 'Skincare cream jar with brushed aluminum lid and floor reflection' },
  { id: 'product-shampoo-pump', name: 'Cylindrical Pump Bottle', category: 'Product', width: 1200, height: 1600, description: 'Minimalist bath & beauty pump dispenser with wrap-around label' },
  { id: 'packaging-box', name: 'Isometric Product Box', category: 'Product', width: 1400, height: 1200, description: 'Luxury folding carton box with isometric depth and ambient shadows' },

  // Devices & Prints
  { id: 'iphone-16-pro', name: 'iPhone 16 Pro (Titanium)', category: 'Device', width: 1200, height: 1600, description: 'Ultra-thin bezel smartphone frame with OLED specular glass reflection' },
  { id: 'macbook-pro', name: 'MacBook Pro 16" (Space Black)', category: 'Device', width: 1800, height: 1200, description: 'Liquid Retina XDR display with anodized aluminum casing & notch' },
  { id: 'framed-canvas', name: 'Gallery Framed Canvas', category: 'Print', width: 1400, height: 1400, description: 'Museum oak timber picture frame with bevel matte border' },
  { id: 'billboard', name: 'Metropolitan Street Billboard', category: 'Outdoor', width: 1920, height: 1080, description: 'Urban outdoor steel billboard illuminated by floodlights' },
];

function drawCylindricalArtwork(
  ctx: CanvasRenderingContext2D,
  artwork: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
  curviness = 0.15
) {
  const slices = 24;
  const sliceW = w / slices;
  const artSliceW = artwork.width / slices;

  ctx.save();
  for (let i = 0; i < slices; i++) {
    const norm = (i / (slices - 1)) * 2 - 1;
    const shade = 1 - Math.pow(Math.abs(norm), 1.8) * 0.45;
    const curveY = (1 - norm * norm) * curviness * (h * 0.08);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + i * sliceW, y - curveY, sliceW + 0.5, h + curveY * 2);
    ctx.clip();

    ctx.drawImage(
      artwork,
      i * artSliceW,
      0,
      artSliceW,
      artwork.height,
      x + i * sliceW,
      y - curveY,
      sliceW + 0.5,
      h + curveY * 2
    );

    ctx.fillStyle = `rgba(0,0,0,${(1 - shade).toFixed(3)})`;
    ctx.fillRect(x + i * sliceW, y - curveY, sliceW + 0.5, h + curveY * 2);

    const spec = Math.exp(-Math.pow((norm + 0.35) / 0.22, 2)) * 0.28;
    if (spec > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${spec.toFixed(3)})`;
      ctx.fillRect(x + i * sliceW, y - curveY, sliceW + 0.5, h + curveY * 2);
    }
    ctx.restore();
  }
  ctx.restore();
}

export function renderMockup(artwork: HTMLCanvasElement, presetId: MockupPresetId): HTMLCanvasElement {
  const preset = MOCKUP_PRESETS.find((p) => p.id === presetId) ?? MOCKUP_PRESETS[0];
  const out = createCanvas(preset.width, preset.height);
  const ctx = ctx2d(out);
  const W = preset.width;
  const H = preset.height;

  switch (presetId) {
    case 'food-coffee-cup': {
      const bg = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 800);
      bg.addColorStop(0, '#2d241e');
      bg.addColorStop(1, '#15100d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2 + 30;
      const cupTopW = 440;
      const cupBotW = 320;
      const cupH = 640;

      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + cupH / 2 + 10, cupBotW * 0.8, 36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const topY = cy - cupH / 2;
      const botY = cy + cupH / 2;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - cupTopW / 2, topY);
      ctx.lineTo(cx + cupTopW / 2, topY);
      ctx.lineTo(cx + cupBotW / 2, botY);
      ctx.lineTo(cx - cupBotW / 2, botY);
      ctx.closePath();
      ctx.clip();

      const kraft = ctx.createLinearGradient(cx - cupTopW / 2, 0, cx + cupTopW / 2, 0);
      kraft.addColorStop(0, '#5a4638');
      kraft.addColorStop(0.3, '#846954');
      kraft.addColorStop(0.7, '#6e5645');
      kraft.addColorStop(1, '#44342a');
      ctx.fillStyle = kraft;
      ctx.fillRect(cx - cupTopW / 2, topY, cupTopW, cupH);

      const bandY = topY + cupH * 0.22;
      const bandH = cupH * 0.52;
      const bandW = cupTopW * 0.88;
      drawCylindricalArtwork(ctx, artwork, cx - bandW / 2, bandY, bandW, bandH, 0.1);
      ctx.restore();

      const lidW = cupTopW + 36;
      const lidH = 50;
      const lidY = topY - lidH + 10;
      const lidGrad = ctx.createLinearGradient(0, lidY, 0, lidY + lidH);
      lidGrad.addColorStop(0, '#ffffff');
      lidGrad.addColorStop(0.4, '#d8d8d8');
      lidGrad.addColorStop(1, '#9e9e9e');
      ctx.fillStyle = lidGrad;
      ctx.beginPath();
      ctx.roundRect(cx - lidW / 2, lidY, lidW, lidH, [16, 16, 4, 4]);
      ctx.fill();
      ctx.fillStyle = '#b0b0b0';
      ctx.fillRect(cx - lidW / 2 - 4, lidY + lidH - 6, lidW + 8, 8);
      break;
    }

    case 'food-snack-pouch': {
      const bg = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 750);
      bg.addColorStop(0, '#222831');
      bg.addColorStop(1, '#111418');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2 + 10;
      const pw = 580;
      const ph = 820;
      const px = cx - pw / 2;
      const py = cy - ph / 2;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.ellipse(cx, py + ph + 15, pw * 0.65, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(px + 40, py);
      ctx.lineTo(px + pw - 40, py);
      ctx.quadraticCurveTo(px + pw, py + 40, px + pw - 20, py + ph - 60);
      ctx.quadraticCurveTo(px + pw / 2, py + ph + 20, px + 20, py + ph - 60);
      ctx.quadraticCurveTo(px, py + 40, px + 40, py);
      ctx.closePath();
      ctx.clip();

      const foil = ctx.createLinearGradient(px, py, px + pw, py);
      foil.addColorStop(0, '#1c1f24');
      foil.addColorStop(0.25, '#3b424e');
      foil.addColorStop(0.65, '#252930');
      foil.addColorStop(1, '#16181c');
      ctx.fillStyle = foil;
      ctx.fill();

      const artPad = 32;
      drawCylindricalArtwork(ctx, artwork, px + artPad, py + 80, pw - artPad * 2, ph - 160, 0.08);

      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(px, py + 48, pw, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(px, py + 52, pw, 2);
      ctx.restore();
      break;
    }

    case 'food-beverage-bottle': {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#1e2024');
      bg.addColorStop(1, '#0e0f12');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2 + 20;
      const bw = 320;
      const bh = 1000;
      const bx = cx - bw / 2;
      const by = cy - bh / 2;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      ctx.ellipse(cx, by + bh + 10, bw * 0.7, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      const nw = 90;
      const nh = 260;
      ctx.moveTo(cx - nw / 2, by);
      ctx.lineTo(cx + nw / 2, by);
      ctx.lineTo(cx + nw / 2, by + nh);
      ctx.quadraticCurveTo(cx + bw / 2, by + nh + 80, cx + bw / 2, by + nh + 140);
      ctx.lineTo(cx + bw / 2, by + bh - 30);
      ctx.quadraticCurveTo(cx + bw / 2, by + bh, cx + bw / 2 - 30, by + bh);
      ctx.lineTo(cx - bw / 2 + 30, by + bh);
      ctx.quadraticCurveTo(cx - bw / 2, by + bh, cx - bw / 2, by + bh - 30);
      ctx.lineTo(cx - bw / 2, by + nh + 140);
      ctx.quadraticCurveTo(cx - bw / 2, by + nh + 80, cx - nw / 2, by + nh);
      ctx.closePath();
      ctx.clip();

      const liquid = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      liquid.addColorStop(0, '#10150e');
      liquid.addColorStop(0.3, '#2a3b22');
      liquid.addColorStop(0.7, '#1e2a18');
      liquid.addColorStop(1, '#0b0e0a');
      ctx.fillStyle = liquid;
      ctx.fillRect(bx, by, bw, bh);

      const labelY = by + nh + 160;
      const labelH = bh * 0.42;
      drawCylindricalArtwork(ctx, artwork, bx + 10, labelY, bw - 20, labelH, 0.12);

      const glare = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      glare.addColorStop(0.18, 'rgba(255,255,255,0.3)');
      glare.addColorStop(0.25, 'rgba(255,255,255,0.02)');
      glare.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glare;
      ctx.fillRect(bx, by, bw, bh);
      ctx.restore();

      const capH = 50;
      const capGrad = ctx.createLinearGradient(cx - nw / 2, 0, cx + nw / 2, 0);
      capGrad.addColorStop(0, '#b4832c');
      capGrad.addColorStop(0.5, '#f5d378');
      capGrad.addColorStop(1, '#8e621c');
      ctx.fillStyle = capGrad;
      ctx.fillRect(cx - nw / 2 - 2, by - 10, nw + 4, capH);
      break;
    }

    case 'food-can-beverage': {
      const bg = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, 700);
      bg.addColorStop(0, '#181f2a');
      bg.addColorStop(1, '#090b0f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const cw = 440;
      const ch = 880;
      const cx0 = cx - cw / 2;
      const cy0 = cy - ch / 2;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath();
      ctx.ellipse(cx, cy0 + ch + 15, cw * 0.65, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(cx0, cy0, cw, ch, [28, 28, 36, 36]);
      ctx.clip();

      const metal = ctx.createLinearGradient(cx0, 0, cx0 + cw, 0);
      metal.addColorStop(0, '#42454a');
      metal.addColorStop(0.2, '#989ca6');
      metal.addColorStop(0.6, '#555860');
      metal.addColorStop(1, '#2c2e33');
      ctx.fillStyle = metal;
      ctx.fillRect(cx0, cy0, cw, ch);

      const labelMargin = 40;
      drawCylindricalArtwork(ctx, artwork, cx0, cy0 + labelMargin, cw, ch - labelMargin * 2, 0.14);

      const rim = ctx.createLinearGradient(cx0, 0, cx0 + cw, 0);
      rim.addColorStop(0, '#888');
      rim.addColorStop(0.5, '#eee');
      rim.addColorStop(1, '#666');
      ctx.fillStyle = rim;
      ctx.fillRect(cx0, cy0, cw, 24);
      ctx.fillRect(cx0, cy0 + ch - 24, cw, 24);
      ctx.restore();
      break;
    }

    case 'food-takeout-box': {
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#2c2724');
      bg.addColorStop(1, '#151311');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2 + 20;
      const boxW = 540;
      const boxH = 460;
      const boxD = 220;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.ellipse(cx + 40, cy + boxH / 2 + 80, boxW * 1.1, 45, -0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const fx = cx - boxW / 2;
      const fy = cy - boxH / 2 + 50;
      ctx.drawImage(artwork, fx, fy, boxW, boxH);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + boxD * 0.7, fy - boxD * 0.4);
      ctx.lineTo(fx + boxW + boxD * 0.7, fy - boxD * 0.4);
      ctx.lineTo(fx + boxW, fy);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
      ctx.beginPath();
      ctx.moveTo(fx + boxW, fy);
      ctx.lineTo(fx + boxW + boxD * 0.7, fy - boxD * 0.4);
      ctx.lineTo(fx + boxW + boxD * 0.7, fy + boxH - boxD * 0.4);
      ctx.lineTo(fx + boxW, fy + boxH);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'model-tshirt-chest': {
      const bg = ctx.createRadialGradient(W / 2, H * 0.35, 100, W / 2, H / 2, 800);
      bg.addColorStop(0, '#2e3038');
      bg.addColorStop(1, '#121316');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;

      ctx.fillStyle = '#b78065';
      ctx.beginPath();
      ctx.ellipse(cx, 160, 80, 110, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - 140, 240);
      ctx.quadraticCurveTo(cx, 320, cx + 140, 240);
      ctx.lineTo(cx + 460, 360);
      ctx.lineTo(cx + 400, 560);
      ctx.lineTo(cx + 280, 520);
      ctx.lineTo(cx + 290, H);
      ctx.lineTo(cx - 290, H);
      ctx.lineTo(cx - 280, 520);
      ctx.lineTo(cx - 400, 560);
      ctx.lineTo(cx - 460, 360);
      ctx.closePath();
      ctx.clip();

      const cotton = ctx.createLinearGradient(cx - 300, 200, cx + 300, H);
      cotton.addColorStop(0, '#27292e');
      cotton.addColorStop(0.35, '#353840');
      cotton.addColorStop(0.7, '#24262a');
      cotton.addColorStop(1, '#1c1e22');
      ctx.fillStyle = cotton;
      ctx.fill();

      const gw = 440;
      const gh = 520;
      const gx = cx - gw / 2;
      const gy = 440;

      ctx.save();
      ctx.globalAlpha = 0.94;
      ctx.drawImage(artwork, gx, gy, gw, gh);
      ctx.restore();

      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.moveTo(cx - 200, 480);
      ctx.quadraticCurveTo(cx, 510, cx + 220, 470);
      ctx.quadraticCurveTo(cx, 530, cx - 200, 480);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = '#3e424c';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(cx - 140, 240);
      ctx.quadraticCurveTo(cx, 320, cx + 140, 240);
      ctx.stroke();
      break;
    }

    case 'model-hoodie-streetwear': {
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#1c2029');
      bg.addColorStop(1, '#0a0c10');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - 160, 200);
      ctx.quadraticCurveTo(cx, 100, cx + 160, 200);
      ctx.lineTo(cx + 500, 360);
      ctx.lineTo(cx + 430, 620);
      ctx.lineTo(cx + 310, 560);
      ctx.lineTo(cx + 320, H);
      ctx.lineTo(cx - 320, H);
      ctx.lineTo(cx - 310, 560);
      ctx.lineTo(cx - 430, 620);
      ctx.lineTo(cx - 500, 360);
      ctx.closePath();
      ctx.clip();

      const fleece = ctx.createLinearGradient(cx - 350, 100, cx + 350, H);
      fleece.addColorStop(0, '#2b2d33');
      fleece.addColorStop(0.5, '#1e2024');
      fleece.addColorStop(1, '#141518');
      ctx.fillStyle = fleece;
      ctx.fill();

      const hw = 460;
      const hh = 460;
      ctx.drawImage(artwork, cx - hw / 2, 420, hw, hh);

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.moveTo(cx - 240, 920);
      ctx.lineTo(cx + 240, 920);
      ctx.lineTo(cx + 200, H - 40);
      ctx.lineTo(cx - 200, H - 40);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - 50, 250);
      ctx.lineTo(cx - 45, 460);
      ctx.moveTo(cx + 50, 250);
      ctx.lineTo(cx + 55, 450);
      ctx.stroke();
      break;
    }

    case 'model-tote-bag': {
      const bg = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 700);
      bg.addColorStop(0, '#ede9e3');
      bg.addColorStop(1, '#c5bfb4');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2 + 50;
      const bw = 580;
      const bh = 680;
      const bx = cx - bw / 2;
      const by = cy - bh / 2;

      ctx.strokeStyle = '#5c5448';
      ctx.lineWidth = 34;
      ctx.beginPath();
      ctx.moveTo(bx + 100, by);
      ctx.bezierCurveTo(bx + 60, by - 360, cx + 180, by - 360, cx + 140, by);
      ctx.stroke();

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(cx, by + bh + 15, bw * 0.58, 25, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, [12, 12, 24, 24]);
      ctx.clip();

      const canvasGrad = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      canvasGrad.addColorStop(0, '#ded7cb');
      canvasGrad.addColorStop(0.5, '#ede6db');
      canvasGrad.addColorStop(1, '#d5cdc0');
      ctx.fillStyle = canvasGrad;
      ctx.fill();

      const pad = 60;
      ctx.drawImage(artwork, bx + pad, by + pad + 20, bw - pad * 2, bh - pad * 2 - 40);

      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      for (let y = by; y < by + bh; y += 8) {
        ctx.fillRect(bx, y, bw, 2);
      }
      ctx.restore();
      break;
    }

    case 'model-cap-hat': {
      const bg = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 650);
      bg.addColorStop(0, '#242831');
      bg.addColorStop(1, '#0e1014');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 220, 380, 40, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx - 320, cy + 80);
      ctx.quadraticCurveTo(cx, cy - 280, cx + 320, cy + 80);
      ctx.closePath();
      ctx.clip();

      const capGrad = ctx.createLinearGradient(cx - 300, cy - 200, cx + 300, cy + 100);
      capGrad.addColorStop(0, '#1c1f24');
      capGrad.addColorStop(0.4, '#30353f');
      capGrad.addColorStop(1, '#181a1f');
      ctx.fillStyle = capGrad;
      ctx.fill();

      const ew = 240;
      const eh = 160;
      ctx.drawImage(artwork, cx - ew / 2, cy - 80, ew, eh);
      ctx.restore();

      ctx.save();
      const brimGrad = ctx.createLinearGradient(cx - 360, cy + 80, cx + 360, cy + 200);
      brimGrad.addColorStop(0, '#111317');
      brimGrad.addColorStop(0.5, '#22262d');
      brimGrad.addColorStop(1, '#0e0f12');
      ctx.fillStyle = brimGrad;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 110, 360, 90, 0, 0, Math.PI);
      ctx.fill();
      ctx.restore();
      break;
    }

    case 'product-dropper-bottle': {
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#1e1c1b');
      bg.addColorStop(1, '#0d0c0b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2 + 30;
      const bw = 380;
      const bh = 680;
      const bx = cx - bw / 2;
      const by = cy - bh / 2;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      ctx.ellipse(cx, by + bh + 15, bw * 0.65, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, [18, 18, 28, 28]);
      ctx.clip();

      const amber = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      amber.addColorStop(0, '#241407');
      amber.addColorStop(0.25, '#784618');
      amber.addColorStop(0.65, '#4a2b0e');
      amber.addColorStop(1, '#180e05');
      ctx.fillStyle = amber;
      ctx.fillRect(bx, by, bw, bh);

      drawCylindricalArtwork(ctx, artwork, bx + 16, by + 120, bw - 32, bh - 240, 0.12);

      const glare = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      glare.addColorStop(0.15, 'rgba(255,255,255,0.35)');
      glare.addColorStop(0.22, 'rgba(255,255,255,0.02)');
      glare.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glare;
      ctx.fillRect(bx, by, bw, bh);
      ctx.restore();

      const collarW = 160;
      const collarH = 50;
      const collarY = by - collarH;
      const gold = ctx.createLinearGradient(cx - collarW / 2, 0, cx + collarW / 2, 0);
      gold.addColorStop(0, '#9e7527');
      gold.addColorStop(0.5, '#f5d882');
      gold.addColorStop(1, '#785514');
      ctx.fillStyle = gold;
      ctx.fillRect(cx - collarW / 2, collarY, collarW, collarH);

      const bulbW = 90;
      const bulbH = 100;
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.ellipse(cx, collarY - bulbH / 2, bulbW / 2, bulbH / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'product-cosmetic-jar': {
      const bg = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 650);
      bg.addColorStop(0, '#2d2e33');
      bg.addColorStop(1, '#141518');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2 + 50;
      const jw = 640;
      const jh = 380;
      const jx = cx - jw / 2;
      const jy = cy - jh / 2;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.ellipse(cx, jy + jh + 20, jw * 0.6, 32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(jx, jy, jw, jh, [12, 12, 36, 36]);
      ctx.clip();

      const frost = ctx.createLinearGradient(jx, 0, jx + jw, 0);
      frost.addColorStop(0, '#50535c');
      frost.addColorStop(0.3, '#9ca0ab');
      frost.addColorStop(0.7, '#6b6f7a');
      frost.addColorStop(1, '#3a3c42');
      ctx.fillStyle = frost;
      ctx.fillRect(jx, jy, jw, jh);

      drawCylindricalArtwork(ctx, artwork, jx + 24, jy + 30, jw - 48, jh - 60, 0.1);
      ctx.restore();

      const lidH = 80;
      const lidY = jy - lidH + 4;
      const lidGrad = ctx.createLinearGradient(jx, 0, jx + jw, 0);
      lidGrad.addColorStop(0, '#888b94');
      lidGrad.addColorStop(0.5, '#e4e7ee');
      lidGrad.addColorStop(1, '#666870');
      ctx.fillStyle = lidGrad;
      ctx.beginPath();
      ctx.roundRect(jx - 10, lidY, jw + 20, lidH, [18, 18, 4, 4]);
      ctx.fill();
      break;
    }

    case 'product-shampoo-pump': {
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#1c1f24');
      bg.addColorStop(1, '#0e1013');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2 + 50;
      const pw = 420;
      const ph = 740;
      const px = cx - pw / 2;
      const py = cy - ph / 2;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath();
      ctx.ellipse(cx, py + ph + 15, pw * 0.65, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, [24, 24, 28, 28]);
      ctx.clip();

      const plastic = ctx.createLinearGradient(px, 0, px + pw, 0);
      plastic.addColorStop(0, '#27292e');
      plastic.addColorStop(0.3, '#525761');
      plastic.addColorStop(0.7, '#34373d');
      plastic.addColorStop(1, '#1b1d21');
      ctx.fillStyle = plastic;
      ctx.fillRect(px, py, pw, ph);

      drawCylindricalArtwork(ctx, artwork, px + 12, py + 80, pw - 24, ph - 160, 0.12);
      ctx.restore();

      ctx.fillStyle = '#111';
      ctx.fillRect(cx - 30, py - 60, 60, 60);
      ctx.beginPath();
      ctx.roundRect(cx - 90, py - 90, 140, 36, [14, 14, 4, 4]);
      ctx.fill();
      break;
    }

    case 'packaging-box': {
      const bg = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 700);
      bg.addColorStop(0, '#2f3542');
      bg.addColorStop(1, '#1e222a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const boxW = 380;
      const boxH = 500;
      const boxD = 180;

      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.ellipse(cx + 40, cy + boxH / 2 + 60, boxW * 1.2, 50, -0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const fx = cx - boxW / 2;
      const fy = cy - boxH / 2 + 40;
      ctx.drawImage(artwork, fx, fy, boxW, boxH);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + boxD * 0.7, fy - boxD * 0.4);
      ctx.lineTo(fx + boxW + boxD * 0.7, fy - boxD * 0.4);
      ctx.lineTo(fx + boxW, fy);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.moveTo(fx + boxW, fy);
      ctx.lineTo(fx + boxW + boxD * 0.7, fy - boxD * 0.4);
      ctx.lineTo(fx + boxW + boxD * 0.7, fy + boxH - boxD * 0.4);
      ctx.lineTo(fx + boxW, fy + boxH);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'iphone-16-pro': {
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#1c1e24');
      bg.addColorStop(1, '#0c0d10');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const pw = 680;
      const ph = 1380;
      const px = (W - pw) / 2;
      const py = (H - ph) / 2;
      const radius = 96;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 90;
      ctx.shadowOffsetY = 45;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, radius);
      ctx.fill();
      ctx.restore();

      const titanium = ctx.createLinearGradient(px, py, px + pw, py + ph);
      titanium.addColorStop(0, '#595653');
      titanium.addColorStop(0.3, '#8e8a84');
      titanium.addColorStop(0.7, '#484542');
      titanium.addColorStop(1, '#696662');
      ctx.fillStyle = titanium;
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, radius);
      ctx.fill();

      const bezelW = 12;
      ctx.fillStyle = '#080808';
      ctx.beginPath();
      ctx.roundRect(px + bezelW, py + bezelW, pw - bezelW * 2, ph - bezelW * 2, radius - 8);
      ctx.fill();

      const sx = px + bezelW + 8;
      const sy = py + bezelW + 8;
      const sw = pw - (bezelW + 8) * 2;
      const sh = ph - (bezelW + 8) * 2;
      const sRadius = radius - 16;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(sx, sy, sw, sh, sRadius);
      ctx.clip();
      ctx.drawImage(artwork, sx, sy, sw, sh);

      const diW = 140;
      const diH = 36;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.roundRect(sx + (sw - diW) / 2, sy + 24, diW, diH, 18);
      ctx.fill();
      ctx.restore();
      break;
    }

    case 'macbook-pro': {
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#22232a');
      bg.addColorStop(1, '#0e0f14');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const lw = 1360;
      const lh = 860;
      const lx = (W - lw) / 2;
      const ly = (H - lh) / 2 - 30;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
      ctx.shadowBlur = 80;
      ctx.shadowOffsetY = 40;
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.roundRect(lx, ly, lw, lh, 28);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#2a2b2f';
      ctx.beginPath();
      ctx.roundRect(lx, ly, lw, lh, 28);
      ctx.fill();

      const sx = lx + 36;
      const sy = ly + 36;
      const sw = lw - 72;
      const sh = lh - 72;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(sx, sy, sw, sh, 8);
      ctx.clip();
      ctx.drawImage(artwork, sx, sy, sw, sh);

      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.roundRect(sx + (sw - 120) / 2, sy, 120, 24, [0, 0, 10, 10]);
      ctx.fill();
      ctx.restore();

      const bw = 1520;
      const bh = 34;
      const bx = (W - bw) / 2;
      const by = ly + lh - 4;
      ctx.fillStyle = '#3a3b40';
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, [4, 4, 18, 18]);
      ctx.fill();
      break;
    }

    case 'framed-canvas': {
      ctx.fillStyle = '#edece8';
      ctx.fillRect(0, 0, W, H);

      const fw = 960;
      const fh = 960;
      const fx = (W - fw) / 2;
      const fy = (H - fh) / 2;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 60;
      ctx.shadowOffsetY = 30;
      ctx.fillStyle = '#fff';
      ctx.fillRect(fx, fy, fw, fh);
      ctx.restore();

      const wood = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh);
      wood.addColorStop(0, '#2b1b11');
      wood.addColorStop(0.5, '#402a1b');
      wood.addColorStop(1, '#22150c');
      ctx.fillStyle = wood;
      ctx.fillRect(fx, fy, fw, fh);

      const border = 44;
      ctx.fillStyle = '#f8f8f6';
      ctx.fillRect(fx + border, fy + border, fw - border * 2, fh - border * 2);

      const matte = 80;
      const ax = fx + border + matte;
      const ay = fy + border + matte;
      const aw = fw - (border + matte) * 2;
      const ah = fh - (border + matte) * 2;

      ctx.drawImage(artwork, ax, ay, aw, ah);
      break;
    }

    case 'billboard': {
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#101726');
      sky.addColorStop(0.7, '#243b55');
      sky.addColorStop(1, '#141e30');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      const bw = 1500;
      const bh = 760;
      const bx = (W - bw) / 2;
      const by = 80;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 50;
      ctx.shadowOffsetY = 30;
      ctx.fillStyle = '#111';
      ctx.fillRect(bx, by, bw, bh);
      ctx.restore();

      ctx.fillStyle = '#22262c';
      ctx.fillRect(bx, by, bw, bh);

      const pad = 24;
      ctx.drawImage(artwork, bx + pad, by + pad, bw - pad * 2, bh - pad * 2);
      break;
    }
  }

  return out;
}
