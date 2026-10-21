import type { ReactNode } from 'react';
import { ShapeGeometryControls, shapeTarget } from './ShapeControls';
import {
  Check, X, RotateCw, RotateCcw, Link2, Link2Off, Crosshair, FlipHorizontal2, FlipVertical2,
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter, AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
  Sparkles, Wand2, SlidersHorizontal,
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
import * as smart from '../core/smartSelect';
import { SelModeButtons } from './ToolContext';
import type { ToolId } from '../core/store';

const SELECT_TOOLS: ToolId[] = ['marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-col', 'lasso', 'poly-lasso', 'wand', 'quick-select', 'object-select'];

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

      {(t === 'brush' || t === 'pencil' || t === 'bucket' || t === 'gradient' || t === 'color-replace') && <ColorInput value={s.fg} onChange={(v) => store.set({ fg: v })} title="Foreground color" />}
      {t === 'gradient' && o.gradientMode === 'fg-bg' && <ColorInput value={s.bg} onChange={(v) => store.set({ bg: v })} title="Background color (gradient end)" />}

      {brushy && (
        <>
          <BrushPresetPicker currentSize={o.size} currentHardness={o.hardness} />
          <NumberField label="Size" value={o.size} min={1} max={2000} unit="px" onChange={(v) => set({ size: v })} />
          {t !== 'pencil' && <NumberField label="Hardness" value={Math.round(o.hardness * 100)} min={0} max={100} unit="%" onChange={(v) => set({ hardness: v / 100 })} />}
        </>
      )}
      {(['brush', 'pencil', 'eraser', 'clone', 'bucket', 'gradient', 'color-replace', 'history-brush', 'magic-eraser', 'heal-brush'] as const).includes(t as never) && (
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

      {SELECT_TOOLS.includes(t) && <SelModeButtons />}
      {(t === 'marquee-rect' || t === 'marquee-ellipse' || t === 'lasso' || t === 'poly-lasso') && (
        <NumberField label="Feather" value={o.selFeather} min={0} max={250} unit="px" onChange={(v) => set({ selFeather: v })} />
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
          <Toggle label="Snap to edges" checked={o.quickEdge} onChange={(v) => set({ quickEdge: v })} />
          {!o.quickEdge && <NumberField label="Tolerance" value={o.tolerance} min={0} max={255} onChange={(v) => set({ tolerance: v })} />}
        </>
      )}
      {(t === 'quick-select' || t === 'object-select') && <Toggle label="Sample all layers" checked={o.sampleAll} onChange={(v) => set({ sampleAll: v })} />}
      {SELECT_TOOLS.includes(t) && (
        <>
          <button className="btn ghost" onClick={() => void smart.selectSubject()} title="Select the main subject (⌥⌘⇧S)">
            <Sparkles size={13} /> Select Subject
          </button>
          <button className="btn ghost" onClick={() => store.set({ dialog: { type: 'selectMask' } })} title="Refine the edge, hair and output (⌥⌘R)">
            Select and Mask…
          </button>
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
      {t === 'eyedropper' && (
        <Select value={o.eyedropperMode} title="Eyedropper mode" onChange={(v) => set({ eyedropperMode: v })} options={[{ value: 'color', label: 'Pick colour' }, { value: 'wb', label: 'White balance' }]} />
      )}
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
              { value: '1.91:1', label: '1.91 : 1 (Link post)' },
              { value: '2:3', label: '2 : 3 (Pinterest)' },
              { value: '4:3', label: '4 : 3' },
              { value: '3:1', label: '3 : 1 (Header)' },
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

      {t === 'text' && <TextOptions />}

      {t === 'shape' && <ShapeOptions />}

      {t === 'eyedropper' && <span className="opt-hint">{o.eyedropperMode === 'wb' ? 'Click something that should be white or grey' : 'Click to set foreground · ⌥-click sets background'}</span>}
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
      </span>
      <span className="opt-group">
        <button
          className="btn ghost"
          style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
          onClick={() => ops.removeBackgroundActiveLayer()}
          title="Cut the subject out to a new layer: on-device AI finds it, edges are snapped and colour-cleaned at full resolution"
        >
          <Sparkles size={12} color="#0078d4" /> Remove BG
        </button>
        <button
          className="btn ghost"
          style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
          onClick={() => ops.selectSubjectActiveLayer()}
          title="Select the main subject (on-device AI, ⌥⌘⇧S)"
        >
          <Wand2 size={12} color="#0078d4" /> Select Subject
        </button>
        <button
          className="btn ghost"
          style={{ padding: '3px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
          onClick={() => ops.harmonizeActiveLayerWithBackground()}
          title="Color Match: Harmonizes lighting, contrast and ambient color tone with the background plate"
        >
          <SlidersHorizontal size={12} color="#0078d4" /> Harmonize Tone
        </button>
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
  const layer = store.activeLayer?.kind === 'shape' ? store.activeLayer : null;
  const sh = layer?.shape;
  const type = sh?.shape ?? o.shapeType;
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
  };
  // Live geometry (corners, points, pie, hole…): the selected shape, or the next one
  const geo = shapeTarget('shape');
  const up = (patch: Partial<ShapeProps>, defaults: Partial<ToolOptions>) => {
    if (layer && sh) store.updateLayer(layer.id, { shape: { ...sh, ...patch } }, 'Shape Properties', `shape:${layer.id}`);
    if (Object.keys(defaults).length) set(defaults);
  };
  return (
    <>
      {isPath ? <span className="opt-readout">Pen path</span> : <Select
        value={type as ToolOptions['shapeType']}
        title="Shape"
        onChange={(t) => up({ shape: t }, { shapeType: t })}
        options={[
          { value: 'rectangle', label: 'Rectangle' },
          { value: 'ellipse', label: 'Ellipse' },
          { value: 'triangle', label: 'Triangle' },
          { value: 'polygon', label: 'Polygon' },
          { value: 'star', label: 'Star' },
          { value: 'line', label: 'Line' },
          { value: 'arrow', label: 'Arrow' },
          { value: 'spiral', label: 'Spiral' },
        ]}
      />}
      {!isLine && (
        <>
          <Toggle label="Fill" checked={v.fillEnabled} onChange={(f) => up({ fillEnabled: f }, { shapeFill: f })} />
          <ColorInput
            value={v.fill}
            title="Fill color (the foreground color)"
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
      {geo ? <ShapeGeometryControls t={geo} bar /> : null}
      {layer && <LayerOpacity layer={layer} />}
      <span className="opt-hint">{layer ? 'Editing the selected shape · ' : ''}Shift constrains · ⌥ draws from center</span>
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
