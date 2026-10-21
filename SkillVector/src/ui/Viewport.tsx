import { useEffect, useRef, useState } from 'react';
import type { Doc, Selection } from '../core/types';
import { store, useStore } from '../core/store';
import { ctx2d } from '../core/canvas';
import { outlinePath } from '../core/selection';
import { shapePath, fontString, type RenderView } from '../core/render';
import { extrasFor } from '../core/shapeGeometry';
import { styleAt } from '../core/text';
import { meshPoint } from '../core/transform';
import { frameCorners, frameHandles, frameVisible, layerFrame, selectionFrame, transformTargets } from '../core/objectTransform';
import type { Frame } from '../core/objectTransform';
import { shapeWidgets } from '../core/shapeWidgets';
import { currentWorkspace, getLayout } from './layout';
import { uiZoom } from './theme';
import type { GuideKind, Layout } from './layout';
import { proofImage } from '../core/color';
import * as tools from '../core/tools';
import { shapeDraftRect, getToolShapeType } from '../core/tools';
import { SAFE_ZONES } from '../core/social';
import * as pro from '../core/proTools';
import * as ops from '../core/ops';
import { view } from '../core/commands';
import { convertToEditablePath, shapeBuilderRegions, solveHarmonicCurvature } from '../core/vectorOps';
import { meshPoints, symbolRadius, vectorOverlay, widthHandles } from '../core/vectorTools';
import { annotatorGeometry, gradientPick } from '../core/gradientAnnotator';
import { traceOverlay } from '../core/studio/trace';
import { drawDocGrid, drawLayoutGrids } from './gridDraw';
import { gridPages } from '../core/gridOps';
import { printTiles, tileOrigin, tileSettings, tilingArea } from '../core/printTiling';

/** 64,000%: vector art is redrawn at the zoom, so there is nothing to pixelate. */
const MAX_ZOOM = 640;

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
    const z = Math.max(0.01, Math.min(MAX_ZOOM, v.zoom * factor));
    v.panX = sx - ((sx - v.panX) * z) / v.zoom;
    v.panY = sy - ((sy - v.panY) * z) / v.zoom;
    v.zoom = z;
    // Only the canvas repaints during a pinch / wheel gesture; readouts follow once it pauses,
    // so zooming a document with hundreds of layers stays as fluid as panning it
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
      const zoom = Math.max(0.01, Math.min(MAX_ZOOM, (w - ruler - pad * 2) / r.width, (h - ruler - pad * 2) / r.height));
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

    const artboards = d.artboards && d.artboards.length > 0 ? d.artboards : [{ id: 'ab-1', name: 'Artboard 1', x: 0, y: 0, width: d.width, height: d.height }];

    // Render artboard papers & headers
    for (const ab of artboards) {
      const ax = panX + ab.x * zoom;
      const ay = panY + ab.y * zoom;
      const aw = ab.width * zoom;
      const ah = ab.height * zoom;

      // Drop shadow & paper
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ax, ay, aw, ah);
      ctx.restore();

      // Artboard border
      ctx.strokeStyle = '#2b2b2b';
      ctx.lineWidth = 1;
      ctx.strokeRect(ax, ay, aw, ah);

      // Artboard pill badge
      ctx.save();
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      const badgeText = `${ab.name} · ${ab.width} × ${ab.height}`;
      const textWidth = ctx.measureText(badgeText).width;
      ctx.fillStyle = ab.id === d.activeArtboardId ? '#ff9a00' : '#2b2b2b';
      ctx.beginPath();
      ctx.roundRect(ax, ay - 22, textWidth + 14, 18, 3);
      ctx.fill();
      ctx.fillStyle = ab.id === d.activeArtboardId ? '#111111' : '#e0e0e0';
      ctx.fillText(badgeText, ax + 7, ay - 9);
      ctx.restore();

      // Active artboard tool outline
      if (st.tool === 'artboard') {
        const isSel = ab.id === d.activeArtboardId;
        ctx.strokeStyle = isSel ? '#ff9a00' : '#4daafc';
        ctx.lineWidth = 2;
        ctx.strokeRect(ax, ay, aw, ah);
        if (isSel) {
          drawHandles(ctx, [
            [ax, ay], [ax + aw / 2, ay], [ax + aw, ay], [ax + aw, ay + ah / 2],
            [ax + aw, ay + ah], [ax + aw / 2, ay + ah], [ax, ay + ah], [ax, ay + ah / 2],
          ], 1);
        }
      }
    }

    if (d.outlineMode) {
      // Outline Mode (⌘Y) — pure vector wireframe preview
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(zoom, zoom);
      ctx.lineWidth = 1 / zoom;
      for (const l of d.layers) {
        if (!l.visible) continue;
        const turned = !!l.rotation && (l.kind === 'shape' || l.kind === 'text');
        if (turned) {
          ctx.save();
          ctx.translate(l.x + l.width / 2, l.y + l.height / 2);
          ctx.rotate((l.rotation! * Math.PI) / 180);
          ctx.translate(-(l.x + l.width / 2), -(l.y + l.height / 2));
        }
        if (l.kind === 'shape' && l.shape) {
          ctx.strokeStyle = '#000000';
          shapePath(ctx, l.shape, l.x, l.y, l.width, l.height);
          ctx.stroke();
        } else if (l.kind === 'text') {
          ctx.strokeStyle = '#000000';
          ctx.strokeRect(l.x, l.y, l.width, l.height);
        } else if (l.kind === 'raster' && l.canvas) {
          ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          ctx.setLineDash([3 / zoom, 3 / zoom]);
          ctx.strokeRect(l.x, l.y, l.canvas.width, l.canvas.height);
          ctx.setLineDash([]);
        }
        if (turned) ctx.restore();
      }
      ctx.restore();
    } else {
      const renderDoc = st.compare ? { ...d, layers: d.layers.filter((l) => l.kind !== 'adjustment') } : d;
      // In SkillVector (Illustrator workflow), the ENTIRE viewport and workable pasteboard canvas is rendered
      // Vector view: render visible shapes, paths, text and objects across the full workable canvas at any zoom
      const s = zoom * dpr;
      if (canvas.width > 0 && canvas.height > 0) {
        const view: RenderView = {
          s,
          ox: -panX * dpr,
          oy: -panY * dpr,
          w: canvas.width,
          h: canvas.height,
        };
        let out = store.viewRenderer.render(renderDoc, store.overrides, view);
        if (st.proof !== 'off') out = proofed(out, store.viewRenderer.signature, st.proof);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(out, 0, 0);
        ctx.restore();
      }
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

    // Document grid: adaptive levels keep it useful at any zoom
    if (st.showGrid) drawDocGrid(ctx, st.docGrid, { zoom, panX, panY, w, h });

    // Platform safe zones (social presets) — guidance only, never exported
    const zone = d.safeZone && st.showSafeZones && !st.crop ? SAFE_ZONES[d.safeZone] : null;
    if (zone) drawSafeZone(ctx, zone, panX, panY, dw, dh);

    // Workspace guides (print bleed / video safe areas / web columns / thirds) — never exported
    const lay = getLayout();
    const ws = currentWorkspace();
    if (lay.guides && ws.guides.length && !st.crop) {
      for (const ab of artboards) drawWorkspaceGuides(ctx, ws.guides, { x: panX + ab.x * zoom, y: panY + ab.y * zoom, w: ab.width * zoom, h: ab.height * zoom }, lay, zoom);
    }

    // Layout grids per artboard (columns, safe areas, panels …) — guidance only, never exported
    if (st.docGrid.showLayout && !st.crop) drawLayoutGrids(ctx, gridPages(d), { zoom, panX, panY, w, h });

    // Doc-space overlays
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    const px = 1 / zoom;

    // Marching ants
    if (d.selection && !st.transform) {
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
      const actualType = getToolShapeType(st.tool, o.shapeType);
      const isLine = actualType === 'line' || actualType === 'arrow' || actualType === 'arc' || actualType === 'spiral';
      const x = isLine ? r.x : Math.min(r.x, r.x + r.w);
      const y = isLine ? r.y : Math.min(r.y, r.y + r.h);
      const sw = isLine ? r.w : Math.abs(r.w);
      const sh = isLine ? r.h : Math.abs(r.h);
      shapePath(ctx, { shape: actualType, fill: st.fg, fillEnabled: o.shapeFill, stroke: st.fg, strokeWidth: 1, radius: actualType === 'round-rect' ? (o.shapeRadius || 24) : o.shapeRadius, sides: o.shapeSides, ...extrasFor(actualType, o.shapeExtras) }, x, y, sw, sh);
      if (o.shapeFill && !isLine) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = st.fg;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = isLine ? Math.max(2, o.shapeStrokeWidth || 6) : px * 1.5;
      ctx.strokeStyle = isLine ? st.fg : 'rgba(255, 154, 0, 0.95)';
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

    // Super Vector Pencil live draft overlay
    const pencilDraft = it.pencilDraft;
    if (pencilDraft && pencilDraft.points.length > 0) {
      const pts = pencilDraft.points;
      const strokeW = Math.max(1, st.opts.shapeStrokeWidth || 3);
      const strokeColor = st.opts.shapeFill ? st.opts.shapeStrokeColor : st.fg;

      ctx.save();

      // Live smoothed curve
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const xc = (prev.x + curr.x) / 2;
        const yc = (prev.y + curr.y) / 2;
        ctx.quadraticCurveTo(prev.x, prev.y, xc, yc);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeW;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Pulled rope lead line (StreamLine visualizer)
      if (pencilDraft.ropeLead) {
        ctx.setLineDash([3 * px, 3 * px]);
        ctx.strokeStyle = 'rgba(255, 120, 0, 0.85)';
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.lineTo(pencilDraft.ropeLead.x, pencilDraft.ropeLead.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(pencilDraft.ropeLead.x, pencilDraft.ropeLead.y, 4 * px, 0, Math.PI * 2);
        ctx.fillStyle = '#ff7800';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = px;
        ctx.stroke();
      }

      // Auto-close magnetic indicator
      if (pencilDraft.isNearStart) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, 10 * px, 0, Math.PI * 2);
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2.5 * px;
        ctx.stroke();
        ctx.fillStyle = 'rgba(34, 197, 94, 0.3)';
        ctx.fill();
      }

      // QuickShape (pen held still): preview the clean shape it will become
      const qs = pencilDraft.quickShape;
      if (qs) {
        ctx.save();
        ctx.beginPath();
        if (qs.anchors?.length) {
          const an = qs.anchors;
          ctx.moveTo(an[0].x, an[0].y);
          for (let i = 1; i <= an.length; i++) {
            if (i === an.length && !qs.closed) break;
            const p = an[i - 1], a = an[i % an.length];
            ctx.bezierCurveTo(p.ox, p.oy, a.ix, a.iy, a.x, a.y);
          }
          if (qs.closed) ctx.closePath();
        } else if (qs.from && qs.to) {
          ctx.moveTo(qs.from.x, qs.from.y);
          ctx.lineTo(qs.to.x, qs.to.y);
        } else {
          const r = qs.rect;
          ctx.translate(r.x + r.width / 2, r.y + r.height / 2);
          ctx.rotate(((qs.rotation ?? 0) * Math.PI) / 180);
          if (qs.shapeType === 'ellipse') ctx.ellipse(0, 0, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
          else if (qs.shapeType === 'triangle') {
            ctx.moveTo(0, -r.height / 2);
            ctx.lineTo(r.width / 2, r.height / 2);
            ctx.lineTo(-r.width / 2, r.height / 2);
            ctx.closePath();
          } else ctx.rect(-r.width / 2, -r.height / 2, r.width, r.height);
        }
        ctx.restore();
        ctx.strokeStyle = getComputedStyle(canvasRef.current!).getPropertyValue('--accent').trim() || '#0078d4';
        ctx.lineWidth = 2 * px;
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // QuickShape detected pill badge
      if (pencilDraft.quickShapeKind) {
        const last = pts[pts.length - 1];
        ctx.font = `600 ${Math.max(11, 13 * px)}px Inter, sans-serif`;
        const tag = `⚡ ${pencilDraft.quickShapeKind.toUpperCase()}`;
        const tw = ctx.measureText(tag).width;
        ctx.fillStyle = 'rgba(0, 120, 212, 0.9)';
        ctx.beginPath();
        ctx.roundRect(last.x + 10 * px, last.y - 18 * px, tw + 12 * px, 20 * px, 4 * px);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(tag, last.x + 16 * px, last.y - 4 * px);
      }

      ctx.restore();
    }

    // Vector geometry tools: the freehand drag, brush rings, puppet pins, mesh points, blend start
    {
      const accent = getComputedStyle(canvasRef.current!).getPropertyValue('--accent').trim() || '#0078d4';
      const tp = it.toolPath;
      if (tp && tp.points.length) {
        const w = Math.max(1, st.opts.size || 10);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        tp.points.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        if (tp.points.length === 1) ctx.lineTo(tp.points[0].x + 0.01, tp.points[0].y);
        if (tp.tool === 'brush' || tp.tool === 'blob-brush') {
          ctx.strokeStyle = st.fg;
          ctx.globalAlpha = tp.tool === 'blob-brush' ? 0.75 : 1;
          ctx.lineWidth = w;
          ctx.stroke();
        } else if (tp.tool === 'eraser' || tp.tool === 'path-eraser') {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.lineWidth = tp.tool === 'eraser' ? w : Math.max(4, w);
          ctx.stroke();
          ctx.strokeStyle = accent;
          ctx.lineWidth = px;
          ctx.stroke();
        } else {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.5 * px;
          if (tp.tool === 'knife') ctx.setLineDash([5 * px, 3 * px]);
          ctx.stroke();
        }
        ctx.restore();
      }
      const ring = (x: number, y: number, r: number) => {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = 3 * px;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = px;
        ctx.stroke();
        ctx.restore();
      };
      const liquify = ['warp', 'twirl', 'pucker', 'bloat', 'scallop', 'crystallize', 'wrinkle'].includes(st.tool);
      const symbols = st.tool.startsWith('symbol-');
      const brush = vectorOverlay.brush ?? (it.pointer && (liquify || symbols) ? { ...it.pointer, r: liquify ? Math.max(20, st.opts.size || 60) : symbolRadius() } : null);
      if (brush && (liquify || symbols)) ring(brush.x, brush.y, brush.r);
      const dot = (q: { x: number; y: number }, fill: string) => {
        ctx.beginPath();
        ctx.arc(q.x, q.y, 4.5 * px, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5 * px;
        ctx.stroke();
      };
      if (st.tool === 'puppet-warp' && vectorOverlay.pins && vectorOverlay.pins.layerId === store.doc?.activeId) {
        for (const q of vectorOverlay.pins.pts) dot(q, '#ffffff');
      }
      if (st.tool === 'mesh') {
        const al = store.activeLayer;
        meshPoints(al).forEach((q, i) => dot(q, al?.shape?.mesh?.[i]?.color ?? '#ffffff'));
      }
      // Gradient annotator: the line, its ends and the colour stops of the selected shape's gradient
      if (st.tool === 'gradient') {
        const al = store.activeLayer;
        const geo = al ? annotatorGeometry(al) : null;
        if (al && geo) {
          ctx.save();
          const line = () => {
            ctx.beginPath();
            ctx.moveTo(geo.a.x, geo.a.y);
            ctx.lineTo(geo.b.x, geo.b.y);
          };
          ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
          ctx.lineWidth = 4 * px;
          line();
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5 * px;
          line();
          ctx.stroke();
          if (geo.radius) {
            ctx.setLineDash([4 * px, 4 * px]);
            ctx.lineWidth = px;
            ctx.beginPath();
            ctx.arc(geo.a.x, geo.a.y, geo.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          // Start: square; end: circle
          const hs = 5 * px;
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#1f1f1f';
          ctx.lineWidth = 1.5 * px;
          ctx.fillRect(geo.a.x - hs, geo.a.y - hs, hs * 2, hs * 2);
          ctx.strokeRect(geo.a.x - hs, geo.a.y - hs, hs * 2, hs * 2);
          ctx.beginPath();
          ctx.arc(geo.b.x, geo.b.y, hs * 1.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Stops: colour dots on the line; the picked one has an accent ring
          geo.stops.forEach((q, i) => {
            const picked = gradientPick.layer === al.id && gradientPick.stop === i;
            ctx.beginPath();
            ctx.arc(q.x, q.y, (picked ? 6 : 4.5) * px, 0, Math.PI * 2);
            ctx.fillStyle = q.color;
            ctx.fill();
            ctx.lineWidth = (picked ? 2.5 : 1.5) * px;
            ctx.strokeStyle = picked ? accent : '#ffffff';
            ctx.stroke();
          });
          ctx.restore();
        }
      }
      // Two-point perspective grid
      const pg = store.doc?.perspective?.visible ? store.doc.perspective : null;
      if (pg && store.doc) {
        const W = store.doc.width, H = store.doc.height;
        ctx.save();
        ctx.lineWidth = px;
        ctx.strokeStyle = 'rgba(77, 170, 252, 0.9)';
        ctx.beginPath();
        ctx.moveTo(-W, pg.horizon);
        ctx.lineTo(W * 2, pg.horizon);
        ctx.stroke();
        const n = 14;
        for (const [vx, color] of [[pg.left, 'rgba(46, 160, 67, 0.55)'], [pg.right, 'rgba(248, 81, 73, 0.55)']] as const) {
          ctx.strokeStyle = color;
          ctx.beginPath();
          for (let i = 0; i <= n; i++) {
            // Rays from the vanishing point to the top and bottom edges of the page
            const tx = -W * 0.5 + (W * 2 * i) / n;
            ctx.moveTo(vx, pg.horizon);
            ctx.lineTo(tx, H);
            ctx.moveTo(vx, pg.horizon);
            ctx.lineTo(tx, 0);
          }
          ctx.stroke();
        }
        for (const vx of [pg.left, pg.right]) {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#0078d4';
          ctx.lineWidth = 1.5 * px;
          ctx.beginPath();
          ctx.arc(vx, pg.horizon, 5 * px, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // Slices: outlined and numbered while a slice tool is active
      if (st.tool === 'slice' || st.tool === 'slice-select') {
        const list = store.doc?.slices ?? [];
        ctx.save();
        ctx.font = `600 ${11 * px}px Inter, system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        list.forEach((sl, i) => {
          const on = sl.id === vectorOverlay.activeSlice;
          ctx.fillStyle = on ? 'rgba(0, 120, 212, 0.12)' : 'rgba(255, 255, 255, 0.04)';
          ctx.fillRect(sl.x, sl.y, sl.width, sl.height);
          ctx.strokeStyle = on ? accent : 'rgba(255, 154, 0, 0.9)';
          ctx.lineWidth = (on ? 2 : 1) * px;
          ctx.strokeRect(sl.x, sl.y, sl.width, sl.height);
          const tag = `${String(i + 1).padStart(2, '0')}`;
          const tw = ctx.measureText(tag).width + 8 * px;
          ctx.fillStyle = on ? accent : 'rgba(255, 154, 0, 0.95)';
          ctx.fillRect(sl.x, sl.y, tw, 15 * px);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(tag, sl.x + 4 * px, sl.y + 2 * px);
        });
        const d = vectorOverlay.sliceDraft;
        if (d) {
          ctx.setLineDash([5 * px, 3 * px]);
          ctx.strokeStyle = accent;
          ctx.lineWidth = px;
          ctx.strokeRect(d.x, d.y, d.width, d.height);
        }
        ctx.restore();
      }
      const first = vectorOverlay.blendFirst && st.tool === 'blend' ? store.doc?.layers.find((l) => l.id === vectorOverlay.blendFirst) : null;
      if (first) {
        ctx.save();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2 * px;
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.strokeRect(first.x, first.y, first.width, first.height);
        ctx.restore();
      }
    }

    // Image Trace tool: the picture a click would trace, and the region being dragged out
    if (st.tool === 'image-trace') {
      const { hover, drag, busy } = traceOverlay;
      const accent = getComputedStyle(canvasRef.current!).getPropertyValue('--accent').trim() || '#0078d4';
      ctx.save();
      if (hover && !drag) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2 * px;
        ctx.setLineDash(busy ? [3 * px, 3 * px] : []);
        ctx.strokeRect(hover.x, hover.y, hover.width, hover.height);
        ctx.font = `600 ${11 * px}px Inter, system-ui, sans-serif`;
        const tag = busy ? 'Tracing…' : `Click to trace · drag for a region · ⌥ pick colour`;
        const tw = ctx.measureText(tag).width + 10 * px;
        ctx.fillStyle = accent;
        ctx.fillRect(hover.x, hover.y - 18 * px, tw, 17 * px);
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(tag, hover.x + 5 * px, hover.y - 9.5 * px);
      }
      if (drag) {
        ctx.fillStyle = 'rgba(0, 120, 212, 0.10)';
        ctx.fillRect(drag.x, drag.y, drag.width, drag.height);
        ctx.setLineDash([5 * px, 3 * px]);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5 * px;
        ctx.strokeRect(drag.x, drag.y, drag.width, drag.height);
      }
      ctx.restore();
    }

    // Direct Selection Tool overlay: anchor points, handles, and path lines
    if (st.tool === 'direct-select') {
      const al = store.activeLayer;
      // Live / rotated shapes show the anchors they will have once a point is grabbed
      const l = al?.kind === 'shape' && al.shape && (!al.shape.points || al.rotation) ? convertToEditablePath(al, true, true) : al;
      if (l && l.kind === 'shape' && l.shape) {
        const s = l.shape;
        const pts = s.points ?? [];
        const W = l.width || 1;
        const H = l.height || 1;
        const X = (v: number) => l.x + v * W;
        const Y = (v: number) => l.y + v * H;

        // Path wireframe in layer selection color
        ctx.strokeStyle = '#ff9a00';
        ctx.lineWidth = 1.2 * px;
        shapePath(ctx, s, l.x, l.y, l.width, l.height);
        ctx.stroke();

        const selIdx = it.selectedAnchorLayer === l.id ? it.selectedAnchorIndex : null;

        // Draw tangent handles for the selected anchor
        if (selIdx !== null && pts[selIdx]) {
          const a = pts[selIdx];
          const hasIn = a.ix !== a.x || a.iy !== a.y;
          const hasOut = a.ox !== a.x || a.oy !== a.y;
          if (hasIn || hasOut) {
            ctx.strokeStyle = 'rgba(255, 154, 0, 0.9)';
            ctx.lineWidth = px;
            ctx.beginPath();
            if (hasIn) {
              ctx.moveTo(X(a.x), Y(a.y));
              ctx.lineTo(X(a.ix), Y(a.iy));
            }
            if (hasOut) {
              ctx.moveTo(X(a.x), Y(a.y));
              ctx.lineTo(X(a.ox), Y(a.oy));
            }
            ctx.stroke();

            if (hasIn) {
              ctx.beginPath();
              ctx.arc(X(a.ix), Y(a.iy), 3.5 * px, 0, Math.PI * 2);
              ctx.fillStyle = '#ff9a00';
              ctx.fill();
              ctx.strokeStyle = '#ffffff';
              ctx.stroke();
            }
            if (hasOut) {
              ctx.beginPath();
              ctx.arc(X(a.ox), Y(a.oy), 3.5 * px, 0, Math.PI * 2);
              ctx.fillStyle = '#ff9a00';
              ctx.fill();
              ctx.strokeStyle = '#ffffff';
              ctx.stroke();
            }
          }
        }

        // Draw all anchor points as squares
        pts.forEach((a, i) => {
          const isSel = i === selIdx;
          const sz = 6 * px;
          const ax = X(a.x);
          const ay = Y(a.y);
          ctx.fillStyle = isSel ? '#ff9a00' : '#ffffff';
          ctx.fillRect(ax - sz / 2, ay - sz / 2, sz, sz);
          ctx.strokeStyle = '#181818';
          ctx.lineWidth = 1.2 * px;
          ctx.strokeRect(ax - sz / 2, ay - sz / 2, sz, sz);
        });
      }
    }

    // Curvature Tool overlay
    if (it.curvaturePath && it.curvaturePath.points.length) {
      const pts = it.curvaturePath.points;
      const allPts = it.curvaturePath.cursor ? [...pts, it.curvaturePath.cursor] : pts;
      if (allPts.length >= 2) {
        const anchors = solveHarmonicCurvature(allPts, false);
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = '#ff9a00';
        ctx.stroke(pro.anchorsPath(anchors, false));
      }
      pts.forEach((pt, i) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4 * px, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#ff9a00' : '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#181818';
        ctx.lineWidth = 1.2 * px;
        ctx.stroke();
      });
    }

    // Artboard Draft overlay
    if (it.artboardDraft) {
      const { a, b } = it.artboardDraft;
      const rx = Math.min(a.x, b.x);
      const ry = Math.min(a.y, b.y);
      const rw = Math.abs(b.x - a.x);
      const rh = Math.abs(b.y - a.y);
      ctx.strokeStyle = '#ff9a00';
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 154, 0, 0.1)';
      ctx.fillRect(rx, ry, rw, rh);
    }

    // Width tool: each width point with its two side handles
    if (st.tool === 'width') {
      for (const hnd of widthHandles(store.activeLayer)) {
        ctx.strokeStyle = '#4daafc';
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.moveTo(hnd.a.x, hnd.a.y);
        ctx.lineTo(hnd.b.x, hnd.b.y);
        ctx.stroke();
        for (const q of [hnd.a, hnd.b]) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(q.x - 3 * px, q.y - 3 * px, 6 * px, 6 * px);
          ctx.strokeRect(q.x - 3 * px, q.y - 3 * px, 6 * px, 6 * px);
        }
        // The point on the path: a diamond
        const r = 4.5 * px;
        ctx.beginPath();
        ctx.moveTo(hnd.at.x, hnd.at.y - r);
        ctx.lineTo(hnd.at.x + r, hnd.at.y);
        ctx.lineTo(hnd.at.x, hnd.at.y + r);
        ctx.lineTo(hnd.at.x - r, hnd.at.y);
        ctx.closePath();
        ctx.fillStyle = '#4daafc';
        ctx.fill();
      }
    }

    // Print Tiling: the printer pages over the artboard, numbered, with the tiled area outlined
    if (st.tool === 'print-tiling' && doc) {
      const area = tilingArea(doc);
      const tiles = printTiles(area, tileSettings(), tileOrigin(doc.id, area));
      ctx.font = `600 ${11 * px}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.lineWidth = px;
      for (const t of tiles) {
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.strokeStyle = 'rgba(80, 80, 80, 0.9)';
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        ctx.setLineDash([]);
        const tag = `Page ${t.n}`;
        const tw = ctx.measureText(tag).width + 8 * px;
        ctx.fillStyle = 'rgba(60, 60, 60, 0.85)';
        ctx.fillRect(t.x, t.y, tw, 15 * px);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(tag, t.x + 4 * px, t.y + 2 * px);
      }
      ctx.strokeStyle = getComputedStyle(canvasRef.current!).getPropertyValue('--accent').trim() || '#0078d4';
      ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(area.x, area.y, area.w, area.h);
    }

    // Shape Builder / Live Paint Bucket: highlight the region under the pointer and the ones the drag has collected
    const sb = it.shapeBuilder;
    if (sb && (st.tool === 'shape-builder' || st.tool === 'bucket')) {
      const regions = shapeBuilderRegions()?.regions ?? [];
      const show = [...new Set([...sb.picked, sb.hover])].filter((i) => i >= 0 && regions[i]);
      for (const i of show) {
        const path = new Path2D();
        for (const ring of regions[i].rings) {
          ring.forEach((p, k) => (k ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
          path.closePath();
        }
        const red = sb.erase && sb.picked.length > 0;
        ctx.fillStyle = red ? 'rgba(248, 81, 73, 0.35)' : sb.picked.includes(i) ? 'rgba(0, 120, 212, 0.4)' : 'rgba(0, 120, 212, 0.22)';
        ctx.fill(path, 'evenodd');
        ctx.strokeStyle = red ? '#f85149' : '#4daafc';
        ctx.lineWidth = 1.5 * px;
        ctx.setLineDash([4 * px, 3 * px]);
        ctx.stroke(path);
        ctx.setLineDash([]);
      }
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
      if (st.tool !== 'move' && st.tool !== 'direct-select' && ws.length) {
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
    const readout = it.readout ?? vectorOverlay.readout;
    if (readout) {
      const rx = panX + readout.x * zoom + 14;
      const ry = panY + readout.y * zoom + 18;
      ctx.save();
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      const tw = ctx.measureText(readout.text).width;
      ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#2f9bff';
      ctx.beginPath();
      ctx.roundRect(rx, ry, tw + 12, 20, 4);
      ctx.fill();
      ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--on-accent').trim() || '#fff';
      ctx.fillText(readout.text, rx + 6, ry + 14);
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
    if (e.buttons && events.length > 1 && (tools.isBrushTool(store.state.tool) || store.state.tool === 'quick-select' || store.state.tool === 'pencil')) {
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
      if (!e.buttons) {
        if (ix >= 0 && iy >= 0 && ix < d.width && iy < d.height) {
          const px = ctx2d(store.docPixels()).getImageData(ix, iy, 1, 1).data;
          color = px[3] ? '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('') : null;
        } else {
          const s = pro.sampleAverage(ix, iy, 1);
          color = s && s.a > 0 ? pro.toHex(s.rgb) : null;
        }
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
    } else if (tools.isShapeTool(st.tool) && tools.widgetHover({ x, y }, store.doc!.view.zoom)) {
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
        if (hasFiles || hasLayers) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={async (e) => {
        const hasFiles = e.dataTransfer.files && e.dataTransfer.files.length > 0;
        const dragLayers = (window as any).__skillSuiteDragLayers;
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
  // Type on a path is typed in a plain box at the start of the path; the canvas shows it on the path
  const onPath = t.path && t.path.points.length ? t.path.points[0] : null;
  return (
    <textarea
      ref={ref}
      className={`text-editor ${wrap ? 'wrap' : ''} ${onPath ? 'on-path' : ''} ${t.vertical && !onPath ? 'vertical' : ''}`}
      spellCheck={false}
      value={t.text}
      style={onPath ? {
        left: panX + (layer.x + onPath.x) * zoom,
        top: panY + (layer.y + onPath.y) * zoom + 8,
        width: 240,
        height: 28,
        font: fontString({ ...t, size: 14 }),
      } : {
        left: panX + layer.x * zoom,
        top: panY + layer.y * zoom,
        width: t.vertical ? Math.max(20, layer.width * zoom + 4) : wrap ? t.boxWidth! * zoom : Math.max(40, layer.width * zoom + t.size * zoom),
        height: t.vertical ? (wrap ? t.boxWidth! * zoom : Math.max(40, layer.height * zoom + t.size * zoom)) : Math.max(20, layer.height * zoom + 4),
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

/** Guides for the current workspace over one artboard (screen coordinates). */
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
