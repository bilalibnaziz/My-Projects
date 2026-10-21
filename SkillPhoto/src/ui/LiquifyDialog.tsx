// Liquify workspace: push, twirl, pucker and bloat pixels with a brush on a live preview, then apply.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Move, RotateCw, RotateCcw, Shrink, Expand, Eraser } from 'lucide-react';
import type { ReactNode } from 'react';
import { store } from '../core/store';
import { createCanvas, ctx2d } from '../core/canvas';
import { applyLiquifyStroke, commitLiquify, createLiquifyMesh, renderLiquifyPreview } from '../core/liquify';
import type { LiquifyMesh, LiquifyMode } from '../core/liquify';
import { Slider } from './widgets';

const MODES: { id: LiquifyMode; label: string; key: string; icon: ReactNode }[] = [
  { id: 'warp', label: 'Forward Warp', key: 'W', icon: <Move size={15} /> },
  { id: 'reconstruct', label: 'Reconstruct', key: 'R', icon: <Eraser size={15} /> },
  { id: 'twirl-cw', label: 'Twirl Clockwise', key: 'C', icon: <RotateCw size={15} /> },
  { id: 'twirl-ccw', label: 'Twirl Counterclockwise', key: 'V', icon: <RotateCcw size={15} /> },
  { id: 'pucker', label: 'Pucker', key: 'S', icon: <Shrink size={15} /> },
  { id: 'bloat', label: 'Bloat', key: 'B', icon: <Expand size={15} /> },
];

/** Modes that keep working while the brush is held still (like Photoshop). */
const CONTINUOUS = new Set<LiquifyMode>(['twirl-cw', 'twirl-ccw', 'pucker', 'bloat', 'reconstruct']);
const PREVIEW_MAX = 1400;

export function LiquifyDialog() {
  const layer = store.activeLayer;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<LiquifyMode>('warp');
  const [size, setSize] = useState(() => Math.round(Math.max(20, Math.min(400, (layer?.canvas?.width ?? 1000) / 12))));
  const [pressure, setPressure] = useState(50);
  // Brush ring position in % of the preview, and preview pixels per layer pixel as % of its width
  const [brush, setBrush] = useState<{ left: number; top: number; per: number } | null>(null);
  const [edited, setEdited] = useState(false);

  // Everything the pointer loop needs, kept outside React state so dabs don't re-render
  const work = useRef<{
    mesh: LiquifyMesh;
    scale: number;
    src: ImageData;
    dst: ImageData;
    ctx: CanvasRenderingContext2D;
    last: { x: number; y: number } | null;
    held: { x: number; y: number } | null;
    raf: number;
  } | null>(null);
  const opts = useRef({ mode, size, pressure });
  useLayoutEffect(() => {
    opts.current = { mode, size, pressure };
  }, [mode, size, pressure]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!layer?.canvas || !c) return;
    const lw = layer.canvas.width;
    const lh = layer.canvas.height;
    const scale = Math.min(1, PREVIEW_MAX / Math.max(lw, lh));
    c.width = Math.max(1, Math.round(lw * scale));
    c.height = Math.max(1, Math.round(lh * scale));
    const proxy = createCanvas(c.width, c.height);
    const pctx = ctx2d(proxy);
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(layer.canvas, 0, 0, c.width, c.height);
    const src = pctx.getImageData(0, 0, c.width, c.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const dst = new ImageData(new Uint8ClampedArray(src.data), c.width, c.height);
    ctx.putImageData(dst, 0, 0);
    const mesh = createLiquifyMesh(lw, lh, Math.max(4, Math.round(Math.max(lw, lh) / 300)));
    work.current = { mesh, scale, src, dst, ctx, last: null, held: null, raf: 0 };
    return () => cancelAnimationFrame(work.current?.raf ?? 0);
  }, [layer]);

  const close = () => store.set({ dialog: null });

  /** One brush dab at layer coordinates (x, y), redrawing only the area it touched. */
  const dab = (x: number, y: number, from: { x: number; y: number }) => {
    const w = work.current;
    if (!w) return;
    const { mode: m, size: sz, pressure: p } = opts.current;
    const radius = sz / 2;
    applyLiquifyStroke(w.mesh, m, x, y, from.x, from.y, radius, p / 100);
    const pad = radius + 2 + Math.abs(x - from.x) + Math.abs(y - from.y);
    const r = { x0: (Math.min(x, from.x) - pad) * w.scale, y0: (Math.min(y, from.y) - pad) * w.scale, x1: (Math.max(x, from.x) + pad) * w.scale, y1: (Math.max(y, from.y) + pad) * w.scale };
    renderLiquifyPreview(w.src, w.dst, w.mesh, w.scale, r);
    const x0 = Math.max(0, Math.floor(r.x0));
    const y0 = Math.max(0, Math.floor(r.y0));
    w.ctx.putImageData(w.dst, 0, 0, x0, y0, Math.ceil(r.x1) - x0, Math.ceil(r.y1) - y0);
    setEdited(true);
  };

  const toLayer = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const b = c.getBoundingClientRect();
    const w = work.current!;
    return { x: ((e.clientX - b.left) / b.width) * c.width / w.scale, y: ((e.clientY - b.top) / b.height) * c.height / w.scale };
  };

  const holdLoop = () => {
    const w = work.current;
    if (!w?.held) return;
    if (CONTINUOUS.has(opts.current.mode)) dab(w.held.x, w.held.y, w.held);
    w.raf = requestAnimationFrame(holdLoop);
  };

  const down = (e: React.PointerEvent) => {
    const w = work.current;
    if (!w || e.button !== 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toLayer(e);
    w.last = p;
    w.held = p;
    w.raf = requestAnimationFrame(holdLoop);
  };

  const move = (e: React.PointerEvent) => {
    const w = work.current;
    if (!w) return;
    const p = toLayer(e);
    const cw = canvasRef.current!.width;
    const ch = canvasRef.current!.height;
    setBrush({ left: ((p.x * w.scale) / cw) * 100, top: ((p.y * w.scale) / ch) * 100, per: (w.scale / cw) * 100 });
    if (!w.last) return;
    // Space dabs a quarter brush apart so fast strokes stay smooth
    const step = Math.max(1, opts.current.size / 8);
    const dist = Math.hypot(p.x - w.last.x, p.y - w.last.y);
    const n = Math.max(1, Math.ceil(dist / step));
    let prev = w.last;
    for (let i = 1; i <= n; i++) {
      const q = { x: w.last.x + ((p.x - w.last.x) * i) / n, y: w.last.y + ((p.y - w.last.y) * i) / n };
      if (opts.current.mode === 'warp' || !CONTINUOUS.has(opts.current.mode)) dab(q.x, q.y, prev);
      prev = q;
    }
    w.last = p;
    w.held = p;
  };

  const up = () => {
    const w = work.current;
    if (!w) return;
    w.last = null;
    w.held = null;
    cancelAnimationFrame(w.raf);
  };

  const restoreAll = () => {
    const w = work.current;
    if (!w) return;
    w.mesh.dx.fill(0);
    w.mesh.dy.fill(0);
    w.dst.data.set(w.src.data);
    w.ctx.putImageData(w.dst, 0, 0);
    setEdited(false);
  };

  const apply = async () => {
    const w = work.current;
    const id = layer?.id;
    close();
    if (w && id) await commitLiquify(id, w.mesh);
  };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') return close();
    if (e.key === 'Enter') return void apply();
    if (e.key === '[') return setSize((v) => Math.max(4, Math.round(v / 1.15)));
    if (e.key === ']') return setSize((v) => Math.min(1500, Math.round(v * 1.15)));
    const m = MODES.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (m) setMode(m.id);
  };

  if (!layer?.canvas) {
    return (
      <div className="overlay" onPointerDown={close}>
        <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
          <div className="modal-body">Liquify needs a pixel layer. Select one and try again.</div>
        </div>
      </div>
    );
  }

  const ring = brush ? { left: `${brush.left}%`, top: `${brush.top}%`, width: `${size * brush.per}%` } : null;

  return (
    <div className="overlay liquify-overlay">
      <div className="modal liquify" tabIndex={-1} ref={(el) => el?.focus()} onKeyDown={onKey}>
        <div className="modal-head">
          <span>Liquify — {layer.name}</span>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="liquify-body">
          <div className="liquify-tools">
            {MODES.map((m) => (
              <button key={m.id} className={`liquify-tool ${mode === m.id ? 'active' : ''}`} title={`${m.label} (${m.key})`} aria-label={m.label} onClick={() => setMode(m.id)}>
                {m.icon}
              </button>
            ))}
          </div>
          <div className="liquify-stage">
            <div className="liquify-frame">
              <canvas
                ref={canvasRef}
                className="liquify-canvas"
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onPointerLeave={() => setBrush(null)}
              />
              {ring && <div className="liquify-ring" style={{ left: ring.left, top: ring.top, width: ring.width }} />}
            </div>
          </div>
          <div className="liquify-side">
            <div className="liquify-mode">{MODES.find((m) => m.id === mode)!.label}</div>
            <Slider label="Size" value={size} min={4} max={1500} unit=" px" onChange={setSize} />
            <Slider label="Pressure" value={pressure} min={1} max={100} unit="%" onChange={setPressure} />
            <button className="btn ghost" onClick={restoreAll} disabled={!edited}>
              Restore All
            </button>
            <div className="hint">
              Drag to push pixels. Twirl, Pucker, Bloat and Reconstruct keep working while you hold the brush still. [ and ] change the size.
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void apply()} disabled={!edited}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
