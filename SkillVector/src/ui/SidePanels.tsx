import { useEffect, useRef, useState } from 'react';
import {
  FilePlus, FileImage, Paintbrush, Brush, Square, Crop, Layers, Trash2, Merge, SlidersHorizontal, Move, Sparkles, Wand2, Pencil, RotateCw, Maximize, PaintBucket, Type, Filter as FilterIcon, Scissors,
} from 'lucide-react';
import { store, useStore } from '../core/store';
import { HARMONIES, contrastGrade, contrastRatio, harmony } from '../core/color';
import { Select } from './widgets';
import type { HarmonyKind } from '../core/color';
import * as pro from '../core/proTools';
import { onCursor } from './Viewport';
import { layerBounds } from '../core/align';
import { histogramOf } from '../core/ops';
import type { Histogram } from '../core/ops';
import { ctx2d } from '../core/canvas';

// ================================================================ histogram

export function HistogramPanel() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hist, setHist] = useState<Histogram | null>(null);
  useEffect(() => {
    let t = 0;
    const update = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        const d = store.doc;
        if (!d) return setHist(null);
        const out = store.docPixels();
        if (out.width > 1) setHist(histogramOf(out));
      }, 260);
    };
    const off = store.onRender(update);
    update();
    return () => {
      off();
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth;
    const H = c.clientHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = ctx2d(c);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!hist) return;
    ctx.globalCompositeOperation = 'lighter';
    const chans: [Uint32Array, string][] = [
      [hist.r, 'rgba(255,70,70,0.55)'],
      [hist.g, 'rgba(70,220,100,0.55)'],
      [hist.b, 'rgba(70,130,255,0.6)'],
    ];
    for (const [arr, color] of chans) {
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * W, H - Math.min(1, Math.sqrt(arr[i] / hist.max)) * (H - 2));
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // Clipping warnings
    const total = hist.l.reduce((s, v) => s + v, 0) || 1;
    if (hist.l[0] / total > 0.01) {
      ctx.fillStyle = '#4f8dff';
      ctx.fillRect(0, 0, 4, 4);
    }
    if (hist.l[255] / total > 0.01) {
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(W - 4, 0, 4, 4);
    }
  }, [hist]);

  return <canvas ref={ref} className="histogram" title="Histogram (corner markers warn of clipped shadows/highlights)" />;
}

// ================================================================ color

function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

const SWATCHES = [
  '#000000', '#3a3a3a', '#7a7a7a', '#bdbdbd', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be',
  '#30b0c7', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#f5d0b5', '#e0ac8a', '#8d5524', '#ff6b00',
];

export function ColorPanel() {
  const s = useStore();
  const [target, setTarget] = useState<'fg' | 'bg'>('fg');
  const hex = target === 'fg' ? s.fg : s.bg;
  const [hsv, setHsv] = useState(() => hexToHsv(hex));
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const [hexText, setHexText] = useState(hex);

  useEffect(() => {
    if (hsvToHex(...hsv) !== hex) setHsv(hexToHsv(hex));
    setHexText(hex);
  }, [hex]);

  const apply = (next: [number, number, number]) => {
    setHsv(next);
    store.set({ [target]: hsvToHex(...next) } as { fg: string });
  };

  const dragSV = (e: React.PointerEvent) => {
    const r = svRef.current!.getBoundingClientRect();
    const sx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const sy = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    apply([hsv[0], sx, sy]);
  };
  const dragHue = (e: React.PointerEvent) => {
    const r = hueRef.current!.getBoundingClientRect();
    apply([Math.max(0, Math.min(359.9, ((e.clientX - r.left) / r.width) * 360)), hsv[1], hsv[2]]);
  };

  return (
    <div className="color-panel">
      <div className="color-top">
        <div className="fgbg">
          <button className={`fgbg-chip bg ${target === 'bg' ? 'sel' : ''}`} style={{ background: s.bg }} onClick={() => setTarget('bg')} onDoubleClick={() => store.set({ dialog: { type: 'colorPicker', target: 'bg' } })} title="Edit background color (double-click: Color Picker)" />
          <button className={`fgbg-chip fg ${target === 'fg' ? 'sel' : ''}`} style={{ background: s.fg }} onClick={() => setTarget('fg')} onDoubleClick={() => store.set({ dialog: { type: 'colorPicker', target: 'fg' } })} title="Edit foreground color (double-click: Color Picker)" />
        </div>
        <input
          className="hex-input"
          value={hexText}
          onChange={(e) => setHexText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          onBlur={() => {
            const v = hexText.startsWith('#') ? hexText : `#${hexText}`;
            if (/^#[0-9a-f]{6}$/i.test(v)) store.set({ [target]: v.toLowerCase() } as { fg: string });
            else setHexText(hex);
          }}
        />
        <span className="rgb-read">
          {parseInt(hex.slice(1, 3), 16)} · {parseInt(hex.slice(3, 5), 16)} · {parseInt(hex.slice(5, 7), 16)}
        </span>
      </div>
      <div
        ref={svRef}
        className="sv-box"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex(hsv[0], 1, 1)})` }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          dragSV(e);
        }}
        onPointerMove={(e) => e.buttons && dragSV(e)}
        onPointerUp={() => store.pushRecentColor(hex)}
      >
        <div className="sv-knob" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: hex }} />
      </div>
      <div
        ref={hueRef}
        className="hue-bar"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          dragHue(e);
        }}
        onPointerMove={(e) => e.buttons && dragHue(e)}
      >
        <div className="hue-knob" style={{ left: `${(hsv[0] / 360) * 100}%` }} />
      </div>
      <div className="swatches">
        {SWATCHES.map((c) => (
          <button key={c} className="swatch" style={{ background: c }} title={c} onClick={() => store.set({ [target]: c } as { fg: string })} />
        ))}
      </div>
      <ColorExtras hex={hex} target={target} />
      {s.recentColors.length > 0 && (
        <>
          <div className="mini-title">Recent</div>
          <div className="swatches">
            {s.recentColors.map((c) => (
              <button key={c} className="swatch" style={{ background: c }} title={c} onClick={() => store.set({ [target]: c } as { fg: string })} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- harmonies, saved swatches, contrast

const SWATCH_KEY = 'photoscale-swatches';

function loadSwatches(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SWATCH_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x)) : [];
  } catch {
    return [];
  }
}

function ColorExtras({ hex, target }: { hex: string; target: 'fg' | 'bg' }) {
  const s = useStore();
  const [kind, setKind] = useState<HarmonyKind>('complementary');
  const [mine, setMine] = useState<string[]>(loadSwatches);
  const save = (list: string[]) => {
    setMine(list);
    try {
      localStorage.setItem(SWATCH_KEY, JSON.stringify(list));
    } catch {
      /* private mode: swatches last for this session */
    }
  };
  const pick = (c: string) => store.set({ [target]: c } as { fg: string });
  const ratio = contrastRatio(s.fg, s.bg);
  const grade = contrastGrade(ratio);
  return (
    <>
      <div className="color-tools">
        <button className="btn ghost" onClick={() => store.set({ dialog: { type: 'colorPicker', target } })}>
          Color Picker…
        </button>
        <span className={`contrast-badge ${grade === 'Fail' ? 'fail' : ''}`} title="WCAG contrast of the foreground on the background (text legibility)">
          <span style={{ background: s.bg, color: s.fg }}>Aa</span> {ratio.toFixed(1)}:1 {grade}
        </span>
      </div>
      <div className="mini-title harmony-title">
        Harmony
        <Select value={kind} onChange={setKind} options={HARMONIES.map((h) => ({ value: h.id, label: h.label }))} title="Color harmony" />
      </div>
      <div className="harmony">
        {harmony(hex, kind).map((c, i) => (
          <button key={i} className="harmony-swatch" style={{ background: c }} title={`${c} · click to use · Shift-click to save`} onClick={(e) => (e.shiftKey ? save([...new Set([...mine, c])]) : pick(c))} />
        ))}
      </div>
      <div className="mini-title">
        My swatches
        <button className="link-btn" onClick={() => save([...new Set([...mine, hex])])} title="Save the current color">
          + Add
        </button>
      </div>
      <div className="swatches">
        {mine.map((c) => (
          <button
            key={c}
            className="swatch"
            style={{ background: c }}
            title={`${c} · right-click to remove`}
            onClick={() => pick(c)}
            onContextMenu={(e) => {
              e.preventDefault();
              save(mine.filter((x) => x !== c));
            }}
          />
        ))}
        {!mine.length && <span className="hint">Save colors you use often</span>}
      </div>
    </>
  );
}

// ================================================================ history

const ICONS: Record<string, React.ReactNode> = {
  file: <FileImage size={12} />, brush: <Brush size={12} />, selection: <Square size={12} />, crop: <Crop size={12} />, layer: <Layers size={12} />,
  trash: <Trash2 size={12} />, merge: <Merge size={12} />, move: <Move size={12} />, magic: <Sparkles size={12} />, filter: <FilterIcon size={12} />,
  rotate: <RotateCw size={12} />, resize: <Maximize size={12} />, fill: <PaintBucket size={12} />, transform: <Move size={12} />, mask: <Wand2 size={12} />,
  gradient: <PaintBucket size={12} />, cut: <Scissors size={12} />, text: <Type size={12} />, edit: <Pencil size={12} />, new: <FilePlus size={12} />,
};

export function HistoryPanel() {
  useStore();
  const doc = store.doc;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector('.hist-row.current');
    el?.scrollIntoView({ block: 'nearest' });
  });
  if (!doc) return <div className="panel-empty">No document</div>;
  return (
    <div className="history-panel" ref={listRef}>
      {doc.history.map((h, i) => (
        <button key={i} className={`hist-row ${i === doc.hIndex ? 'current' : ''} ${i > doc.hIndex ? 'future' : ''}`} onClick={() => store.jumpHistory(i)}>
          <span
            className={`hist-source ${(store.state.historySource && doc.history.includes(store.state.historySource) ? store.state.historySource : doc.history[0]) === h ? 'on' : ''}`}
            title="History Brush paints from this state"
            onClick={(e) => {
              e.stopPropagation();
              store.set({ historySource: h });
            }}
          >
            <Paintbrush size={11} />
          </span>
          <span className="hist-icon">{ICONS[h.label.startsWith('New Adj') || h.label.startsWith('Preset') ? 'magic' : h.icon] ?? <SlidersHorizontal size={12} />}</span>
          <span className="hist-label">{h.label}</span>
          <span className="hist-time">{new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </button>
      ))}
      <div className="hint pad">Keeps the last 60 steps · ⌘Z / ⇧⌘Z</div>
    </div>
  );
}

// ================================================================ navigator

export function NavigatorPanel() {
  const ref = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useStore();
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = 0;
      const c = ref.current;
      const d = store.doc;
      if (!c || !d) return;
      const W = c.clientWidth;
      const H = c.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      c.width = W * dpr;
      c.height = H * dpr;
      const ctx = ctx2d(c);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = Math.min(W / d.width, H / d.height);
      const ox = (W - d.width * s) / 2;
      const oy = (H - d.height * s) / 2;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(store.docPixels(), ox, oy, d.width * s, d.height * s);
      const vp = document.querySelector('.viewport');
      if (vp) {
        const r = { width: (vp as HTMLElement).clientWidth, height: (vp as HTMLElement).clientHeight };
        const v = d.view;
        const x = (-v.panX / v.zoom) * s + ox;
        const y = (-v.panY / v.zoom) * s + oy;
        ctx.strokeStyle = '#ff6b00';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, (r.width / v.zoom) * s, (r.height / v.zoom) * s);
      }
    };
    const off = store.onRender(() => {
      if (!raf) raf = requestAnimationFrame(draw);
    });
    draw();
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, []);

  const jump = (e: React.PointerEvent) => {
    const c = ref.current;
    const d = store.doc;
    const vp = document.querySelector('.viewport');
    if (!c || !d || !vp) return;
    const r = c.getBoundingClientRect();
    const s = Math.min(r.width / d.width, r.height / d.height);
    const ox = (r.width - d.width * s) / 2;
    const oy = (r.height - d.height * s) / 2;
    const dx = (e.clientX - r.left - ox) / s;
    const dy = (e.clientY - r.top - oy) / s;
    const vr = { width: (vp as HTMLElement).clientWidth, height: (vp as HTMLElement).clientHeight };
    d.view.panX = vr.width / 2 - dx * d.view.zoom;
    d.view.panY = vr.height / 2 - dy * d.view.zoom;
    store.requestRender();
  };

  const doc = store.doc;
  return (
    <div className="navigator" ref={boxRef}>
      <canvas
        ref={ref}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          jump(e);
        }}
        onPointerMove={(e) => e.buttons && jump(e)}
      />
      {doc && (
        <div className="nav-zoom">
          <input
            type="range"
            min={-4.6}
            max={4.1}
            step={0.01}
            value={Math.log(doc.view.zoom)}
            onChange={(e) => {
              const vpEl = document.querySelector('.viewport') as HTMLElement;
              const vp = { width: vpEl.clientWidth, height: vpEl.clientHeight };
              const z = Math.exp(parseFloat(e.target.value));
              const v = doc.view;
              const cx = vp.width / 2;
              const cy = vp.height / 2;
              v.panX = cx - ((cx - v.panX) * z) / v.zoom;
              v.panY = cy - ((cy - v.panY) * z) / v.zoom;
              v.zoom = z;
              store.emit();
            }}
          />
          <span>{Math.round(doc.view.zoom * 100)}%</span>
        </div>
      )}
    </div>
  );
}

// ================================================================ info

function ColorReadout({ rgb }: { rgb: [number, number, number] }) {
  const hsb = pro.rgbToHsb(rgb);
  const lab = pro.rgbToLab(rgb);
  const cmyk = pro.rgbToCmyk(rgb);
  return (
    <div className="info-grid mono">
      <span>R {rgb[0]}</span><span>G {rgb[1]}</span><span>B {rgb[2]}</span><span>{pro.toHex(rgb)}</span>
      <span>H {hsb[0]}°</span><span>S {hsb[1]}%</span><span>B {hsb[2]}%</span><span />
      <span>L {lab[0]}</span><span>a {lab[1]}</span><span>b {lab[2]}</span><span />
      <span>C {cmyk[0]}%</span><span>M {cmyk[1]}%</span><span>Y {cmyk[2]}%</span><span>K {cmyk[3]}%</span>
    </div>
  );
}

/** Photoshop-style Info panel: cursor color in several models, pinned samplers, sizes, ruler. */
export function InfoPanel() {
  const s = useStore();
  const doc = store.doc;
  const [cur, setCur] = useState<{ x: number; y: number; color: string | null } | null>(null);
  const [, force] = useState(0);
  useEffect(() => onCursor(setCur), []);
  // Sampler values change whenever pixels do
  useEffect(() => {
    let t = 0;
    const off = store.onRender(() => {
      clearTimeout(t);
      t = window.setTimeout(() => force((n) => n + 1), 120);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, []);
  if (!doc) return <div className="panel-empty">No document</div>;
  const rgb = cur?.color ? pro.fromHex(cur.color) : null;
  const layer = store.activeLayer;
  const lb = layer ? layerBounds(layer) : null;
  const rl = pro.ruler.line;
  const m = rl ? pro.measure(rl.a, rl.b) : null;
  return (
    <div className="info-panel">
      <div className="info-head">
        <span className="mini-title">Cursor</span>
        <span className="mono info-xy">{cur ? `X ${cur.x}  Y ${cur.y}` : '—'}</span>
      </div>
      {rgb ? <ColorReadout rgb={rgb} /> : <div className="hint">Move over the image</div>}
      <div className="mini-title">Color samplers</div>
      {doc.samplers?.length ? (
        doc.samplers.map((sp, i) => {
          const v = pro.sampleAverage(sp.x, sp.y, s.opts.samplerSize);
          return (
            <div key={i} className="sampler-row mono">
              <span className="sampler-num">{i + 1}</span>
              <span className="sb-swatch" style={{ background: v ? pro.toHex(v.rgb) : 'transparent' }} />
              <span>{v ? `${v.rgb[0]}, ${v.rgb[1]}, ${v.rgb[2]}` : '—'}</span>
              <span className="hint">{v ? pro.toHex(v.rgb) : ''}</span>
              <span className="hint">@ {sp.x}, {sp.y}</span>
            </div>
          );
        })
      ) : (
        <div className="hint">Use the Color Sampler (Shift+I) to pin readouts</div>
      )}
      <div className="mini-title">Document</div>
      <div className="info-grid two mono">
        <span>Canvas</span><span>{doc.width} × {doc.height}</span>
        {doc.selection && (<><span>Selection</span><span>{doc.selection.bounds.width} × {doc.selection.bounds.height} @ {doc.selection.bounds.x}, {doc.selection.bounds.y}</span></>)}
        {lb && (<><span>Layer</span><span>{lb.width} × {lb.height} @ {lb.x}, {lb.y}</span></>)}
        {m && rl && (<><span>Ruler</span><span>{m.length.toFixed(1)} px · {m.angle.toFixed(2)}°</span></>)}
      </div>
    </div>
  );
}
