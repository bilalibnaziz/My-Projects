import { TimelineClip, TimelineTrack, TransformProperties } from './types';
import { evaluateProperty } from './keyframeEngine';
import { applyVFXStack } from './vfxEngine';
import { clipMediaKind, containRect, imageFor, videoFrameFor } from './media';

// Main 60fps Multi-Track Compositor
export function renderCompositionFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  tracks: TimelineTrack[],
  clips: TimelineClip[],
  currentTime: number,
  selectedClipId: string | null,
  showGuides: boolean = true
) {
  // Clear canvas with deep dark cinema background
  ctx.save();
  ctx.fillStyle = '#0a0b10';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // Create an offscreen buffer canvas for adjustment layers and layer compositing
  const offCanvas = document.createElement('canvas');
  offCanvas.width = width;
  offCanvas.height = height;
  const offCtx = offCanvas.getContext('2d')!;

  // Tracks are listed top (V3) to bottom (V1); paint the bottom one first so upper tracks cover it
  const videoTracks = tracks.filter((t) => t.type === 'video').reverse();

  // Render each track
  for (const track of videoTracks) {
    if (!track.visible) continue;

    // Find clips on this track that are active at currentTime
    const activeClips = clips.filter((c) => {
      return (
        c.trackId === track.id &&
        currentTime >= c.startTime &&
        currentTime < c.startTime + c.duration
      );
    });

    for (const clip of activeClips) {
      const clipLocalTime = currentTime - clip.startTime + clip.offset;

      if (clip.type === 'adjustment') {
        // Adjustment layer: takes the accumulated canvas rendering so far, and applies this clip's VFX stack!
        applyVFXStack(ctx, width, height, clip.vfxStack, currentTime);
        continue;
      }

      renderSingleClip(ctx, width, height, clip, clipLocalTime, currentTime);
    }
  }

  // Draw Interactive Gizmo for Selected Clip (Bounding box, handles, rotate handle)
  if (selectedClipId && showGuides) {
    const selectedClip = clips.find((c) => c.id === selectedClipId);
    if (
      selectedClip &&
      currentTime >= selectedClip.startTime &&
      currentTime < selectedClip.startTime + selectedClip.duration
    ) {
      const clipLocalTime = currentTime - selectedClip.startTime + selectedClip.offset;
      const transform = getEvaluatedTransform(selectedClip, clipLocalTime);
      drawTransformGizmo(ctx, width, height, transform, selectedClip);
    }
  }

  // Draw Safe Margins & Center Crosshair if enabled
  if (showGuides) {
    drawSafeGuides(ctx, width, height);
  }
}

// Computes current transform values taking keyframes into account
export function getEvaluatedTransform(clip: TimelineClip, clipLocalTime: number): TransformProperties {
  const kf = clip.keyframes;
  const def = clip.transform;

  return {
    positionX: evaluateProperty(def.positionX, kf?.positionX, clipLocalTime),
    positionY: evaluateProperty(def.positionY, kf?.positionY, clipLocalTime),
    scaleX: evaluateProperty(def.scaleX, kf?.scaleX, clipLocalTime),
    scaleY: evaluateProperty(def.scaleY, kf?.scaleY, clipLocalTime),
    uniformScale: def.uniformScale,
    rotation: evaluateProperty(def.rotation, kf?.rotation, clipLocalTime),
    opacity: evaluateProperty(def.opacity, kf?.opacity, clipLocalTime),
    anchorX: evaluateProperty(def.anchorX, kf?.anchorX, clipLocalTime),
    anchorY: evaluateProperty(def.anchorY, kf?.anchorY, clipLocalTime),
  };
}

// Renders an individual clip with its transform, keyframes, transitions, and VFX
function renderSingleClip(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  clip: TimelineClip,
  clipLocalTime: number,
  globalTime: number
) {
  const transform = getEvaluatedTransform(clip, clipLocalTime);

  // Compute transition alpha and scale adjustments
  let transitionAlpha = 1.0;
  const progressFromStart = clipLocalTime - clip.offset;
  const remainingTime = clip.duration - progressFromStart;

  // In transition
  if (clip.transitionIn.type !== 'none' && progressFromStart < clip.transitionIn.duration) {
    const progress = progressFromStart / clip.transitionIn.duration;
    if (clip.transitionIn.type === 'cross-dissolve' || clip.transitionIn.type === 'dip-black') {
      transitionAlpha = progress;
    }
  }

  // Out transition
  if (clip.transitionOut.type !== 'none' && remainingTime < clip.transitionOut.duration) {
    const progress = remainingTime / clip.transitionOut.duration;
    if (clip.transitionOut.type === 'cross-dissolve' || clip.transitionOut.type === 'dip-black') {
      transitionAlpha = Math.min(transitionAlpha, progress);
    }
  }

  const finalAlpha = Math.max(0, Math.min(1, (transform.opacity / 100) * transitionAlpha));
  if (finalAlpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = finalAlpha;
  ctx.globalCompositeOperation = clip.blendMode || 'source-over';

  // Apply Transform Matrix (Translation, Rotation around Anchor Point, Scale)
  const posX = width / 2 + transform.positionX;
  const posY = height / 2 + transform.positionY;

  ctx.translate(posX, posY);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  const scaleX = transform.scaleX / 100;
  const scaleY = (transform.uniformScale ? transform.scaleX : transform.scaleY) / 100;
  ctx.scale(scaleX, scaleY);

  // Render clip content based on type
  switch (clip.type) {
    case 'video':
      renderVideoOrProcedural(ctx, width, height, clip, clipLocalTime, globalTime);
      break;
    case 'text':
      renderTextClip(ctx, clip, clipLocalTime);
      break;
    case 'shape':
      renderShapeClip(ctx, clip);
      break;
    case 'solid':
      renderSolidClip(ctx, width, height, clip);
      break;
    case 'particles':
      renderParticles(ctx, width, height, clip, globalTime);
      break;
    case 'visualizer':
      renderAudioVisualizer(ctx, clip, globalTime);
      break;
  }

  ctx.restore();

  // Apply clip-level VFX stack if any
  if (clip.vfxStack && clip.vfxStack.length > 0) {
    applyVFXStack(ctx, width, height, clip.vfxStack, globalTime);
  }
}

// Renders Video or Procedural Cyberpunk/Cinematic Footage
function renderVideoOrProcedural(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  clip: TimelineClip,
  clipLocalTime: number,
  globalTime: number
) {
  const kind = clipMediaKind(clip);
  if (kind === 'video' || kind === 'image') {
    // Real footage fills the frame at its own aspect ratio (letterboxed / pillarboxed)
    const src = kind === 'video' ? videoFrameFor(clip) : imageFor(clip.sourceUrl!);
    if (src) {
      const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
      const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
      const r = containRect(sw, sh, width, height);
      ctx.drawImage(src, r.x - width / 2, r.y - height / 2, r.w, r.h);
    }
    return;
  }

  const w = width * 0.9;
  const h = height * 0.9;
  const x = -w / 2;
  const y = -h / 2;

  // Procedural Cinematic Motion Footage (Cyberpunk city neon grid / retro synthwave / studio)
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(0.5, '#1e1b4b');
  grad.addColorStop(1, '#020617');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // Animated perspective cyber grid floor
  ctx.save();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
  ctx.lineWidth = 1.5;

  const horizonY = y + h * 0.6;
  const speed = (globalTime * 120) % 50;

  // Horizontal receding lines
  for (let ly = horizonY; ly < y + h; ly += (ly - horizonY) * 0.4 + 10) {
    const shiftedY = ly + (speed * (ly - horizonY)) / h;
    if (shiftedY < y + h) {
      ctx.beginPath();
      ctx.moveTo(x, shiftedY);
      ctx.lineTo(x + w, shiftedY);
      ctx.stroke();
    }
  }

  // Perspective vertical rays converging to vanishing point
  const vpX = x + w / 2;
  for (let px = x - w; px < x + w * 2; px += 80) {
    ctx.beginPath();
    ctx.moveTo(vpX, horizonY);
    ctx.lineTo(px, y + h);
    ctx.stroke();
  }

  // Glowing neon sun / orb on horizon
  const sunGrad = ctx.createRadialGradient(vpX, horizonY - 40, 10, vpX, horizonY - 40, 140);
  sunGrad.addColorStop(0, '#f43f5e');
  sunGrad.addColorStop(0.5, '#e11d48');
  sunGrad.addColorStop(1, 'rgba(225, 29, 72, 0)');
  ctx.fillStyle = sunGrad;
  ctx.beginPath();
  ctx.arc(vpX, horizonY - 40, 140, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// Kinetic Animated Text
function renderTextClip(
  ctx: CanvasRenderingContext2D,
  clip: TimelineClip,
  clipLocalTime: number
) {
  const data = clip.textData;
  if (!data) return;

  let text = data.text;
  const anim = data.animation;

  // Typewriter effect
  if (anim === 'typewriter') {
    const charsPerSec = 16;
    const count = Math.min(text.length, Math.floor(clipLocalTime * charsPerSec));
    text = text.substring(0, count);
  }

  ctx.font = `${data.fontWeight} ${data.fontSize}px ${data.fontFamily}, sans-serif`;
  ctx.textAlign = data.align || 'center';
  ctx.textBaseline = 'middle';

  // 3D Extrude drop shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillText(text, 4, 4);

  // Stroke
  if (data.strokeWidth > 0) {
    ctx.strokeStyle = data.strokeColor;
    ctx.lineWidth = data.strokeWidth;
    ctx.strokeText(text, 0, 0);
  }

  // Fill
  ctx.fillStyle = data.color;
  ctx.fillText(text, 0, 0);
}

// Vector Shapes & Lower Thirds
function renderShapeClip(ctx: CanvasRenderingContext2D, clip: TimelineClip) {
  const data = clip.shapeData;
  if (!data) return;

  const w = 480;
  const h = 160;
  const x = -w / 2;
  const y = -h / 2;

  ctx.fillStyle = data.fill;
  ctx.strokeStyle = data.stroke;
  ctx.lineWidth = data.strokeWidth;

  if (data.shapeType === 'circle') {
    ctx.beginPath();
    ctx.arc(0, 0, w / 4, 0, Math.PI * 2);
    ctx.fill();
    if (data.strokeWidth > 0) ctx.stroke();
  } else if (data.shapeType === 'lower-third') {
    // Glassmorphism lower third badge
    const rad = data.cornerRadius || 12;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 80, rad);
    ctx.fill();
    if (data.strokeWidth > 0) ctx.stroke();

    if (data.label) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 24px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(data.label, x + 24, y + 42);
    }
  } else {
    // Rounded rectangle
    const rad = data.cornerRadius || 12;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rad);
    ctx.fill();
    if (data.strokeWidth > 0) ctx.stroke();
  }
}

// Solid Color or Gradient
function renderSolidClip(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  clip: TimelineClip
) {
  const data = clip.solidData;
  const w = width * 1.2;
  const h = height * 1.2;
  const x = -w / 2;
  const y = -h / 2;

  if (data?.gradient) {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    data.gradient.stops.forEach(([stop, col]) => grad.addColorStop(stop, col));
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = data?.color || '#000000';
  }

  ctx.fillRect(x, y, w, h);
}

// Procedural Particle System (Embers, Sparks, Stars, Digital Rain)
function renderParticles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  clip: TimelineClip,
  globalTime: number
) {
  const data = clip.particleData;
  const count = data?.count || 80;
  const color = data?.color || '#38bdf8';
  const preset = data?.preset || 'sparks';

  ctx.save();
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random based on index and time
    const seed = i * 137.5;
    const speed = (data?.speed || 1.2) * 60;
    const px = (((Math.sin(seed) * 50000 + globalTime * speed * (0.5 + (i % 5) * 0.2)) % width) + width) % width - width / 2;
    const py = (((Math.cos(seed) * 50000 - globalTime * speed * (0.8 + (i % 3) * 0.3)) % height) + height) % height - height / 2;
    const size = 2 + (i % 4) * 2;

    if (preset === 'stars') {
      const alpha = 0.4 + 0.6 * Math.sin(globalTime * 3 + i);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, size * 0.8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Live Audio Reactive Spectrum / Oscilloscope
function renderAudioVisualizer(
  ctx: CanvasRenderingContext2D,
  clip: TimelineClip,
  globalTime: number
) {
  const data = clip.visualizerData;
  const bars = data?.barCount || 48;
  const totalW = 600;
  const barW = totalW / bars - 4;
  const startX = -totalW / 2;

  ctx.save();
  for (let i = 0; i < bars; i++) {
    // Simulated frequency heights reacting dynamically to time
    const freq = Math.sin(globalTime * 8 + i * 0.4) * 0.5 + 0.5;
    const subFreq = Math.cos(globalTime * 14 + i * 0.7) * 0.3;
    const h = Math.max(8, (freq + subFreq) * 140);

    const bx = startX + i * (barW + 4);
    const by = -h / 2;

    const grad = ctx.createLinearGradient(bx, by, bx, by + h);
    grad.addColorStop(0, data?.color1 || '#38bdf8');
    grad.addColorStop(1, data?.color2 || '#a855f7');

    ctx.fillStyle = grad;
    ctx.shadowColor = data?.color1 || '#38bdf8';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(bx, by, barW, h, 4);
    ctx.fill();
  }
  ctx.restore();
}

// Interactive Transform Gizmo overlay
// Untransformed size of a clip's content, used for its on-canvas bounding box
function contentBox(clip: TimelineClip, width: number, height: number): { w: number; h: number } {
  const kind = clipMediaKind(clip);
  if (kind === 'video' || kind === 'image') {
    const sw = clip.mediaWidth || width;
    const sh = clip.mediaHeight || height;
    const r = containRect(sw, sh, width, height);
    return { w: r.w, h: r.h };
  }
  if (clip.type === 'video') return { w: width * 0.9, h: height * 0.9 };
  return { w: 400, h: 240 };
}

function drawTransformGizmo(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  transform: TransformProperties,
  clip: TimelineClip
) {
  const posX = width / 2 + transform.positionX;
  const posY = height / 2 + transform.positionY;
  const scaleX = transform.scaleX / 100;
  const scaleY = (transform.uniformScale ? transform.scaleX : transform.scaleY) / 100;

  ctx.save();
  ctx.translate(posX, posY);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(scaleX, scaleY);

  const box = contentBox(clip, width, height);
  const boxW = box.w;
  const boxH = box.h;
  const bx = -boxW / 2;
  const by = -boxH / 2;

  // Glowing Cyan Bounding Box
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2 / Math.max(scaleX, 0.1);
  ctx.strokeRect(bx, by, boxW, boxH);

  // 8 Corner & Edge Handles
  const handles = [
    [bx, by],
    [bx + boxW / 2, by],
    [bx + boxW, by],
    [bx + boxW, by + boxH / 2],
    [bx + boxW, by + boxH],
    [bx + boxW / 2, by + boxH],
    [bx, by + boxH],
    [bx, by + boxH / 2],
  ];

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0284c7';
  const handleSize = 8 / Math.max(scaleX, 0.1);

  handles.forEach(([hx, hy]) => {
    ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
  });

  // Rotation Handle (top stalk with circle)
  const stalkH = 32 / Math.max(scaleX, 0.1);
  ctx.beginPath();
  ctx.moveTo(0, by);
  ctx.lineTo(0, by - stalkH);
  ctx.strokeStyle = '#38bdf8';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, by - stalkH, 6 / Math.max(scaleX, 0.1), 0, Math.PI * 2);
  ctx.fillStyle = '#38bdf8';
  ctx.fill();

  // Center Anchor Point Crosshair
  ctx.beginPath();
  ctx.arc(0, 0, 5 / Math.max(scaleX, 0.1), 0, Math.PI * 2);
  ctx.fillStyle = '#f43f5e';
  ctx.fill();

  ctx.restore();
}

// Action Safe & Title Safe Margins
function drawSafeGuides(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.lineWidth = 1;

  // Action Safe (90%)
  const asW = width * 0.9;
  const asH = height * 0.9;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.strokeRect((width - asW) / 2, (height - asH) / 2, asW, asH);

  // Title Safe (80%)
  const tsW = width * 0.8;
  const tsH = height * 0.8;
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
  ctx.strokeRect((width - tsW) / 2, (height - tsH) / 2, tsW, tsH);

  // Center subtle crosshair
  const cx = width / 2;
  const cy = height / 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy);
  ctx.lineTo(cx + 12, cy);
  ctx.moveTo(cx, cy - 12);
  ctx.lineTo(cx, cy + 12);
  ctx.stroke();

  ctx.restore();
}
