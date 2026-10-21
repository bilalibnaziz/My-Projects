// Appearance of everything selected: object opacity + blend, fill (colour, on/off, opacity), stroke
// (colour, weight, opacity, cap, join) and live corners on paths. Every control edits the whole
// selection in one undo step; values that differ across the selection show as "Mixed".

import { store, useStore } from '../core/store';
import { BLEND_MODES, withLayer } from '../core/types';
import type { BlendMode, Layer, ShapeGradient, ShapeProps } from '../core/types';
import { useRef, useState } from 'react';
import { ArrowLeftRight, Trash2 } from 'lucide-react';
import { frameVisible } from '../core/objectTransform';
import { isBackdrop } from '../core/tools';
import { pathCornerGeometry } from '../core/shapeWidgets';
import { colorAt, joinAlpha, splitAlpha } from '../core/gradientStops';
import { ColorInput, IconButton, NumberField, Select, Slider, Toggle } from './widgets';

const isLineShape = (s: ShapeProps) => s.shape === 'line' || s.shape === 'arrow' || s.shape === 'arc' || s.shape === 'spiral' || (s.shape === 'path' && !s.closed);

/** The layers the panel edits: the selection while its frame is shown, else the active shape / text. */
function appearanceTargets(): Layer[] {
  const a = store.activeLayer;
  const sel = frameVisible() ? store.selectedLayers : a && (a.kind === 'shape' || a.kind === 'text') ? [a] : [];
  return sel.filter((l) => l.kind !== 'adjustment' && !isBackdrop(l));
}

/** One undoable change over the targets; drags of the same control coalesce into one step. */
function patchTargets(targets: Layer[], label: string, fn: (l: Layer) => Partial<Layer> | null) {
  const doc = store.doc;
  if (!doc) return;
  const ids = new Set(targets.filter((l) => !l.locked).map((l) => l.id));
  let n = 0;
  const layers = doc.layers.map((l) => {
    if (!ids.has(l.id)) return l;
    const p = fn(l);
    if (!p) return l;
    n++;
    return withLayer(l, p);
  });
  if (n) store.commit(label, { layers }, { coalesce: `appearance:${label}:${[...ids].join(',')}` });
}

const shapePatch = (patch: Partial<ShapeProps>) => (l: Layer) => (l.kind === 'shape' && l.shape ? { shape: { ...l.shape, ...patch } } : null);

/** The common value, or null when the selection disagrees. */
function common<T>(vals: T[]): T | null {
  if (!vals.length) return null;
  return vals.every((v) => v === vals[0]) ? vals[0] : null;
}

const pct = (v: number) => Math.round(v * 100);

export function AppearanceSection() {
  useStore();
  const targets = appearanceTargets();
  if (!store.doc || !targets.length) return null;
  const shapes = targets.filter((l) => l.kind === 'shape' && l.shape) as (Layer & { shape: ShapeProps })[];
  const texts = targets.filter((l) => l.kind === 'text' && l.text);
  const fillable = shapes.filter((l) => !isLineShape(l.shape));

  const opacity = common(targets.map((l) => pct(l.opacity)));
  const blend = common(targets.map((l) => l.blend));
  const fillOn = common(fillable.map((l) => l.shape.fillEnabled));
  const fillColor = common([...fillable.map((l) => l.shape.fill), ...texts.map((l) => l.text!.color)]);
  const fillOp = common(fillable.map((l) => pct(l.shape.fillOpacity ?? 1)));
  const strokeColor = common(shapes.map((l) => l.shape.stroke));
  const strokeW = common(shapes.map((l) => l.shape.strokeWidth));
  const strokeOp = common(shapes.map((l) => pct(l.shape.strokeOpacity ?? 1)));
  const cap = common(shapes.map((l) => l.shape.strokeCap ?? 'round'));
  const join = common(shapes.map((l) => l.shape.strokeJoin ?? 'round'));
  const mixed = (v: unknown) => (v === null ? ' (mixed)' : '');

  // Live corners on the selected paths (rectangles and polygons have their own Shape section)
  const paths = shapes.filter((l) => l.shape.shape === 'path' && l.shape.points?.length);
  const corners = paths.flatMap((l) => pathCornerGeometry(l).map((g) => ({ l, g })));
  const cornerR = common(corners.map(({ g }) => Math.round(Math.min(g.radius, g.maxRadius) * 10) / 10));

  return (
    <div className="panel-section appearance-section">
      <div className="mini-title">
        Appearance{targets.length > 1 && <span className="mini-count">{targets.length} objects</span>}
      </div>

      <Slider
        label={`Opacity${mixed(opacity)}`}
        value={opacity ?? 100}
        min={0}
        max={100}
        def={100}
        unit="%"
        onChange={(v) => patchTargets(targets, 'Opacity', () => ({ opacity: v / 100 }))}
      />
      <div className="prop-row">
        <span className="prop-label">Blend</span>
        <Select<BlendMode | ''>
          value={blend ?? ''}
          title="Blend mode"
          onChange={(b) => b && patchTargets(targets, 'Blend Mode', () => ({ blend: b }))}
          options={[...(blend === null ? [{ value: '' as const, label: 'Mixed' }] : []), ...BLEND_MODES.map((m) => ({ value: m.id, label: m.label }))]}
        />
      </div>

      {(fillable.length > 0 || texts.length > 0) && (
        <>
          <div className="prop-row">
            <span className="prop-label">Fill</span>
            {fillable.length > 0 && (
              <Toggle
                label={fillOn === null ? 'Mixed' : 'On'}
                checked={fillOn !== false}
                onChange={(f) => patchTargets(fillable, 'Toggle Fill', shapePatch({ fillEnabled: f }))}
              />
            )}
            {(fillOn !== false || texts.length > 0) && (
              <ColorInput
                value={fillColor ?? '#808080'}
                title={fillColor === null ? 'Fill colour (mixed)' : 'Fill colour'}
                onChange={(c) => {
                  patchTargets([...fillable, ...texts], 'Fill Color', (l) =>
                    l.kind === 'shape' && l.shape
                      ? { shape: { ...l.shape, fill: c, fillEnabled: true } }
                      : l.text
                        ? { text: { ...l.text, color: c, runs: l.text.runs?.map(({ color: _c, ...r }) => r) } }
                        : null
                  );
                  store.set({ fg: c });
                }}
              />
            )}
          </div>
          {fillable.length > 0 && fillOn !== false && <GradientEditor shapes={fillable} />}
          {fillable.length > 0 && fillOn !== false && (
            <Slider
              label={`Fill opacity${mixed(fillOp)}`}
              value={fillOp ?? 100}
              min={0}
              max={100}
              def={100}
              unit="%"
              onChange={(v) => patchTargets(fillable, 'Fill Opacity', shapePatch({ fillOpacity: v >= 100 ? undefined : v / 100 }))}
            />
          )}
        </>
      )}

      {shapes.length > 0 && (
        <>
          <div className="prop-row">
            <span className="prop-label">Stroke</span>
            <ColorInput
              value={strokeColor ?? '#808080'}
              title={strokeColor === null ? 'Stroke colour (mixed)' : 'Stroke colour'}
              onChange={(c) => patchTargets(shapes, 'Stroke Color', (l) => (l.shape ? { shape: { ...l.shape, stroke: c, strokeWidth: l.shape.strokeWidth || 2 } } : null))}
            />
            <NumberField
              label="Weight"
              value={strokeW ?? 0}
              min={0}
              max={200}
              step={0.5}
              unit="px"
              onChange={(w) => patchTargets(shapes, 'Stroke Weight', shapePatch({ strokeWidth: w }))}
            />
          </div>
          {(strokeW === null || strokeW > 0) && (
            <>
              <Slider
                label={`Stroke opacity${mixed(strokeOp)}`}
                value={strokeOp ?? 100}
                min={0}
                max={100}
                def={100}
                unit="%"
                onChange={(v) => patchTargets(shapes, 'Stroke Opacity', shapePatch({ strokeOpacity: v >= 100 ? undefined : v / 100 }))}
              />
              <div className="prop-row">
                <Select<NonNullable<ShapeProps['strokeCap']> | ''>
                  value={cap ?? ''}
                  title="Stroke cap"
                  onChange={(c) => c && patchTargets(shapes, 'Stroke Cap', shapePatch({ strokeCap: c }))}
                  options={[...(cap === null ? [{ value: '' as const, label: 'Mixed caps' }] : []), { value: 'round', label: 'Round cap' }, { value: 'butt', label: 'Butt cap' }, { value: 'square', label: 'Square cap' }]}
                />
                <Select<NonNullable<ShapeProps['strokeJoin']> | ''>
                  value={join ?? ''}
                  title="Stroke join"
                  onChange={(j) => j && patchTargets(shapes, 'Stroke Join', shapePatch({ strokeJoin: j }))}
                  options={[...(join === null ? [{ value: '' as const, label: 'Mixed joins' }] : []), { value: 'round', label: 'Round join' }, { value: 'miter', label: 'Miter join' }, { value: 'bevel', label: 'Bevel join' }]}
                />
              </div>
            </>
          )}
        </>
      )}

      {corners.length > 0 && (
        <div className="prop-row" title="Live corners: rounds every sharp corner of the selected paths; the anchors stay editable. Drag the dots on the canvas for one corner (⌥).">
          <span className="prop-label">Corners</span>
          <NumberField
            label="Radius"
            value={cornerR ?? 0}
            min={0}
            max={10000}
            unit="px"
            onChange={(r) => {
              const doc = store.doc;
              if (!doc) return;
              const byLayer = new Map<string, Set<string>>();
              for (const { l, g } of corners) {
                const set = byLayer.get(l.id) ?? new Set<string>();
                set.add(`${g.ring}:${g.index}`);
                byLayer.set(l.id, set);
              }
              patchTargets(paths, 'Corner Radius', (l) => {
                const keys = byLayer.get(l.id);
                const s = l.shape!;
                if (!keys) return null;
                const rings = (s.compoundPoints?.length ? s.compoundPoints : [s.points ?? []]).map((ring, ri) =>
                  ring.map((a, i) => {
                    if (!keys.has(`${ri}:${i}`)) return a;
                    const { corner: _c, ...rest } = a;
                    return r > 0 ? { ...rest, corner: r } : rest;
                  })
                );
                return { shape: s.compoundPoints?.length ? { ...s, points: rings[0], compoundPoints: rings } : { ...s, points: rings[0] } };
              });
            }}
          />
          {cornerR === null && <span className="hint">mixed</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- gradient fill

type Stop = ShapeGradient['stops'][number];
const cssStops = (stops: Stop[]) => [...stops].sort((a, b) => a.offset - b.offset).map((s) => `${s.color} ${Math.round(s.offset * 1000) / 10}%`).join(', ');

/** Linear gradient angle in degrees (0 = left to right, clockwise), measured in document px. */
const gradAngle = (g: ShapeGradient, l: Layer) => Math.round((Math.atan2((g.y1 - g.y0) * l.height, (g.x1 - g.x0) * l.width) * 180) / Math.PI);

/** A linear gradient across the box at `deg`, reaching exactly from edge to edge. */
function linearAt(deg: number, l: Layer): Pick<ShapeGradient, 'x0' | 'y0' | 'x1' | 'y1'> {
  const a = (deg * Math.PI) / 180;
  const W = Math.abs(l.width) || 1, H = Math.abs(l.height) || 1;
  const half = (Math.abs(Math.cos(a)) * W + Math.abs(Math.sin(a)) * H) / 2;
  const dx = (Math.cos(a) * half) / W, dy = (Math.sin(a) * half) / H;
  return { x0: 0.5 - dx, y0: 0.5 - dy, x1: 0.5 + dx, y1: 0.5 + dy };
}

function GradientEditor({ shapes }: { shapes: (Layer & { shape: ShapeProps })[] }) {
  const [sel, setSel] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; moved: boolean } | null>(null);
  const first = shapes.find((l) => l.shape.gradient && l.shape.gradient.stops.length >= 2) ?? shapes[0];
  const g = first.shape.gradient && first.shape.gradient.stops.length >= 2 ? first.shape.gradient : null;
  const kind = g ? g.type : 'solid';

  /** Same stops (and type) on every selected shape; each keeps its own direction. */
  const setGradient = (label: string, fn: (g: ShapeGradient | undefined, l: Layer) => ShapeGradient | undefined) =>
    patchTargets(shapes, label, (l) => (l.shape ? { shape: { ...l.shape, gradient: fn(l.shape.gradient, l), fillEnabled: true } } : null));

  const setKind = (k: 'solid' | 'linear' | 'radial') => {
    if (k === 'solid') return setGradient('Solid Fill', () => undefined);
    const stops = g?.stops ?? [{ offset: 0, color: first.shape.fill }, { offset: 1, color: store.state.bg !== first.shape.fill ? store.state.bg : '#ffffff' }];
    setGradient(k === 'linear' ? 'Linear Gradient' : 'Radial Gradient', (cur, l) =>
      k === 'radial'
        ? { type: 'radial', x0: 0.5, y0: 0.5, x1: 1, y1: 0.5, stops: cur?.stops ?? stops }
        : { type: 'linear', ...(cur?.type === 'linear' ? { x0: cur.x0, y0: cur.y0, x1: cur.x1, y1: cur.y1 } : linearAt(0, l)), stops: cur?.stops ?? stops }
    );
  };

  const stops = g?.stops ?? [];
  const i = Math.min(sel, Math.max(0, stops.length - 1));
  const cur = stops[i];
  const setStops = (label: string, next: Stop[]) => setGradient(label, (gr) => (gr ? { ...gr, stops: next } : gr));
  const offsetAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
  };

  return (
    <div className="gradient-editor">
      <div className="prop-row">
        <span className="seg compact" role="radiogroup" aria-label="Fill type">
          {(['solid', 'linear', 'radial'] as const).map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {k === 'solid' ? 'Solid' : k === 'linear' ? 'Linear' : 'Radial'}
            </button>
          ))}
        </span>
        {g && (
          <IconButton
            icon={<ArrowLeftRight size={13} />}
            title="Reverse the gradient"
            onClick={() => setStops('Reverse Gradient', stops.map((s) => ({ ...s, offset: 1 - s.offset })).reverse())}
          />
        )}
      </div>
      {g && (
        <>
          <div
            ref={bar}
            className="grad-bar"
            title="Click to add a stop · drag a stop to move it · drag it down off the bar to remove it"
            onPointerDown={(e) => {
              if (e.target !== bar.current) return;
              const t = offsetAt(e.clientX);
              const next = [...stops, { offset: t, color: colorAt(stops, t) }];
              setStops('Add Gradient Stop', next);
              setSel(next.length - 1);
            }}
          >
            <div className="grad-fill" style={{ background: `linear-gradient(90deg, ${cssStops(stops)})` }} />
            {stops.map((st, k) => (
              <button
                key={k}
                className={`grad-stop ${k === i ? 'active' : ''}`}
                style={{ left: `${st.offset * 100}%`, ['--stop' as string]: st.color }}
                aria-label={`Stop ${k + 1} at ${Math.round(st.offset * 100)}%`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSel(k);
                  drag.current = { i: k, moved: false };
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d || !bar.current) return;
                  d.moved = true;
                  const r = bar.current.getBoundingClientRect();
                  const off = e.clientY > r.bottom + 30 && stops.length > 2;
                  (e.target as HTMLElement).style.opacity = off ? '0.3' : '';
                  if (!off) setStops('Move Gradient Stop', stops.map((s, j) => (j === d.i ? { ...s, offset: Math.round(offsetAt(e.clientX) * 1000) / 1000 } : s)));
                }}
                onPointerUp={(e) => {
                  const d = drag.current;
                  drag.current = null;
                  (e.target as HTMLElement).style.opacity = '';
                  const r = bar.current?.getBoundingClientRect();
                  if (d && r && e.clientY > r.bottom + 30 && stops.length > 2) {
                    setStops('Delete Gradient Stop', stops.filter((_, j) => j !== d.i));
                    setSel(0);
                  }
                }}
              />
            ))}
          </div>
          {cur && (
            <>
              <div className="prop-row">
                <span className="prop-label">Stop</span>
                <ColorInput
                  value={splitAlpha(cur.color).hex}
                  title="Stop colour"
                  onChange={(c) => setStops('Gradient Stop Color', stops.map((s, j) => (j === i ? { ...s, color: joinAlpha(c, splitAlpha(s.color).a) } : s)))}
                />
                <NumberField
                  label="At"
                  value={Math.round(cur.offset * 100)}
                  min={0}
                  max={100}
                  unit="%"
                  width={34}
                  onChange={(v) => setStops('Move Gradient Stop', stops.map((s, j) => (j === i ? { ...s, offset: v / 100 } : s)))}
                />
                <IconButton
                  icon={<Trash2 size={13} />}
                  title="Delete this stop"
                  disabled={stops.length <= 2}
                  onClick={() => {
                    setStops('Delete Gradient Stop', stops.filter((_, j) => j !== i));
                    setSel(0);
                  }}
                />
              </div>
              <Slider
                label="Stop opacity"
                value={Math.round(splitAlpha(cur.color).a * 100)}
                min={0}
                max={100}
                def={100}
                unit="%"
                onChange={(v) => setStops('Gradient Stop Opacity', stops.map((s, j) => (j === i ? { ...s, color: joinAlpha(splitAlpha(s.color).hex, v / 100) } : s)))}
              />
            </>
          )}
          {g.type === 'linear' && (
            <div className="prop-row">
              <NumberField
                label="Angle"
                value={gradAngle(g, first)}
                min={-360}
                max={360}
                unit="°"
                onChange={(deg) => setGradient('Gradient Angle', (gr, l) => (gr ? { ...gr, ...linearAt(deg, l) } : gr))}
              />
              <span className="hint">or drag with the Gradient tool (G)</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
