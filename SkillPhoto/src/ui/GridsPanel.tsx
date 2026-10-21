// Grids panel: Auto Grid, layout grids of the active artboard (edit every parameter), the preset
// library by industry, and the super-zoom document grid with snapping.

import { useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Plus, RotateCw, Sparkles, Trash2 } from 'lucide-react';
import { store, useStore } from '../core/store';
import type { GridCategory, GridKind, GridSpec } from '../core/grids';
import { GRID_CATEGORIES, GRID_COLORS, GRID_PRESETS, autoGrid, gridId, snapStep } from '../core/grids';
import { activeGridPage, applyAutoGrid, applyGridPreset, bakeGrids, clearGrids, gridPages, pageDpi, removeGrid, setGrids, updateGrid } from '../core/gridOps';
import { ColorInput, NumberField, Select, Toggle } from './widgets';

const KIND_LABELS: Record<GridKind, string> = {
  columns: 'Columns',
  rows: 'Rows',
  baseline: 'Baseline',
  square: 'Square grid',
  dots: 'Dot grid',
  isometric: 'Isometric',
  thirds: 'Rule of thirds',
  golden: 'Golden ratio',
  spiral: 'Golden spiral',
  diagonals: 'Diagonals',
  center: 'Centre lines',
  radial: 'Radial',
  safe: 'Safe area',
  bleed: 'Bleed',
  aspect: 'Aspect crop',
  region: 'Zone',
  panels: 'Panels / folds',
};

const ASPECTS: { value: string; label: string }[] = [
  { value: '1', label: '1:1' },
  { value: '0.8', label: '4:5' },
  { value: '0.75', label: '3:4' },
  { value: '0.5625', label: '9:16' },
  { value: '1.7778', label: '16:9' },
  { value: '1.3333', label: '4:3' },
  { value: '1.5', label: '3:2' },
  { value: '0.6667', label: '2:3' },
  { value: '2.39', label: '2.39:1' },
];

/** A new grid of `kind` with sensible defaults for a w × h artboard. */
function newGrid(kind: GridKind, w: number, h: number): GridSpec {
  const m = Math.round(Math.min(w, h) * 0.05);
  const base: GridSpec = { id: gridId(), kind, visible: true, color: GRID_COLORS.composition };
  switch (kind) {
    case 'columns':
      return { ...base, count: 12, gutter: Math.round(w * 0.016), margin: m, color: GRID_COLORS.columns };
    case 'rows':
      return { ...base, count: 6, gutter: Math.round(h * 0.016), margin: m, color: GRID_COLORS.rows };
    case 'baseline':
      return { ...base, size: 8, offset: m, color: GRID_COLORS.baseline };
    case 'square':
    case 'dots':
    case 'isometric':
      return { ...base, size: Math.max(4, Math.round(Math.min(w, h) / 40)), color: GRID_COLORS.safe };
    case 'safe':
      return { ...base, inset: [m, m, m, m], label: 'SAFE', color: GRID_COLORS.safe };
    case 'bleed':
      return { ...base, inset: [36, 36, 36, 36], label: 'BLEED', color: GRID_COLORS.bleed };
    case 'aspect':
      return { ...base, ratio: 0.8, label: '4:5', color: GRID_COLORS.crop };
    case 'region':
      return { ...base, rect: { x: m, y: h * 0.7, w: w / 2, h: h * 0.18 }, label: 'ZONE', color: GRID_COLORS.zone };
    case 'panels':
      return { ...base, axis: 'x', positions: [w / 3, (w * 2) / 3], names: ['1', '2', '3'], color: GRID_COLORS.panels };
    case 'radial':
      return { ...base, count: 6, spokes: 12 };
    default:
      return base;
  }
}

function summary(g: GridSpec): string {
  const r = (v?: number) => Math.round((v ?? 0) * 10) / 10;
  switch (g.kind) {
    case 'columns':
    case 'rows':
      return `${g.count} · gutter ${r(g.gutter)} · margin ${r(g.margin)}`;
    case 'baseline':
    case 'square':
    case 'dots':
    case 'isometric':
      return `every ${r(g.size)}`;
    case 'safe':
    case 'bleed':
      return g.inset ? (g.inset.every((v) => v === g.inset![0]) ? `${r(g.inset[0])}` : g.inset.map(r).join(' / ')) : '';
    case 'aspect':
      return ASPECTS.find((a) => Math.abs(Number(a.value) - (g.ratio ?? 1)) < 0.002)?.label ?? `${r(g.ratio)}:1`;
    case 'panels':
      return `${g.positions?.length ?? 0} folds`;
    case 'radial':
      return `${g.count} rings · ${g.spokes} spokes`;
    default:
      return g.label ?? '';
  }
}

function GridEditor({ pageId, g }: { pageId: string; g: GridSpec }) {
  const up = (patch: Partial<GridSpec>) => updateGrid(pageId, g.id, patch);
  const big = 100000;
  return (
    <div className="grid-editor">
      {(g.kind === 'columns' || g.kind === 'rows') && (
        <>
          <div className="prop-grid">
            <NumberField label="Count" value={g.count ?? 1} min={1} max={200} onChange={(count) => up({ count: Math.round(count) })} />
            <NumberField label="Gutter" value={g.gutter ?? 0} min={0} max={big} onChange={(gutter) => up({ gutter })} />
            <NumberField label="Margin" value={g.margin ?? 0} min={0} max={big} onChange={(margin) => up({ margin })} />
            {g.align && g.align !== 'stretch' && <NumberField label="Size" value={g.size ?? 0} min={0.1} max={big} onChange={(size) => up({ size })} />}
          </div>
          <Select
            value={g.align ?? 'stretch'}
            title="How the tracks sit in the artboard"
            options={[
              { value: 'stretch', label: 'Stretch to fill' },
              { value: 'center', label: 'Fixed size, centred' },
              { value: 'start', label: 'Fixed size, from start' },
              { value: 'end', label: 'Fixed size, from end' },
            ]}
            onChange={(align) => up({ align, size: g.size ?? 72 })}
          />
        </>
      )}
      {(g.kind === 'baseline' || g.kind === 'square' || g.kind === 'dots' || g.kind === 'isometric') && (
        <div className="prop-grid">
          <NumberField label="Every" value={g.size ?? 8} min={0.01} max={big} step={0.5} onChange={(size) => up({ size })} />
          {g.kind === 'baseline' && <NumberField label="Offset" value={g.offset ?? 0} min={0} max={big} onChange={(offset) => up({ offset })} />}
        </div>
      )}
      {(g.kind === 'safe' || g.kind === 'bleed') && (
        <div className="prop-grid">
          {(['T', 'R', 'B', 'L'] as const).map((side, i) => (
            <NumberField
              key={side}
              label={side}
              value={g.inset?.[i] ?? 0}
              min={0}
              max={big}
              onChange={(v) => {
                const inset = [...(g.inset ?? [0, 0, 0, 0])] as [number, number, number, number];
                inset[i] = v;
                up({ inset });
              }}
            />
          ))}
        </div>
      )}
      {g.kind === 'aspect' && (
        <Select
          value={String(ASPECTS.find((a) => Math.abs(Number(a.value) - (g.ratio ?? 1)) < 0.002)?.value ?? '1')}
          options={ASPECTS}
          onChange={(v) => up({ ratio: Number(v), label: ASPECTS.find((a) => a.value === v)?.label })}
        />
      )}
      {g.kind === 'panels' && (
        <>
          <div className="prop-row">
            <Select value={g.axis ?? 'x'} options={[{ value: 'x', label: 'Vertical folds' }, { value: 'y', label: 'Horizontal folds' }]} onChange={(axis) => up({ axis })} />
          </div>
          <input
            className="opt-input"
            style={{ width: '100%' }}
            title="Fold positions from the left (or top), separated by commas"
            defaultValue={(g.positions ?? []).map((p) => Math.round(p * 10) / 10).join(', ')}
            onKeyDown={(e) => e.stopPropagation()}
            onBlur={(e) => up({ positions: e.target.value.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0) })}
          />
          <input
            className="opt-input"
            style={{ width: '100%', marginTop: 4 }}
            title="Panel names, separated by commas"
            placeholder="Panel names: FRONT, SIDE, BACK…"
            defaultValue={(g.names ?? []).join(', ')}
            onKeyDown={(e) => e.stopPropagation()}
            onBlur={(e) => up({ names: e.target.value.split(',').map((s) => s.trim()) })}
          />
        </>
      )}
      {g.kind === 'radial' && (
        <div className="prop-grid">
          <NumberField label="Rings" value={g.count ?? 6} min={1} max={60} onChange={(count) => up({ count: Math.round(count) })} />
          <NumberField label="Spokes" value={g.spokes ?? 12} min={0} max={360} onChange={(spokes) => up({ spokes: Math.round(spokes) })} />
        </div>
      )}
      {g.kind === 'spiral' && (
        <button className="btn ghost" onClick={() => up({ turn: ((g.turn ?? 0) + 1) % 4 })}>
          <RotateCw size={13} /> Turn spiral
        </button>
      )}
      {g.kind === 'region' && g.rect && (
        <div className="prop-grid">
          {(['x', 'y', 'w', 'h'] as const).map((k) => (
            <NumberField key={k} label={k.toUpperCase()} value={g.rect![k]} min={-big} max={big} onChange={(v) => up({ rect: { ...g.rect!, [k]: v } })} />
          ))}
        </div>
      )}
      <div className="prop-row" style={{ marginTop: 6 }}>
        <Toggle checked={g.snap !== false} onChange={(snap) => up({ snap })} label="Snap" title="Objects and new points snap to this grid" />
        {(g.kind === 'safe' || g.kind === 'bleed' || g.kind === 'aspect' || g.kind === 'region') && (
          <input className="opt-input" style={{ flex: 1, minWidth: 0 }} placeholder="Label" defaultValue={g.label ?? ''} onKeyDown={(e) => e.stopPropagation()} onBlur={(e) => up({ label: e.target.value || undefined })} />
        )}
      </div>
    </div>
  );
}

export function GridsPanel() {
  const s = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const [cat, setCat] = useState<GridCategory>('Social');
  const [reason, setReason] = useState('');
  const doc = store.doc;
  if (!doc) return <div className="panel-empty">No document</div>;
  const page = activeGridPage(doc);
  const pages = gridPages(doc);
  const g = s.docGrid;
  const setG = (patch: Partial<typeof g>) => store.set({ docGrid: { ...g, ...patch } });
  const suggestion = autoGrid(page.box.w, page.box.h, pageDpi(page.box));
  const finest = snapStep(g, doc.view.zoom);

  return (
    <div className="properties-panel grids-panel">
      <div className="panel-section">
        <div className="mini-title">
          Layout grids · {page.name} <span className="grid-dims">{Math.round(page.box.w)} × {Math.round(page.box.h)}</span>
        </div>
        <button
          className="btn primary grid-auto"
          title="Reads the artboard's size and shape and adds the grids that fit it"
          onClick={() => setReason(applyAutoGrid())}
        >
          <Sparkles size={13} /> Auto Grid
        </button>
        {pages.length > 1 && (
          <button className="btn ghost" style={{ marginLeft: 6 }} title="Auto Grid every artboard" onClick={() => setReason(applyAutoGrid(true))}>
            All artboards
          </button>
        )}
        <div className="hint" style={{ marginTop: 6 }}>{reason || suggestion.reason}</div>
        <div className="prop-row" style={{ marginTop: 8, gap: 12 }}>
          <Toggle checked={g.showLayout} onChange={(showLayout) => setG({ showLayout })} label="Show" title="Show layout grids (⌘;)" />
          <Toggle checked={g.snapLayout} onChange={(snapLayout) => setG({ snapLayout })} label="Snap to grids" />
        </div>

        <div className="grid-list">
          {page.grids.length === 0 && <div className="hint pad">No layout grids yet — try Auto Grid or a preset below.</div>}
          {page.grids.map((gr) => (
            <div key={gr.id} className={`grid-row ${open === gr.id ? 'open' : ''}`}>
              <div className="grid-row-head">
                <button className="dock-mini" title={open === gr.id ? 'Collapse' : 'Edit'} onClick={() => setOpen(open === gr.id ? null : gr.id)}>
                  {open === gr.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <ColorInput value={gr.color} onChange={(color) => updateGrid(page.id, gr.id, { color })} title="Grid colour" />
                <span className="grid-name" onClick={() => setOpen(open === gr.id ? null : gr.id)}>
                  {KIND_LABELS[gr.kind]}
                  <span className="grid-sum">{summary(gr)}</span>
                </span>
                <button className="dock-mini" title={gr.visible ? 'Hide' : 'Show'} onClick={() => updateGrid(page.id, gr.id, { visible: !gr.visible }, `vis:${gr.id}`)}>
                  {gr.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button className="dock-mini" title="Remove" onClick={() => removeGrid(page.id, gr.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
              {open === gr.id && <GridEditor pageId={page.id} g={gr} />}
            </div>
          ))}
        </div>
        <div className="prop-row" style={{ marginTop: 6 }}>
          <Select
            value={'' as GridKind | ''}
            title="Add a grid"
            options={[{ value: '' as const, label: '+ Add grid…' }, ...(Object.keys(KIND_LABELS) as GridKind[]).map((k) => ({ value: k, label: KIND_LABELS[k] }))]}
            onChange={(k) => {
              if (!k) return;
              const ng = newGrid(k, page.box.w, page.box.h);
              setGrids(page.id, [...page.grids, ng], `Add ${KIND_LABELS[k]}`);
              setOpen(ng.id);
              if (!g.showLayout) setG({ showLayout: true });
            }}
          />
          {page.grids.length > 0 && (
            <>
              <button className="btn ghost" title="Turn the visible grids into real artwork (print guides, boards, exports)" onClick={() => bakeGrids()}>
                Bake
              </button>
              <button className="btn ghost" onClick={clearGrids}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      <div className="panel-section">
        <div className="mini-title">Grid presets</div>
        <div className="seg compact grid-cats">
          {GRID_CATEGORIES.map((c) => (
            <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="grid-presets">
          {GRID_PRESETS.filter((p) => p.category === cat).map((p) => (
            <div key={p.id} className="grid-preset">
              <button className="grid-preset-main" title={`${p.hint}\nClick: use this grid · ⇧-click: add to the current grids`} onClick={(e) => applyGridPreset(p.id, e.shiftKey ? 'add' : 'replace')}>
                <span className="grid-preset-label">{p.label}</span>
                <span className="grid-preset-hint">{p.hint}</span>
              </button>
              <button className="dock-mini" title="Add to the current grids" onClick={() => applyGridPreset(p.id, 'add')}>
                <Plus size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div className="mini-title">Document grid</div>
        <div className="prop-row" style={{ gap: 12 }}>
          <Toggle checked={s.showGrid} onChange={(showGrid) => store.set({ showGrid })} label="Show" title="Show grid (⌘')" />
          <Toggle checked={g.snap} onChange={(snap) => store.set({ docGrid: { ...g, snap }, ...(snap ? { showGrid: true } : {}) })} label="Snap to grid" title="⌥⌘'" />
        </div>
        <div className="prop-grid" style={{ marginTop: 6 }}>
          <NumberField label="Every" value={g.size} min={0.01} max={100000} onChange={(size) => setG({ size })} />
          <NumberField label="Subdiv." value={g.subdivisions} min={2} max={20} onChange={(subdivisions) => setG({ subdivisions: Math.round(subdivisions) })} />
        </div>
        <div className="prop-row" style={{ marginTop: 6, gap: 8 }}>
          <Select value={g.style} options={[{ value: 'lines', label: 'Lines' }, { value: 'dots', label: 'Dots' }]} onChange={(style) => setG({ style })} />
          <ColorInput value={g.color} onChange={(color) => setG({ color })} title="Grid colour" />
          <Toggle checked={g.adaptive} onChange={(adaptive) => setG({ adaptive })} label="Super zoom" title="Keep subdividing as you zoom in (and merging as you zoom out)" />
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          At {Math.round(doc.view.zoom * 100)}% the finest line is every {finest >= 1 ? Math.round(finest * 100) / 100 : finest.toPrecision(2)} px{g.snap ? ' — objects snap to it' : ''}.
        </div>
      </div>
    </div>
  );
}
