// Select and Mask: a focused workspace to build and refine a selection — smart brushes, hair-aware edge
// matting, live view modes and output to a selection, mask or cut-out layer.
// Works on a preview proxy for speed; OK re-runs the same pipeline at full resolution.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X, WandSparkles, Brush, Sparkles, SquareDashedMousePointer, UserRound, RotateCcw, FlipHorizontal2, Eye } from 'lucide-react';
import { store } from '../core/store';
import { createCanvas, ctx2d } from '../core/canvas';
import * as seg from '../core/segment';
import { refineMask, guidedUpsample, decontaminate, localDetail, luma, signedDistance, DEFAULT_REFINE } from '../core/matte';
import type { MatteResult, RefineParams, RGBA } from '../core/matte';
import { docImage, findObjectAt, findObjectInBox, findSubject, outputMask, selectionAlpha, warmUpAI } from '../core/smartSelect';
import type { MaskOutput } from '../core/smartSelect';
import { Select, Slider, Toggle } from './widgets';

type SMTool = 'quick' | 'refine' | 'brush' | 'object';
type ViewMode = 'overlay' | 'onion' | 'black' | 'white' | 'bw' | 'layers';

const TOOLS: { id: SMTool; label: string; key: string; icon: ReactNode; hint: string }[] = [
  { id: 'quick', label: 'Quick Selection', key: 'W', icon: <WandSparkles size={15} />, hint: 'Paint over the object; it snaps to the edges when you let go. ⌥ subtracts.' },
  { id: 'refine', label: 'Refine Edge Brush', key: 'R', icon: <Sparkles size={15} />, hint: 'Paint over hair, fur or soft edges: the edge there is matted pixel by pixel. ⌥ erases the refine marks.' },
  { id: 'brush', label: 'Brush', key: 'B', icon: <Brush size={15} />, hint: 'Paint the selection in by hand. ⌥ paints it out.' },
  { id: 'object', label: 'Object Selection', key: 'O', icon: <SquareDashedMousePointer size={15} />, hint: 'Drag a box around an object, or click it. ⌥ subtracts.' },
];

const VIEWS: { id: ViewMode; label: string; key: string }[] = [
  { id: 'onion', label: 'Onion Skin', key: '1' },
  { id: 'overlay', label: 'Overlay', key: '2' },
  { id: 'black', label: 'On Black', key: '3' },
  { id: 'white', label: 'On White', key: '4' },
  { id: 'bw', label: 'Black & White', key: '5' },
  { id: 'layers', label: 'On Layers', key: '6' },
];

const OUTPUTS: { value: MaskOutput; label: string }[] = [
  { value: 'selection', label: 'Selection' },
  { value: 'mask', label: 'Layer Mask' },
  { value: 'layer', label: 'New Layer' },
  { value: 'layer-mask', label: 'New Layer with Layer Mask' },
];

const PREVIEW_MAX = 1100;
const PREFS_KEY = 'skillphoto.selectMask';

interface Prefs {
  view: ViewMode;
  opacity: number;
  overlayColor: string;
  params: RefineParams;
  decon: boolean;
  deconAmount: number;
  output: MaskOutput;
}

function loadPrefs(): Prefs {
  const def: Prefs = { view: 'overlay', opacity: 50, overlayColor: '#ff3b30', params: { ...DEFAULT_REFINE }, decon: false, deconAmount: 70, output: 'selection' };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>;
      return { ...def, ...p, params: { ...def.params, ...(p.params ?? {}) } };
    }
  } catch {
    /* private mode */
  }
  return def;
}

interface Work {
  img: RGBA;
  /** Proxy pixels per document pixel. */
  scale: number;
  imageCanvas: HTMLCanvasElement;
  base: Float32Array;
  marks: Uint8Array;
  anyMarks: boolean;
  baseEdited: boolean;
  res: MatteResult | null;
  stroke: { dabs: seg.Dab[]; sub: boolean; last: { x: number; y: number } | null; start: { x: number; y: number } } | null;
  box: { x: number; y: number; w: number; h: number } | null;
  undo: { base: Float32Array; marks: Uint8Array }[];
}

export function SelectMaskDialog() {
  const doc = store.doc;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [tool, setTool] = useState<SMTool>('quick');
  const [size, setSize] = useState(() => Math.round(Math.max(8, Math.min(200, (doc?.width ?? 1000) / 40))));
  const [altDown, setAltDown] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showEdge, setShowEdge] = useState(false);
  const [brush, setBrush] = useState<{ left: number; top: number; d: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, bump] = useState(0);
  const work = useRef<Work | null>(null);
  const live = useRef({ prefs, tool, size, showOriginal, showEdge });
  useLayoutEffect(() => {
    live.current = { prefs, tool, size, showOriginal, showEdge };
  }, [prefs, tool, size, showOriginal, showEdge]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  const close = () => store.set({ dialog: null });

  // ------------------------------------------------------------ set-up: proxy image + current selection
  useEffect(() => {
    if (!doc) return;
    warmUpAI();
    const full = docImage();
    if (!full) return;
    const scale = Math.min(1, PREVIEW_MAX / Math.max(doc.width, doc.height));
    const pw = Math.max(1, Math.round(doc.width * scale));
    const ph = Math.max(1, Math.round(doc.height * scale));
    const src = createCanvas(doc.width, doc.height);
    const sctx = ctx2d(src);
    const id = sctx.createImageData(doc.width, doc.height);
    id.data.set(full.data);
    sctx.putImageData(id, 0, 0);
    const imageCanvas = createCanvas(pw, ph);
    const ictx = ctx2d(imageCanvas);
    ictx.imageSmoothingQuality = 'high';
    ictx.drawImage(src, 0, 0, pw, ph);
    const img = { data: ictx.getImageData(0, 0, pw, ph).data, w: pw, h: ph };
    const base = new Float32Array(pw * ph);
    if (doc.selection) {
      const m = createCanvas(pw, ph);
      const mctx = ctx2d(m);
      mctx.imageSmoothingQuality = 'high';
      mctx.drawImage(doc.selection.canvas, 0, 0, pw, ph);
      const d = mctx.getImageData(0, 0, pw, ph).data;
      for (let i = 0; i < base.length; i++) base[i] = d[i * 4 + 3] / 255;
    }
    const c = canvasRef.current;
    if (c) {
      c.width = pw;
      c.height = ph;
    }
    work.current = { img, scale, imageCanvas, base, marks: new Uint8Array(pw * ph), anyMarks: false, baseEdited: false, res: null, stroke: null, box: null, undo: [] };
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------ compute + draw
  const draw = useCallback(() => {
    const w = work.current;
    const c = canvasRef.current;
    if (!w || !c) return;
    const { prefs: p, showOriginal: orig, showEdge: edge } = live.current;
    const ctx = ctx2d(c);
    const { w: pw, h: ph } = w.img;
    ctx.clearRect(0, 0, pw, ph);
    if (orig || !w.res) {
      ctx.drawImage(w.imageCanvas, 0, 0);
      drawBox(ctx, w);
      return;
    }
    const alpha = w.res.alpha;
    // White + alpha mask canvas
    const mask = createCanvas(pw, ph);
    const mctx = ctx2d(mask);
    const md = mctx.createImageData(pw, ph);
    for (let i = 0; i < alpha.length; i++) {
      md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = 255;
      md.data[i * 4 + 3] = alpha[i] * 255;
    }
    mctx.putImageData(md, 0, 0);
    const cut = createCanvas(pw, ph);
    const cctx = ctx2d(cut);
    cctx.drawImage(w.imageCanvas, 0, 0);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(mask, 0, 0);
    const op = p.opacity / 100;
    switch (p.view) {
      case 'overlay': {
        ctx.drawImage(w.imageCanvas, 0, 0);
        const tint = createCanvas(pw, ph);
        const tctx = ctx2d(tint);
        tctx.fillStyle = p.overlayColor;
        tctx.fillRect(0, 0, pw, ph);
        tctx.globalCompositeOperation = 'destination-out';
        tctx.drawImage(mask, 0, 0);
        ctx.globalAlpha = op;
        ctx.drawImage(tint, 0, 0);
        ctx.globalAlpha = 1;
        break;
      }
      case 'onion':
        ctx.globalAlpha = 1 - op;
        ctx.drawImage(w.imageCanvas, 0, 0);
        ctx.globalAlpha = 1;
        ctx.drawImage(cut, 0, 0);
        break;
      case 'black':
      case 'white':
        ctx.fillStyle = p.view === 'black' ? '#000' : '#fff';
        ctx.fillRect(0, 0, pw, ph);
        ctx.drawImage(cut, 0, 0);
        break;
      case 'bw':
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, pw, ph);
        ctx.drawImage(mask, 0, 0);
        break;
      case 'layers':
        ctx.drawImage(cut, 0, 0);
        break;
    }
    if (edge) {
      const band = w.res.band;
      const e = ctx.createImageData(pw, ph);
      for (let i = 0; i < band.length; i++) {
        if (!band[i] && !w.marks[i]) continue;
        e.data[i * 4] = 0;
        e.data[i * 4 + 1] = 200;
        e.data[i * 4 + 2] = 255;
        e.data[i * 4 + 3] = w.marks[i] ? 150 : 90;
      }
      const ec = createCanvas(pw, ph);
      ctx2d(ec).putImageData(e, 0, 0);
      ctx.drawImage(ec, 0, 0);
    }
    drawBox(ctx, w);
  }, []);

  const pending = useRef(0);
  const recompute = useCallback(() => {
    cancelAnimationFrame(pending.current);
    pending.current = requestAnimationFrame(() => {
      const w = work.current;
      if (!w) return;
      const p = live.current.prefs.params;
      w.res = refineMask(w.img, w.base, p, w.anyMarks ? w.marks : null, w.scale);
      draw();
    });
  }, [draw]);

  useEffect(() => {
    recompute();
  }, [prefs.params, recompute]);
  useEffect(() => {
    draw();
  }, [prefs.view, prefs.opacity, prefs.overlayColor, showOriginal, showEdge, draw]);

  const setParams = (patch: Partial<RefineParams>) => setPrefs((p) => ({ ...p, params: { ...p.params, ...patch } }));

  // ------------------------------------------------------------ editing helpers
  const snapshot = () => {
    const w = work.current!;
    w.undo.push({ base: Float32Array.from(w.base), marks: Uint8Array.from(w.marks) });
    if (w.undo.length > 30) w.undo.shift();
  };

  const undo = () => {
    const w = work.current;
    const u = w?.undo.pop();
    if (!w || !u) return;
    w.base = u.base;
    w.marks = u.marks;
    w.anyMarks = w.marks.some((v) => v);
    w.baseEdited = true;
    recompute();
    bump((n) => n + 1);
  };

  /** Merges a region (proxy coordinates) into the base mask. */
  const mergeRegion = (r: seg.RegionMask, mode: 'replace' | 'add' | 'sub' | 'set') => {
    const w = work.current!;
    const { w: pw } = w.img;
    if (mode === 'replace') w.base.fill(0);
    for (let y = 0; y < r.roi.h; y++)
      for (let x = 0; x < r.roi.w; x++) {
        const i = (y + r.roi.y) * pw + x + r.roi.x;
        const v = r.alpha[y * r.roi.w + x];
        if (mode === 'sub') w.base[i] = Math.min(w.base[i], 1 - v);
        else if (mode === 'set') w.base[i] = v;
        else w.base[i] = Math.max(w.base[i], v);
      }
    w.baseEdited = true;
  };

  const baseBytes = () => {
    const w = work.current!;
    const out = new Uint8Array(w.base.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(w.base[i] * 255);
    return out;
  };

  /** Paints a soft disc into base (brush) or marks (refine edge). */
  const paint = (x: number, y: number, r: number, sub: boolean, target: 'base' | 'marks') => {
    const w = work.current!;
    const { w: pw, h: ph } = w.img;
    for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(ph - 1, Math.ceil(y + r)); yy++)
      for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(pw - 1, Math.ceil(x + r)); xx++) {
        const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
        if (d > r) continue;
        const i = yy * pw + xx;
        if (target === 'marks') {
          w.marks[i] = sub ? 0 : 1;
        } else {
          const k = Math.min(1, (r - d) / Math.max(1, r * 0.2)); // 80% hardness
          w.base[i] = sub ? Math.min(w.base[i], 1 - k) : Math.max(w.base[i], k);
        }
      }
    if (target === 'marks') w.anyMarks = !sub || w.marks.some((v) => v);
    else w.baseEdited = true;
  };

  const toProxy = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const b = c.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * c.width, y: ((e.clientY - b.top) / b.height) * c.height };
  };

  const radiusPx = () => Math.max(1, (live.current.size / 2) * (work.current?.scale ?? 1));

  // ------------------------------------------------------------ pointer
  const down = (e: React.PointerEvent) => {
    const w = work.current;
    if (!w || e.button !== 0 || busy) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toProxy(e);
    const sub = e.altKey;
    snapshot();
    w.stroke = { dabs: [], sub, last: null, start: p };
    if (tool === 'object') {
      w.box = { x: p.x, y: p.y, w: 0, h: 0 };
      return;
    }
    strokeTo(p);
  };

  const strokeTo = (p: { x: number; y: number }) => {
    const w = work.current!;
    const s = w.stroke!;
    const r = radiusPx();
    const from = s.last ?? p;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - from.x, p.y - from.y) / Math.max(1, r / 3)));
    for (let i = s.last ? 1 : 0; i <= steps; i++) {
      const q = { x: from.x + ((p.x - from.x) * i) / steps, y: from.y + ((p.y - from.y) * i) / steps };
      if (tool === 'quick') s.dabs.push({ ...q, r });
      else paint(q.x, q.y, r, s.sub, tool === 'brush' ? 'base' : 'marks');
    }
    s.last = p;
    if (tool === 'quick') {
      // Live feedback: show the stroke itself until the cut runs on release
      const c = canvasRef.current!;
      const ctx = ctx2d(c);
      ctx.fillStyle = s.sub ? 'rgba(255,80,80,0.45)' : 'rgba(80,170,255,0.45)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (tool === 'brush') {
      recompute();
    } else if (tool === 'refine') {
      // Draw the marks immediately; the matte updates on release
      const c = canvasRef.current!;
      const ctx = ctx2d(c);
      ctx.fillStyle = s.sub ? 'rgba(0,0,0,0.35)' : 'rgba(0,200,255,0.35)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const move = (e: React.PointerEvent) => {
    const w = work.current;
    if (!w) return;
    const p = toProxy(e);
    const c = canvasRef.current!;
    setBrush(tool === 'object' ? null : { left: (p.x / c.width) * 100, top: (p.y / c.height) * 100, d: ((radiusPx() * 2) / c.width) * 100 });
    if (!w.stroke) return;
    if (tool === 'object' && w.box) {
      const s = w.stroke.start;
      w.box = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
      draw();
      return;
    }
    strokeTo(p);
  };

  const up = (e: React.PointerEvent) => {
    const w = work.current;
    if (!w?.stroke) return;
    const s = w.stroke;
    w.stroke = null;
    const has = w.base.some((v) => v >= 0.5);
    if (tool === 'quick' && s.dabs.length) {
      const r = seg.strokeCut(w.img, has ? baseBytes() : null, s.dabs, s.sub ? 'sub' : 'add');
      if (r) {
        if (s.sub) mergeRegion(r, 'set');
        else mergeRegion(r, 'add');
      }
    } else if (tool === 'object') {
      const b = w.box;
      w.box = null;
      const p = toProxy(e);
      const sub = s.sub;
      setBusy('Selecting object');
      void (b && b.w >= 4 && b.h >= 4 ? findObjectInBox(w.img, b) : findObjectAt(w.img, p.x, p.y))
        .then((r) => {
          if (r && work.current === w) mergeRegion(r, sub ? 'sub' : 'add');
        })
        .finally(() => {
          setBusy(null);
          recompute();
          bump((n) => n + 1);
        });
      return;
    }
    recompute();
    bump((n) => n + 1);
  };

  // ------------------------------------------------------------ actions
  const run = (label: string, fn: () => void) => {
    setBusy(label);
    setTimeout(() => {
      try {
        fn();
      } finally {
        setBusy(null);
        recompute();
        bump((n) => n + 1);
      }
    }, 20);
  };

  const subject = () => {
    const w = work.current;
    if (!w) return;
    setBusy('Finding the subject');
    snapshot();
    void findSubject(w.img)
      .then((r) => {
        if (r && work.current === w) mergeRegion(r.region, 'replace');
      })
      .finally(() => {
        setBusy(null);
        recompute();
        bump((n) => n + 1);
      });
  };

  /** Refine Hair: widens the edge band and marks the busy (hairy) parts of the outline for matting. */
  const refineHair = () =>
    run('Refining hair', () => {
      const w = work.current!;
      snapshot();
      const { w: pw, h: ph } = w.img;
      const sdf = signedDistance(w.base, pw, ph);
      const detail = localDetail(luma(w.img), pw, ph, 3);
      const reach = Math.max(4, Math.round(Math.min(pw, ph) * 0.03));
      let any = false;
      for (let i = 0; i < w.marks.length; i++) {
        if (Math.abs(sdf[i]) <= reach && detail[i] > 0.05) {
          w.marks[i] = 1;
          any = true;
        }
      }
      w.anyMarks = w.anyMarks || any;
      const docR = Math.max(4, Math.round(Math.min(doc!.width, doc!.height) / 150));
      setPrefs((p) => ({ ...p, params: { ...p.params, smartRadius: true, radius: Math.max(p.params.radius, docR) } }));
    });

  const invert = () => {
    const w = work.current;
    if (!w) return;
    snapshot();
    for (let i = 0; i < w.base.length; i++) w.base[i] = 1 - w.base[i];
    w.baseEdited = true;
    recompute();
  };

  const reset = () => {
    const w = work.current;
    if (!w) return;
    snapshot();
    w.base.fill(0);
    w.marks.fill(0);
    w.anyMarks = false;
    w.baseEdited = true;
    setPrefs((p) => ({ ...p, params: { ...DEFAULT_REFINE } }));
    recompute();
  };

  const apply = () => {
    const w = work.current;
    if (!w || !doc) return;
    const { params, decon, deconAmount, output } = live.current.prefs;
    close();
    void store.task('Refining the selection', () => {
      const full = docImage();
      if (!full) return;
      const W = doc.width;
      const H = doc.height;
      let base: Float32Array;
      const orig = !w.baseEdited ? selectionAlpha() : null;
      if (orig) {
        base = new Float32Array(W * H);
        for (let i = 0; i < base.length; i++) base[i] = orig[i] / 255;
      } else base = guidedUpsample(full, w.base, w.img.w, w.img.h);
      let marks: Uint8Array | null = null;
      if (w.anyMarks) {
        marks = new Uint8Array(W * H);
        const fx = w.img.w / W;
        const fy = w.img.h / H;
        for (let y = 0; y < H; y++) {
          const py = Math.min(w.img.h - 1, Math.floor(y * fy));
          for (let x = 0; x < W; x++) marks[y * W + x] = w.marks[py * w.img.w + Math.min(w.img.w - 1, Math.floor(x * fx))];
        }
      }
      const res = refineMask(full, base, params, marks, 1);
      const pixels = decon && output !== 'selection' && output !== 'mask' ? decontaminate(full, res, deconAmount / 100) : null;
      outputMask(res.alpha, output, pixels);
    });
  };

  // ------------------------------------------------------------ keys
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Alt') setAltDown(e.type === 'keydown');
    if (e.type !== 'keydown') return;
    if (e.key === 'Escape') return close();
    if (e.key === 'Enter') return apply();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') return undo();
    if (e.key === '[') return setSize((v) => Math.max(2, Math.round(v / 1.2)));
    if (e.key === ']') return setSize((v) => Math.min(1500, Math.round(v * 1.2)));
    if (e.key.toLowerCase() === 'x') return setShowOriginal((v) => !v);
    if (e.key.toLowerCase() === 'j') return setShowEdge((v) => !v);
    if (e.key.toLowerCase() === 'f') {
      const i = VIEWS.findIndex((v) => v.id === prefs.view);
      return setPrefs((p) => ({ ...p, view: VIEWS[(i + 1) % VIEWS.length].id }));
    }
    const v = VIEWS.find((x) => x.key === e.key);
    if (v) return setPrefs((p) => ({ ...p, view: v.id }));
    const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (t) setTool(t.id);
  };

  if (!doc) return null;
  const p = prefs.params;
  const t = TOOLS.find((x) => x.id === tool)!;
  const ring = brush && tool !== 'object' ? { left: `${brush.left}%`, top: `${brush.top}%`, width: `${brush.d}%` } : null;
  const hasPixelsOut = prefs.output === 'layer' || prefs.output === 'layer-mask';

  return (
    <div className="overlay liquify-overlay">
      <div className="modal liquify select-mask" tabIndex={-1} ref={(el) => el?.focus()} onKeyDown={onKey} onKeyUp={onKey} data-testid="select-mask">
        <div className="modal-head">
          <span>Select and Mask</span>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="liquify-body">
          <div className="liquify-tools">
            {TOOLS.map((m) => (
              <button key={m.id} className={`liquify-tool ${tool === m.id ? 'active' : ''}`} title={`${m.label} (${m.key})`} aria-label={m.label} onClick={() => setTool(m.id)}>
                {m.icon}
              </button>
            ))}
          </div>
          <div className="liquify-stage">
            <div className={`liquify-frame sm-frame ${prefs.view === 'layers' || prefs.view === 'onion' ? 'checker' : ''}`}>
              <canvas
                ref={canvasRef}
                className="liquify-canvas sm-canvas"
                style={{ cursor: tool === 'object' ? 'crosshair' : 'none' }}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onPointerLeave={() => setBrush(null)}
              />
              {ring && <div className={`liquify-ring ${altDown ? 'minus' : ''}`} style={{ left: ring.left, top: ring.top, width: ring.width }} />}
              {busy && <div className="sm-busy">{busy}…</div>}
            </div>
          </div>
          <div className="liquify-side sm-side">
            <div className="sm-tool-card">
              <div className="liquify-mode">{t.label}</div>
              <div className="hint">{t.hint}</div>
              {tool !== 'object' && <Slider label="Size" value={size} min={2} max={1500} unit=" px" onChange={setSize} />}
              <div className="sm-row">
                <button className="btn ghost compact" onClick={subject} title="Find the main subject">
                  <UserRound size={13} /> Select Subject
                </button>
                <button className="btn ghost compact" onClick={refineHair} title="Mark hair and fur along the edge and widen the edge band">
                  <Sparkles size={13} /> Refine Hair
                </button>
              </div>
              <div className="sm-row">
                <button className="btn ghost compact" onClick={invert}>
                  <FlipHorizontal2 size={13} /> Invert
                </button>
                <button className="btn ghost compact" onClick={undo} disabled={!work.current?.undo.length} title="Undo (⌘Z)">
                  <RotateCcw size={13} /> Undo
                </button>
                <button className="btn ghost compact" onClick={reset}>
                  Reset
                </button>
              </div>
            </div>

            <div className="sm-section">
              <div className="mini-title">View</div>
              <div className="sm-views" role="radiogroup" aria-label="View mode">
                {VIEWS.map((v) => (
                  <button key={v.id} role="radio" aria-checked={prefs.view === v.id} className={prefs.view === v.id ? 'on' : ''} title={`${v.label} (${v.key}, F cycles)`} onClick={() => setPrefs((q) => ({ ...q, view: v.id }))}>
                    <span className={`sm-view-swatch sv-${v.id}`} />
                    {v.label}
                  </button>
                ))}
              </div>
              {(prefs.view === 'overlay' || prefs.view === 'onion') && (
                <Slider label={prefs.view === 'overlay' ? 'Overlay opacity' : 'Transparency'} value={prefs.opacity} min={0} max={100} unit="%" onChange={(v) => setPrefs((q) => ({ ...q, opacity: v }))} />
              )}
              {prefs.view === 'overlay' && (
                <div className="sm-row">
                  {['#ff3b30', '#2ea043', '#0078d4', '#000000', '#ffffff'].map((c) => (
                    <button key={c} className={`sm-swatch ${prefs.overlayColor === c ? 'sel' : ''}`} style={{ background: c }} aria-label={`Overlay ${c}`} onClick={() => setPrefs((q) => ({ ...q, overlayColor: c }))} />
                  ))}
                </div>
              )}
              <div className="sm-row">
                <Toggle label="Show Edge (J)" checked={showEdge} onChange={setShowEdge} />
                <Toggle label="Original (X)" checked={showOriginal} onChange={setShowOriginal} />
              </div>
            </div>

            <div className="sm-section">
              <div className="mini-title">Edge Detection</div>
              <Slider label="Radius" value={p.radius} min={0} max={250} def={0} unit=" px" onChange={(v) => setParams({ radius: v })} />
              <Toggle label="Smart Radius" title="Wide band on hair and fur, tight on crisp edges" checked={p.smartRadius} onChange={(v) => setParams({ smartRadius: v })} />
            </div>

            <div className="sm-section">
              <div className="mini-title">Global Refinements</div>
              <Slider label="Smooth" value={p.smooth} min={0} max={100} def={0} onChange={(v) => setParams({ smooth: v })} />
              <Slider label="Feather" value={p.feather} min={0} max={250} step={0.1} def={0} unit=" px" onChange={(v) => setParams({ feather: v })} />
              <Slider label="Contrast" value={p.contrast} min={0} max={100} def={0} unit="%" onChange={(v) => setParams({ contrast: v })} />
              <Slider label="Shift Edge" value={p.shiftEdge} min={-100} max={100} def={0} unit=" px" onChange={(v) => setParams({ shiftEdge: v })} />
            </div>

            <div className="sm-section">
              <div className="mini-title">Output</div>
              <Toggle label="Decontaminate Colors" checked={prefs.decon} onChange={(v) => setPrefs((q) => ({ ...q, decon: v, output: v && !hasPixelsOut ? 'layer-mask' : q.output }))} />
              {prefs.decon && <Slider label="Amount" value={prefs.deconAmount} min={0} max={100} unit="%" onChange={(v) => setPrefs((q) => ({ ...q, deconAmount: v }))} />}
              <Select value={prefs.output} title="Output To" onChange={(v) => setPrefs((q) => ({ ...q, output: v as MaskOutput }))} options={OUTPUTS} />
              {prefs.decon && !hasPixelsOut && <div className="hint">Decontaminated colours need a new layer output.</div>}
            </div>
            <div className="hint sm-keys">
              <Eye size={11} /> W R B O tools · ⌥ subtracts · [ ] size · F/1–6 views · ⌘Z undo
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={apply} data-testid="sm-ok">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function drawBox(ctx: CanvasRenderingContext2D, w: Work) {
  if (!w.box) return;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(w.box.x, w.box.y, w.box.w, w.box.h);
  ctx.strokeStyle = '#000';
  ctx.lineDashOffset = 5;
  ctx.strokeRect(w.box.x, w.box.y, w.box.w, w.box.h);
  ctx.restore();
}
