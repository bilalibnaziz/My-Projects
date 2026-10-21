import type { ReactNode } from 'react';
import {
  Check, X, RotateCw, RotateCcw, Link2, Link2Off, Crosshair, FlipHorizontal2, FlipVertical2,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
  Package, FileText, Sparkles, ScanEye,
} from 'lucide-react';
import { store, useStore } from '../core/store';
import type { ToolOptions, TransformMode } from '../core/store';
import type { Layer, ShapeProps, TextProps, TextStyle } from '../core/types';
import { styleAt } from '../core/text';
import { meshFromCorners } from '../core/transform';
import { ColorInput, IconButton, NumberField, Select, Toggle } from './widgets';
import { alignActive, centerActive, distributeSelected, ALIGN_LABELS } from '../core/align';
import { frameVisible, moveSelectionTo, resizeSelectionTo, rotateSelectionBy, rotateSelectionTo, selectionGeometry } from '../core/objectTransform';
import * as pro from '../core/proTools';
import type { AlignEdge } from '../core/align';
import { toolLabel } from './ToolRail';
import { FontPicker } from './FontPicker';
import { BrushPresetPicker } from './BrushPresetPicker';
import * as tools from '../core/tools';
import * as ops from '../core/ops';
import { applyPathfinder, pathfinderDivide, pathfinderExtra, PATHFINDER_EXTRA_LABELS, type PathfinderExtraOp, joinPaths, ARTBOARD_PRESETS, getActiveArtboard, addArtboard, updateArtboard, removeArtboard, editArtboards } from '../core/vectorOps';
import { commitCurvature } from '../core/tools';
import { BOX_TYPE_LABELS } from '../core/dieline';
import type { BoxType } from '../core/dieline';
import { detectTextFromCanvas, copyTextToClipboard, createLiveTypeLayerFromBlock } from '../core/masterSelect';
import { TRACE_PRESETS } from '../core/tracer';
import { autoTrace, currentTraceOptions, parsePalette, runTrace } from '../core/studio/trace';
import { openStudioKit } from './StudioPanel';
import { ShapeGeometryControls, keyTips, shapeTarget, toolFamily } from './ToolContext';

const set = (p: Partial<ToolOptions>) => store.setOpts(p);

export function OptionsBar() {
  const s = useStore();
  const o = s.opts;
  const t = s.tool;

  if (s.transform) {
    const tr = s.transform;
    return (
      <div className="options-bar">
        <span className="opt-title">Free Transform</span>
        <div className="fx-seg transform-modes" role="radiogroup" aria-label="Transform mode">
          {TRANSFORM_MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={(tr.mode ?? 'free') === m.id}
              className={(tr.mode ?? 'free') === m.id ? 'on' : ''}
              title={m.hint}
              onClick={() => {
                // Warp starts from a flat 4×4 grid over the current box; other modes drop the mesh
                if (m.id === 'warp') updateT({ mode: 'warp', mesh: tr.mesh ?? meshFromCorners(ops.transformCorners(tr)) });
                else updateT({ mode: m.id, mesh: undefined });
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        {tr.quad || tr.mesh ? (
          <button className="btn ghost" onClick={() => updateT({ quad: undefined, mesh: undefined, mode: 'free' })} title="Back to a plain scale / rotate box">
            Reset Corners
          </button>
        ) : (
          <>
            <NumberField label="W" value={Math.round(tr.scaleX * 1000) / 10} min={-1000} max={1000} unit="%" onChange={(v) => updateT({ scaleX: v / 100 })} />
            <NumberField label="H" value={Math.round(tr.scaleY * 1000) / 10} min={-1000} max={1000} unit="%" onChange={(v) => updateT({ scaleY: v / 100 })} />
            <NumberField label="∠" value={Math.round((tr.angle * 180) / Math.PI * 10) / 10} min={-360} max={360} unit="°" onChange={(v) => updateT({ angle: (v * Math.PI) / 180 })} />
          </>
        )}
        <span className="opt-hint">{TRANSFORM_MODES.find((m) => m.id === (tr.mode ?? 'free'))!.hint}</span>
        <div className="opt-spacer" />
        <button className="btn ghost" onClick={() => ops.cancelTransform()}>
          <X size={14} /> Cancel
        </button>
        <button className="btn primary" onClick={() => ops.commitTransform()}>
          <Check size={14} /> Apply
        </button>
      </div>
    );
  }

  const brushy = tools.isBrushTool(t);
  return (
    <div className="options-bar">
      <span className="opt-title">{toolLabel(t)}</span>

      {t === 'pencil' && (
        <>
          <NumberField label="Stroke" value={o.shapeStrokeWidth} min={1} max={100} unit="px" onChange={(v) => set({ shapeStrokeWidth: v })} />
          <NumberField label="Fidelity" value={o.pencilFidelity} min={1} max={20} unit="px" onChange={(v) => set({ pencilFidelity: v })} />
          <NumberField label="StreamLine" value={o.pencilStreamline} min={0} max={50} unit="px" onChange={(v) => set({ pencilStreamline: v })} />
          <Toggle label="⚡ QuickShape" checked={o.pencilQuickShape} onChange={(v) => set({ pencilQuickShape: v })} title="Hold the pen still at the end of a stroke to snap it to a clean line, arc, circle, ellipse, rectangle, triangle, polygon or star" />
          <Toggle label="Sculpt" checked={o.pencilSculpt} onChange={(v) => set({ pencilSculpt: v })} title="With a path selected: draw from one point on it to another to reshape that stretch, from an open end to extend it, or end to end to close it" />
          <Toggle label="Auto-Close" checked={o.pencilAutoClose} onChange={(v) => set({ pencilAutoClose: v })} title="A stroke that ends on its start becomes a closed shape (seamless, no kink)" />
          <Toggle label="Fill" checked={o.shapeFill} onChange={(v) => set({ shapeFill: v })} title="Enable fill color for closed pencil shapes" />
          {o.shapeFill && <ColorInput value={s.fg} onChange={(v) => store.set({ fg: v })} title="Fill Color" />}
          <ColorInput value={o.shapeFill ? o.shapeStrokeColor : s.fg} onChange={(v) => o.shapeFill ? set({ shapeStrokeColor: v }) : store.set({ fg: v })} title="Stroke Color" />
        </>
      )}

      {(t === 'brush' || t === 'bucket' || t === 'gradient' || t === 'color-replace') && <ColorInput value={s.fg} onChange={(v) => store.set({ fg: v })} title="Foreground color" />}
      {t === 'gradient' && o.gradientMode === 'fg-bg' && <ColorInput value={s.bg} onChange={(v) => store.set({ bg: v })} title="Background color (gradient end)" />}

      {brushy && (
        <>
          <BrushPresetPicker currentSize={o.size} currentHardness={o.hardness} />
          <NumberField label="Size" value={o.size} min={1} max={2000} unit="px" onChange={(v) => set({ size: v })} />
          <NumberField label="Hardness" value={Math.round(o.hardness * 100)} min={0} max={100} unit="%" onChange={(v) => set({ hardness: v / 100 })} />
        </>
      )}
      {(['brush', 'eraser', 'clone', 'bucket', 'gradient', 'color-replace', 'history-brush', 'magic-eraser', 'heal-brush'] as const).includes(t as never) && (
        <NumberField label="Opacity" value={Math.round(o.opacity * 100)} min={1} max={100} unit="%" onChange={(v) => set({ opacity: v / 100 })} />
      )}
      {(t === 'brush' || t === 'eraser' || t === 'clone' || t === 'history-brush') && (
        <>
          <NumberField label="Flow" value={Math.round(o.flow * 100)} min={1} max={100} unit="%" onChange={(v) => set({ flow: v / 100 })} />
          <NumberField label="Smoothing" value={Math.round(o.smoothing * 100)} min={0} max={100} unit="%" onChange={(v) => set({ smoothing: v / 100 })} />
        </>
      )}
      {brushy && <Toggle label="Pen pressure → size" checked={o.pressureSize} onChange={(v) => set({ pressureSize: v })} />}
      {(t === 'brush' || t === 'eraser') && <Toggle label="→ opacity" checked={o.pressureOpacity} onChange={(v) => set({ pressureOpacity: v })} />}
      {(t === 'clone' || t === 'heal-brush') && (
        <>
          <Toggle label="Aligned" checked={o.cloneAligned} onChange={(v) => set({ cloneAligned: v })} />
          <Toggle label="Sample all layers" checked={o.sampleAll} onChange={(v) => set({ sampleAll: v })} />
        </>
      )}
      {(t === 'dodge' || t === 'burn') && (
        <>
          <Select value={o.dodgeRange} onChange={(v) => set({ dodgeRange: v })} options={[{ value: 'shadows', label: 'Shadows' }, { value: 'midtones', label: 'Midtones' }, { value: 'highlights', label: 'Highlights' }]} />
          <NumberField label="Exposure" value={Math.round(o.exposure * 100)} min={1} max={100} unit="%" onChange={(v) => set({ exposure: v / 100 })} />
        </>
      )}
      {t === 'sponge' && (
        <Select value={o.spongeMode} onChange={(v) => set({ spongeMode: v })} options={[{ value: 'desaturate', label: 'Desaturate' }, { value: 'saturate', label: 'Saturate' }]} />
      )}
      {(t === 'sponge' || t === 'blur' || t === 'sharpen' || t === 'smudge') && (
        <NumberField label="Strength" value={Math.round(o.strength * 100)} min={1} max={100} unit="%" onChange={(v) => set({ strength: v / 100 })} />
      )}

      {(t === 'marquee-rect' || t === 'marquee-ellipse' || t === 'lasso' || t === 'poly-lasso') && (
        <>
          <NumberField label="Feather" value={o.selFeather} min={0} max={250} unit="px" onChange={(v) => set({ selFeather: v })} />
          <span className="opt-hint">Shift add · ⌥ subtract · Shift⌥ intersect</span>
        </>
      )}
      {(t === 'bg-eraser' || t === 'color-replace') && (
        <>
          <NumberField label="Tolerance" value={o.tolerance} min={0} max={255} onChange={(v) => set({ tolerance: v })} />
          <Select value={o.bgSampling} title="Sampling" onChange={(v) => set({ bgSampling: v })} options={[{ value: 'continuous', label: 'Sample: Continuous' }, { value: 'once', label: 'Sample: Once' }]} />
        </>
      )}
      {t === 'bg-eraser' && <Toggle label="Protect foreground color" checked={o.protectFg} onChange={(v) => set({ protectFg: v })} />}
      {t === 'color-replace' && (
        <Select value={o.replaceMode} title="Mode" onChange={(v) => set({ replaceMode: v })} options={[{ value: 'color', label: 'Color' }, { value: 'hue', label: 'Hue' }, { value: 'saturation', label: 'Saturation' }, { value: 'luminosity', label: 'Luminosity' }]} />
      )}
      {t === 'history-brush' && <HistorySourceHint />}
      {t === 'heal-brush' && <span className="opt-hint">⌥-click a clean source, then paint</span>}
      {(t === 'marquee-row' || t === 'marquee-col') && <span className="opt-hint">Click to select one pixel {t === 'marquee-row' ? 'row' : 'column'} · Shift add · ⌥ subtract</span>}
      {t === 'quick-select' && (
        <>
          <NumberField label="Size" value={o.size} min={1} max={2000} unit="px" onChange={(v) => set({ size: v })} />
          <NumberField label="Tolerance" value={o.tolerance} min={0} max={255} onChange={(v) => set({ tolerance: v })} />
          <span className="opt-hint">Paint to grow the selection · ⌥ paints it away · [ ] size</span>
        </>
      )}
      {t === 'red-eye' && (
        <>
          <NumberField label="Pupil size" value={Math.round(o.redEyePupil * 100)} min={1} max={100} unit="%" onChange={(v) => set({ redEyePupil: v / 100 })} />
          <NumberField label="Darken" value={Math.round(o.redEyeDarken * 100)} min={0} max={100} unit="%" onChange={(v) => set({ redEyeDarken: v / 100 })} />
          <span className="opt-hint">Click an eye, or drag a box around it</span>
        </>
      )}
      {t === 'pen' && <PenOptions />}
      {t === 'ruler' && <RulerOptions />}
      {(t === 'eyedropper' || t === 'color-sampler') && (
        <Select
          value={o.samplerSize}
          title="Sample size"
          onChange={(v) => set({ samplerSize: v })}
          options={[{ value: 1, label: 'Point sample' }, { value: 3, label: '3 × 3 average' }, { value: 5, label: '5 × 5 average' }, { value: 11, label: '11 × 11 average' }]}
        />
      )}
      {t === 'color-sampler' && (
        <>
          <span className="opt-hint">{store.doc?.samplers?.length ?? 0} / {pro.MAX_SAMPLERS} samplers · readouts in the Info panel</span>
          <button className="btn ghost" onClick={() => pro.clearSamplers()} disabled={!store.doc?.samplers?.length}>Clear</button>
        </>
      )}
      {(t === 'wand' || t === 'bucket' || t === 'magic-eraser') && (
        <>
          <NumberField label="Tolerance" value={o.tolerance} min={0} max={255} onChange={(v) => set({ tolerance: v })} />
          <Toggle label="Contiguous" checked={o.contiguous} onChange={(v) => set({ contiguous: v })} />
          <Toggle label="Sample all layers" checked={o.sampleAll} onChange={(v) => set({ sampleAll: v })} />
        </>
      )}

      {t === 'crop' && (
        <>
          <Select
            value={o.cropRatio}
            onChange={(v) => {
              set({ cropRatio: v });
              tools.applyCropRatio();
            }}
            options={[
              { value: 'free', label: 'Free ratio' },
              { value: 'original', label: 'Original' },
              { value: '1:1', label: '1 : 1 (Square)' },
              { value: '4:5', label: '4 : 5 (Portrait)' },
              { value: '3:2', label: '3 : 2 (Photo)' },
              { value: '16:9', label: '16 : 9 (Wide)' },
              { value: '9:16', label: '9 : 16 (Story)' },
            ]}
          />
          {s.crop && (
            <>
              <NumberField label="W" value={Math.round(s.crop.rect.width)} min={1} max={100000} unit="px" onChange={(v) => store.set({ crop: { rect: { ...s.crop!.rect, width: v } } })} />
              <NumberField label="H" value={Math.round(s.crop.rect.height)} min={1} max={100000} unit="px" onChange={(v) => store.set({ crop: { rect: { ...s.crop!.rect, height: v } } })} />
            </>
          )}
          <Toggle label="Delete cropped pixels" checked={o.cropDelete} onChange={(v) => set({ cropDelete: v })} />
          <div className="opt-spacer" />
          <button className="btn ghost" onClick={() => tools.startCrop()} title="Reset crop box">
            <RotateCw size={13} /> Reset
          </button>
          <button className="btn ghost" onClick={() => tools.cancelCrop()}>
            <X size={14} /> Cancel
          </button>
          <button className="btn primary" onClick={() => tools.commitCrop()} disabled={!s.crop}>
            <Check size={14} /> Crop
          </button>
        </>
      )}

      {t === 'gradient' && (
        <>
          <Select value={o.gradientType} onChange={(v) => set({ gradientType: v })} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }, { value: 'reflected', label: 'Reflected' }]} />
          <Select value={o.gradientMode} onChange={(v) => set({ gradientMode: v })} options={[{ value: 'fg-bg', label: 'Foreground → Background' }, { value: 'fg-transparent', label: 'Foreground → Transparent' }]} />
          <Toggle label="Reverse" checked={o.gradientReverse} onChange={(v) => set({ gradientReverse: v })} />
        </>
      )}

      {toolFamily(t) === 'type' && <TextOptions />}

      {tools.isShapeTool(t) && !t.startsWith('graph-') && <ShapeOptions />}
      <VectorToolOptions />
      {t === 'direct-select' && <DirectSelectOptions />}
      {t === 'curvature' && <CurvatureOptions />}
      {t === 'artboard' && <ArtboardOptions />}
      {t === 'shape-builder' && <ShapeBuilderOptions />}

      {t === 'master-select' && <MasterSelectOptions />}
      {t === 'packaging' && <PackagingOptions />}
      {t === 'image-trace' && <ImageTraceOptions />}
      {t !== 'image-trace' && s.activeDocId && store.activeLayer?.kind === 'raster' && <TraceButton />}
      {t === 'eyedropper' && <span className="opt-hint">Click to set foreground · ⌥-click sets background</span>}
      {(t === 'hand' || t === 'zoom') && <span className="opt-hint">Pinch or ⌘/Ctrl + scroll to zoom · Space-drag to pan · ⌘0 fit · ⌘1 100%</span>}
      {t === 'move' && <MoveOptions />}
      {t === 'heal' && <span className="opt-hint">Paint over what you want gone — it's rebuilt from surrounding texture</span>}
    </div>
  );
}

const ALIGN_ICONS: Record<AlignEdge, ReactNode> = {
  left: <AlignHorizontalJustifyStart size={15} />,
  hcenter: <AlignHorizontalJustifyCenter size={15} />,
  right: <AlignHorizontalJustifyEnd size={15} />,
  top: <AlignVerticalJustifyStart size={15} />,
  vcenter: <AlignVerticalJustifyCenter size={15} />,
  bottom: <AlignVerticalJustifyEnd size={15} />,
};

function HistorySourceHint() {
  const s = useStore();
  const doc = store.doc;
  const src = s.historySource && doc?.history.includes(s.historySource) ? s.historySource : doc?.history[0];
  return <span className="opt-hint">Source: <b>{src?.label ?? '—'}</b> · set it with the brush icon in History</span>;
}

function PenOptions() {
  const s = useStore();
  const o = s.opts;
  const drawing = !!pro.pen.path && pro.pen.path.docId === store.doc?.id;
  return (
    <>
      <Select value={o.penMode} title="Pen makes" onChange={(v) => set({ penMode: v })} options={[{ value: 'shape', label: 'Shape layer' }, { value: 'selection', label: 'Selection' }]} />
      {o.penMode === 'shape' && (
        <>
          <Toggle label="Fill" checked={o.shapeFill} onChange={(v) => set({ shapeFill: v })} />
          <ColorInput value={s.fg} onChange={(v) => store.set({ fg: v })} title="Fill color (foreground)" />
          <NumberField label="Stroke" value={o.shapeStrokeWidth} min={0} max={300} unit="px" onChange={(n) => set({ shapeStrokeWidth: n })} />
          <ColorInput value={o.shapeStrokeColor} onChange={(c) => set({ shapeStrokeColor: c })} title="Stroke color" />
        </>
      )}
      <span className="opt-hint">Click = corner · drag = curve · Shift = 45° · click first point to close</span>
      <div className="opt-spacer" />
      <button className="btn ghost" disabled={!drawing} onClick={() => pro.cancelPen()}>
        <X size={14} /> Cancel
      </button>
      <button className="btn primary" disabled={!drawing} onClick={() => pro.commitPen()}>
        <Check size={14} /> {o.penMode === 'shape' ? 'Make Shape' : 'Make Selection'}
      </button>
    </>
  );
}

function RulerOptions() {
  useStore();
  const l = pro.ruler.line;
  const m = l ? pro.measure(l.a, l.b) : null;
  const f = (v: number) => v.toFixed(1);
  return (
    <>
      {m && l ? (
        <span className="opt-readout mono">
          X {f(l.a.x)} Y {f(l.a.y)} · W {f(m.dx)} H {f(-m.dy)} · A {m.angle.toFixed(2)}° · L {f(m.length)} px
        </span>
      ) : (
        <span className="opt-hint">Drag to measure · Shift snaps to 45° · drag an end to adjust</span>
      )}
      <div className="opt-spacer" />
      <button className="btn ghost" disabled={!l} onClick={() => pro.clearRuler()}>Clear</button>
      <button className="btn primary" disabled={!l} onClick={() => pro.straightenLayer()} title="Rotate the active layer so this line is level (or plumb)">
        Straighten Layer
      </button>
    </>
  );
}

function MoveOptions() {
  const s = useStore();
  const selected = store.selectedLayers.filter((l) => l.kind !== 'adjustment');
  const many = selected.length > 1;
  const shown = frameVisible();
  const g = shown ? selectionGeometry() : null;
  const to = many && !store.doc?.selection ? `${selected.length} layers` : store.doc?.selection ? 'selection' : 'canvas';
  const r = (v: number) => Math.round(v * 10) / 10;
  const ratio = s.opts.lockAspect;
  return (
    <>
      <span className="opt-group" title={`Aligns the active layer to the ${to}`}>
        {(Object.keys(ALIGN_ICONS) as AlignEdge[]).map((e) => (
          <IconButton key={e} icon={ALIGN_ICONS[e]} title={`${ALIGN_LABELS[e]} (to ${to})`} disabled={!g} onClick={() => alignActive(e)} />
        ))}
        <IconButton icon={<Crosshair size={15} />} title={many ? 'Center the layers on the canvas' : `Center on ${to}`} disabled={!g} onClick={() => centerActive()} />
      </span>
      {selected.length >= 3 && (
        <span className="opt-group" title="Space the selected layers evenly">
          <IconButton icon={<AlignHorizontalDistributeCenter size={15} />} title="Distribute horizontal centers" onClick={() => distributeSelected('hcenter')} />
          <IconButton icon={<AlignHorizontalSpaceAround size={15} />} title="Distribute horizontal spacing" onClick={() => distributeSelected('hspace')} />
          <IconButton icon={<AlignVerticalDistributeCenter size={15} />} title="Distribute vertical centers" onClick={() => distributeSelected('vcenter')} />
          <IconButton icon={<AlignVerticalSpaceAround size={15} />} title="Distribute vertical spacing" onClick={() => distributeSelected('vspace')} />
        </span>
      )}
      {g && (
        <span className="opt-group">
          <NumberField label="X" value={r(g.x)} min={-100000} max={100000} unit="px" onChange={(v) => moveSelectionTo(v, undefined)} />
          <NumberField label="Y" value={r(g.y)} min={-100000} max={100000} unit="px" onChange={(v) => moveSelectionTo(undefined, v)} />
          <NumberField label="W" value={r(g.w)} min={1} max={100000} unit="px" onChange={(v) => resizeSelectionTo(v, undefined, ratio)} />
          <IconButton
            icon={ratio ? <Link2 size={13} /> : <Link2Off size={13} />}
            title={ratio ? 'Proportions locked — handles and W/H keep the shape (Shift frees them)' : 'Proportions free (Shift keeps them)'}
            active={ratio}
            onClick={() => set({ lockAspect: !ratio })}
          />
          <NumberField label="H" value={r(g.h)} min={1} max={100000} unit="px" onChange={(v) => resizeSelectionTo(undefined, v, ratio)} />
          <NumberField label="∠" value={g.angle} min={-360} max={360} unit="°" width={44} onChange={(v) => rotateSelectionTo(v)} />
          <IconButton icon={<RotateCcw size={14} />} title="Rotate 90° counter-clockwise" onClick={() => rotateSelectionBy(-90)} />
          <IconButton icon={<RotateCw size={14} />} title="Rotate 90° clockwise" onClick={() => rotateSelectionBy(90)} />
          <IconButton icon={<FlipHorizontal2 size={14} />} title="Flip horizontal" disabled={many} onClick={() => ops.flipLayer('h')} />
          <IconButton icon={<FlipVertical2 size={14} />} title="Flip vertical" disabled={many} onClick={() => ops.flipLayer('v')} />
        </span>
      )}
      <span className="opt-group">
        <Select
          value={s.opts.autoSelect}
          title="What a click on the canvas selects"
          onChange={(v) => set({ autoSelect: v })}
          options={[
            { value: 'group', label: 'Auto-Select: Group' },
            { value: 'layer', label: 'Auto-Select: Layer' },
            { value: 'off', label: 'Auto-Select: Off' },
          ]}
        />
        <Toggle label="Transform controls" checked={s.opts.transformControls} onChange={(v) => set({ transformControls: v })} />
        <Select
          value=""
          title="Create Mockup: Generates photorealistic product, model apparel, food packaging or device presentations"
          onChange={(v) => ops.createMockupFromActiveLayer(v as any)}
          options={[
            { value: '', label: '⚡ Smart Mockups…' },
            // Food & Culinary
            { value: 'food-coffee-cup', label: '☕ Food: Artisan Coffee Cup' },
            { value: 'food-snack-pouch', label: '🍿 Food: Stand-Up Snack Pouch' },
            { value: 'food-beverage-bottle', label: '🍾 Food: Glass Beverage Bottle' },
            { value: 'food-can-beverage', label: '🥤 Food: 330ml Aluminum Soda Can' },
            { value: 'food-takeout-box', label: '🍔 Food: Bakery / Takeout Box' },
            // Person & Model / Apparel
            { value: 'model-tshirt-chest', label: '👕 Model: Crewneck T-Shirt' },
            { value: 'model-hoodie-streetwear', label: '🧥 Model: Streetwear Hoodie' },
            { value: 'model-tote-bag', label: '👜 Model: Canvas Tote Bag' },
            { value: 'model-cap-hat', label: '🧢 Model: Baseball Cap Hat' },
            // Product & Cosmetics
            { value: 'product-dropper-bottle', label: '🧪 Product: Dropper Serum Bottle' },
            { value: 'product-cosmetic-jar', label: '🧴 Product: Frosted Beauty Jar' },
            { value: 'product-shampoo-pump', label: '🫧 Product: Shampoo Pump Dispenser' },
            { value: 'packaging-box', label: '📦 Product: Isometric Packaging Box' },
            // Devices & Outdoor
            { value: 'iphone-16-pro', label: '📱 Device: iPhone 16 Pro' },
            { value: 'macbook-pro', label: '💻 Device: MacBook Pro 16"' },
            { value: 'framed-canvas', label: '🖼️ Print: Framed Gallery Canvas' },
            { value: 'billboard', label: '🏙️ Outdoor: Street Billboard' },
          ]}
        />
      </span>
      <span className="opt-hint" title="Drag handles to resize (Shift flips the proportion lock, Alt scales from the centre) · drag just outside a corner to rotate (Shift snaps 15°) · Alt-drag copies · double-click edits points or text · drag empty canvas to select several">Alt-drag copies · double-click edits · Shift snaps</span>
    </>
  );
}

/** Opacity of the layer being edited, right in the options bar. */
function LayerOpacity({ layer }: { layer: Layer }) {
  return (
    <NumberField
      label="Layer opacity"
      value={Math.round(layer.opacity * 100)}
      min={0}
      max={100}
      unit="%"
      width={36}
      onChange={(v) => store.updateLayer(layer.id, { opacity: v / 100 }, 'Layer Opacity')}
    />
  );
}

/**
 * Type options. With a text layer selected they edit that layer live (and become the defaults for
 * new text); otherwise they set what the next click creates.
 */
function TextOptions() {
  const s = useStore();
  const o = s.opts;
  const layer = store.activeLayer?.kind === 'text' ? store.activeLayer : null;
  const tp = layer?.text;
  // While editing with characters selected, the bar shows and sets their style (rich text)
  const range = layer ? tools.activeTextRange(layer.id) : null;
  const cs = tp && range ? styleAt(tp, range[0]) : null;
  const v = {
    font: cs?.font ?? tp?.font ?? o.font,
    size: cs?.size ?? tp?.size ?? o.fontSize,
    weight: cs?.weight ?? tp?.weight ?? o.fontWeight,
    align: tp?.align ?? o.textAlign,
    color: cs?.color ?? tp?.color ?? s.fg,
    caps: tp?.caps ?? o.textCaps,
  };
  const style = (st: TextStyle, defaults: Partial<ToolOptions>, label = 'Text Properties') => {
    if (layer) tools.applyTextStyle(layer.id, st, label);
    if (!range && Object.keys(defaults).length) set(defaults);
  };
  const up = (patch: Partial<TextProps>, defaults: Partial<ToolOptions>) => {
    if (layer) tools.updateText(layer.id, patch, 'Text Properties');
    if (Object.keys(defaults).length) set(defaults);
  };
  return (
    <>
      {range && <span className="badge sel-badge">{range[1] - range[0]} characters</span>}
      <FontPicker value={v.font} sample={tp?.text} onChange={(f) => style({ font: f }, { font: f })} title="Font — search, favourites, installed and added fonts" />
      <NumberField label="Size" value={Math.round(v.size)} min={4} max={2000} unit="px" onChange={(n) => style({ size: n }, { fontSize: n })} />
      <Select value={v.weight} onChange={(w) => style({ weight: w }, { fontWeight: w })} options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: WEIGHTS[w] }))} title="Weight" />
      {cs && (
        <>
          <Toggle label="I" checked={cs.italic} onChange={(c) => style({ italic: c }, {})} title="Italic (⌘I)" />
          <Toggle label="U" checked={cs.underline} onChange={(c) => style({ underline: c }, {})} title="Underline (⌘U)" />
        </>
      )}
      {!range && <Select value={v.align} onChange={(a) => up({ align: a }, { textAlign: a })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} title="Alignment" />}
      <ColorInput
        value={v.color}
        title={range ? 'Color of the selected characters' : 'Text color'}
        onChange={(c) => {
          if (layer) tools.applyTextStyle(layer.id, { color: c }, 'Text Color');
          if (!range) store.set({ fg: c });
        }}
      />
      {!range && <Toggle label="All caps" checked={v.caps} onChange={(c) => up({ caps: c }, { textCaps: c })} />}
      {layer && tp && !range && (
        <>
          <Toggle label="Highlight box" checked={!!tp.box} onChange={(b) => up({ box: b }, {})} />
          {tp.box && <ColorInput value={tp.boxColor ?? '#000000'} onChange={(c) => up({ boxColor: c }, {})} title="Box color" />}
          <LayerOpacity layer={layer} />
        </>
      )}
      <span className="opt-hint">
        {range ? 'Styling the selected characters · ⌘B / ⌘I / ⌘U' : layer ? 'Select characters to style them · drag a box for paragraph text' : 'Click for a line of text · drag a box for a paragraph'} · ⌘Enter / Esc to finish
      </span>
    </>
  );
}

/** Shape options: edit the selected shape layer live, or set up the next shape. */
function ShapeOptions() {
  const s = useStore();
  const o = s.opts;
  // A shape tool edits a selected shape of its own kind live; otherwise it sets up the next one
  const target = shapeTarget(s.tool);
  const layer = target?.layer ?? null;
  const sh = layer?.shape;
  const type = target?.type ?? o.shapeType;
  const isPath = type === 'path';
  const openPath = isPath && !sh?.closed;
  const isLine = type === 'line' || type === 'arrow' || openPath;
  const v = {
    fillEnabled: sh?.fillEnabled ?? o.shapeFill,
    fill: sh?.fill ?? s.fg,
    stroke: sh?.stroke ?? (o.shapeFill ? o.shapeStrokeColor : s.fg),
    strokeWidth: sh?.strokeWidth ?? o.shapeStrokeWidth,
    radius: sh?.radius ?? o.shapeRadius,
    sides: sh?.sides ?? o.shapeSides,
    cap: sh?.strokeCap ?? o.strokeCap,
    join: sh?.strokeJoin ?? o.strokeJoin,
    dash: sh?.strokeDash && sh.strokeDash.length > 0 ? (sh.strokeDash[0] > 4 ? 'dashed' : 'dotted') : o.strokeDash,
  };
  const up = (patch: Partial<ShapeProps>, defaults: Partial<ToolOptions>) => {
    if (layer && sh) store.updateLayer(layer.id, { shape: { ...sh, ...patch } }, 'Shape Properties', `shape:${layer.id}`);
    if (Object.keys(defaults).length) set(defaults);
  };
  return (
    <>
      {isPath ? <span className="opt-readout">Pen path</span> : s.tool !== 'shape' ? null : <Select
        value={type as ToolOptions['shapeType']}
        title="Shape"
        onChange={(t) => up({ shape: t }, { shapeType: t })}
        options={[
          { value: 'rectangle', label: 'Rectangle (M)' },
          { value: 'ellipse', label: 'Ellipse (L)' },
          { value: 'triangle', label: 'Triangle' },
          { value: 'polygon', label: 'Polygon' },
          { value: 'star', label: 'Star' },
          { value: 'line', label: 'Line (\\)' },
          { value: 'arrow', label: 'Arrow' },
        ]}
      />}
      {!isLine && (
        <>
          <Toggle label="Fill" checked={v.fillEnabled} onChange={(f) => up({ fillEnabled: f }, { shapeFill: f })} />
          <ColorInput
            value={v.fill}
            title="Fill color"
            onChange={(c) => {
              up({ fill: c }, {});
              store.set({ fg: c });
            }}
          />
        </>
      )}
      <NumberField label="Stroke" value={v.strokeWidth} min={0} max={300} unit="px" onChange={(n) => up({ strokeWidth: n }, { shapeStrokeWidth: n })} />
      <ColorInput
        value={v.stroke}
        title="Stroke color"
        onChange={(c) => {
          up({ stroke: c }, { shapeStrokeColor: c });
          if (isLine || !v.fillEnabled) store.set({ fg: c });
        }}
      />
      <Select
        value={v.cap}
        title="Stroke Cap"
        onChange={(cap) => up({ strokeCap: cap }, { strokeCap: cap })}
        options={[
          { value: 'round', label: 'Round Cap' },
          { value: 'butt', label: 'Butt Cap' },
          { value: 'square', label: 'Square Cap' },
        ]}
      />
      <Select
        value={v.join}
        title="Stroke Corner"
        onChange={(join) => up({ strokeJoin: join }, { strokeJoin: join })}
        options={[
          { value: 'round', label: 'Round Join' },
          { value: 'miter', label: 'Miter Join' },
          { value: 'bevel', label: 'Bevel Join' },
        ]}
      />
      <Select
        value={v.dash}
        title="Stroke Dash Pattern"
        onChange={(dash) => {
          const arr = dash === 'dashed' ? [8, 5] : dash === 'dotted' ? [2, 4] : [];
          up({ strokeDash: arr }, { strokeDash: dash });
        }}
        options={[
          { value: 'solid', label: 'Solid Line' },
          { value: 'dashed', label: 'Dashed (8, 5)' },
          { value: 'dotted', label: 'Dotted (2, 4)' },
        ]}
      />
      {target && <span className="opt-group"><ShapeGeometryControls t={target} bar /></span>}
      {layer && <LayerOpacity layer={layer} />}
      <span className="opt-hint">{layer ? 'Editing the selected shape · ' : ''}{isLine ? 'Shift 45°' : 'Shift equal sides · ⌥ from centre'}</span>
    </>
  );
}

function DirectSelectOptions() {
  const layer = store.activeLayer;
  const isShape = layer?.kind === 'shape';
  return (
    <>
      <span className="opt-title">Direct Selection</span>
      {isShape ? (
        <>
          <span className="opt-hint">Click point to select · Drag point/handle to shape curve · Alt breaks tangent symmetry</span>
          <button className="btn ghost" onClick={() => joinPaths()} title="Join open path ends or close path (⌘J)">Join Path (⌘J)</button>
        </>
      ) : (
        <span className="opt-hint">Click on any anchor point or curve segment of a vector shape</span>
      )}
    </>
  );
}

function CurvatureOptions() {
  const drawing = !!tools.interaction.curvaturePath?.points?.length;
  return (
    <>
      <span className="opt-title">Curvature Tool</span>
      <span className="opt-hint">Click points to draw smooth Bézier curves · Double click for corner</span>
      <div className="opt-spacer" />
      <button className="btn ghost" disabled={!drawing} onClick={() => { tools.interaction.curvaturePath = null; store.requestRender(); }}>Cancel</button>
      <button className="btn primary" disabled={!drawing} onClick={() => commitCurvature(false)}>Create Path</button>
    </>
  );
}

function ArtboardOptions() {
  const doc = store.doc;
  if (!doc) return null;
  const activeAb = getActiveArtboard(doc);
  const presets = ARTBOARD_PRESETS;
  return (
    <>
      <span className="opt-title">Artboard</span>
      <input
        className="opt-input"
        style={{ width: 110 }}
        value={activeAb.name}
        onChange={(e) => editArtboards('Edit Artboard', (d) => updateArtboard(d, activeAb.id, { name: e.target.value }), `ab:${activeAb.id}`)}
        title="Artboard Name"
      />
      <NumberField
        label="W"
        value={activeAb.width}
        min={10}
        max={100000}
        unit="px"
        onChange={(w) => editArtboards('Edit Artboard', (d) => updateArtboard(d, activeAb.id, { width: w }), `ab:${activeAb.id}`)}
      />
      <NumberField
        label="H"
        value={activeAb.height}
        min={10}
        max={100000}
        unit="px"
        onChange={(h) => editArtboards('Edit Artboard', (d) => updateArtboard(d, activeAb.id, { height: h }), `ab:${activeAb.id}`)}
      />
      <Select
        value={activeAb.name}
        title="Preset sizes"
        options={presets.map((p) => ({ value: p.id, label: `${p.name} (${p.width}×${p.height})` }))}
        onChange={(id) => {
          const found = presets.find((p) => p.id === id);
          if (found) {
            editArtboards('Edit Artboard', (d) => updateArtboard(d, activeAb.id, { name: found.name.split(' (')[0], width: found.width, height: found.height }), `ab:${activeAb.id}`);
          }
        }}
      />
      <button className="btn ghost" onClick={() => editArtboards('New Artboard', (d) => addArtboard(d))}>+ New Artboard</button>
      {doc.artboards && doc.artboards.length > 1 && (
        <button className="btn ghost" style={{ color: '#ff5a5a' }} onClick={() => editArtboards('Delete Artboard', (d) => removeArtboard(d, activeAb.id))}>Delete</button>
      )}
    </>
  );
}

const PATHFINDER_EXTRA_HINTS: Record<PathfinderExtraOp, string> = {
  'minus-back': 'Front shape minus everything behind it',
  trim: 'Remove the hidden parts of filled shapes (strokes removed)',
  merge: 'Trim, then join shapes of the same fill colour',
  crop: 'Keep only what is inside the front shape',
  outline: 'Region outlines as strokes in their fill colour',
};

function ShapeBuilderOptions() {
  return (
    <>
      <span className="opt-title">Pathfinder</span>
      <button className="btn ghost" onClick={() => applyPathfinder('unite')} title="Unite overlapping vector shapes">Unite</button>
      <button className="btn ghost" onClick={() => applyPathfinder('minus-front')} title="Subtract front shapes">Minus Front</button>
      <button className="btn ghost" onClick={() => applyPathfinder('intersect')} title="Keep intersecting region">Intersect</button>
      <button className="btn ghost" onClick={() => applyPathfinder('exclude')} title="Exclude overlapping regions">Exclude</button>
      <button className="btn ghost" onClick={() => pathfinderDivide()} title="Cut into every region the outlines form">Divide</button>
      {(Object.keys(PATHFINDER_EXTRA_LABELS) as PathfinderExtraOp[]).map((op) => (
        <button key={op} className="btn ghost" onClick={() => pathfinderExtra(op)} title={PATHFINDER_EXTRA_HINTS[op]}>{PATHFINDER_EXTRA_LABELS[op]}</button>
      ))}
    </>
  );
}

const TRANSFORM_MODES: { id: TransformMode; label: string; hint: string }[] = [
  { id: 'free', label: 'Scale', hint: 'Corners scale (Shift = free) · outside rotates · ⌘ corner distorts · ⌘ edge skews · ⌘⌥⇧ corner = perspective' },
  { id: 'skew', label: 'Skew', hint: 'Drag an edge to slant it along itself' },
  { id: 'distort', label: 'Distort', hint: 'Drag any corner or edge freely' },
  { id: 'perspective', label: 'Perspective', hint: 'Drag a corner: the opposite corner on that edge moves the other way' },
  { id: 'warp', label: 'Warp', hint: 'Drag any of the 16 grid points to bend the layer (mockups, flags, curved labels)' },
];

function updateT(patch: Partial<NonNullable<typeof store.state.transform>>) {
  const t = store.state.transform;
  if (!t) return;
  store.state.transform = { ...t, ...patch };
  ops.updateTransformPreview();
  store.emit();
}

export const WEIGHTS: Record<number, string> = { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };

function MasterSelectOptions() {
  const active = store.activeLayer;
  const isImage = active?.kind === 'raster' && !!active.canvas;
  return (
    <>
      <span className="opt-hint">Click or drag over an image to read text or extract content</span>
      <button
        className="btn ghost"
        disabled={!isImage}
        onClick={async () => {
          if (!active?.canvas) return;
          const blocks = await detectTextFromCanvas(active.canvas);
          if (blocks.length > 0) {
            copyTextToClipboard(blocks[0].text);
          } else {
            store.toast('No distinct text detected in layer', 'info');
          }
        }}
        title="Reads text from the selected image and copies it to clipboard"
      >
        <FileText size={13} /> Copy Text
      </button>
      <button
        className="btn primary"
        disabled={!isImage}
        onClick={async () => {
          if (!active?.canvas || !store.doc) return;
          const blocks = await detectTextFromCanvas(active.canvas);
          if (blocks.length > 0) {
            createLiveTypeLayerFromBlock(blocks[0], store.doc);
          } else {
            store.toast('No text block detected to convert', 'info');
          }
        }}
        title="Converts text in the image into an editable live Type layer"
      >
        <Sparkles size={13} /> Convert to Text Layer
      </button>
    </>
  );
}

function PackagingOptions() {
  const s = useStore();
  const o = s.opts;
  return (
    <>
      <Select
        value={o.packagingBoxType ?? 'reverse-tuck'}
        title="Packaging Structure"
        onChange={(v) => set({ packagingBoxType: v as BoxType })}
        options={Object.entries(BOX_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
      />
      <NumberField label="L" value={o.packagingLength ?? 60} min={10} max={2000} unit="mm" onChange={(v) => set({ packagingLength: v })} />
      <NumberField label="W" value={o.packagingWidth ?? 30} min={10} max={2000} unit="mm" onChange={(v) => set({ packagingWidth: v })} />
      <NumberField label="D" value={o.packagingDepth ?? 120} min={10} max={2000} unit="mm" onChange={(v) => set({ packagingDepth: v })} />
      <Select
        value={o.packagingFoldStyle ?? 'dotted'}
        title="Fold Crease Line"
        onChange={(v) => set({ packagingFoldStyle: v as 'dotted' | 'dashed' | 'crease-perf' | 'solid' })}
        options={[
          { value: 'dotted', label: 'Dotted Crease' },
          { value: 'dashed', label: 'Dashed Crease' },
          { value: 'crease-perf', label: 'Perforated' },
          { value: 'solid', label: 'Solid Crease' },
        ]}
      />
      <button className="btn primary" onClick={() => store.setDockTab('packaging')} title="Opens full Packaging Studio dock panel">
        <Package size={13} /> Studio & Presets
      </button>
    </>
  );
}

/** Trace the selected picture with the shared trace settings (Auto by default). */
function TraceButton() {
  const l = store.activeLayer;
  if (!l || l.kind !== 'raster' || !l.canvas) return null;
  const o = store.state.opts;
  return (
    <button
      className="btn ghost"
      style={{ gap: 4 }}
      onClick={() => void runTrace(l, currentTraceOptions(l), { after: o.traceAfter, output: o.traceOutput })}
      title={o.tracePreset === 'auto' ? `Turn this picture into vector paths — Auto: ${autoTrace(l).why}` : 'Turn this picture into vector paths with the Image Trace settings'}
    >
      <Sparkles size={13} /> Trace Image
    </button>
  );
}

/** Image Trace tool: preset (Auto reads each picture), output, the picture after, exact colours. */
function ImageTraceOptions() {
  const s = useStore();
  const o = s.opts;
  const pic = store.activeLayer?.kind === 'raster' && store.activeLayer.canvas ? store.activeLayer : null;
  const auto = o.tracePreset === 'auto' && pic ? autoTrace(pic) : null;
  const pal = parsePalette(o.tracePalette);
  const pick = (id: string) => {
    if (id === 'auto' || id === 'custom') return set({ tracePreset: id });
    const p = TRACE_PRESETS.find((x) => x.id === id);
    if (p) set({ tracePreset: id, traceOpts: { ...p.opts } });
  };
  return (
    <>
      <Select
        value={o.tracePreset}
        title="Trace settings — Auto looks at each picture and picks"
        onChange={pick}
        options={[{ value: 'auto', label: 'Auto (smart)' }, ...TRACE_PRESETS.map((p) => ({ value: p.id, label: p.label })), ...(o.tracePreset === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])]}
      />
      {auto && <span className="opt-hint" title="What Auto chose for the selected picture">{auto.why}</span>}
      <Select
        value={o.traceOutput}
        title="What the trace becomes"
        onChange={(v) => set({ traceOutput: v })}
        options={[{ value: 'group', label: 'Grouped' }, { value: 'ungroup', label: 'Ungrouped' }, { value: 'shapes', label: 'Every shape separate' }]}
      />
      <Select value={o.traceAfter} title="The picture after tracing it (a traced region always keeps it)" onChange={(v) => set({ traceAfter: v })} options={[{ value: 'hide', label: 'Hide picture' }, { value: 'keep', label: 'Keep picture' }, { value: 'delete', label: 'Delete picture' }]} />
      {pal.length > 0 && (
        <span className="trace-pal" title="Exact trace colours (⌥-click the picture to add more)">
          {pal.map((c) => (
            <button key={c} className="swatch-dot" style={{ background: c }} title={`${c} — click to remove`} onClick={() => set({ tracePalette: pal.filter((x) => x !== c).join(', ') })} />
          ))}
          <button className="btn ghost" onClick={() => set({ tracePalette: '' })} title="Back to colours found in the picture">
            <X size={12} /> Colours
          </button>
        </span>
      )}
      {pic && <TraceButton />}
      <button className="btn ghost" onClick={() => openStudioKit('trace')} title="Every setting, a live preview and clean-up tools">
        <ScanEye size={13} /> Trace Studio
      </button>
      <span className="opt-hint">Click a picture · drag over part of it · ⌥-click picks exact colours</span>
    </>
  );
}

/** Options of the vector reshape / symbol / blend tools, which have no other bar. */
function VectorToolOptions() {
  const s = useStore();
  const t = s.tool;
  const o = s.opts;
  const has = store.selectedLayers.length > 0;
  const sized = tools.isLiquifyTool(t) || t.startsWith('symbol-') || t === 'path-eraser';
  const tips = keyTips(t);
  const own = sized || t === 'blend' || t === 'rotate' || t === 'reflect' || t === 'shear' || t === 'puppet-warp' || t === 'width' || t === 'scissors' || t === 'knife' || t === 'mesh' || t === 'smooth' || t === 'join';
  if (!own) return null;
  return (
    <>
      {sized && <NumberField label="Size" value={o.size} min={2} max={2000} unit="px" onChange={(v) => set({ size: v })} />}
      {t === 'blend' && <NumberField label="Steps" value={o.blendSteps} min={1} max={200} onChange={(v) => set({ blendSteps: v })} />}
      {t === 'rotate' && (
        <span className="opt-group">
          <IconButton icon={<RotateCcw size={14} />} title="Rotate 15° counter-clockwise" disabled={!has} onClick={() => rotateSelectionBy(-15)} />
          <IconButton icon={<RotateCw size={14} />} title="Rotate 15° clockwise" disabled={!has} onClick={() => rotateSelectionBy(15)} />
          <button className="btn ghost" disabled={!has} onClick={() => rotateSelectionBy(90)}>+90°</button>
        </span>
      )}
      {t === 'reflect' && (
        <span className="opt-group">
          <IconButton icon={<FlipHorizontal2 size={14} />} title="Flip horizontal" disabled={!has} onClick={() => ops.flipLayer('h')} />
          <IconButton icon={<FlipVertical2 size={14} />} title="Flip vertical" disabled={!has} onClick={() => ops.flipLayer('v')} />
        </span>
      )}
      {tips.length > 0 && <span className="opt-hint">{tips.slice(0, 3).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>}
    </>
  );
}
