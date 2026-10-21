import { useEffect, useRef, useState } from 'react';
import { uiZoom } from './theme';
import type { Doc, Selection } from '../core/types';
import { store, useStore } from '../core/store';
import { ctx2d } from '../core/canvas';
import { outlinePath } from '../core/selection';
import { shapePath, fontString } from '../core/render';
import { styleAt } from '../core/text';
import { meshPoint } from '../core/transform';
import { POST_DRAG_TYPE, dropPostItem } from './SocialPanel';
import { shapeWidgets } from '../core/shapeWidgets';
import { frameCorners, frameHandles, frameVisible, layerFrame, selectionFrame, transformTargets } from '../core/objectTransform';
import type { Frame } from '../core/objectTransform';
import { currentWorkspace, getLayout } from './layout';
import type { GuideKind, Layout } from './layout';
import { proofImage } from '../core/color';
import * as tools from '../core/tools';
import { shapeDraftRect } from '../core/tools';
import { SAFE_ZONES } from '../core/social';
import * as pro from '../core/proTools';
import * as ops from '../core/ops';
import { view } from '../core/commands';
import { drawDocGrid, drawLayoutGrids } from './gridDraw';
import { gridPages } from '../core/gridOps';

const RULER = 20;
const isMacPlatform = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// Cursor readout for the status bar, kept out of React state for speed
type CursorInfo = { x: number; y: number; color: string | null } | null;
const cursorListeners = new Set<(c: CursorInfo) => void>();
export function onCursor(fn: (c: CursorInfo) => void) {
  cursorListeners.add(fn);
  return () => {
    cursorListeners.delete(fn);
  };
}

const antsCache = new WeakMap<Selection, Path2D>();
function antsPath(s: Selection) {
  let p = antsCache.get(s);
  if (!p) {
    p = outlinePath(s);
    antsCache.set(s, p);
  }
  return p;
}

let checker: CanvasPattern | null = null;
function checkerPattern(ctx: CanvasRenderingContext2D) {
  if (checker) return checker;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = ctx2d(c);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#d9d9de';
  g.fillRect(0, 0, 8, 8);
  g.fillRect(8, 8, 8, 8);
  checker = ctx.createPattern(c, 'repeat');
  return checker;
}

/** The document point under a screen position, or null when it isn't over the canvas. */
export function clientToDoc(clientX: number, clientY: number): { x: number; y: number } | null {
  const c = document.querySelector<HTMLCanvasElement>('.viewport-canvas');
  const d = store.doc;
  if (!c || !d) return null;
  const r = c.getBoundingClientRect();
  if (clientX < r.left || clientY < r.top || clientX > r.right || clientY > r.bottom) return null;
  const k = uiZoom();
  return { x: ((clientX - r.left) / k - d.view.panX) / d.view.zoom, y: ((clientY - r.top) / k - d.view.panY) / d.view.zoom };
}

export function Viewport() {
  const s = useStore();
  const doc = store.doc;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const spaceDown = useRef(false);
  const panning = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [cursor, setCursor] = useState('default');
  const antsOffset = useRef(0);

  // ------------------------------------------------------------ view math
  // The view each document had right after fitting: while it is unchanged (no zoom or pan since),
  // the document keeps fitting the viewport as panels open/close or the window resizes
  const fitSnap = useRef(new WeakMap<Doc, string>());
  const viewKey = (d: Doc) => `${d.view.zoom}:${d.view.panX}:${d.view.panY}`;

  const fitDoc = (d: Doc) => {
    const { w, h } = sizeRef.current;
    const pad = 48;
    const availW = w - pad * 2 - (store.state.showRulers ? RULER : 0);
    const availH = h - pad * 2 - (store.state.showRulers ? RULER : 0);
    const zoom = Math.min(availW / d.width, availH / d.height, 4);
    d.view.zoom = Math.max(0.01, zoom);
    d.view.panX = Math.round((w - d.width * d.view.zoom) / 2 + (store.state.showRulers ? RULER / 2 : 0));
    d.view.panY = Math.round((h - d.height * d.view.zoom) / 2 + (store.state.showRulers ? RULER / 2 : 0));
    d.view.fitted = true;
    fitSnap.current.set(d, viewKey(d));
  };

  const zoomAt = (d: Doc, factor: number, sx: number, sy: number) => {
    const v = d.view;
    const z = Math.max(0.01, Math.min(64, v.zoom * factor));
    v.panX = sx - ((sx - v.panX) * z) / v.zoom;
    v.panY = sy - ((sy - v.panY) * z) / v.zoom;
    v.zoom = z;
    // Only the canvas repaints during a pinch / wheel gesture; readouts follow once it pauses
    store.requestRender();
    clearTimeout(zoomEmit.current);
    zoomEmit.current = window.setTimeout(() => store.emit(), 120);
  };
  const zoomEmit = useRef(0);

  useEffect(() => {
    view.fit = () => {
      const d = store.doc;
      if (d) {
        fitDoc(d);
        store.emit();
      }
    };
    view.actual = () => {
      const d = store.doc;
      if (d) zoomAt(d, 1 / d.view.zoom, sizeRef.current.w / 2, sizeRef.current.h / 2);
    };
    view.zoomBy = (f) => {
      const d = store.doc;
      if (d) zoomAt(d, f, sizeRef.current.w / 2, sizeRef.current.h / 2);
    };
    view.fitRect = (r) => {
      const d = store.doc;
      if (!d || r.width <= 0 || r.height <= 0) return;
      const { w, h } = sizeRef.current;
      const ruler = store.state.showRulers ? RULER : 0;
      const pad = 48;
      const zoom = Math.max(0.01, Math.min(32, (w - ruler - pad * 2) / r.width, (h - ruler - pad * 2) / r.height));
      d.view.zoom = zoom;
      d.view.panX = Math.round(ruler + (w - ruler) / 2 - (r.x + r.width / 2) * zoom);
      d.view.panY = Math.round(ruler + (h - ruler) / 2 - (r.y + r.height / 2) * zoom);
      store.emit();
    };
  }, []);

  // ------------------------------------------------------------ sizing
  useEffect(() => {
    const d = store.doc;
    if (d?.view.fitted && fitSnap.current.get(d) === viewKey(d)) {
      fitDoc(d);
      store.emit();
    }
  }, [size.w, size.h, s.showRulers]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // CSS pixels of the element itself (unaffected by an interface zoom)
      setSize({ w: Math.max(1, Math.floor(el.clientWidth)), h: Math.max(1, Math.floor(el.clientHeight)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ------------------------------------------------------------ drawing
  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Backing pixels follow the screen, including the interface zoom, so the canvas stays sharp
    const dpr = (window.devicePixelRatio || 1) * uiZoom();
    const { w, h } = sizeRef.current;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = ctx2d(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--canvas-bg').trim() || '#1c1c21';
    ctx.fillRect(0, 0, w, h);
    const d = store.doc;
    if (!d) return;
    if (!d.view.fitted) {
      fitDoc(d);
      queueMicrotask(() => store.emit()); // zoom readouts (tab, status bar) show the fitted zoom
    }
    const { zoom, panX, panY } = d.view;
    const st = store.state;
    const dw = d.width * zoom;
    const dh = d.height * zoom;

    // Drop shadow + transparency checkerboard
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = checkerPattern(ctx) ?? '#fff';
    ctx.translate(panX, panY);
    ctx.fillRect(0, 0, dw, dh);
    ctx.restore();

    const renderDoc = st.compare ? { ...d, layers: d.layers.filter((l) => l.kind !== 'adjustment') } : d;
    // Type and shape layers are vectors: zoomed in, the visible part is rendered at the zoom so
    // they stay sharp (pixel layers still show their pixels from 200%, like before)
    const s = zoom * dpr;
    const X0 = Math.max(0, Math.floor(panX * dpr));
    const Y0 = Math.max(0, Math.floor(panY * dpr));
    const X1 = Math.min(canvas.width, Math.ceil((panX + dw) * dpr));
    const Y1 = Math.min(canvas.height, Math.ceil((panY + dh) * dpr));
    if (s > 1.001 && X1 > X0 && Y1 > Y0 && renderDoc.layers.some((l) => l.visible && (l.kind === 'text' || l.kind === 'shape'))) {
      const view = { s, ox: X0 - panX * dpr, oy: Y0 - panY * dpr, w: X1 - X0, h: Y1 - Y0, nearestFrom: 2 * dpr };
      let out = store.viewRenderer.render(renderDoc, store.overrides, view);
      if (st.proof !== 'off') out = proofed(out, store.viewRenderer.signature, st.proof);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(out, X0, Y0);
      ctx.restore();
    } else {
      let out = store.renderer.render(renderDoc, store.overrides);
      if (st.proof !== 'off') out = proofed(out, store.renderer.signature, st.proof);
      ctx.save();
      ctx.imageSmoothingEnabled = zoom < 2;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(out, panX, panY, dw, dh);
      ctx.restore();
    }

    // Pixel grid at high zoom
    if (st.showPixelGrid && zoom >= 10) {
      ctx.save();
      ctx.beginPath();
      const x0 = Math.max(0, Math.floor(-panX / zoom));
      const x1 = Math.min(d.width, Math.ceil((w - panX) / zoom));
      const y0 = Math.max(0, Math.floor(-panY / zoom));
      const y1 = Math.min(d.height, Math.ceil((h - panY) / zoom));
      for (let x = x0; x <= x1; x++) {
        ctx.moveTo(Math.round(panX + x * zoom) + 0.5, panY + y0 * zoom);
        ctx.lineTo(Math.round(panX + x * zoom) + 0.5, panY + y1 * zoom);
      }
      for (let y = y0; y <= y1; y++) {
        ctx.moveTo(panX + x0 * zoom, Math.round(panY + y * zoom) + 0.5);
        ctx.lineTo(panX + x1 * zoom, Math.round(panY + y * zoom) + 0.5);
      }
      ctx.strokeStyle = 'rgba(128,128,128,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    // Document grid over the canvas: adaptive levels keep it useful at any zoom
    if (st.showGrid) drawDocGrid(ctx, st.docGrid, { zoom, panX, panY, w, h }, { x: 0, y: 0, w: d.width, h: d.height });

    // Platform safe zones (social presets) — guidance only, never exported
    const zone = d.safeZone && st.showSafeZones && !st.crop ? SAFE_ZONES[d.safeZone] : null;
    if (zone) drawSafeZone(ctx, zone, panX, panY, dw, dh);

    // Workspace guides (print bleed / video safe areas / web columns / thirds) — never exported
    const lay = getLayout();
    const ws = currentWorkspace();
    if (lay.guides && ws.guides.length && !st.crop) drawWorkspaceGuides(ctx, ws.guides, { x: panX, y: panY, w: dw, h: dh }, lay, zoom);

    // Layout grids (columns, safe areas, panels …) — guidance only, never exported
    if (st.docGrid.showLayout && !st.crop) drawLayoutGrids(ctx, gridPages(d), { zoom, panX, panY, w, h });

    // Doc-space overlays
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    const px = 1 / zoom;

    // Marching ants / Quick Mask
    if (d.selection && !st.transform) {
      if (st.quickMask) {
        ctx.save();
        // Draw ruby rubylith mask over unselected region
        ctx.fillStyle = 'rgba(225, 29, 72, 0.45)';
        ctx.fillRect(0, 0, d.width, d.height);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(d.selection.canvas, 0, 0);
        ctx.restore();
      } else {
        const path = antsPath(d.selection);
        ctx.lineWidth = px;
        ctx.strokeStyle = '#000';
        ctx.setLineDash([]);
        ctx.stroke(path);
        ctx.strokeStyle = '#fff';
        ctx.setLineDash([4 * px, 4 * px]);
        ctx.lineDashOffset = -antsOffset.current * px;
        ctx.stroke(path);
        ctx.setLineDash([]);
      }
    }

    const it = tools.interaction;
    const dashed = (fn: () => void) => {
      ctx.lineWidth = px;
      ctx.strokeStyle = '#000';
      ctx.setLineDash([]);
      fn();
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.setLineDash([4 * px, 4 * px]);
      fn();
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (it.marquee) {
      const r = it.marquee.rect;
      dashed(() => {
        ctx.beginPath();
        if (it.marquee!.ellipse) ctx.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
        else ctx.rect(r.x, r.y, r.width, r.height);
      });
    }
    if (it.lasso && it.lasso.points.length) {
      const pts = it.lasso.points;
      dashed(() => {
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (it.lasso!.poly && it.lasso!.cursor) ctx.lineTo(it.lasso!.cursor.x, it.lasso!.cursor.y);
      });
      if (it.lasso.poly) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(pts[0].x - 3 * px, pts[0].y - 3 * px, 6 * px, 6 * px);
      }
    }
    if (it.gradient) {
      const { a, b } = it.gradient;
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.lineWidth = px;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      for (const p of [a, b]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 * px, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.stroke();
      }
    }
    if (it.shapeDraft) {
      const r = shapeDraftRect(it.shapeDraft);
      const o = st.opts;
      const isLine = o.shapeType === 'line' || o.shapeType === 'arrow';
      const x = isLine ? r.x : Math.min(r.x, r.x + r.w);
      const y = isLine ? r.y : Math.min(r.y, r.y + r.h);
      const sw = isLine ? r.w : Math.abs(r.w);
      const sh = isLine ? r.h : Math.abs(r.h);
      shapePath(ctx, { shape: o.shapeType, fill: st.fg, fillEnabled: o.shapeFill, stroke: st.fg, strokeWidth: 1, radius: o.shapeRadius, sides: o.shapeSides }, x, y, sw, sh);
      if (o.shapeFill && !isLine) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = st.fg;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = isLine ? Math.max(2, o.shapeStrokeWidth || 6) : px * 1.5;
      ctx.strokeStyle = isLine ? st.fg : 'rgba(0, 170, 255, 0.95)';
      ctx.stroke();
    }

    // Type tool: paragraph box being dragged out
    if (it.textBox) {
      const { a, b } = it.textBox;
      dashed(() => {
        ctx.beginPath();
        ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      });
    }

    // Red eye search box
    if (it.redEyeBox) {
      const r = it.redEyeBox;
      dashed(() => {
        ctx.beginPath();
        ctx.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
      });
    }

    // Pen path: segments, rubber band to the cursor, anchors and the handles being shaped
    const penPath = pro.pen.path;
    if (penPath && penPath.docId === d.id && penPath.anchors.length) {
      const accent = getComputedStyle(canvasRef.current!).getPropertyValue('--accent').trim() || '#0078d4';
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = accent;
      ctx.stroke(pro.anchorsPath(penPath.anchors, penPath.closed));
      const last = penPath.anchors[penPath.anchors.length - 1];
      if (penPath.cursor && !penPath.closed && penPath.drag === null) {
        ctx.setLineDash([4 * px, 3 * px]);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.bezierCurveTo(last.ox, last.oy, penPath.cursor.x, penPath.cursor.y, penPath.cursor.x, penPath.cursor.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const shaping = penPath.drag !== null ? penPath.anchors[penPath.drag] : last;
      ctx.lineWidth = px;
      ctx.beginPath();
      ctx.moveTo(shaping.ix, shaping.iy);
      ctx.lineTo(shaping.ox, shaping.oy);
      ctx.stroke();
      for (const hp of [[shaping.ix, shaping.iy], [shaping.ox, shaping.oy]]) {
        ctx.beginPath();
        ctx.arc(hp[0], hp[1], 3 * px, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
      }
      penPath.anchors.forEach((a, i) => {
        const sz = (i === 0 ? 8 : 6) * px;
        ctx.fillStyle = i === penPath.anchors.length - 1 ? accent : '#fff';
        ctx.fillRect(a.x - sz / 2, a.y - sz / 2, sz, sz);
        ctx.strokeStyle = accent;
        ctx.strokeRect(a.x - sz / 2, a.y - sz / 2, sz, sz);
      });
    }

    // Ruler: the measured line with its end crosses
    const rl = pro.ruler.line;
    if (rl && st.tool === 'ruler') {
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.moveTo(rl.a.x, rl.a.y);
      ctx.lineTo(rl.b.x, rl.b.y);
      ctx.stroke();
      ctx.lineWidth = px;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      for (const e of [rl.a, rl.b]) {
        ctx.beginPath();
        ctx.moveTo(e.x - 6 * px, e.y);
        ctx.lineTo(e.x + 6 * px, e.y);
        ctx.moveTo(e.x, e.y - 6 * px);
        ctx.lineTo(e.x, e.y + 6 * px);
        ctx.stroke();
      }
    }

    // Color samplers: numbered crosshairs on the sampled pixel centres
    if (d.samplers?.length && (st.tool === 'color-sampler' || st.tool === 'eyedropper' || st.tool === 'ruler')) {
      ctx.font = `600 ${10 * px}px Inter, system-ui, sans-serif`;
      d.samplers.forEach((sp, i) => {
        const cx = sp.x + 0.5;
        const cy = sp.y + 0.5;
        ctx.lineWidth = 2.5 * px;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.beginPath();
        ctx.arc(cx, cy, 5 * px, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1.2 * px;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - 9 * px, cy);
        ctx.lineTo(cx - 5 * px, cy);
        ctx.moveTo(cx + 5 * px, cy);
        ctx.lineTo(cx + 9 * px, cy);
        ctx.moveTo(cx, cy - 9 * px);
        ctx.lineTo(cx, cy - 5 * px);
        ctx.moveTo(cx, cy + 5 * px);
        ctx.lineTo(cx, cy + 9 * px);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 3 * px;
        ctx.strokeText(String(i + 1), cx + 7 * px, cy - 7 * px);
        ctx.fillText(String(i + 1), cx + 7 * px, cy - 7 * px);
      });
    }

    // Crop overlay
    if (st.crop) {
      const r = st.crop.rect;
      ctx.save();
      ctx.fillStyle = 'rgba(10,10,14,0.62)';
      ctx.beginPath();
      ctx.rect(-1e5, -1e5, 2e5, 2e5);
      ctx.rect(r.x, r.y, r.width, r.height);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = px;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(r.x + (r.width * i) / 3, r.y);
        ctx.lineTo(r.x + (r.width * i) / 3, r.y + r.height);
        ctx.moveTo(r.x, r.y + (r.height * i) / 3);
        ctx.lineTo(r.x + r.width, r.y + (r.height * i) / 3);
      }
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      drawHandles(ctx, [
        [r.x, r.y], [r.x + r.width / 2, r.y], [r.x + r.width, r.y], [r.x + r.width, r.y + r.height / 2],
        [r.x + r.width, r.y + r.height], [r.x + r.width / 2, r.y + r.height], [r.x, r.y + r.height], [r.x, r.y + r.height / 2],
      ], px);
      ctx.restore();
    }

    // Free transform box
    if (st.transform?.mesh) {
      // Warp: the bent outline, the inner grid lines, and the 16 control points
      const m = st.transform.mesh;
      ctx.lineWidth = 1 * px;
      ctx.strokeStyle = 'rgba(47,155,255,0.75)';
      for (let k = 0; k <= 3; k++) {
        for (const dir of [0, 1]) {
          ctx.beginPath();
          for (let s2 = 0; s2 <= 24; s2++) {
            const p = dir ? meshPoint(m, k / 3, s2 / 24) : meshPoint(m, s2 / 24, k / 3);
            if (s2) ctx.lineTo(p.x, p.y);
            else ctx.moveTo(p.x, p.y);
          }
          ctx.stroke();
        }
      }
      ctx.setLineDash([3 * px, 3 * px]);
      ctx.strokeStyle = 'rgba(47,155,255,0.45)';
      for (let j = 0; j < 4; j++) {
        ctx.beginPath();
        for (let i = 0; i < 4; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, m[j * 4 + i].x, m[j * 4 + i].y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      drawHandles(ctx, m.map((p) => [p.x, p.y] as [number, number]), px);
    } else if (st.transform) {
      const c = ops.transformCorners(st.transform);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = '#2f9bff';
      ctx.beginPath();
      c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      const mids = c.map((p, i) => [(p.x + c[(i + 1) % 4].x) / 2, (p.y + c[(i + 1) % 4].y) / 2] as [number, number]);
      drawHandles(ctx, [...c.map((p) => [p.x, p.y] as [number, number]), ...mids], px);
    }

    // Selection tool: hover outline, the selection's bounding box with handles, marquee
    if (st.tool === 'move' && !st.transform && !st.crop) {
      const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#2f9bff';
      const outline = (f: Frame, width: number) => {
        const c = frameCorners(f);
        ctx.lineWidth = width * px;
        ctx.beginPath();
        c.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        ctx.stroke();
      };
      ctx.strokeStyle = accent;
      const picked = store.selectedLayers;
      const pickedIds = new Set(picked.map((l) => l.id));
      if (it.hoverId && (!pickedIds.has(it.hoverId) || !frameVisible())) {
        const hl = d.layers.find((l) => l.id === it.hoverId);
        const targets = hl ? transformTargets([hl]) : [];
        for (const t of targets) {
          const f = layerFrame(t);
          if (f) outline(f, 1.5);
        }
      }
      const frame = frameVisible() ? selectionFrame(picked) : null;
      if (frame) {
        // Several objects: a thin outline on each, one box around all
        const targets = transformTargets(picked);
        if (targets.length > 1) {
          ctx.globalAlpha = 0.6;
          for (const t of targets) {
            const f = layerFrame(t);
            if (f) outline(f, 1);
          }
          ctx.globalAlpha = 1;
        }
        outline(frame, 1);
        if (st.opts.transformControls) {
          const small = Math.min(frame.w, frame.h) * zoom < 24;
          const hs = frameHandles(frame).filter((h) => !small || h.id.length === 2);
          const size = 7 * px;
          ctx.lineWidth = px;
          for (const h of hs) {
            ctx.save();
            ctx.translate(h.x, h.y);
            ctx.rotate(frame.angle);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-size / 2, -size / 2, size, size);
            ctx.strokeRect(-size / 2, -size / 2, size, size);
            ctx.restore();
          }
        }
      }
      if (it.objectMarquee) {
        const m = it.objectMarquee;
        ctx.fillStyle = 'rgba(128,128,128,0.08)';
        ctx.fillRect(m.x, m.y, m.width, m.height);
        ctx.lineWidth = px;
        ctx.setLineDash([4 * px, 3 * px]);
        ctx.strokeRect(m.x, m.y, m.width, m.height);
        ctx.setLineDash([]);
      }
    }

    // Live shape widgets: corner radius dots, polygon sides, star inner radius, pie and hole handles
    const wl = tools.widgetLayer();
    if (wl) {
      const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#2f9bff';
      const ws = shapeWidgets(wl, zoom);
      if (st.tool !== 'move' && ws.length) {
        // Shape tools: outline the shape being edited so its widgets read as belonging to it
        const f = layerFrame(wl);
        if (f) {
          const c = frameCorners(f);
          ctx.strokeStyle = accent;
          ctx.lineWidth = px;
          ctx.setLineDash([4 * px, 3 * px]);
          ctx.beginPath();
          c.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      const hov = it.pointer ? tools.widgetHover(it.pointer, zoom) : null;
      for (const w of ws) {
        const on = !!hov && hov.kind === w.kind && hov.index === w.index && hov.ring === w.ring;
        const r = (on ? 6.5 : 5) * px;
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = w.atMax ? '#f85149' : accent;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        if (w.kind === 'sides') {
          ctx.moveTo(w.x, w.y - r * 1.3);
          ctx.lineTo(w.x + r * 1.3, w.y);
          ctx.lineTo(w.x, w.y + r * 1.3);
          ctx.lineTo(w.x - r * 1.3, w.y);
          ctx.closePath();
        } else ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Corner / rounding widgets get Illustrator's inner dot; the others are filled
        ctx.fillStyle = w.atMax ? '#f85149' : accent;
        ctx.beginPath();
        ctx.arc(w.x, w.y, (w.kind === 'corner' || w.kind === 'point-round' ? 1.6 : 2.6) * px, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Clone source marker
    if (st.tool === 'clone' && st.cloneSource && st.cloneSource.docId === d.id) {
      const cs = st.cloneSource;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.moveTo(cs.x - 8 * px, cs.y);
      ctx.lineTo(cs.x + 8 * px, cs.y);
      ctx.moveTo(cs.x, cs.y - 8 * px);
      ctx.lineTo(cs.x, cs.y + 8 * px);
      ctx.stroke();
    }

    // Smart guides while snapping a move
    if (it.guides) {
      ctx.lineWidth = px;
      ctx.strokeStyle = '#ff2fd6';
      ctx.beginPath();
      if (it.guides.x !== null) {
        ctx.moveTo(it.guides.x, -1e4);
        ctx.lineTo(it.guides.x, 1e4);
      }
      if (it.guides.y !== null) {
        ctx.moveTo(-1e4, it.guides.y);
        ctx.lineTo(1e4, it.guides.y);
      }
      ctx.stroke();
    }

    // Stabilizer string from the paint point to the pointer
    if (it.stringAnchor && it.pointer) {
      ctx.lineWidth = px;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.setLineDash([3 * px, 3 * px]);
      ctx.beginPath();
      ctx.moveTo(it.stringAnchor.x, it.stringAnchor.y);
      ctx.lineTo(it.pointer.x, it.pointer.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(it.stringAnchor.x, it.stringAnchor.y, 2 * px, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }

    // Brush cursor
    const p = it.pointer;
    if (p && (tools.isBrushTool(st.tool) || st.tool === 'quick-select') && !panning.current && !spaceDown.current) {
      const r = Math.max(0.5, st.opts.size / 2);
      ctx.lineWidth = px;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, r - px), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      if (st.opts.hardness < 0.95 && r * zoom > 8) {
        ctx.setLineDash([2 * px, 3 * px]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * Math.max(0.05, st.opts.hardness), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (r * zoom < 6) {
        ctx.beginPath();
        ctx.moveTo(p.x - 6 * px, p.y);
        ctx.lineTo(p.x + 6 * px, p.y);
        ctx.moveTo(p.x, p.y - 6 * px);
        ctx.lineTo(p.x, p.y + 6 * px);
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
    }
    ctx.restore();

    // Live size / angle / offset next to the pointer while dragging
    if (it.readout) {
      const rx = panX + it.readout.x * zoom + 14;
      const ry = panY + it.readout.y * zoom + 18;
      ctx.save();
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      const tw = ctx.measureText(it.readout.text).width;
      ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#2f9bff';
      ctx.beginPath();
      ctx.roundRect(rx, ry, tw + 12, 20, 4);
      ctx.fill();
      ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--on-accent').trim() || '#fff';
      ctx.fillText(it.readout.text, rx + 6, ry + 14);
      ctx.restore();
    }

    if (st.showRulers) drawRulers(ctx, d, w, h);
  };

  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    let raf = 0;
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        drawRef.current();
      });
    };
    const off = store.onRender(schedule);
    schedule();
    // Animate marching ants
    const ants = setInterval(() => {
      if (store.doc?.selection) {
        antsOffset.current = (antsOffset.current + 1) % 8;
        schedule();
      }
    }, 90);
    return () => {
      off();
      clearInterval(ants);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    drawRef.current();
  }, [size, s.activeDocId]);

  // ------------------------------------------------------------ input
  const toDoc = (e: { clientX: number; clientY: number }) => {
    // Pointer positions are screen pixels; the view math works in the page's CSS pixels
    const r = canvasRef.current!.getBoundingClientRect();
    const k = uiZoom();
    const d = store.doc!;
    const sx = (e.clientX - r.left) / k;
    const sy = (e.clientY - r.top) / k;
    return { sx, sy, x: (sx - d.view.panX) / d.view.zoom, y: (sy - d.view.panY) / d.view.zoom };
  };

  const info = (e: React.PointerEvent | PointerEvent, x: number, y: number): tools.PointerInfo => ({
    x,
    y,
    pressure: e.pointerType === 'pen' ? Math.max(0.02, e.pressure) : 1,
    shift: e.shiftKey,
    alt: e.altKey,
    mod: e.metaKey || e.ctrlKey,
    zoom: store.doc!.view.zoom,
    detail: (e as PointerEvent).detail ?? 1,
  });

  const lastClick = useRef({ t: 0, x: 0, y: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    const d = store.doc;
    if (!d) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // Keep focus where tools put it (e.g. the text editor) and release stray inputs
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    const p = toDoc(e);
    const st = store.state;
    // On-canvas brush resize: ⌃⌥-drag (macOS) or Alt + right-drag (Windows/Linux)
    const resizeGesture = isMacPlatform ? e.button === 0 && e.ctrlKey && e.altKey : e.button === 2 && e.altKey;
    if (resizeGesture && tools.isBrushTool(st.tool)) {
      tools.interaction.brushResize = { at: { x: p.x, y: p.y }, size: st.opts.size, hardness: st.opts.hardness, sx: e.clientX, sy: e.clientY };
      tools.interaction.pointer = { x: p.x, y: p.y };
      store.requestRender();
      return;
    }
    if (e.button === 1 || e.button === 2 || spaceDown.current || st.tool === 'hand') {
      panning.current = { x: e.clientX, y: e.clientY, px: d.view.panX, py: d.view.panY };
      setCursor('grabbing');
      return;
    }
    if (e.button !== 0) return;
    if (st.tool === 'zoom' && !st.transform) {
      zoomAt(d, e.altKey ? 0.5 : 2, p.sx, p.sy);
      return;
    }
    // Detect double clicks for polygonal lasso
    const now = performance.now();
    const dbl = now - lastClick.current.t < 350 && Math.hypot(e.clientX - lastClick.current.x, e.clientY - lastClick.current.y) < 6;
    lastClick.current = { t: now, x: e.clientX, y: e.clientY };
    const pi = info(e, p.x, p.y);
    pi.detail = dbl ? 2 : 1;
    tools.pointerDown(pi);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = store.doc;
    if (!d) return;
    if (panning.current) {
      d.view.panX = panning.current.px + (e.clientX - panning.current.x) / uiZoom();
      d.view.panY = panning.current.py + (e.clientY - panning.current.y) / uiZoom();
      store.requestRender();
      return;
    }
    const br = tools.interaction.brushResize;
    if (br) {
      // Right = bigger (the circle edge follows the pointer), up = harder
      const size = Math.round(Math.max(1, Math.min(2000, br.size + ((e.clientX - br.sx) * 2) / uiZoom() / d.view.zoom)));
      const hardness = Math.max(0, Math.min(1, Math.round((br.hardness - (e.clientY - br.sy) / 200) * 100) / 100));
      if (size !== store.state.opts.size || hardness !== store.state.opts.hardness) store.setOpts({ size, hardness });
      return;
    }
    const p = toDoc(e);
    // Coalesced events give smooth strokes with fast pens/mice
    const events = (e.nativeEvent.getCoalescedEvents?.() ?? []) as PointerEvent[];
    if (e.buttons && events.length > 1 && (tools.isBrushTool(store.state.tool) || store.state.tool === 'quick-select')) {
      for (const ce of events) {
        const cp = toDoc(ce);
        tools.pointerMove(info(ce, cp.x, cp.y), ce.buttons);
      }
    } else tools.pointerMove(info(e, p.x, p.y), e.buttons);

    // Status bar readout
    if (cursorListeners.size) {
      const ix = Math.floor(p.x);
      const iy = Math.floor(p.y);
      let color: string | null = null;
      if (ix >= 0 && iy >= 0 && ix < d.width && iy < d.height && !e.buttons) {
        const px = ctx2d(store.docPixels()).getImageData(ix, iy, 1, 1).data;
        color = px[3] ? '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('') : null;
      }
      cursorListeners.forEach((fn) => fn({ x: ix, y: iy, color }));
    }
    updateCursor(p.x, p.y);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (tools.interaction.brushResize) {
      tools.interaction.brushResize = null;
      store.requestRender();
      return;
    }
    if (panning.current) {
      panning.current = null;
      setCursor(spaceDown.current || store.state.tool === 'hand' ? 'grab' : 'default');
      store.emit();
      return;
    }
    if (!store.doc) return;
    const p = toDoc(e);
    tools.pointerUp(info(e, p.x, p.y));
  };

  const updateCursor = (x: number, y: number) => {
    const st = store.state;
    let c = tools.cursorFor(st.tool);
    if (spaceDown.current) c = 'grab';
    else if (tools.isBrushTool(st.tool) || st.tool === 'quick-select') c = 'none';
    else if (st.transform) {
      const hit = tools.transformHit({ x, y }, store.doc!.view.zoom);
      c = hit === 'move' ? 'move' : hit === 'rotate' ? 'alias' : ['n', 's'].includes(hit) ? 'ns-resize' : ['e', 'w'].includes(hit) ? 'ew-resize' : ['nw', 'se'].includes(hit) ? 'nwse-resize' : 'nesw-resize';
    } else if (st.tool === 'move') {
      c = tools.objectCursor({ x, y }, store.doc!.view.zoom) ?? tools.cursorFor(st.tool);
    } else if (st.tool === 'shape' && tools.widgetHover({ x, y }, store.doc!.view.zoom)) {
      c = 'pointer';
    } else if (st.tool === 'crop' && st.crop) {
      const r = st.crop.rect;
      const tol = 9 / store.doc!.view.zoom;
      const nearL = Math.abs(x - r.x) < tol, nearR = Math.abs(x - r.x - r.width) < tol;
      const nearT = Math.abs(y - r.y) < tol, nearB = Math.abs(y - r.y - r.height) < tol;
      if ((nearL && nearT) || (nearR && nearB)) c = 'nwse-resize';
      else if ((nearR && nearT) || (nearL && nearB)) c = 'nesw-resize';
      else if (nearL || nearR) c = 'ew-resize';
      else if (nearT || nearB) c = 'ns-resize';
      else if (x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height) c = 'move';
    }
    if (c !== cursor) setCursor(c);
  };

  // Wheel: pinch / ctrl / alt = zoom, otherwise scroll-pan
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const d = store.doc;
      if (!d) return;
      const r = el.getBoundingClientRect();
      // Normalise line/page scrolling (Firefox, some mice on Windows) to pixels
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // Trackpad pinch arrives as ctrl+wheel with small deltas; clamp so one mouse notch can't jump wildly
        const factor = Math.exp(-Math.max(-120, Math.min(120, dy)) * (e.ctrlKey && !e.metaKey ? 0.012 : 0.0025));
        zoomAt(d, factor, (e.clientX - r.left) / uiZoom(), (e.clientY - r.top) / uiZoom());
      } else {
        d.view.panX -= e.shiftKey && !dx ? dy : dx;
        d.view.panY -= e.shiftKey && !dx ? 0 : dy;
        store.requestRender();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Space-bar temporary hand tool
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) {
        e.preventDefault();
        if (!spaceDown.current) {
          spaceDown.current = true;
          setCursor('grab');
          store.requestRender();
        }
      }
    };
    const release = () => {
      if (!spaceDown.current) return;
      spaceDown.current = false;
      setCursor(tools.isBrushTool(store.state.tool) ? 'none' : tools.cursorFor(store.state.tool));
      store.requestRender();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') release();
    };
    // The keyup never arrives if focus leaves mid-press (⌘Tab, dialogs), so release on blur
    const onVisibility = () => document.hidden && release();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    setCursor(tools.isBrushTool(s.tool) || s.tool === 'quick-select' ? 'none' : tools.cursorFor(s.tool));
    if (s.tool === 'crop' && !s.crop && store.doc) tools.startCrop();
  }, [s.tool, s.activeDocId]);

  return (
    <div
      className="viewport"
      ref={wrapRef}
      onDragOver={(e) => {
        const hasFiles = e.dataTransfer.types && (e.dataTransfer.types.includes('Files') || Array.from(e.dataTransfer.types).includes('Files'));
        const hasLayers = !!(window as any).__skillSuiteDragLayers;
        const hasPost = store.doc && e.dataTransfer.types.includes(POST_DRAG_TYPE);
        if (hasFiles || hasLayers || hasPost) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={async (e) => {
        const hasFiles = e.dataTransfer.files && e.dataTransfer.files.length > 0;
        const dragLayers = (window as any).__skillSuiteDragLayers;
        const rawPost = e.dataTransfer.getData(POST_DRAG_TYPE);

        if (hasFiles) {
          e.preventDefault();
          e.stopPropagation();
          const files = Array.from(e.dataTransfer.files);
          const at = store.doc ? (toDoc(e) ?? undefined) : undefined;
          const hit = at && store.doc ? tools.pickObject(at.x, at.y, store.doc.view.zoom, true) : null;
          const frame = hit?.kind === 'shape' && hit.id === store.activeLayer?.id ? hit : null;
          const { dropFiles } = await import('../core/io');
          await dropFiles(files, { at, frame, asDocuments: e.shiftKey });
          return;
        }

        if (dragLayers && dragLayers.layers && store.doc) {
          e.preventDefault();
          e.stopPropagation();
          const at = toDoc(e);
          const { transferLayersToDoc } = await import('../core/ops');
          transferLayersToDoc(store.doc.id, dragLayers.layers, at);
          (window as any).__skillSuiteDragLayers = null;
          return;
        }

        if (rawPost && store.doc) {
          e.preventDefault();
          e.stopPropagation();
          const p = toDoc(e);
          dropPostItem(rawPost, { x: p.x, y: p.y });
        }
      }}
    >
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        style={{ width: size.w, height: size.h, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          tools.interaction.pointer = null;
          tools.interaction.hoverId = null;
          cursorListeners.forEach((fn) => fn(null));
          store.requestRender();
        }}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={() => {
          if (store.state.tool === 'hand') view.fit();
        }}
      />
      {doc && s.textEditId && <TextEditor key={s.textEditId} doc={doc} />}
      {doc && s.compare && <div className="compare-badge">Before — adjustments hidden (\)</div>}
      {doc?.editMask && store.activeLayer?.mask && <div className="mask-badge">Editing mask — paint black to hide, white to reveal (Q to exit)</div>}
    </div>
  );
}

function TextEditor({ doc }: { doc: Doc }) {
  const id = store.state.textEditId!;
  const layer = doc.layers.find((l) => l.id === id);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (layer?.text?.text === tools.DEFAULT_TEXT) el.select();
    tools.textSelection.id = id;
    tools.textSelection.start = el.selectionStart;
    tools.textSelection.end = el.selectionEnd;
    // After styling from the options bar, come back to the same characters
    tools.textEditorHooks.refocus = () => {
      const t = ref.current;
      if (!t || store.state.textEditId !== id) return;
      t.focus();
      t.setSelectionRange(tools.textSelection.start, tools.textSelection.end);
    };
    // Any selection change (mouse, keyboard, select-all, programmatic) updates what gets styled
    const onSel = () => {
      if (document.activeElement !== el) return;
      tools.textSelection.id = id;
      tools.textSelection.start = el.selectionStart;
      tools.textSelection.end = el.selectionEnd;
      store.emit();
    };
    document.addEventListener('selectionchange', onSel);
    el.addEventListener('select', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      el.removeEventListener('select', onSel);
      tools.textEditorHooks.refocus = () => {};
      tools.textSelection.id = '';
    };
  }, []);
  if (!layer?.text) return null;
  const t = layer.text;
  const { zoom, panX, panY } = doc.view;
  const remember = () => {
    const el = ref.current;
    if (!el) return;
    tools.textSelection.id = id;
    tools.textSelection.start = el.selectionStart;
    tools.textSelection.end = el.selectionEnd;
  };
  const finish = () => {
    const cur = store.doc?.layers.find((l) => l.id === id);
    store.set({ textEditId: null });
    if (cur?.text && !cur.text.text.trim()) {
      ops.deleteLayer(id);
    }
  };
  const wrap = !!t.boxWidth;
  return (
    <textarea
      ref={ref}
      className={`text-editor ${wrap ? 'wrap' : ''}`}
      spellCheck={false}
      value={t.text}
      style={{
        left: panX + layer.x * zoom,
        top: panY + layer.y * zoom,
        width: wrap ? t.boxWidth! * zoom : Math.max(40, layer.width * zoom + t.size * zoom),
        height: Math.max(20, layer.height * zoom + 4),
        font: fontString({ ...t, size: t.size * zoom }),
        lineHeight: `${t.size * t.lineHeight * zoom}px`,
        letterSpacing: `${t.tracking * zoom}px`,
        textAlign: t.align,
        textTransform: t.caps ? 'uppercase' : 'none', // keeps the caret over the drawn glyphs
        // Rotated text is edited in place, turned like the drawn type
        transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
        transformOrigin: layer.rotation ? `${(layer.width * zoom) / 2}px ${(layer.height * zoom) / 2}px` : undefined,
      }}
      onChange={(e) => {
        tools.updateText(id, { text: e.target.value });
        remember();
      }}
      onSelect={remember}
      onKeyUp={remember}
      onMouseUp={remember}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          finish();
          return;
        }
        // ⌘B / ⌘I / ⌘U style the selected characters
        const k = e.key.toLowerCase();
        if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'u'].includes(k)) {
          e.preventDefault();
          remember();
          const el = ref.current!;
          if (el.selectionEnd <= el.selectionStart) return;
          const cur = styleAt(t, el.selectionStart);
          const style = k === 'b' ? { weight: cur.weight >= 600 ? 400 : 700 } : k === 'i' ? { italic: !cur.italic } : { underline: !cur.underline };
          tools.styleTextRange(id, el.selectionStart, el.selectionEnd, style);
        }
      }}
      onBlur={(e) => {
        // Clicking the options bar or text properties keeps editing, so the selection can be styled
        const to = e.relatedTarget as HTMLElement | null;
        if (to?.closest('.options-bar, .props, .ctx-menu, .font-pop')) return;
        finish();
      }}
    />
  );
}

function drawSafeZone(ctx: CanvasRenderingContext2D, z: (typeof SAFE_ZONES)[string], x: number, y: number, w: number, h: number) {
  const ix = x + z.left * w;
  const iy = y + z.top * h;
  const iw = w * (1 - z.left - z.right);
  const ih = h * (1 - z.top - z.bottom);
  ctx.save();
  // Shade what the platform covers
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.rect(ix, iy, iw, ih);
  ctx.fillStyle = 'rgba(255, 64, 112, 0.10)';
  ctx.fill('evenodd');
  for (const e of z.extra ?? []) {
    ctx.beginPath();
    if (e.round) ctx.ellipse(x + (e.x + e.w / 2) * w, y + (e.y + e.h / 2) * h, (e.w * w) / 2, Math.min((e.h * h) / 2, (e.w * w) / 2), 0, 0, Math.PI * 2);
    else ctx.rect(x + e.x * w, y + e.y * h, e.w * w, e.h * h);
    ctx.fillStyle = 'rgba(255, 64, 112, 0.16)';
    ctx.fill();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255, 96, 136, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (e.w * w > 50) {
      ctx.font = '600 10px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255, 160, 184, 0.95)';
      ctx.textAlign = 'center';
      ctx.fillText(e.label, x + (e.x + e.w / 2) * w, y + (e.y + e.h / 2) * h + 3);
    }
  }
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = 'rgba(255, 96, 136, 0.9)';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(ix) + 0.5, Math.round(iy) + 0.5, Math.round(iw), Math.round(ih));
  if (iw > 160) {
    ctx.setLineDash([]);
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    const label = z.label.toUpperCase();
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(255, 64, 112, 0.85)';
    ctx.fillRect(Math.round(ix) + 1, Math.round(iy) + 1, tw + 10, 15);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, Math.round(ix) + 6, Math.round(iy) + 12);
  }
  ctx.restore();
}

// Soft-proof display copy, redone only when the document pixels or the proof mode change
let proofCache: { key: string; canvas: HTMLCanvasElement } | null = null;
function proofed(src: HTMLCanvasElement, sig: string, mode: 'cmyk' | 'gamut'): HTMLCanvasElement {
  const key = `${mode}|${src.width}x${src.height}|${sig}`;
  if (proofCache?.key === key && sig) return proofCache.canvas;
  const c = proofCache?.canvas.width === src.width && proofCache.canvas.height === src.height ? proofCache.canvas : document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  proofImage(img.data, mode === 'gamut');
  ctx.putImageData(img, 0, 0);
  proofCache = { key, canvas: c };
  return c;
}

/** Guides for the current workspace over the canvas (screen coordinates). */
function drawWorkspaceGuides(ctx: CanvasRenderingContext2D, kinds: GuideKind[], r: { x: number; y: number; w: number; h: number }, lay: Layout, zoom: number) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.font = '600 10px Inter, system-ui, sans-serif';
  const label = (text: string, x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  const rect = (x: number, y: number, w: number, h: number) => ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  if (kinds.includes('print')) {
    const b = lay.bleed * zoom;
    const sm = lay.safe * zoom;
    if (b > 0) {
      ctx.strokeStyle = '#ff3b5c';
      rect(r.x - b, r.y - b, r.w + b * 2, r.h + b * 2);
      label('BLEED', r.x - b, r.y + r.h + b + 12, '#ff3b5c');
    }
    // Trim marks at the corners, outside the bleed
    ctx.strokeStyle = 'rgba(160,160,160,0.9)';
    const m = Math.max(6, b + 4);
    const len = 14;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [[r.x, r.y, -1, -1], [r.x + r.w, r.y, 1, -1], [r.x, r.y + r.h, -1, 1], [r.x + r.w, r.y + r.h, 1, 1]]) {
      ctx.moveTo(Math.round(cx) + 0.5, cy + sy * m);
      ctx.lineTo(Math.round(cx) + 0.5, cy + sy * (m + len));
      ctx.moveTo(cx + sx * m, Math.round(cy) + 0.5);
      ctx.lineTo(cx + sx * (m + len), Math.round(cy) + 0.5);
    }
    ctx.stroke();
    if (sm > 0 && sm * 2 < Math.min(r.w, r.h)) {
      ctx.strokeStyle = '#2f9bff';
      ctx.setLineDash([5, 4]);
      rect(r.x + sm, r.y + sm, r.w - sm * 2, r.h - sm * 2);
      ctx.setLineDash([]);
      label('SAFE', r.x + sm + 3, r.y + sm + 12, '#2f9bff');
    }
  }
  if (kinds.includes('video')) {
    ctx.strokeStyle = 'rgba(47,155,255,0.85)';
    ctx.setLineDash([6, 4]);
    rect(r.x + r.w * 0.035, r.y + r.h * 0.035, r.w * 0.93, r.h * 0.93);
    ctx.setLineDash([]);
    label('ACTION SAFE 93%', r.x + r.w * 0.035 + 3, r.y + r.h * 0.035 + 12, 'rgba(47,155,255,0.95)');
    ctx.strokeStyle = 'rgba(255,170,0,0.9)';
    rect(r.x + r.w * 0.05, r.y + r.h * 0.05, r.w * 0.9, r.h * 0.9);
    label('TITLE SAFE 90%', r.x + r.w * 0.05 + 3, r.y + r.h * 0.05 + 24, 'rgba(255,170,0,0.95)');
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 12, Math.round(cy) + 0.5);
    ctx.lineTo(cx + 12, Math.round(cy) + 0.5);
    ctx.moveTo(Math.round(cx) + 0.5, cy - 12);
    ctx.lineTo(Math.round(cx) + 0.5, cy + 12);
    ctx.stroke();
  }
  if (kinds.includes('web')) {
    // 12 columns, gutters and margins scale with the frame like a responsive grid
    const cols = 12;
    const margin = Math.max(16 * zoom, r.w * 0.05);
    const gutter = Math.max(8 * zoom, r.w * 0.016);
    const colW = (r.w - margin * 2 - gutter * (cols - 1)) / cols;
    if (colW > 1) {
      ctx.fillStyle = 'rgba(255, 59, 107, 0.07)';
      for (let i = 0; i < cols; i++) ctx.fillRect(r.x + margin + i * (colW + gutter), r.y, colW, r.h);
    }
  }
  if (kinds.includes('social')) {
    ctx.strokeStyle = 'rgba(160,160,160,0.45)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    for (const f of [1 / 3, 2 / 3]) {
      ctx.moveTo(Math.round(r.x + r.w * f) + 0.5, r.y);
      ctx.lineTo(Math.round(r.x + r.w * f) + 0.5, r.y + r.h);
      ctx.moveTo(r.x, Math.round(r.y + r.h * f) + 0.5);
      ctx.lineTo(r.x + r.w, Math.round(r.y + r.h * f) + 0.5);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawHandles(ctx: CanvasRenderingContext2D, pts: [number, number][], px: number) {
  const s = 7 * px;
  for (const [x, y] of pts) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#2f9bff';
    ctx.lineWidth = px;
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
    ctx.strokeRect(x - s / 2, y - s / 2, s, s);
  }
}

function niceStep(raw: number) {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

function drawRulers(ctx: CanvasRenderingContext2D, d: Doc, w: number, h: number) {
  const { zoom, panX, panY } = d.view;
  const css = getComputedStyle(ctx.canvas);
  const bg = css.getPropertyValue('--ruler-bg').trim() || '#16161a';
  const fg = css.getPropertyValue('--ruler-fg').trim() || '#6c6c78';
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, RULER);
  ctx.fillRect(0, 0, RULER, h);
  ctx.strokeStyle = fg;
  ctx.fillStyle = fg;
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.lineWidth = 1;
  const step = niceStep(60 / zoom);
  const minor = step / 5;
  ctx.beginPath();
  const startX = Math.floor(-panX / zoom / minor) * minor;
  for (let v = startX; v * zoom + panX < w; v += minor) {
    const x = Math.round(panX + v * zoom) + 0.5;
    if (x < RULER) continue;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    ctx.moveTo(x, major ? 4 : 14);
    ctx.lineTo(x, RULER);
    if (major) ctx.fillText(String(Math.round(v)), x + 3, 10);
  }
  const startY = Math.floor(-panY / zoom / minor) * minor;
  for (let v = startY; v * zoom + panY < h; v += minor) {
    const y = Math.round(panY + v * zoom) + 0.5;
    if (y < RULER) continue;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    ctx.moveTo(major ? 4 : 14, y);
    ctx.lineTo(RULER, y);
    if (major) {
      ctx.save();
      ctx.translate(10, y + 3);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(Math.round(v)), 0, 0);
      ctx.restore();
    }
  }
  ctx.stroke();
  // Pointer markers
  const p = tools.interaction.pointer;
  if (p) {
    ctx.strokeStyle = '#ff6b00';
    ctx.beginPath();
    const sx = Math.round(panX + p.x * zoom) + 0.5;
    const sy = Math.round(panY + p.y * zoom) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, RULER);
    ctx.moveTo(0, sy);
    ctx.lineTo(RULER, sy);
    ctx.stroke();
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, RULER, RULER);
  ctx.restore();
}

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset', 'file']);

/** True when the element accepts typed text (so paste and letter keys belong to it). */
export function isTextEntry(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
  return t.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((t as HTMLInputElement).type);
}

/**
 * True when a key press belongs to the focused control rather than to app shortcuts.
 * Sliders, dropdowns and checkboxes only own the keys they actually use, so shortcuts keep
 * working after you touch one (previously any focused <input> or <select> disabled them all).
 */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  if (isTextEntry(t)) return true;
  if (!(t instanceof HTMLElement) || e.metaKey || e.ctrlKey) return false;
  const nav = e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown';
  if (t.tagName === 'SELECT') return nav || e.key === ' ' || e.key === 'Enter';
  if (t.tagName === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    if (type === 'range') return nav;
    return e.key === ' ' || e.key === 'Enter'; // checkbox, color, buttons
  }
  return false;
}
