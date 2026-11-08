import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, X, Copy, ClipboardPaste, Eraser } from 'lucide-react';
import { store, useStore } from '../core/store';
import type { FxKey, LayerFx } from '../core/types';
import { fullFx } from '../core/types';
import { computeFx } from '../core/effects';
import { createCanvas, ctx2d } from '../core/canvas';
import { STYLE_PRESETS, applyPreset, canPasteStyle, clearStyle, copyStyle, pasteStyle, presetFx, setEffect, setFill } from '../core/layerStyle';
import { ColorInput, Slider } from './widgets';

const EFFECTS: { key: FxKey; label: string }[] = [
  { key: 'dropShadow', label: 'Drop Shadow' },
  { key: 'outerGlow', label: 'Outer Glow' },
  { key: 'stroke', label: 'Stroke' },
  { key: 'innerShadow', label: 'Inner Shadow' },
  { key: 'innerGlow', label: 'Inner Glow' },
  { key: 'bevel', label: 'Bevel & Emboss' },
  { key: 'colorOverlay', label: 'Color Overlay' },
  { key: 'gradientOverlay', label: 'Gradient Overlay' },
];

/** Drag-to-set angle dial (Photoshop convention: 0° = right, 90° = up). */
function AngleDial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const a = Math.atan2(-(e.clientY - (r.top + r.height / 2)), e.clientX - (r.left + r.width / 2));
    let deg = Math.round((a * 180) / Math.PI);
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    onChange(deg);
  };
  const rad = (value * Math.PI) / 180;
  return (
    <div
      ref={ref}
      className="angle-dial"
      title="Drag to set the light angle (Shift snaps to 15°)"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        set(e);
      }}
      onPointerMove={(e) => e.buttons && set(e)}
    >
      <span style={{ transform: `translate(-50%, -50%) translate(${Math.cos(rad) * 9}px, ${-Math.sin(rad) * 9}px)` }} />
    </div>
  );
}

function Angle({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="fx-angle">
      <AngleDial value={value} onChange={onChange} />
      <div className="fx-grow">
        <Slider label="Angle" value={value} min={-180} max={180} def={120} unit="°" onChange={onChange} />
      </div>
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="fx-color-row">
      <span>{label}</span>
      <ColorInput value={value} onChange={onChange} title={label} />
      <code>{value.toUpperCase()}</code>
    </div>
  );
}

function EffectBody({ k, fx }: { k: FxKey; fx: LayerFx }) {
  const up = <K extends FxKey>(key: K) => (p: Partial<LayerFx[K]>) => setEffect(key, p);
  switch (k) {
    case 'dropShadow':
    case 'innerShadow': {
      const e = fx[k];
      const u = up(k);
      return (
        <>
          <ColorRow label="Color" value={e.color} onChange={(color) => u({ color })} />
          <Slider label="Opacity" value={e.opacity} min={0} max={100} unit="%" onChange={(opacity) => u({ opacity })} />
          <Angle value={e.angle} onChange={(angle) => u({ angle })} />
          <Slider label="Distance" value={e.distance} min={0} max={500} unit="px" onChange={(distance) => u({ distance })} />
          <Slider label={k === 'dropShadow' ? 'Spread' : 'Choke'} value={e.spread} min={0} max={100} unit="%" onChange={(spread) => u({ spread })} />
          <Slider label="Size" value={e.size} min={0} max={250} unit="px" onChange={(size) => u({ size })} />
        </>
      );
    }
    case 'outerGlow':
    case 'innerGlow': {
      const e = fx[k];
      const u = up(k);
      return (
        <>
          <ColorRow label="Color" value={e.color} onChange={(color) => u({ color })} />
          <Slider label="Opacity" value={e.opacity} min={0} max={100} unit="%" onChange={(opacity) => u({ opacity })} />
          <Slider label={k === 'outerGlow' ? 'Spread' : 'Choke'} value={e.spread} min={0} max={100} unit="%" onChange={(spread) => u({ spread })} />
          <Slider label="Size" value={e.size} min={0} max={250} unit="px" onChange={(size) => u({ size })} />
        </>
      );
    }
    case 'stroke': {
      const e = fx.stroke;
      const u = up('stroke');
      return (
        <>
          <ColorRow label="Color" value={e.color} onChange={(color) => u({ color })} />
          <div className="fx-seg">
            {(['outside', 'center', 'inside'] as const).map((p) => (
              <button key={p} className={e.position === p ? 'on' : ''} onClick={() => u({ position: p })}>
                {p[0].toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <Slider label="Size" value={e.size} min={1} max={250} unit="px" onChange={(size) => u({ size })} />
          <Slider label="Opacity" value={e.opacity} min={0} max={100} unit="%" onChange={(opacity) => u({ opacity })} />
        </>
      );
    }
    case 'colorOverlay': {
      const e = fx.colorOverlay;
      const u = up('colorOverlay');
      return (
        <>
          <ColorRow label="Color" value={e.color} onChange={(color) => u({ color })} />
          <Slider label="Opacity" value={e.opacity} min={0} max={100} unit="%" onChange={(opacity) => u({ opacity })} />
        </>
      );
    }
    case 'gradientOverlay': {
      const e = fx.gradientOverlay;
      const u = up('gradientOverlay');
      return (
        <>
          <div className="fx-gradient">
            <ColorInput value={e.from} onChange={(from) => u({ from })} title="Start color" />
            <div className="fx-gradient-bar" style={{ background: `linear-gradient(90deg, ${e.from}, ${e.to})` }} />
            <ColorInput value={e.to} onChange={(to) => u({ to })} title="End color" />
            <button className="btn ghost fx-mini" onClick={() => u({ from: e.to, to: e.from })} title="Reverse">⇄</button>
          </div>
          <Angle value={e.angle} onChange={(angle) => u({ angle })} />
          <Slider label="Opacity" value={e.opacity} min={0} max={100} unit="%" onChange={(opacity) => u({ opacity })} />
        </>
      );
    }
    case 'bevel': {
      const e = fx.bevel;
      const u = up('bevel');
      return (
        <>
          <Slider label="Size" value={e.size} min={1} max={150} unit="px" onChange={(size) => u({ size })} />
          <Slider label="Depth" value={e.depth} min={1} max={500} unit="%" def={100} onChange={(depth) => u({ depth })} />
          <Angle value={e.angle} onChange={(angle) => u({ angle })} />
          <Slider label="Altitude" value={e.altitude} min={0} max={90} unit="°" def={30} onChange={(altitude) => u({ altitude })} />
          <ColorRow label="Highlight" value={e.highlight} onChange={(highlight) => u({ highlight })} />
          <ColorRow label="Shadow" value={e.shadow} onChange={(shadow) => u({ shadow })} />
          <Slider label="Opacity" value={e.opacity} min={0} max={100} unit="%" onChange={(opacity) => u({ opacity })} />
        </>
      );
    }
  }
}

// ---------------------------------------------------------------- preset previews

const previewCache = new Map<string, string>();

/** Small "Aa" sample rendered with the preset (sizes scaled down to the thumbnail). */
function presetPreview(id: string): string {
  const hit = previewCache.get(id);
  if (hit) return hit;
  const p = STYLE_PRESETS.find((x) => x.id === id)!;
  const fx = presetFx(p);
  const k = 0.22;
  for (const e of Object.values(fx) as Record<string, number>[]) {
    for (const f of ['size', 'distance']) if (typeof e[f] === 'number') e[f] = Math.max(e[f] > 0 ? 1 : 0, Math.round(e[f] * k));
  }
  const w = 44;
  const h = 34;
  const c = createCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.fillStyle = '#e8e8ee';
  ctx.font = '800 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Aa', w / 2, h / 2 + 1);
  const src = ctx.getImageData(0, 0, w, h);
  const r = computeFx(src.data, w, h, fx, p.fill ?? 1);
  const out = createCanvas(r.width, r.height);
  const octx = ctx2d(out);
  octx.putImageData(new ImageData(r.behind as Uint8ClampedArray<ArrayBuffer>, r.width, r.height, { colorSpace: src.colorSpace }), 0, 0);
  const front = createCanvas(r.width, r.height);
  ctx2d(front).putImageData(new ImageData(r.front as Uint8ClampedArray<ArrayBuffer>, r.width, r.height, { colorSpace: src.colorSpace }), 0, 0);
  octx.drawImage(front, 0, 0);
  const url = out.toDataURL();
  previewCache.set(id, url);
  return url;
}

// ---------------------------------------------------------------- panel

export function LayerStylePanel() {
  useStore();
  const layer = store.activeLayer;
  const [open, setOpen] = useState<FxKey | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const close = () => store.set({ dialog: null });
  if (!layer) return null;
  const fx = fullFx(layer.fx);
  const styleable = layer.kind !== 'adjustment';
  return (
    <div
      ref={ref}
      className="fx-panel"
      tabIndex={-1}
      role="dialog"
      aria-label="Layer Style"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="fx-head">
        <span className="fx-title">Layer Style</span>
        <span className="fx-layer">{layer.name}</span>
        <button className="icon-btn" onClick={close} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      {!styleable ? (
        <div className="fx-empty">Adjustment layers have no styles. Pick a pixel, text or shape layer.</div>
      ) : (
        <div className="fx-body">
          <div className="fx-presets">
            {STYLE_PRESETS.map((p) => (
              <button key={p.id} className="fx-preset" onClick={() => applyPreset(p.id)} title={`Apply "${p.label}" (replaces the current style)`}>
                <img src={presetPreview(p.id)} alt="" />
                <span>{p.label}</span>
              </button>
            ))}
          </div>
          <Slider
            label="Fill Opacity"
            value={Math.round((layer.fill ?? 1) * 100)}
            min={0}
            max={100}
            def={100}
            unit="%"
            onChange={(v) => setFill(v / 100)}
          />
          <div className="fx-list">
            {EFFECTS.map(({ key, label }) => {
              const e = fx[key];
              const expanded = open === key;
              return (
                <div key={key} className={`fx-item ${e.enabled ? 'on' : ''} ${expanded ? 'open' : ''}`}>
                  <div className="fx-item-head" onClick={() => setOpen(expanded ? null : key)}>
                    <label className="toggle" onClick={(ev) => ev.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={label}
                        checked={e.enabled}
                        onChange={(ev) => {
                          setEffect(key, { enabled: ev.target.checked } as Partial<LayerFx[typeof key]>);
                          if (ev.target.checked) setOpen(key);
                        }}
                      />
                      <span className="toggle-box" />
                    </label>
                    <span className="fx-name">{label}</span>
                    {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </div>
                  {expanded && (
                    <div className={`fx-item-body ${e.enabled ? '' : 'dim'}`}>
                      <EffectBody k={key} fx={fx} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {styleable && (
        <div className="fx-foot">
          <button className="btn ghost" onClick={clearStyle} title="Remove all effects">
            <Eraser size={13} /> Clear
          </button>
          <button className="btn ghost" onClick={copyStyle} title="Copy this layer's style">
            <Copy size={13} /> Copy
          </button>
          <button className="btn ghost" onClick={pasteStyle} disabled={!canPasteStyle()} title="Paste the copied style onto the selected layers">
            <ClipboardPaste size={13} /> Paste
          </button>
          <div className="opt-spacer" />
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
