// Active Toolbox: a slim strip beside the panels that follows the active tool. It lists every tool of
// the active tool's family (the flyout group it belongs to) with its shortcut, the tools used most
// recently from other families, and a hover card per tool: name, key, what it does, its gestures.
// Below them, "Live" knobs for the active tool's key settings (drag up / down, scroll, double-click to
// type): they edit the selected shape or text live, or set up the next one.

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { store, useStore } from '../core/store';
import type { ToolId, ToolOptions } from '../core/store';
import { applyTextStyle, isLiquifyTool } from '../core/tools';
import { cornerRadii, DEFAULT_STAR_INNER } from '../core/shapeGeometry';
import { ADVANCED_GROUPS, TOOLS } from './ToolRail';
import { keyTips, shapeTarget, toolFamily } from './ToolContext';

/** The tools that share the active tool's flyout group (or its category when it has no group). */
function toolFamilyMembers(t: ToolId): ToolId[] {
  const g = ADVANCED_GROUPS.find((x) => x.includes(t));
  if (g) return g;
  const cat = TOOLS[t]?.category;
  return cat ? (Object.keys(TOOLS) as ToolId[]).filter((id) => TOOLS[id].category === cat).slice(0, 10) : [t];
}

// Recently used tools, most recent first (kept across renders, updated after each tool change)
let recent: ToolId[] = [];
const RECENT_MAX = 5;

type Hover = { id: ToolId; top: number; right: number } | null;

interface Knob {
  id: string;
  /** Short label (fits the 40 px strip). */
  label: string;
  /** Full name for the hover title. */
  title: string;
  value: number;
  min: number;
  max: number;
  /** Units per 2 px of drag. */
  step?: number;
  unit?: string;
  set: (v: number) => void;
}

/** The key settings of a tool, wired to the same state its Properties controls use. */
function quickKnobs(t: ToolId): Knob[] {
  const o = store.state.opts;
  const setO = (p: Partial<ToolOptions>) => store.setOpts(p);
  const knobs: Knob[] = [];
  const fam = toolFamily(t);
  if (fam === 'shape') {
    const st = shapeTarget(t);
    if (st) {
      const c = st.cur;
      if (st.type === 'rectangle' || st.type === 'round-rect') {
        const r = cornerRadii(c);
        const max = st.layer ? Math.max(1, Math.floor(Math.min(Math.abs(st.layer.width), Math.abs(st.layer.height)) / 2)) : 500;
        knobs.push({ id: 'radius', label: 'Rad', title: c.radii ? 'Corner radius (all corners — they differ now)' : 'Corner radius', value: Math.round(Math.max(...r)), min: 0, max, unit: 'px', set: (v) => st.apply({ radius: v, radii: undefined }, 'Corner Radius') });
      }
      if (st.type === 'polygon' || st.type === 'star') {
        const star = st.type === 'star';
        knobs.push({ id: 'sides', label: star ? 'Pts' : 'Sides', title: star ? 'Star points' : 'Polygon sides', value: c.sides ?? (star ? 5 : 6), min: 3, max: star ? 60 : 64, step: 0.5, set: (v) => st.apply({ sides: Math.round(v) }, 'Sides') });
        if (star) knobs.push({ id: 'inner', label: 'Inner', title: 'Star inner radius', value: Math.round((c.innerRatio ?? DEFAULT_STAR_INNER) * 100), min: 2, max: 98, unit: '%', set: (v) => st.apply({ innerRatio: v / 100 }, 'Star Inner Radius') });
        knobs.push({ id: 'round', label: 'Round', title: 'Round every point', value: Math.round(c.pointRadius ?? 0), min: 0, max: 500, unit: 'px', set: (v) => st.apply({ pointRadius: v }, 'Round Points') });
      }
      if (st.type === 'ellipse') knobs.push({ id: 'hole', label: 'Hole', title: 'Donut hole', value: Math.round((c.hole ?? 0) * 100), min: 0, max: 95, unit: '%', set: (v) => st.apply({ hole: v > 0 ? v / 100 : undefined }, 'Ellipse Hole') });
      knobs.push(strokeKnob(st.layer?.id ?? null, st.layer?.shape?.strokeWidth ?? o.shapeStrokeWidth));
    }
    return knobs;
  }
  if (t === 'pencil') {
    knobs.push(strokeKnob(null, o.shapeStrokeWidth));
    knobs.push({ id: 'fidelity', label: 'Fid', title: 'Fidelity: low = follows the hand exactly, high = smoother curves', value: o.pencilFidelity, min: 1, max: 20, step: 0.5, set: (v) => setO({ pencilFidelity: Math.round(v) }) });
    knobs.push({ id: 'streamline', label: 'Stab', title: 'StreamLine stabilizer (0 = off)', value: o.pencilStreamline, min: 0, max: 50, set: (v) => setO({ pencilStreamline: v }) });
    return knobs;
  }
  if (t === 'pen' || t === 'curvature' || t === 'shaper') return [strokeKnob(null, o.shapeStrokeWidth)];
  if (t === 'brush' || t === 'blob-brush' || t === 'eraser' || t === 'path-eraser' || t === 'smooth' || isLiquifyTool(t) || t.startsWith('symbol-')) {
    return [{ id: 'size', label: 'Size', title: 'Brush size ( [ and ] also work)', value: o.size, min: 2, max: 600, unit: 'px', set: (v) => setO({ size: v }) }];
  }
  if (fam === 'type') {
    const tl = store.activeLayer?.kind === 'text' ? store.activeLayer : null;
    return [{
      id: 'font', label: 'Font', title: tl ? 'Font size of the selected text' : 'Font size of the next text', value: Math.round(tl?.text?.size ?? o.fontSize), min: 4, max: 2000, unit: 'px',
      set: (v) => {
        setO({ fontSize: v });
        if (tl) applyTextStyle(tl.id, { size: v }, 'Font Size');
      },
    }];
  }
  if (t === 'blend') return [{ id: 'steps', label: 'Steps', title: 'Blend steps', value: o.blendSteps, min: 1, max: 200, step: 0.5, set: (v) => setO({ blendSteps: Math.round(v) }) }];
  return knobs;
}

/** Stroke weight: the selected shape's when there is one, and the next shape's default. */
function strokeKnob(layerId: string | null, value: number): Knob {
  return {
    id: 'stroke', label: 'Stroke', title: layerId ? 'Stroke weight of the selected shape' : 'Stroke weight of the next path', value, min: 0, max: 200, unit: 'px',
    set: (v) => {
      store.setOpts({ shapeStrokeWidth: v });
      const l = layerId ? store.doc?.layers.find((x) => x.id === layerId) : null;
      if (l?.shape) store.updateLayer(l.id, { shape: { ...l.shape, strokeWidth: v } }, 'Stroke Weight', `atb-stroke:${l.id}`);
    },
  };
}

/** Vertical scrub knob: drag up = more (Shift ×5), scroll, ↑↓ keys, double-click to type. */
function KnobView({ k }: { k: Knob }) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const step = k.step ?? 1;
  const clamp = (v: number) => Math.max(k.min, Math.min(k.max, v));
  const shown = Math.round(k.value * 10) / 10;
  return (
    <div
      className={`atb-knob ${editing ? 'editing' : ''}`}
      role="spinbutton"
      tabIndex={0}
      aria-label={k.title}
      aria-valuenow={shown}
      aria-valuemin={k.min}
      aria-valuemax={k.max}
      data-knob={k.id}
      title={`${k.title}: ${shown}${k.unit ?? ''} — drag up / down, scroll, double-click to type`}
      onPointerDown={(e) => {
        if (editing || e.button !== 0) return;
        drag.current = { y: e.clientY, v: k.value };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dy = d.y - e.clientY;
        if (Math.abs(dy) < 2) return;
        k.set(clamp(d.v + Math.round(dy / 2) * step * (e.shiftKey ? 5 : 1)));
      }}
      onPointerUp={() => (drag.current = null)}
      onWheel={(e) => {
        if (editing) return;
        k.set(clamp(k.value + (e.deltaY < 0 ? 1 : -1) * Math.max(1, step * 2) * (e.shiftKey ? 5 : 1)));
      }}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (editing) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          k.set(clamp(k.value + (e.key === 'ArrowUp' ? 1 : -1) * Math.max(1, step * 2) * (e.shiftKey ? 10 : 1)));
        } else if (e.key === 'Enter') setEditing(true);
      }}
    >
      <span className="atb-knob-label">{k.label}</span>
      {editing ? (
        <input
          className="atb-knob-input"
          autoFocus
          defaultValue={String(shown)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const v = parseFloat(e.currentTarget.value);
            if (!Number.isNaN(v)) k.set(clamp(v));
            setEditing(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.currentTarget.value = String(shown);
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <span className="atb-knob-value">{shown}</span>
      )}
    </div>
  );
}

export function ActiveToolbox() {
  const s = useStore();
  const t = s.tool;
  const [hover, setHover] = useState<Hover>(null);
  useEffect(() => {
    recent = [t, ...recent.filter((x) => x !== t)].slice(0, RECENT_MAX + 1);
  }, [t]);
  const family = toolFamilyMembers(t);
  const others = recent.filter((x) => x !== t && !family.includes(x) && TOOLS[x]).slice(0, RECENT_MAX);
  const knobs = quickKnobs(t);

  const item = (id: ToolId) => {
    const def = TOOLS[id];
    if (!def) return null;
    return (
      <button
        key={id}
        className={`atb-tool ${id === t ? 'active' : ''}`}
        aria-label={`${def.label} (${def.key})`}
        aria-pressed={id === t}
        onClick={() => store.setTool(id)}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover({ id, top: r.top, right: window.innerWidth - r.left + 8 });
        }}
        onMouseLeave={() => setHover(null)}
      >
        {def.icon}
        <span className="atb-key">{def.key}</span>
      </button>
    );
  };

  const hd = hover && TOOLS[hover.id];
  const tips = hover ? keyTips(hover.id) : [];
  return (
    <div className="active-toolbox" aria-label="Active toolbox">
      <div className="atb-title" title="Tools of the same family as the active tool">Tools</div>
      {family.map(item)}
      {knobs.length > 0 && (
        <>
          <div className="atb-sep" />
          <div className="atb-title" title="Key settings of the active tool — drag up / down">Live</div>
          {knobs.map((k) => (
            <KnobView key={k.id} k={k} />
          ))}
        </>
      )}
      {others.length > 0 && (
        <>
          <div className="atb-sep" />
          <div className="atb-title" title="Recently used tools">Recent</div>
          {others.map(item)}
        </>
      )}
      <div className="atb-spacer" />
      <button className="atb-close" title="Hide the Active Toolbox (Window ▸ Active Toolbox shows it again)" onClick={() => store.setOpts({ activeToolbox: false })}>
        <X size={12} />
      </button>
      {hd && (
        <div className="atb-card" style={{ top: Math.min(hover!.top, window.innerHeight - 180), right: hover!.right }} role="tooltip">
          <div className="atb-card-head">
            <span className="atb-card-icon">{hd.icon}</span>
            <span className="atb-card-name">{hd.label}</span>
            <kbd className="kbd">{hd.key}</kbd>
          </div>
          <div className="atb-card-hint">{hd.hint}</div>
          {tips.length > 0 && (
            <div className="key-tips">
              {tips.map(([k, v]) => (
                <span key={k} className="key-tip">
                  <kbd>{k}</kbd> {v}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
