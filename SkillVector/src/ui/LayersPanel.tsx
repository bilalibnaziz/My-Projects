import { Fragment, useEffect, useRef, useState } from 'react';
import { uiZoom } from './theme';
import {
  Eye, EyeOff, Lock, Unlock, Plus, Trash2, Copy, SlidersHorizontal, SquareDashed, Layers as LayersIcon, Merge, CornerLeftDown, Type, Shapes,
  Folder, FolderOpen, FolderPlus, ChevronRight, ChevronDown, Search, Grid2x2Check, Box, Filter, X,
} from 'lucide-react';
import type { Layer, TextStyle } from '../core/types';
import { BLEND_MODES, LAYER_LABELS, hasFx, withLayer } from '../core/types';
import { setFill, copyStyle, pasteStyle, canPasteStyle, clearStyle } from '../core/layerStyle';
import { filterById } from '../core/filters';
import { pickFiles } from '../core/io';
import { childrenOf } from '../core/groups';
import type { DropWhere } from '../core/groups';
import { TEXT_WARPS } from '../core/warp';

/** Layers panel rows, top to bottom, with nesting depth (collapsed groups hide their contents). */
function treeRows(layers: Layer[]): { layer: Layer; depth: number }[] {
  const out: { layer: Layer; depth: number }[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    const list = childrenOf(layers, parent);
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i];
      out.push({ layer: l, depth });
      if (l.kind === 'group' && !l.collapsed && depth < 32) walk(l.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}
import { store, useStore } from '../core/store';
import { layerThumb } from '../core/render';
import * as ops from '../core/ops';
import { selectionFromCanvas } from '../core/selection';
import { applyTextStyle, updateText } from '../core/tools';
import { IconButton, NumberField, Select, Toggle, ColorInput } from './widgets';
import { WEIGHTS } from './OptionsBar';
import { FontPicker } from './FontPicker';

function Thumb({ layer, w, h, mask, active, onClick }: { layer: Layer; w: number; h: number; mask?: boolean; active?: boolean; onClick: (e: React.MouseEvent) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const t = layerThumb(layer, w, h, 64, mask);
    c.width = t.width;
    c.height = t.height;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(t, 0, 0);
  });
  return (
    <div className={`thumb ${mask ? 'thumb-mask' : ''} ${active ? 'thumb-active' : ''}`} onClick={onClick} title={mask ? 'Click: edit mask · Shift-click: disable · ⌘-click: load as selection' : '⌘-click: load transparency as selection'}>
      <canvas ref={ref} className={mask && layer.mask && !layer.mask.enabled ? 'disabled' : ''} />
    </div>
  );
}

export function LayersPanel() {
  useStore();
  const doc = store.doc;
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; where: DropWhere } | null>(null);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Re-render thumbnails after strokes
  const [, force] = useState(0);
  useEffect(() => {
    let t = 0;
    const off = store.onRender(() => {
      clearTimeout(t);
      t = window.setTimeout(() => force((n) => n + 1), 220);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, []);

  if (!doc) return <div className="panel-empty">No document</div>;
  const active = store.activeLayer;
  const q = query.trim().toLowerCase();
  // Searching shows every match, whatever group it is in
  const rows = q
    ? [...doc.layers].reverse().filter((l) => l.name.toLowerCase().includes(q) || l.kind.includes(q) || (q === 'smart' && !!l.smart) || (!!l.label && l.label === q)).map((layer) => ({ layer, depth: 0 }))
    : treeRows(doc.layers);
  const selected = store.selectedLayers;
  const selectedIds = new Set(selected.map((l) => l.id));
  const many = selected.length > 1;

  return (
    <div className="layers-panel">
      <div className="layers-head">
        <Select
          className="blend-select"
          value={active?.blend ?? 'normal'}
          title="Blend mode"
          options={BLEND_MODES.map((b) => ({ value: b.id, label: b.label }))}
          onChange={(v) => active && ops.updateSelectedLayers({ blend: v }, 'Blend Mode')}
        />
        <IconButton
          icon={<Grid2x2Check size={13} />}
          title={active?.lockAlpha ? 'Unlock transparency' : 'Lock transparency: paint only where there are pixels'}
          active={!!active?.lockAlpha}
          disabled={!active || active.kind !== 'raster'}
          onClick={() => active && ops.updateSelectedLayers({ lockAlpha: !active.lockAlpha }, active.lockAlpha ? 'Unlock Transparency' : 'Lock Transparency', `lockAlpha:${Date.now()}`)}
        />
        <IconButton
          icon={active?.locked ? <Lock size={13} /> : <Unlock size={13} />}
          title={active?.locked ? 'Unlock layer' : 'Lock layer'}
          active={active?.locked}
          onClick={() => active && ops.updateSelectedLayers({ locked: !active.locked }, active.locked ? 'Unlock Layer' : 'Lock Layer', `lock:${Date.now()}`)}
        />
        <NumberField
          label="Opacity"
          value={Math.round((active?.opacity ?? 1) * 100)}
          min={0}
          max={100}
          unit="%"
          width={34}
          onChange={(v) => active && ops.updateSelectedLayers({ opacity: v / 100 }, 'Layer Opacity')}
        />
        {active && active.kind !== 'adjustment' && (
          <NumberField
            label="Fill"
            value={Math.round((active.fill ?? 1) * 100)}
            min={0}
            max={100}
            unit="%"
            width={34}
            onChange={(v) => setFill(v / 100)}
          />
        )}
      </div>
      {doc.layers.length > 3 && (
        <label className="layer-search">
          <Search size={12} />
          <input value={query} placeholder="Search layers (name, text, smart, red…)" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setQuery(''); }} />
          {query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={11} /></button>}
        </label>
      )}
      {many && <div className="multi-bar">{selected.length} layers selected</div>}

      <div
        className="layer-list"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dragLayers = (window as any).__skillSuiteDragLayers;
          if (dragLayers && dragLayers.docId !== doc.id && dragLayers.layers) {
            ops.transferLayersToDoc(doc.id, dragLayers.layers);
            (window as any).__skillSuiteDragLayers = null;
          } else if (dragId !== null && drop) {
            ops.dropLayer(dragId, drop.id, drop.where);
          }
          setDragId(null);
          setDrop(null);
        }}
      >
        {rows.map(({ layer, depth }) => {
          const isActive = layer.id === doc.activeId;
          const isGroup = layer.kind === 'group';
          const dropHere = drop?.id === layer.id ? drop.where : null;
          const labelColor = LAYER_LABELS.find((x) => x.id === layer.label)?.color;
          return (
            <Fragment key={layer.id}>
            <div
              className={`layer-row ${isGroup ? 'group-row' : ''} ${isActive ? 'active' : ''} ${!isActive && selectedIds.has(layer.id) ? 'selected' : ''} ${layer.clip ? 'clipped' : ''} ${!layer.visible ? 'hidden-layer' : ''} ${dropHere === 'above' ? 'drop-before' : ''} ${dropHere === 'below' ? 'drop-after' : ''} ${dropHere === 'into' ? 'drop-into' : ''}`}
              style={{ ...(depth ? { paddingLeft: 4 + depth * 14 + (layer.clip ? 14 : 0) } : {}), ...(labelColor ? { boxShadow: `inset 3px 0 0 ${labelColor}` } : {}) }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selectedIds.has(layer.id)) store.selectLayer(layer.id);
                setMenu({ x: e.clientX / uiZoom(), y: e.clientY / uiZoom(), id: layer.id });
              }}
              draggable={renaming !== layer.id}
              onDragStart={(e) => {
                setDragId(layer.id);
                const selected = selectedIds.has(layer.id) ? store.selectedLayers : [layer];
                e.dataTransfer.setData('application/x-skillsuite-layers', JSON.stringify({
                  docId: doc.id,
                  layerIds: selected.map((l) => l.id),
                }));
                e.dataTransfer.setData('text/plain', selected.map((l) => l.name).join(', '));
                e.dataTransfer.effectAllowed = 'copyMove';
                (window as any).__skillSuiteDragLayers = {
                  docId: doc.id,
                  layers: selected,
                };
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                const r = e.currentTarget.getBoundingClientRect();
                const f = (e.clientY - r.top) / r.height;
                // Groups take drops in their middle; an open group's lower edge is its first child
                let where: DropWhere = f < 0.5 ? 'above' : 'below';
                if (isGroup && f >= 0.25 && (f <= 0.75 || !layer.collapsed)) where = 'into';
                if (drop?.id !== layer.id || drop.where !== where) setDrop({ id: layer.id, where });
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const dragLayers = (window as any).__skillSuiteDragLayers;
                if (dragLayers && dragLayers.docId !== doc.id && dragLayers.layers) {
                  ops.transferLayersToDoc(doc.id, dragLayers.layers);
                  (window as any).__skillSuiteDragLayers = null;
                } else if (dragId !== null && drop) {
                  ops.dropLayer(dragId, drop.id, drop.where);
                }
                setDragId(null);
                setDrop(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDrop(null);
                (window as any).__skillSuiteDragLayers = null;
              }}
              onClick={(e) => store.selectLayer(layer.id, e.metaKey || e.ctrlKey ? 'toggle' : e.shiftKey ? 'range' : 'replace')}
            >
              <button
                className="eye"
                title={layer.visible ? 'Hide layer (⌥-click: solo)' : 'Show layer'}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.altKey) {
                    const others = doc.layers.filter((l) => l.id !== layer.id);
                    const solo = others.some((l) => l.visible);
                    const layers = doc.layers.map((l) => withLayer(l, { visible: l.id === layer.id ? true : !solo }));
                    store.commit('Solo Layer', { layers });
                    return;
                  }
                  store.updateLayer(layer.id, { visible: !layer.visible }, layer.visible ? 'Hide Layer' : 'Show Layer', `vis:${layer.id}:${Date.now()}`);
                }}
              >
                {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              {layer.clip && <CornerLeftDown size={12} className="clip-arrow" />}
              {isGroup ? (
                <>
                  <button
                    className="group-chevron"
                    title={layer.collapsed ? 'Expand group' : 'Collapse group'}
                    onClick={(e) => {
                      e.stopPropagation();
                      store.updateLayer(layer.id, { collapsed: !layer.collapsed });
                    }}
                  >
                    {layer.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                  <div className={`thumb thumb-group ${isActive && !doc.editMask ? 'thumb-active' : ''}`} title={`${childrenOf(doc.layers, layer.id).length} layers`}>
                    {layer.collapsed ? <Folder size={15} /> : <FolderOpen size={15} />}
                  </div>
                </>
              ) : layer.kind === 'adjustment' ? (
                <div
                  className={`thumb thumb-adjust ${isActive && !doc.editMask ? 'thumb-active' : ''}`}
                  onClick={() => {
                    store.selectLayer(layer.id);
                    store.set({ rightTab: 'adjust' });
                  }}
                  title="Adjustment layer — edit in the Adjust tab"
                >
                  <SlidersHorizontal size={15} />
                </div>
              ) : (
                <Thumb
                  layer={layer}
                  w={doc.width}
                  h={doc.height}
                  active={isActive && !doc.editMask}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.metaKey || e.ctrlKey) return ops.selectLayerAlpha(layer.id);
                    if (e.shiftKey) return store.selectLayer(layer.id, 'range');
                    store.selectLayer(layer.id);
                    doc.editMask = false;
                    store.emit();
                  }}
                />
              )}
              {layer.smart && <Box size={10} className="smart-badge" aria-label="Smart Object" />}
              {layer.mask && (
                <Thumb
                  layer={layer}
                  w={doc.width}
                  h={doc.height}
                  mask
                  active={isActive && doc.editMask}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey) return store.updateLayer(layer.id, { mask: { ...layer.mask!, enabled: !layer.mask!.enabled } }, 'Toggle Mask');
                    if (e.metaKey || e.ctrlKey) {
                      const c = document.createElement('canvas');
                      c.width = doc.width;
                      c.height = doc.height;
                      c.getContext('2d')!.drawImage(layer.mask!.canvas, layer.mask!.x, layer.mask!.y);
                      store.setSelection(selectionFromCanvas(c), 'Load Mask');
                      return;
                    }
                    store.selectLayer(layer.id);
                    doc.editMask = true;
                    store.emit();
                  }}
                />
              )}
              <div className="layer-name" onDoubleClick={() => setRenaming(layer.id)}>
                {renaming === layer.id ? (
                  <input
                    autoFocus
                    defaultValue={layer.name}
                    onFocus={(e) => e.target.select()}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') {
                        // Mark cancelled so the blur that follows doesn't save the edit
                        e.currentTarget.dataset.cancelled = '1';
                        setRenaming(null);
                      }
                    }}
                    onBlur={(e) => {
                      if (e.target.dataset.cancelled) return setRenaming(null);
                      const v = e.target.value.trim();
                      if (v && v !== layer.name) store.updateLayer(layer.id, { name: v }, 'Rename Layer');
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <>
                    {layer.kind === 'text' && <Type size={11} className="kind-icon" />}
                    {layer.kind === 'shape' && <Shapes size={11} className="kind-icon" />}
                    <span>{layer.name}</span>
                  </>
                )}
              </div>
              <div className="layer-badges">
                {hasFx(layer) && (
                  <button
                    className="badge fx-badge"
                    title="Layer style: click to edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      store.selectLayer(layer.id);
                      store.set({ dialog: { type: 'layerStyle' } });
                    }}
                  >
                    fx
                  </button>
                )}
                {layer.blend !== 'normal' && <span className="badge">{BLEND_MODES.find((b) => b.id === layer.blend)?.label.split(' ')[0]}</span>}
                {layer.opacity < 1 && <span className="badge">{Math.round(layer.opacity * 100)}%</span>}
                {layer.lockAlpha && <Grid2x2Check size={10} />}
                {layer.locked && <Lock size={10} />}
              </div>
            </div>
            {layer.smart && layer.smart.filters.length > 0 && !q && (
              <div className="smart-filters" style={{ paddingLeft: 30 + depth * 14 }}>
                <div className="smart-filters-head">
                  <Filter size={11} /> Smart Filters
                </div>
                {layer.smart.filters.map((f, i) => (
                  <div key={i} className={`smart-filter ${f.enabled ? '' : 'off'}`}>
                    <button
                      className="eye"
                      title={f.enabled ? 'Hide this filter' : 'Show this filter'}
                      onClick={() => ops.setSmartFilters(layer.id, layer.smart!.filters.map((x, k) => (k === i ? { ...x, enabled: !x.enabled } : x)), f.enabled ? 'Hide Smart Filter' : 'Show Smart Filter')}
                    >
                      {f.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <span
                      className="smart-filter-name"
                      title="Double-click to edit"
                      onDoubleClick={() => {
                        store.selectLayer(layer.id);
                        store.set({ dialog: { type: 'filter', filterId: f.id, smartIndex: i, params: f.params } });
                      }}
                    >
                      {filterById(f.id)?.name ?? f.id}
                    </span>
                    <button className="smart-filter-del" title="Delete this filter" onClick={() => ops.setSmartFilters(layer.id, layer.smart!.filters.filter((_, k) => k !== i), 'Delete Smart Filter')}>
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            </Fragment>
          );
        })}
        {q && !rows.length && <div className="panel-empty">No layers match “{query}”</div>}
      </div>
      {menu && <LayerMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}

      <div className="layers-foot">
        <IconButton icon={<Plus size={14} />} title="New layer (⇧⌘N)" onClick={() => store.newRasterLayer()} />
        <IconButton
          icon={<FolderPlus size={14} />}
          title={many ? `Group ${selected.length} layers (⌘G)` : 'New group · ⌘G groups the selected layers'}
          onClick={() => (many ? ops.groupSelected() : ops.newGroup())}
        />
        <IconButton icon={<SlidersHorizontal size={14} />} title="New adjustment layer" onClick={() => ops.newAdjustmentLayer({}, 'Adjustment')} />
        <IconButton
          icon={<span className="fx-icon">fx</span>}
          title="Layer style: shadow, glow, stroke, bevel, overlays (⌥⌘Y)"
          active={!!active && hasFx(active)}
          disabled={!active || active.kind === 'adjustment'}
          onClick={() => store.set({ dialog: { type: 'layerStyle' } })}
        />
        <IconButton icon={<SquareDashed size={14} />} title={active?.mask ? 'Edit mask' : 'Add mask (from selection if any)'} onClick={() => ops.addMask(true)} />
        <IconButton icon={<CornerLeftDown size={14} />} title="Clip to layer below (⌥⌘G)" active={active?.clip} onClick={() => ops.toggleClip()} />
        <IconButton icon={<Copy size={14} />} title="Duplicate layer" onClick={() => ops.duplicateLayer()} />
        <IconButton icon={<Merge size={14} />} title={many ? `Merge ${selected.length} layers (⌘E)` : active?.kind === 'group' ? 'Merge group (⌘E)' : 'Merge down (⌘E)'} onClick={() => ops.mergeSelected()} />
        <IconButton icon={<LayersIcon size={14} />} title="Flatten image" onClick={() => ops.flattenImage()} />
        <div className="opt-spacer" />
        <IconButton icon={<Trash2 size={14} />} title={many ? `Delete ${selected.length} layers` : 'Delete layer'} onClick={() => ops.deleteLayer()} />
      </div>

      {active?.kind === 'text' && active.text && <TextProps layer={active} />}
      {active?.kind === 'shape' && active.shape && <ShapePropsPanel layer={active} />}
    </div>
  );
}

/** Right-click menu for layer rows: the common layer commands in one place. */
function LayerMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  const l = store.activeLayer;
  const doc = store.doc;
  if (!l || !doc) return null;
  const many = store.selectedLayers.length > 1;
  const item = (label: string, run: () => void, enabled = true, hint?: string) => (
    <button
      className="ctx-item"
      disabled={!enabled}
      onClick={() => {
        onClose();
        run();
      }}
    >
      <span>{label}</span>
      {hint && <kbd className="kbd">{hint}</kbd>}
    </button>
  );
  // Keep the menu on screen
  const left = Math.max(4, Math.min(x, window.innerWidth / uiZoom() - 230));
  const top = Math.max(4, Math.min(y, window.innerHeight / uiZoom() - 420));
  return (
    <div ref={ref} className="ctx-menu" style={{ left, top }} role="menu">
      {item('Layer Style…', () => store.set({ dialog: { type: 'layerStyle' } }), l.kind !== 'adjustment')}
      {item('Copy Layer Style', copyStyle, hasFx(l))}
      {item('Paste Layer Style', pasteStyle, canPasteStyle())}
      {item('Clear Layer Style', clearStyle, hasFx(l))}
      <div className="ctx-sep" />
      {item('Duplicate', () => ops.duplicateLayer())}
      {item(many ? 'Group Layers' : 'Group into New Group', () => ops.groupSelected(), true, '⌘G')}
      {item('Ungroup', () => ops.ungroupActive(), l.kind === 'group' || !!l.parent, '⇧⌘G')}
      {item(l.kind === 'group' ? 'Merge Group' : many ? 'Merge Layers' : 'Merge Down', () => ops.mergeSelected(), true, '⌘E')}
      <div className="ctx-sep" />
      {item('Convert to Smart Object', () => ops.convertToSmartObject(), !l.smart && l.kind !== 'adjustment')}
      {item('Replace Contents…', async () => {
        const [f] = await pickFiles('image/*', false);
        if (f) await store.task('Replacing contents', () => ops.replaceSmartContents(f));
      }, !!l.smart)}
      {item(l.smart ? 'Rasterize Smart Object' : 'Rasterize Layer', () => ops.rasterizeActive(), !!l.smart || l.kind === 'text' || l.kind === 'shape')}
      {item(l.lockAlpha ? 'Unlock Transparency' : 'Lock Transparency', () => ops.updateSelectedLayers({ lockAlpha: !l.lockAlpha }, 'Lock Transparency', `lockAlpha:${Date.now()}`), l.kind === 'raster')}
      <div className="ctx-sep" />
      <div className="ctx-labels" aria-label="Color label">
        <button className={`ctx-label none ${!l.label ? 'on' : ''}`} title="No color" onClick={() => { ops.updateSelectedLayers({ label: undefined }, 'Color Label'); onClose(); }} />
        {LAYER_LABELS.map((c) => (
          <button
            key={c.id}
            className={`ctx-label ${l.label === c.id ? 'on' : ''}`}
            style={{ background: c.color }}
            title={c.id[0].toUpperCase() + c.id.slice(1)}
            onClick={() => {
              ops.updateSelectedLayers({ label: c.id }, 'Color Label');
              onClose();
            }}
          />
        ))}
      </div>
      <div className="ctx-sep" />
      {item(many ? `Delete ${store.selectedLayers.length} Layers` : 'Delete', () => ops.deleteLayer())}
    </div>
  );
}

function TextProps({ layer }: { layer: Layer }) {
  const t = layer.text!;
  const up = (p: Partial<typeof t>, label = 'Text Properties') => updateText(layer.id, p, label);
  const styleUp = (st: TextStyle, label = 'Text Properties') => applyTextStyle(layer.id, st, label);
  return (
    <div className="props">
      <div className="props-title">Text</div>
      <textarea className="props-text" value={t.text} onChange={(e) => up({ text: e.target.value }, 'Edit Text')} onKeyDown={(e) => e.stopPropagation()} rows={2} />
      <div className="props-row">
        <FontPicker value={t.font} sample={t.text} onChange={(v) => styleUp({ font: v }, 'Font')} />
        <Select value={t.weight} onChange={(v) => styleUp({ weight: v })} options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: WEIGHTS[w] }))} />
      </div>
      <div className="props-row">
        <NumberField label="Size" value={Math.round(t.size)} min={4} max={2000} unit="px" onChange={(v) => styleUp({ size: v })} />
        <NumberField label="Track" value={t.tracking} min={-50} max={200} onChange={(v) => up({ tracking: v })} />
        <NumberField label="Lead" value={t.lineHeight} min={0.5} max={4} step={0.05} onChange={(v) => up({ lineHeight: v })} />
      </div>
      <div className="props-row">
        <ColorInput value={t.color} onChange={(v) => styleUp({ color: v }, 'Text Color')} title="Text color" />
        <Select value={t.align} onChange={(v) => up({ align: v })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} />
        <Toggle label="Italic" checked={t.italic} onChange={(v) => styleUp({ italic: v })} />
        <Toggle label="Underline" checked={!!t.underline} onChange={(v) => styleUp({ underline: v })} />
        <Toggle label="Strike" checked={!!t.strike} onChange={(v) => styleUp({ strike: v })} />
        <Toggle label="Shadow" checked={t.shadow} onChange={(v) => up({ shadow: v })} />
      </div>
      <div className="props-row">
        <NumberField label="Outline" value={t.stroke} min={0} max={100} unit="px" onChange={(v) => up({ stroke: v })} />
        <ColorInput value={t.strokeColor} onChange={(v) => up({ strokeColor: v })} title="Outline color" />
      </div>
      <div className="props-row">
        <Toggle label="Paragraph box" checked={!!t.boxWidth} onChange={(v) => up({ boxWidth: v ? Math.max(100, Math.round(layer.width)) : undefined }, 'Paragraph Text')} />
        {!!t.boxWidth && <NumberField label="Width" value={Math.round(t.boxWidth)} min={10} max={20000} unit="px" onChange={(v) => up({ boxWidth: v }, 'Paragraph Width')} />}
        {!!t.runs?.length && (
          <button className="link-btn" onClick={() => up({ runs: undefined }, 'Clear Character Styles')} title="Remove per-character styles">
            Clear styles
          </button>
        )}
      </div>
      <div className="props-row">
        <span className="props-label">Warp</span>
        <Select value={t.warp?.style ?? 'none'} onChange={(style) => up({ warp: { style, bend: t.warp?.bend || 50 } }, 'Warp Text')} options={TEXT_WARPS.map((w) => ({ value: w.id, label: w.label }))} />
        {t.warp && t.warp.style !== 'none' && <NumberField label="Bend" value={t.warp.bend} min={-100} max={100} unit="%" onChange={(bend) => up({ warp: { ...t.warp!, bend } }, 'Warp Text')} />}
      </div>
      <div className="props-row">
        <Toggle label="All caps" checked={!!t.caps} onChange={(v) => up({ caps: v })} />
        <Toggle label="Box" checked={!!t.box} onChange={(v) => up({ box: v })} />
        {t.box && (
          <>
            <ColorInput value={t.boxColor ?? '#000000'} onChange={(v) => up({ boxColor: v })} title="Box color" />
            <NumberField label="Pad" value={Math.round(t.boxPad ?? 0)} min={0} max={500} onChange={(v) => up({ boxPad: v })} />
            <NumberField label="Round" value={Math.round(t.boxRadius ?? 0)} min={0} max={1000} onChange={(v) => up({ boxRadius: v })} />
          </>
        )}
      </div>
    </div>
  );
}

function ShapePropsPanel({ layer }: { layer: Layer }) {
  const sh = layer.shape!;
  const up = (p: Partial<typeof sh>) => store.updateLayer(layer.id, { shape: { ...sh, ...p } }, 'Shape Properties', `shape:${layer.id}`);
  const isLine = sh.shape === 'line' || sh.shape === 'arrow';
  return (
    <div className="props">
      <div className="props-title">Shape</div>
      <div className="props-row">
        {!isLine && <Toggle label="Fill" checked={sh.fillEnabled} onChange={(v) => up({ fillEnabled: v })} />}
        {!isLine && <ColorInput value={sh.fill} onChange={(v) => up({ fill: v })} title="Fill color" />}
        <NumberField label="Stroke" value={sh.strokeWidth} min={0} max={300} unit="px" onChange={(v) => up({ strokeWidth: v })} />
        <ColorInput value={sh.stroke} onChange={(v) => up({ stroke: v })} title="Stroke color" />
      </div>
      <div className="props-row">
        <NumberField label="W" value={Math.round(layer.width)} min={-20000} max={20000} onChange={(v) => store.updateLayer(layer.id, { width: v }, 'Resize Shape', `shape-size:${layer.id}`)} />
        <NumberField label="H" value={Math.round(layer.height)} min={-20000} max={20000} onChange={(v) => store.updateLayer(layer.id, { height: v }, 'Resize Shape', `shape-size:${layer.id}`)} />
        {/* One radius for every corner: typing here re-links per-corner radii (set them in Properties) */}
        {sh.shape === 'rectangle' && <NumberField label="Radius" value={sh.radii?.[0] ?? sh.radius} min={0} max={2000} onChange={(v) => up({ radius: v, radii: undefined })} />}
        {(sh.shape === 'polygon' || sh.shape === 'star') && <NumberField label="Sides" value={sh.sides ?? (sh.shape === 'star' ? 5 : 6)} min={3} max={64} onChange={(v) => up({ sides: v })} />}
      </div>
    </div>
  );
}
