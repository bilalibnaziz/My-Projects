import { useState } from 'react';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { FontPicker } from './FontPicker';
import { WEIGHTS } from './OptionsBar';
import { activeTextRange, applyTextStyle, updateText } from '../core/tools';
import { styleAt } from '../core/text';
import { withLayer } from '../core/types';
import type { Layer, TextStyle } from '../core/types';
import {
  Plus, Trash2, Package, Sparkles, Wand2, Copy, FileText,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, Link2, Link2Off,
} from 'lucide-react';
import * as ops from '../core/ops';
import { frameVisible, moveSelectionTo, resizeSelectionTo, rotateSelectionBy, rotateSelectionTo, selectionGeometry } from '../core/objectTransform';
import { store, useStore } from '../core/store';
import type { ToolOptions } from '../core/store';
import type { ShapeProps } from '../core/types';
import { ColorInput, IconButton, NumberField, Select, Toggle } from './widgets';
import {
  ARTBOARD_PRESETS, getActiveArtboard,
  addArtboard, updateArtboard, removeArtboard, editArtboards, convertToEditablePath,
} from '../core/vectorOps';
import { sortWidthPoints, WIDTH_PROFILES } from '../core/strokeProfile';
import type { WidthPoint } from '../core/strokeProfile';
import { alignActive } from '../core/align';
import { dielineLayers, tuckBoxDieline, generateDieline, BOX_TYPE_LABELS, mmToPx } from '../core/dieline';
import type { BoxType, PackagingSpec } from '../core/dieline';
import { groupLayers } from '../core/groups';
import { view } from '../core/commands';
import { AnchorSection, ToolCard, ShapeSection, SmartActions, toolFamily } from './ToolContext';
import { LOGO_GRID_CATALOG, insertLogoGridOntoCanvas } from '../core/logoGrids';
import type { LogoGridType } from '../core/logoGrids';
import { TRACE_PRESETS } from '../core/tracer';
import type { TraceOptions } from '../core/tracer';
import { autoTrace, currentTraceOptions, runTrace } from '../core/studio/trace';
import { AppearanceSection } from './Appearance';
import { detectTextFromCanvas, copyTextToClipboard, createLiveTypeLayerFromBlock } from '../core/masterSelect';

function ActiveToolInspector() {
  const s = useStore();
  const t = s.tool;
  const o = s.opts;
  const set = (p: Partial<ToolOptions>) => store.setOpts(p);

  return (
    <>
      {/* Tool-specific interactive controls */}
      {t === 'master-select' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="hint" style={{ fontSize: 11, marginBottom: 2 }}>
            Master Smart Selection: Reads and copies text from images, selects discrete elements, and creates live vector typography.
          </div>
          <button
            className="btn primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={async () => {
              const active = store.activeLayer;
              if (!active || active.kind !== 'raster' || !active.canvas) {
                store.toast('Select an image layer to scan and extract text', 'info');
                return;
              }
              const blocks = await detectTextFromCanvas(active.canvas);
              if (blocks.length > 0) {
                copyTextToClipboard(blocks[0].text);
              } else {
                store.toast('No high-contrast text detected in layer', 'info');
              }
            }}
          >
            <FileText size={13} /> Scan & Copy Text from Image
          </button>
          <button
            className="btn ghost"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={async () => {
              const active = store.activeLayer;
              if (!active || active.kind !== 'raster' || !active.canvas) {
                store.toast('Select an image layer to convert text', 'info');
                return;
              }
              const blocks = await detectTextFromCanvas(active.canvas);
              if (blocks.length > 0 && store.doc) {
                createLiveTypeLayerFromBlock(blocks[0], store.doc);
              } else {
                store.toast('No distinct text block found to convert', 'info');
              }
            }}
          >
            <Sparkles size={13} /> Convert to Live Typography Layer
          </button>
        </div>
      )}

      {t === 'move' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="prop-row">
            <span className="prop-label">Auto-Select</span>
            <Select
              value={o.autoSelect}
              title="Click selection target"
              onChange={(v) => set({ autoSelect: v as 'group' | 'layer' | 'off' })}
              options={[
                { value: 'group', label: 'Group' },
                { value: 'layer', label: 'Layer' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </div>
          <div className="prop-row">
            <Toggle label="Show Transform Box" checked={o.transformControls} onChange={(v) => set({ transformControls: v })} />
            <Toggle label="Lock Proportions" checked={o.lockAspect} onChange={(v) => set({ lockAspect: v })} />
          </div>
        </div>
      )}

      {t === 'pencil' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="prop-grid">
            <NumberField label="Stroke" value={o.shapeStrokeWidth} min={1} max={100} unit="px" onChange={(v) => set({ shapeStrokeWidth: v })} />
            <NumberField label="Fidelity" value={o.pencilFidelity} min={1} max={20} unit="px" onChange={(v) => set({ pencilFidelity: v })} />
            <NumberField label="StreamLine" value={o.pencilStreamline} min={0} max={50} unit="px" onChange={(v) => set({ pencilStreamline: v })} />
          </div>
          <div className="prop-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <Toggle label="⚡ QuickShape" checked={o.pencilQuickShape} onChange={(v) => set({ pencilQuickShape: v })} />
            <Toggle label="Sculpt" checked={o.pencilSculpt} onChange={(v) => set({ pencilSculpt: v })} />
            <Toggle label="Auto-Close" checked={o.pencilAutoClose} onChange={(v) => set({ pencilAutoClose: v })} />
          </div>
        </div>
      )}

      {(t === 'pen' || t === 'curvature') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="prop-row">
            <span className="prop-label">Mode</span>
            <Select value={o.penMode} onChange={(v) => set({ penMode: v as 'shape' | 'selection' })} options={[{ value: 'shape', label: 'Shape Layer' }, { value: 'selection', label: 'Selection' }]} />
          </div>
          <div className="prop-row">
            <Toggle label="Fill" checked={o.shapeFill} onChange={(v) => set({ shapeFill: v })} />
            <NumberField label="Stroke" value={o.shapeStrokeWidth} min={0} max={100} unit="px" onChange={(v) => set({ shapeStrokeWidth: v })} />
          </div>
        </div>
      )}

      {t === 'packaging' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="prop-row">
            <Select
              value={o.packagingBoxType ?? 'reverse-tuck'}
              options={Object.entries(BOX_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              onChange={(v) => set({ packagingBoxType: v as BoxType })}
            />
          </div>
          <div className="prop-grid">
            <NumberField label="L" value={o.packagingLength ?? 60} min={10} max={1000} unit="mm" onChange={(v) => set({ packagingLength: v })} />
            <NumberField label="W" value={o.packagingWidth ?? 30} min={10} max={1000} unit="mm" onChange={(v) => set({ packagingWidth: v })} />
            <NumberField label="D" value={o.packagingDepth ?? 120} min={10} max={1000} unit="mm" onChange={(v) => set({ packagingDepth: v })} />
          </div>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} onClick={() => store.setDockTab('packaging')}>
            <Package size={13} /> Open Full Packaging Studio
          </button>
        </div>
      )}

      {t === 'artboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button className="btn ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={() => store.setDockTab('artboards')}>
            Manage All Artboards
          </button>
        </div>
      )}
    </>
  );
}

export function PropertiesPanel() {
  const s = useStore();
  const doc = store.doc;
  const layer = store.activeLayer;
  if (!doc) return <div className="panel-empty">No document open</div>;

  const isText = layer?.kind === 'text';
  const geo = frameVisible() ? selectionGeometry() : null;
  const r = (v: number) => Math.round(v * 10) / 10;
  const ratio = s.opts.lockAspect;
  const fam = toolFamily(s.tool);

  return (
    <div className="properties-panel">
      <ToolCard extra={<ActiveToolInspector />} />

      {/* Live geometry of the shape being drawn or the selected shape */}
      <ShapeSection tool={s.tool} />

      {/* The anchor picked with Direct Selection */}
      <AnchorSection tool={s.tool} />

      {/* Transform Section */}
      {geo && fam !== 'navigate' && (
      <div className="panel-section">
        <div className="mini-title">Transform</div>
        {geo ? (
          <>
            <div className="prop-grid">
              <NumberField label="X" value={r(geo.x)} min={-100000} max={100000} unit="px" onChange={(v) => moveSelectionTo(v, undefined)} />
              <NumberField label="Y" value={r(geo.y)} min={-100000} max={100000} unit="px" onChange={(v) => moveSelectionTo(undefined, v)} />
              <NumberField label="W" value={r(geo.w)} min={1} max={100000} unit="px" onChange={(v) => resizeSelectionTo(v, undefined, ratio)} />
              <NumberField label="H" value={r(geo.h)} min={1} max={100000} unit="px" onChange={(v) => resizeSelectionTo(undefined, v, ratio)} />
            </div>
            <div className="prop-row">
              <NumberField label="Angle" value={geo.angle} min={-360} max={360} unit="°" onChange={(v) => rotateSelectionTo(v)} />
              <IconButton icon={<RotateCcw size={14} />} title="Rotate 90° counter-clockwise" onClick={() => rotateSelectionBy(-90)} />
              <IconButton icon={<RotateCw size={14} />} title="Rotate 90° clockwise" onClick={() => rotateSelectionBy(90)} />
              <IconButton icon={<FlipHorizontal2 size={14} />} title="Flip horizontal" onClick={() => ops.flipLayer('h')} />
              <IconButton icon={<FlipVertical2 size={14} />} title="Flip vertical" onClick={() => ops.flipLayer('v')} />
              <IconButton
                icon={ratio ? <Link2 size={13} /> : <Link2Off size={13} />}
                title={ratio ? 'Proportions locked' : 'Proportions free'}
                active={ratio}
                onClick={() => store.setOpts({ lockAspect: !ratio })}
              />
            </div>
          </>
        ) : (
          <div className="hint">Select an object to transform — click it on the canvas, or drag a box around several</div>
        )}
      </div>
      )}

      {/* Vector Tracing for Raster Images */}
      {layer?.kind === 'raster' && layer.canvas && <QuickTrace layer={layer} />}

      {/* Appearance of everything selected: opacity, blend, fill, stroke, live corners */}
      <AppearanceSection />

      {/* Text */}
      {isText && layer?.text && <TextSection layerId={layer.id} />}

      {/* One-click colors for everything selected */}
      {store.selectedLayers.some((l) => l.kind === 'shape' || l.kind === 'text') && (
        <div className="panel-section">
          <div className="mini-title">Quick colors</div>
          <div className="quick-swatches" title="Click: fill · ⌥-click or right-click: stroke">
            {[...new Set([...s.recentColors.slice(0, 6), ...QUICK_COLORS])].slice(0, 20).map((c) => (
              <button
                key={c}
                className="quick-swatch"
                style={{ background: c }}
                aria-label={`Use ${c}`}
                onClick={(e) => colorSelection(c, e.altKey ? 'stroke' : 'fill')}
                onContextMenu={(e) => {
                  e.preventDefault();
                  colorSelection(c, 'stroke');
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Next steps that fit the selection (Pathfinder, Simplify, Outline, Group…) */}
      <SmartActions />

      {/* Align Section */}
      {geo && (
      <div className="panel-section">
        <div className="mini-title">Align</div>
        <div className="align-btns">
          <IconButton icon={<AlignHorizontalJustifyStart size={14} />} title="Align Left" onClick={() => alignActive('left')} />
          <IconButton icon={<AlignHorizontalJustifyCenter size={14} />} title="Align Horizontal Center" onClick={() => alignActive('hcenter')} />
          <IconButton icon={<AlignHorizontalJustifyEnd size={14} />} title="Align Right" onClick={() => alignActive('right')} />
          <IconButton icon={<AlignVerticalJustifyStart size={14} />} title="Align Top" onClick={() => alignActive('top')} />
          <IconButton icon={<AlignVerticalJustifyCenter size={14} />} title="Align Vertical Center" onClick={() => alignActive('vcenter')} />
          <IconButton icon={<AlignVerticalJustifyEnd size={14} />} title="Align Bottom" onClick={() => alignActive('bottom')} />
        </div>
      </div>

      )}
    </div>
  );
}

const QUICK_COLORS = [
  '#000000', '#ffffff', '#1f1f1f', '#8b8d98', '#e5484d', '#f76b15', '#ffc53d', '#30a46c',
  '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#ff9a00', '#a18072', '#f0e6d2',
];

/** Fill (or stroke) of every selected shape, or the color of every selected text layer, in one step. */
function colorSelection(color: string, target: 'fill' | 'stroke') {
  const doc = store.doc;
  if (!doc) return;
  const ids = new Set(store.selectedLayers.map((l) => l.id));
  let changed = 0;
  const layers = doc.layers.map((l) => {
    if (!ids.has(l.id) || l.locked) return l;
    if (l.kind === 'shape' && l.shape) {
      changed++;
      return withLayer(l, {
        shape: target === 'fill' ? { ...l.shape, fill: color, fillEnabled: true } : { ...l.shape, stroke: color, strokeWidth: l.shape.strokeWidth || 2 },
      });
    }
    if (l.kind === 'text' && l.text) {
      changed++;
      return withLayer(l, { text: target === 'fill' ? { ...l.text, color, runs: l.text.runs?.map(({ color: _c, ...r }) => r) } : { ...l.text, strokeColor: color, stroke: l.text.stroke || 2 } });
    }
    return l;
  });
  if (!changed) return;
  store.pushRecentColor(color);
  if (target === 'fill') store.set({ fg: color });
  store.commit(target === 'fill' ? 'Fill Color' : 'Stroke Color', { layers });
}

/** Type settings for the selected text layer (or the selected characters while editing). */
function TextSection({ layerId }: { layerId: string }) {
  useStore();
  const layer = store.doc?.layers.find((l) => l.id === layerId);
  const t = layer?.text;
  if (!t) return null;
  const range = activeTextRange(layerId);
  const cs = range ? styleAt(t, range[0]) : null;
  const font = cs?.font ?? t.font;
  const weight = cs?.weight ?? t.weight;
  const size = cs?.size ?? t.size;
  const color = cs?.color ?? t.color;
  const style = (st: TextStyle, label: string) => applyTextStyle(layerId, st, label);
  return (
    <div className="panel-section props">
      <div className="mini-title">Text{range ? ' · selected characters' : ''}</div>
      <div className="prop-row">
        <FontPicker value={font} sample={t.text} onChange={(f) => style({ font: f }, 'Font')} />
        <Select value={weight} title="Weight" onChange={(w) => style({ weight: w }, 'Font Weight')} options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: WEIGHTS[w] ?? String(w) }))} />
      </div>
      <div className="prop-row">
        <NumberField label="Size" value={Math.round(size * 10) / 10} min={1} max={5000} unit="px" onChange={(v) => style({ size: v }, 'Font Size')} />
        <ColorInput value={color} title="Text color" onChange={(c) => style({ color: c }, 'Text Color')} />
        <span className="seg compact">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} className={t.align === a ? 'active' : ''} title={`Align ${a}`} onClick={() => updateText(layerId, { align: a }, 'Align Text')}>
              {a === 'left' ? <AlignLeft size={13} /> : a === 'center' ? <AlignCenter size={13} /> : <AlignRight size={13} />}
            </button>
          ))}
        </span>
      </div>
      <div className="prop-row">
        <NumberField label="Tracking" value={t.tracking} min={-200} max={1000} unit="px" onChange={(v) => updateText(layerId, { tracking: v }, 'Tracking')} />
        <NumberField label="Leading" value={Math.round(t.lineHeight * 100) / 100} min={0.5} max={4} step={0.05} unit="×" onChange={(v) => updateText(layerId, { lineHeight: v }, 'Leading')} />
      </div>
      <div className="hint">Double-click the text on the canvas to edit it</div>
    </div>
  );
}

export function StrokePanel() {
  const s = useStore();
  const layer = store.activeLayer;
  const sh = layer?.shape;

  const w = sh?.strokeWidth ?? s.opts.shapeStrokeWidth;
  const cap = sh?.strokeCap ?? s.opts.strokeCap;
  const join = sh?.strokeJoin ?? s.opts.strokeJoin;
  const dash = sh?.strokeDash && sh.strokeDash.length > 0 ? (sh.strokeDash[0] > 4 ? 'dashed' : 'dotted') : s.opts.strokeDash;

  const update = (patch: Partial<ShapeProps>, def: Partial<ToolOptions>) => {
    if (layer && sh) {
      store.updateLayer(layer.id, { shape: { ...sh, ...patch } }, 'Stroke Properties');
    }
    store.setOpts(def);
  };

  return (
    <div className="properties-panel">
      <div className="panel-section">
        <div className="mini-title">Stroke Weight</div>
        <NumberField
          label="Weight"
          value={w}
          min={0}
          max={300}
          unit="px"
          onChange={(n) => update({ strokeWidth: n }, { shapeStrokeWidth: n })}
        />
      </div>

      <div className="panel-section">
        <div className="mini-title">Cap & Corner</div>
        <div className="prop-row">
          <span className="prop-label">Cap</span>
          <Select
            value={cap}
            title="Cap style"
            onChange={(c) => update({ strokeCap: c }, { strokeCap: c })}
            options={[
              { value: 'round', label: 'Round Cap' },
              { value: 'butt', label: 'Butt Cap' },
              { value: 'square', label: 'Square Cap' },
            ]}
          />
        </div>
        <div className="prop-row">
          <span className="prop-label">Corner</span>
          <Select
            value={join}
            title="Corner style"
            onChange={(j) => update({ strokeJoin: j }, { strokeJoin: j })}
            options={[
              { value: 'round', label: 'Round Corner' },
              { value: 'miter', label: 'Miter Corner' },
              { value: 'bevel', label: 'Bevel Corner' },
            ]}
          />
        </div>
      </div>

      <div className="panel-section">
        <div className="mini-title">Dashed Line</div>
        <Select
          value={dash}
          title="Dash pattern"
          onChange={(d) => {
            const arr = d === 'dashed' ? [8, 5] : d === 'dotted' ? [2, 4] : [];
            update({ strokeDash: arr }, { strokeDash: d });
          }}
          options={[
            { value: 'solid', label: 'Solid Stroke' },
            { value: 'dashed', label: 'Dashed (8px dash, 5px gap)' },
            { value: 'dotted', label: 'Dotted (2px dot, 4px gap)' },
          ]}
        />
      </div>

      {layer && sh && (
        <div className="panel-section">
          <div className="mini-title">Align & Profile</div>
          <div className="prop-row">
            <span className="prop-label">Align</span>
            <Select
              value={sh.strokeAlign ?? 'center'}
              title="Align stroke to the outline (closed shapes)"
              onChange={(a) => store.updateLayer(layer.id, { shape: { ...sh, strokeAlign: a === 'center' ? undefined : a } }, 'Align Stroke')}
              options={[
                { value: 'center', label: 'Center' },
                { value: 'inside', label: 'Inside' },
                { value: 'outside', label: 'Outside' },
              ]}
            />
          </div>
          <div className="prop-row">
            <span className="prop-label">Profile</span>
            <Select
              value={profileId(sh.widthPoints)}
              title="Width profile (edit points with the Width tool, ⇧W)"
              onChange={(id) => {
                const prof = WIDTH_PROFILES.find((p) => p.id === id);
                if (!prof) return;
                // Profiles need a path to run along
                const path = prof.points.length ? convertToEditablePath(layer) : layer;
                store.updateLayer(layer.id, { x: path.x, y: path.y, width: path.width, height: path.height, rotation: path.rotation, shape: { ...path.shape!, widthPoints: prof.points.length ? prof.points.map((p) => ({ ...p })) : undefined } }, 'Width Profile');
              }}
              options={[...WIDTH_PROFILES.map((p) => ({ value: p.id, label: p.label })), ...(profileId(sh.widthPoints) === 'custom' ? [{ value: 'custom', label: 'Custom (Width tool)' }] : [])]}
            />
          </div>
          {!!sh.widthPoints?.length && (
            <button
              className="btn ghost"
              title="Reverse the profile along the path"
              onClick={() => store.updateLayer(layer.id, { shape: { ...sh, widthPoints: sh.widthPoints!.map((p) => ({ t: 1 - p.t, w: p.w })) } }, 'Flip Width Profile')}
            >
              Flip Profile
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Which preset a shape's width points match, else 'custom'. */
function profileId(pts: WidthPoint[] | undefined): string {
  if (!pts?.length) return 'uniform';
  const s = sortWidthPoints(pts);
  const hit = WIDTH_PROFILES.find((p) => p.points.length === s.length && p.points.every((q, i) => Math.abs(q.t - s[i].t) < 1e-6 && Math.abs(q.w - s[i].w) < 1e-6));
  return hit?.id ?? 'custom';
}

export function ArtboardsPanel() {
  useStore();
  const doc = store.doc;
  if (!doc) return <div className="panel-empty">No document</div>;

  const artboards = doc.artboards && doc.artboards.length > 0 ? doc.artboards : [getActiveArtboard(doc)];
  const active = artboards.find((a) => a.id === doc.activeArtboardId) ?? artboards[0];

  return (
    <div className="properties-panel">
      <div className="panel-section">
        <div className="mini-title">Artboards ({artboards.length})</div>
        <div className="artboard-list">
          {artboards.map((ab, i) => (
            <div
              key={ab.id}
              className={`artboard-row ${ab.id === doc.activeArtboardId ? 'active' : ''}`}
              title="Click to make active · double-click to zoom to it"
              onClick={() => {
                doc.activeArtboardId = ab.id;
                store.emit();
              }}
              onDoubleClick={() => view.fitRect(ab)}
            >
              <span className="artboard-num">{i + 1}</span>
              <span className="artboard-name">{ab.name}</span>
              <span className="artboard-dims">{ab.width} × {ab.height}</span>
            </div>
          ))}
        </div>
        <div className="prop-row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={() => editArtboards('New Artboard', (d) => addArtboard(d))}>
            <Plus size={13} /> Add Artboard
          </button>
          {artboards.length > 1 && (
            <button className="btn ghost" style={{ color: '#ff5a5a' }} onClick={() => editArtboards('Delete Artboard', (d) => removeArtboard(d, active.id))}>
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </div>

      {active && (
        <div className="panel-section">
          <div className="mini-title">Active Artboard Properties</div>
          <input
            className="opt-input"
            style={{ width: '100%', marginBottom: 8 }}
            value={active.name}
            onChange={(e) => editArtboards('Edit Artboard', (d) => updateArtboard(d, active.id, { name: e.target.value }), `ab:${active.id}`)}
            placeholder="Artboard Name"
          />
          <div className="prop-grid">
            <NumberField label="W" value={active.width} min={10} max={100000} unit="px" onChange={(w) => editArtboards('Edit Artboard', (d) => updateArtboard(d, active.id, { width: w }), `ab:${active.id}`)} />
            <NumberField label="H" value={active.height} min={10} max={100000} unit="px" onChange={(h) => editArtboards('Edit Artboard', (d) => updateArtboard(d, active.id, { height: h }), `ab:${active.id}`)} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Select
              value={active.name}
              title="Apply preset size"
              options={ARTBOARD_PRESETS.map((p) => ({ value: p.id, label: `${p.name}` }))}
              onChange={(id) => {
                const found = ARTBOARD_PRESETS.find((p) => p.id === id);
                if (found) {
                  editArtboards('Edit Artboard', (d) => updateArtboard(d, active.id, { name: found.name.split(' (')[0], width: found.width, height: found.height }), `ab:${active.id}`);
                }
              }}
            />
          </div>
        </div>
      )}

      <div className="panel-section">
        <div className="mini-title">Quick Dieline Launcher</div>
        <div className="hint" style={{ marginBottom: 6 }}>Open the dedicated Packaging tab in the dock for full box styles, fold nets, and sheet presets</div>
        <button className="btn ghost" style={{ width: '100%' }} onClick={() => store.setDockTab('packaging')}>
          <Package size={14} /> Open Packaging Studio
        </button>
      </div>
    </div>
  );
}

const PACKAGING_PRESETS = [
  { name: 'Cosmetic / Perfume Box', type: 'reverse-tuck' as BoxType, l: 45, w: 45, d: 110, desc: 'Slim luxury reverse tuck end carton' },
  { name: 'Standard Retail Product', type: 'straight-tuck' as BoxType, l: 70, w: 35, d: 130, desc: 'Clean straight tuck front face' },
  { name: 'Heavy Bottle / Jar 1-2-3', type: 'snap-lock' as BoxType, l: 65, w: 65, d: 125, desc: 'Interlocking glue-less snap bottom' },
  { name: 'Auto-Lock Crash Carton', type: 'auto-lock' as BoxType, l: 80, w: 50, d: 150, desc: 'Pre-glued instant pop-open crash bottom' },
  { name: 'E-Commerce Mailer Box', type: 'mailer-box' as BoxType, l: 200, w: 140, d: 55, desc: 'Corrugated roll-end double wall RETT' },
  { name: 'Gift / Jewelry Pillow Box', type: 'pillow-box' as BoxType, l: 85, w: 25, d: 120, desc: 'Curved pouch with thumb tab cutouts' },
  { name: 'Packaging Wrapper Sleeve', type: 'sleeve' as BoxType, l: 110, w: 40, d: 140, desc: 'Open-ended wrap band with glue seam' },
];

/** Dedicated Packaging Studio Panel for professional packaging engineers and designers */
export function PackagingPanel() {
  const s = useStore();
  const doc = store.doc;
  const o = s.opts;

  const [boxType, setBoxType] = useState<BoxType>(o.packagingBoxType ?? 'reverse-tuck');
  const [length, setLength] = useState(o.packagingLength ?? 60);
  const [width, setWidth] = useState(o.packagingWidth ?? 30);
  const [depth, setDepth] = useState(o.packagingDepth ?? 120);
  const [glue, setGlue] = useState(o.packagingGlue ?? 15);
  const [tuck, setTuck] = useState(o.packagingTuck ?? 15);
  const [foldStyle, setFoldStyle] = useState<'dotted' | 'dashed' | 'crease-perf' | 'solid'>(o.packagingFoldStyle ?? 'dotted');
  const [bleed, setBleed] = useState(o.packagingBleed ?? 3);
  const [ppi, setPpi] = useState(o.packagingPpi ?? 300);

  const spec: PackagingSpec = {
    type: boxType,
    length,
    width,
    depth,
    glue,
    tuck,
    ppi,
    foldStyle,
    bleed,
  };

  const d = generateDieline(spec);
  const pxToMm = (px: number) => Math.round(((px * 25.4) / ppi) * 10) / 10;
  const sheetW = pxToMm(d.width);
  const sheetH = pxToMm(d.height);

  const addDieline = (fitArtboard = false) => {
    if (!doc) return;
    const ab = getActiveArtboard(doc);
    if (fitArtboard) {
      const marginPx = mmToPx(15, ppi);
      const newW = Math.round(d.width + marginPx * 2);
      const newH = Math.round(d.height + marginPx * 2);
      editArtboards('Fit Artboard to Dieline', (d) => updateArtboard(d, ab.id, { width: newW, height: newH }));
    }
    const targetAb = getActiveArtboard(store.doc!);
    const x = Math.round(targetAb.x + (targetAb.width - d.width) / 2);
    const y = Math.round(targetAb.y + (targetAb.height - d.height) / 2);
    const strokeW = Math.max(1, Math.round(ppi / 150));
    const parts = dielineLayers(d, x, y, strokeW, spec);
    const label = `Dieline · ${BOX_TYPE_LABELS[boxType]} (${length}×${width}×${depth} mm)`;
    const grouped = groupLayers([...store.doc!.layers, ...parts], parts.map((l) => l.id), label);
    if (!grouped) return;
    store.commit('Add Packaging Dieline', { layers: grouped.layers, activeId: grouped.group.id }, { icon: 'shape' });
    store.toast(`Placed ${BOX_TYPE_LABELS[boxType]} (${sheetW} × ${sheetH} mm)`, 'success');
  };

  return (
    <div className="properties-panel packaging-panel">
      {/* Box Style Selector */}
      <div className="panel-section">
        <div className="mini-title">Box Standard & Net Style</div>
        <Select
          value={boxType}
          title="Box Structure"
          options={Object.entries(BOX_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
          onChange={(v) => {
            setBoxType(v as BoxType);
            store.setOpts({ packagingBoxType: v as BoxType });
          }}
        />
        <div className="hint" style={{ marginTop: 6 }}>
          {boxType === 'reverse-tuck' && 'Standard folding carton: top tuck hinges on back, bottom tuck hinges on front.'}
          {boxType === 'straight-tuck' && 'Clean appearance: top and bottom tuck flaps hinge from the same panel.'}
          {boxType === 'snap-lock' && 'Heavy duty: 4 interlocking bottom flaps (1-2-3) supporting bottles and weights.'}
          {boxType === 'auto-lock' && 'Fast assembly: pre-glued crash bottom that pops open automatically.'}
          {boxType === 'mailer-box' && 'E-commerce shipping: roll-end tuck top with double-wall roll-over side panels.'}
          {boxType === 'pillow-box' && 'Curved gift pouch: arched convex score lines with ergonomic thumb tab cutouts.'}
          {boxType === 'sleeve' && 'Open-ended tubular belly band wrap for boxes, food containers and trays.'}
        </div>
      </div>

      {/* Internal Dimensions */}
      <div className="panel-section">
        <div className="mini-title">Inside Dimensions (mm)</div>
        <div className="prop-grid">
          <NumberField label="Length" value={length} min={5} max={2000} unit="mm" onChange={(v) => { setLength(v); store.setOpts({ packagingLength: v }); }} />
          <NumberField label="Width" value={width} min={5} max={2000} unit="mm" onChange={(v) => { setWidth(v); store.setOpts({ packagingWidth: v }); }} />
          <NumberField label="Depth" value={depth} min={5} max={2000} unit="mm" onChange={(v) => { setDepth(v); store.setOpts({ packagingDepth: v }); }} />
          <NumberField label="Glue Tab" value={glue} min={5} max={100} unit="mm" onChange={(v) => { setGlue(v); store.setOpts({ packagingGlue: v }); }} />
        </div>
        {boxType !== 'pillow-box' && boxType !== 'sleeve' && (
          <div className="prop-row" style={{ marginTop: 6 }}>
            <NumberField label="Tuck Flap" value={tuck} min={5} max={100} unit="mm" onChange={(v) => { setTuck(v); store.setOpts({ packagingTuck: v }); }} />
            <NumberField label="Bleed" value={bleed} min={0} max={25} unit="mm" onChange={(v) => { setBleed(v); store.setOpts({ packagingBleed: v }); }} />
          </div>
        )}
      </div>

      {/* Production & Crease Fold Settings */}
      <div className="panel-section">
        <div className="mini-title">Crease & Production Lines</div>
        <div className="prop-row">
          <span className="prop-label">Fold Crease</span>
          <Select
            value={foldStyle}
            title="Fold Crease Stroke Style"
            options={[
              { value: 'dotted', label: 'Dotted (Print Spot Crease)' },
              { value: 'dashed', label: 'Dashed (Standard Folding)' },
              { value: 'crease-perf', label: 'Perforated (Tear / Fold)' },
              { value: 'solid', label: 'Solid Line' },
            ]}
            onChange={(v) => {
              setFoldStyle(v as 'dotted' | 'dashed' | 'crease-perf' | 'solid');
              store.setOpts({ packagingFoldStyle: v as 'dotted' | 'dashed' | 'crease-perf' | 'solid' });
            }}
          />
        </div>
        <div className="prop-row">
          <span className="prop-label">Print DPI</span>
          <Select
            value={ppi}
            title="Dieline Resolution"
            options={[
              { value: 300, label: '300 DPI (High Resolution Prepress)' },
              { value: 600, label: '600 DPI (Ultra Precision Laser Die)' },
              { value: 150, label: '150 DPI (Draft Proofing)' },
            ]}
            onChange={(v) => {
              setPpi(Number(v));
              store.setOpts({ packagingPpi: Number(v) });
            }}
          />
        </div>
        <div className="dieline-specs-card" style={{ background: 'var(--panel-bg-subtle, rgba(255,255,255,0.03))', padding: '8px 10px', borderRadius: 6, marginTop: 8, fontSize: 11, border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: 'var(--text-muted)' }}>Flat Sheet Footprint:</span>
            <span style={{ fontWeight: 600, color: 'var(--accent, #ff9a00)' }}>{sheetW} × {sheetH} mm</span>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: '#ff0055' }} /> CutContour
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: '#00a3ff' }} /> Crease Fold
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: '#00e676' }} /> Bleed Safe
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="panel-section">
        <div className="prop-row" style={{ flexDirection: 'column', gap: 6 }}>
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => addDieline(false)}>
            <Package size={14} /> Insert Box Dieline
          </button>
          <button className="btn ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={() => addDieline(true)} title="Sizes active artboard with 15mm print margins around box dieline">
            Fit Artboard & Insert Dieline
          </button>
        </div>
      </div>

      {/* Industry Box Presets */}
      <div className="panel-section">
        <div className="mini-title">Popular Packaging Presets</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {PACKAGING_PRESETS.map((p) => (
            <button
              key={p.name}
              className="btn ghost"
              style={{ justifyContent: 'space-between', textAlign: 'left', padding: '6px 8px', fontSize: 11 }}
              onClick={() => {
                setBoxType(p.type);
                setLength(p.l);
                setWidth(p.w);
                setDepth(p.d);
                store.setOpts({ packagingBoxType: p.type, packagingLength: p.l, packagingWidth: p.w, packagingDepth: p.d });
                store.toast(`Loaded preset: ${p.name}`, 'info');
              }}
            >
              <span>
                <b style={{ display: 'block', color: 'var(--text-bright)' }}>{p.name}</b>
                <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{p.l}×{p.w}×{p.d} mm · {BOX_TYPE_LABELS[p.type].split(' ')[0]}</span>
              </span>
              <Package size={13} style={{ opacity: 0.6 }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Dedicated Logo Design Studio with 10 Construction Grids and Shape Builder fusion */
export function LogoStudioPanel() {
  const [gridType, setGridType] = useState<LogoGridType>('golden-ratio');
  const [size, setSize] = useState(400);
  const [color, setColor] = useState('#00d2ff');
  const [strokeWidth, setStrokeWidth] = useState(1.5);
  const [dashed, setDashed] = useState(false);
  const [selectedCat, setSelectedCat] = useState<'All' | 'Geometric' | 'Mathematical' | 'Radial' | 'Typography'>('All');

  const filtered = selectedCat === 'All' ? LOGO_GRID_CATALOG : LOGO_GRID_CATALOG.filter((g) => g.category === selectedCat);

  return (
    <div className="properties-panel logo-studio-panel">
      {/* Category selector */}
      <div className="panel-section">
        <div className="mini-title">Logo Construction Grids (10 Standards)</div>
        <div className="fx-seg" style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {(['All', 'Geometric', 'Mathematical', 'Radial', 'Typography'] as const).map((cat) => (
            <button
              key={cat}
              className={selectedCat === cat ? 'on' : ''}
              onClick={() => setSelectedCat(cat)}
              style={{ fontSize: 10, padding: '3px 6px' }}
            >
              {cat}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.map((g) => (
            <button
              key={g.id}
              className={`btn ${gridType === g.id ? 'primary' : 'ghost'}`}
              style={{ justifyContent: 'space-between', textAlign: 'left', padding: '6px 8px', fontSize: 11 }}
              onClick={() => setGridType(g.id)}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, opacity: 0.85, width: 16, textAlign: 'center' }}>{g.iconHint}</span>
                <span>
                  <b style={{ display: 'block' }}>{g.name}</b>
                  <span style={{ fontSize: 10, opacity: 0.7 }}>{g.category}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Grid Settings */}
      <div className="panel-section">
        <div className="mini-title">Grid Dimensions & Appearance</div>
        <div className="prop-grid">
          <NumberField label="Grid Size" value={size} min={50} max={2000} unit="px" onChange={setSize} />
          <NumberField label="Weight" value={strokeWidth} min={0.5} max={10} unit="px" onChange={setStrokeWidth} />
        </div>
        <div className="prop-row" style={{ marginTop: 6 }}>
          <span className="prop-label">Guide Color</span>
          <ColorInput value={color} onChange={setColor} title="Guide Color" />
          <Toggle label="Dashed Lines" checked={dashed} onChange={setDashed} />
        </div>
      </div>

      {/* Insert Action */}
      <div className="panel-section">
        <button
          className="btn primary"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => insertLogoGridOntoCanvas(gridType, { size, color, strokeWidth, dashed })}
        >
          <Sparkles size={14} /> Place Grid on Artboard
        </button>
      </div>

      {/* Shape Builder / Joiner Workflow Instructions */}
      <div className="panel-section">
        <div className="mini-title">Grid Joiner & Logo Shaper</div>
        <div className="hint" style={{ fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>
          <b>How to forge your logo mark:</b>
          <ol style={{ paddingLeft: 16, margin: '4px 0 0 0' }}>
            <li>Place your chosen construction grid on the artboard.</li>
            <li>Select the grid layer(s).</li>
            <li>Switch to the <b>Shape Builder Tool (⇧M)</b>.</li>
            <li>Drag across overlapping grid cells to <b>fuse & merge</b> them into solid geometry.</li>
            <li>Hold <b>⌥ (Alt)</b> and drag to erase and carve negative space!</li>
          </ol>
        </div>
        <button
          className="btn ghost"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => store.set({ tool: 'shape-builder' })}
        >
          <Wand2 size={13} /> Switch to Shape Builder (⇧M)
        </button>
      </div>
    </div>
  );
}

/** Properties ▸ Image Trace: one click with Auto (reads the picture), the pixel-exact and colour shortcuts. */
function QuickTrace({ layer }: { layer: Layer }) {
  const o = store.state.opts;
  const auto = autoTrace(layer);
  const go = (opts: TraceOptions) => void runTrace(layer, opts, { after: o.traceAfter, output: o.traceOutput });
  const preset = (id: string) => TRACE_PRESETS.find((p) => p.id === id)!.opts;
  return (
    <div className="panel-section">
      <div className="mini-title">Image Trace</div>
      <div className="hint" style={{ marginBottom: 6 }}>Auto: {auto.why}</div>
      <div className="prop-row" style={{ flexDirection: 'column', gap: 6 }}>
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!!store.state.busy} onClick={() => go(currentTraceOptions(layer))}>
          <Sparkles size={14} /> Trace Image{o.tracePreset === 'auto' ? ' (Auto)' : ''}
        </button>
        <div className="prop-row" style={{ gap: 6 }}>
          <button className="btn ghost" onClick={() => go({ ...preset('color-logo'), split: o.traceOutput === 'shapes' })} title="Exact colours found automatically, background dropped">
            <Wand2 size={13} /> Colour
          </button>
          <button className="btn ghost" onClick={() => go({ ...preset('pixel-art'), split: o.traceOutput === 'shapes' })} title="Every pixel edge, exact colours">
            Pixel-exact
          </button>
          <button className="btn ghost" onClick={() => go(preset('centerline'))} title="Single strokes down the middle of lines">
            Centerline
          </button>
        </div>
        <button className="btn ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={() => void import('./StudioPanel').then((m) => m.openStudioKit('trace'))}>
          Trace Studio: every setting and a live preview
        </button>
      </div>
    </div>
  );
}
