// Tool-aware Properties: whatever tool is active, this shows what it is doing right now, every setting
// it has, the gestures it understands, and one-click next steps that fit the moment.
import type { ReactNode } from 'react';
import {
  AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, ArrowLeftRight,
  SquarePlus, SquareMinus, SquareDashed, Squircle, UserRound, CloudSun, Sparkles, FlipHorizontal2, Scissors, Layers2,
} from 'lucide-react';
import { store, useStore } from '../core/store';
import type { ToolId, ToolOptions } from '../core/store';
import { COMMANDS } from '../core/commands';
import { alignActive } from '../core/align';
import type { AlignEdge } from '../core/align';
import * as ops from '../core/ops';
import * as tools from '../core/tools';
import * as smart from '../core/smartSelect';
import * as tune from '../core/tuneOps';
import { ColorInput, Select, Slider, Toggle } from './widgets';
import { BrushPresetPicker } from './BrushPresetPicker';
import { toolHint, toolIcon, toolKey, toolLabel } from './ToolRail';

export type ToolFamily = 'select' | 'paint' | 'retouch' | 'fill' | 'sample' | 'crop' | 'move' | 'type' | 'shape' | 'pen' | 'view';

const FAMILY: Record<ToolFamily, ToolId[]> = {
  select: ['marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-col', 'lasso', 'poly-lasso', 'wand', 'quick-select', 'object-select'],
  paint: ['brush', 'pencil', 'eraser', 'history-brush', 'color-replace', 'bg-eraser'],
  retouch: ['clone', 'heal', 'heal-brush', 'red-eye', 'smudge', 'blur', 'sharpen', 'dodge', 'burn', 'sponge'],
  fill: ['bucket', 'gradient', 'magic-eraser'],
  sample: ['eyedropper', 'color-sampler', 'ruler'],
  crop: ['crop'],
  move: ['move'],
  type: ['text'],
  shape: ['shape'],
  pen: ['pen'],
  view: ['hand', 'zoom'],
};

export function toolFamily(t: ToolId): ToolFamily {
  return (Object.keys(FAMILY) as ToolFamily[]).find((f) => FAMILY[f].includes(t)) ?? 'view';
}

const set = (p: Partial<ToolOptions>) => store.setOpts(p);
const cmd = (id: string) => () => void COMMANDS.find((c) => c.id === id)?.run();

/** Gestures each tool really handles (kept in sync with tools.ts / proTools.ts). */
export function keyTips(t: ToolId): [string, string][] {
  const sel: [string, string][] = [['⇧', 'add'], ['⌥', 'subtract'], ['⇧⌥', 'intersect']];
  switch (t) {
    case 'marquee-rect':
    case 'marquee-ellipse':
      return [...sel, ['⇧ while dragging', 'square / circle'], ['⌥ while dragging', 'from centre'], ['⌘D', 'deselect']];
    case 'marquee-row':
    case 'marquee-col':
      return sel.slice(0, 2);
    case 'lasso':
      return [...sel, ['⌘D', 'deselect']];
    case 'poly-lasso':
      return [...sel, ['click', 'corner'], ['double-click / ↵', 'close'], ['Esc', 'cancel']];
    case 'wand':
      return [...sel, ['click', 'similar colour']];
    case 'quick-select':
      return [['drag', 'paint the object'], ['⌥ drag', 'paint away'], ['[ ]', 'brush size'], ['⌥⌘R', 'refine edge']];
    case 'object-select':
      return [['drag', 'box an object'], ['click', 'object under cursor'], ...sel, ['⌥⌘R', 'refine edge']];
    case 'brush':
      return [['[ ]', 'size'], ['⇧[ ⇧]', 'hardness'], ['1–0', 'opacity'], ['⌥ click', 'pick colour']];
    case 'eraser':
    case 'history-brush':
    case 'color-replace':
    case 'bg-eraser':
      return [['[ ]', 'size'], ['⇧[ ⇧]', 'hardness'], ['1–0', 'opacity']];
    case 'pencil':
      return [['[ ]', 'size'], ['⌥ click', 'pick colour']];
    case 'clone':
    case 'heal-brush':
      return [['⌥ click', 'set source'], ['drag', 'paint'], ['[ ]', 'size']];
    case 'heal':
      return [['drag', 'paint over it'], ['[ ]', 'size']];
    case 'red-eye':
      return [['click', 'fix an eye'], ['drag', 'box an eye']];
    case 'smudge':
    case 'blur':
    case 'sharpen':
    case 'dodge':
    case 'burn':
    case 'sponge':
      return [['drag', 'paint'], ['[ ]', 'size']];
    case 'bucket':
    case 'magic-eraser':
      return [['click', 'fill similar pixels']];
    case 'gradient':
      return [['drag', 'draw'], ['⇧', 'snap to 45°'], ['on a mask', 'graduated filter']];
    case 'eyedropper':
      return store.state.opts.eyedropperMode === 'wb' ? [['click', 'neutral grey / white']] : [['click', 'foreground'], ['⌥ click', 'background']];
    case 'color-sampler':
      return [['click', 'pin a readout'], ['drag', 'move'], ['⌥ click', 'remove']];
    case 'ruler':
      return [['drag', 'measure']];
    case 'crop':
      return [['drag', 'new box'], ['handles', 'resize'], ['↵', 'crop'], ['Esc', 'cancel']];
    case 'move':
      return [['click', 'pick layer'], ['⇧ click', 'add layer'], ['⌥ drag', 'duplicate'], ['⌘ click', 'pick under cursor'], ['arrows', 'nudge 1 px'], ['⇧ arrows', '10 px']];
    case 'text':
      return [['click', 'new text'], ['click text', 'edit']];
    case 'shape':
      return [['drag', 'draw'], ['⇧', 'constrain'], ['⌥', 'from centre']];
    case 'pen':
      return [['click', 'corner'], ['drag', 'curve'], ['click first', 'close'], ['↵', 'finish'], ['⌫', 'remove point'], ['Esc', 'cancel']];
    case 'hand':
      return [['drag', 'pan'], ['Space', 'pan from any tool']];
    case 'zoom':
      return [['click', 'zoom in'], ['⌥ click', 'zoom out'], ['⌘0', 'fit'], ['⌘1', '100%']];
  }
  return [];
}

/** One line on what the tool is doing right now. */
function toolStatus(t: ToolId): string | null {
  const s = store.state;
  const doc = store.doc;
  const selB = doc?.selection?.bounds;
  const fam = toolFamily(t);
  if (fam === 'select') {
    const mode = { replace: 'New selection', add: 'Adding', subtract: 'Subtracting', intersect: 'Intersecting' }[s.opts.selMode];
    if (selB) return `${mode} · selection bounds ${Math.round(selB.width)} × ${Math.round(selB.height)} px`;
    if (t === 'quick-select') return `${mode} · ${s.opts.quickEdge ? 'snaps to object edges on release' : 'grows to similar colours'}`;
    if (t === 'object-select') return `${mode} · box or click an object`;
    return `${mode} · nothing selected yet`;
  }
  if (t === 'eyedropper' && s.opts.eyedropperMode === 'wb') return 'White balance: click something that should be white or grey';
  if (t === 'crop' && s.crop) return `Crop box ${Math.round(s.crop.rect.width)} × ${Math.round(s.crop.rect.height)} px · ↵ to apply`;
  if (fam === 'paint' || fam === 'retouch') {
    const l = store.activeLayer;
    if (l && l.kind !== 'raster' && !doc?.editMask) return `${l.name} is a ${l.kind} layer — painting needs a pixel layer or a mask`;
    if (doc?.editMask) return 'Painting on the layer mask (black hides, white reveals)';
    if (doc?.selection) return 'Painting only inside the selection';
  }
  return null;
}

const SEL_MODES: { id: ToolOptions['selMode']; label: string; icon: ReactNode }[] = [
  { id: 'replace', label: 'New', icon: <SquareDashed size={13} /> },
  { id: 'add', label: 'Add', icon: <SquarePlus size={13} /> },
  { id: 'subtract', label: 'Subtract', icon: <SquareMinus size={13} /> },
  { id: 'intersect', label: 'Intersect', icon: <Squircle size={13} /> },
];

export function SelModeButtons() {
  const s = useStore();
  return (
    <div className="fx-seg sel-modes" role="radiogroup" aria-label="Selection mode">
      {SEL_MODES.map((m) => (
        <button key={m.id} role="radio" aria-checked={s.opts.selMode === m.id} className={s.opts.selMode === m.id ? 'on' : ''} title={`${m.label} selection`} onClick={() => set({ selMode: m.id })}>
          {m.icon}
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

const CROP_CHIPS: { id: ToolOptions['cropRatio']; label: string; hint: string }[] = [
  { id: 'free', label: 'Free', hint: 'Any shape' },
  { id: 'original', label: 'Original', hint: 'Keep the photo’s shape' },
  { id: '1:1', label: '1:1', hint: 'Square post' },
  { id: '4:5', label: '4:5', hint: 'Portrait feed post' },
  { id: '9:16', label: '9:16', hint: 'Story / Reel / TikTok' },
  { id: '16:9', label: '16:9', hint: 'YouTube / widescreen' },
  { id: '1.91:1', label: '1.91:1', hint: 'Link preview / landscape post' },
  { id: '2:3', label: '2:3', hint: 'Pinterest pin' },
  { id: '3:2', label: '3:2', hint: 'Classic photo' },
  { id: '4:3', label: '4:3', hint: 'Presentation' },
  { id: '3:1', label: '3:1', hint: 'Profile header / banner' },
];

const ALIGN: [AlignEdge, () => ReactNode][] = [
  ['left', () => <AlignHorizontalJustifyStart size={14} />],
  ['hcenter', () => <AlignHorizontalJustifyCenter size={14} />],
  ['right', () => <AlignHorizontalJustifyEnd size={14} />],
  ['top', () => <AlignVerticalJustifyStart size={14} />],
  ['vcenter', () => <AlignVerticalJustifyCenter size={14} />],
  ['bottom', () => <AlignVerticalJustifyEnd size={14} />],
];

function Colors({ both = true }: { both?: boolean }) {
  const s = useStore();
  return (
    <div className="props-row tc-colors">
      <ColorInput value={s.fg} onChange={(v) => store.set({ fg: v })} title="Foreground colour" />
      {both && <ColorInput value={s.bg} onChange={(v) => store.set({ bg: v })} title="Background colour" />}
      {both && (
        <button className="icon-btn" title="Swap colours (X)" aria-label="Swap colours" onClick={() => store.set({ fg: s.bg, bg: s.fg })}>
          <ArrowLeftRight size={13} />
        </button>
      )}
    </div>
  );
}

function BrushBasics({ t }: { t: ToolId }) {
  const o = useStore().opts;
  return (
    <>
      <BrushPresetPicker currentSize={o.size} currentHardness={o.hardness} />
      <Slider label="Size" value={o.size} min={1} max={2000} def={40} unit=" px" onChange={(v) => set({ size: v })} />
      {t !== 'pencil' && <Slider label="Hardness" value={Math.round(o.hardness * 100)} min={0} max={100} def={80} unit="%" onChange={(v) => set({ hardness: v / 100 })} />}
    </>
  );
}

function ToolSettings({ t }: { t: ToolId }) {
  const s = useStore();
  const o = s.opts;
  const fam = toolFamily(t);
  switch (fam) {
    case 'select':
      return (
        <>
          <SelModeButtons />
          {['marquee-rect', 'marquee-ellipse', 'lasso', 'poly-lasso'].includes(t) && (
            <Slider label="Feather" value={o.selFeather} min={0} max={250} def={0} unit=" px" onChange={(v) => set({ selFeather: v })} />
          )}
          {t === 'wand' && (
            <>
              <Slider label="Tolerance" value={o.tolerance} min={0} max={255} def={32} onChange={(v) => set({ tolerance: v })} />
              <Toggle label="Contiguous" checked={o.contiguous} onChange={(v) => set({ contiguous: v })} />
            </>
          )}
          {t === 'quick-select' && (
            <>
              <Slider label="Brush size" value={o.size} min={1} max={2000} def={40} unit=" px" onChange={(v) => set({ size: v })} />
              <Toggle label="Snap to object edges" title="On release, a graph cut fits the selection to the object's real edges" checked={o.quickEdge} onChange={(v) => set({ quickEdge: v })} />
              {!o.quickEdge && <Slider label="Tolerance" value={o.tolerance} min={0} max={255} def={32} onChange={(v) => set({ tolerance: v })} />}
            </>
          )}
          {['wand', 'quick-select', 'object-select'].includes(t) && <Toggle label="Sample all layers" checked={o.sampleAll} onChange={(v) => set({ sampleAll: v })} />}
        </>
      );
    case 'paint':
      return (
        <>
          {t !== 'eraser' && t !== 'bg-eraser' && t !== 'history-brush' && <Colors />}
          <BrushBasics t={t} />
          {t !== 'bg-eraser' && <Slider label="Opacity" value={Math.round(o.opacity * 100)} min={1} max={100} def={100} unit="%" onChange={(v) => set({ opacity: v / 100 })} />}
          {['brush', 'eraser', 'history-brush'].includes(t) && (
            <>
              <Slider label="Flow" value={Math.round(o.flow * 100)} min={1} max={100} def={100} unit="%" onChange={(v) => set({ flow: v / 100 })} />
              <Slider label="Smoothing" value={Math.round(o.smoothing * 100)} min={0} max={100} def={0} unit="%" onChange={(v) => set({ smoothing: v / 100 })} />
            </>
          )}
          {(t === 'bg-eraser' || t === 'color-replace') && (
            <>
              <Slider label="Tolerance" value={o.tolerance} min={0} max={255} def={32} onChange={(v) => set({ tolerance: v })} />
              <Select value={o.bgSampling} title="Sampling" onChange={(v) => set({ bgSampling: v })} options={[{ value: 'continuous', label: 'Sample: Continuous' }, { value: 'once', label: 'Sample: Once' }]} />
            </>
          )}
          {t === 'bg-eraser' && <Toggle label="Protect foreground colour" checked={o.protectFg} onChange={(v) => set({ protectFg: v })} />}
          {t === 'color-replace' && (
            <Select value={o.replaceMode} title="Mode" onChange={(v) => set({ replaceMode: v })} options={[{ value: 'color', label: 'Colour' }, { value: 'hue', label: 'Hue' }, { value: 'saturation', label: 'Saturation' }, { value: 'luminosity', label: 'Luminosity' }]} />
          )}
          <Toggle label="Pen pressure → size" checked={o.pressureSize} onChange={(v) => set({ pressureSize: v })} />
          {(t === 'brush' || t === 'eraser') && <Toggle label="Pen pressure → opacity" checked={o.pressureOpacity} onChange={(v) => set({ pressureOpacity: v })} />}
        </>
      );
    case 'retouch':
      if (t === 'red-eye')
        return (
          <>
            <Slider label="Pupil size" value={Math.round(o.redEyePupil * 100)} min={1} max={100} def={50} unit="%" onChange={(v) => set({ redEyePupil: v / 100 })} />
            <Slider label="Darken" value={Math.round(o.redEyeDarken * 100)} min={0} max={100} def={50} unit="%" onChange={(v) => set({ redEyeDarken: v / 100 })} />
          </>
        );
      return (
        <>
          <BrushBasics t={t} />
          {(t === 'clone' || t === 'heal-brush') && (
            <>
              {t === 'clone' && <Slider label="Opacity" value={Math.round(o.opacity * 100)} min={1} max={100} def={100} unit="%" onChange={(v) => set({ opacity: v / 100 })} />}
              <Toggle label="Aligned" checked={o.cloneAligned} onChange={(v) => set({ cloneAligned: v })} />
              <Toggle label="Sample all layers" checked={o.sampleAll} onChange={(v) => set({ sampleAll: v })} />
            </>
          )}
          {(t === 'dodge' || t === 'burn') && (
            <>
              <Select value={o.dodgeRange} title="Range" onChange={(v) => set({ dodgeRange: v })} options={[{ value: 'shadows', label: 'Shadows' }, { value: 'midtones', label: 'Midtones' }, { value: 'highlights', label: 'Highlights' }]} />
              <Slider label="Exposure" value={Math.round(o.exposure * 100)} min={1} max={100} def={50} unit="%" onChange={(v) => set({ exposure: v / 100 })} />
            </>
          )}
          {t === 'sponge' && <Select value={o.spongeMode} title="Mode" onChange={(v) => set({ spongeMode: v })} options={[{ value: 'desaturate', label: 'Desaturate' }, { value: 'saturate', label: 'Saturate' }]} />}
          {['sponge', 'blur', 'sharpen', 'smudge'].includes(t) && (
            <Slider label="Strength" value={Math.round(o.strength * 100)} min={1} max={100} def={50} unit="%" onChange={(v) => set({ strength: v / 100 })} />
          )}
        </>
      );
    case 'fill':
      return (
        <>
          <Colors both={t === 'gradient'} />
          {t === 'gradient' ? (
            <>
              <Select value={o.gradientType} title="Type" onChange={(v) => set({ gradientType: v })} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }, { value: 'reflected', label: 'Reflected' }]} />
              <Select value={o.gradientMode} title="Colours" onChange={(v) => set({ gradientMode: v })} options={[{ value: 'fg-bg', label: 'Foreground → Background' }, { value: 'fg-transparent', label: 'Foreground → Transparent' }]} />
              <Toggle label="Reverse" checked={o.gradientReverse} onChange={(v) => set({ gradientReverse: v })} />
            </>
          ) : (
            <>
              <Slider label="Tolerance" value={o.tolerance} min={0} max={255} def={32} onChange={(v) => set({ tolerance: v })} />
              <Toggle label="Contiguous" checked={o.contiguous} onChange={(v) => set({ contiguous: v })} />
              <Toggle label="Sample all layers" checked={o.sampleAll} onChange={(v) => set({ sampleAll: v })} />
            </>
          )}
          <Slider label="Opacity" value={Math.round(o.opacity * 100)} min={1} max={100} def={100} unit="%" onChange={(v) => set({ opacity: v / 100 })} />
        </>
      );
    case 'sample':
      if (t === 'ruler') return null;
      return (
        <>
          {t === 'eyedropper' && (
            <div className="fx-seg" role="radiogroup" aria-label="Eyedropper mode">
              {(['color', 'wb'] as const).map((m) => (
                <button key={m} role="radio" aria-checked={o.eyedropperMode === m} className={o.eyedropperMode === m ? 'on' : ''} onClick={() => set({ eyedropperMode: m })}>
                  {m === 'color' ? 'Pick colour' : 'White balance'}
                </button>
              ))}
            </div>
          )}
          <Select
            value={o.samplerSize}
            title="Sample size"
            onChange={(v) => set({ samplerSize: v })}
            options={[{ value: 1, label: 'Point sample' }, { value: 3, label: '3 × 3 average' }, { value: 5, label: '5 × 5 average' }, { value: 11, label: '11 × 11 average' }]}
          />
          {o.eyedropperMode !== 'wb' && <Colors />}
        </>
      );
    case 'crop':
      return (
        <>
          <div className="crop-chips">
            {CROP_CHIPS.map((c) => (
              <button
                key={c.id}
                className={`preset-chip ${o.cropRatio === c.id ? 'on' : ''}`}
                title={c.hint}
                onClick={() => {
                  set({ cropRatio: c.id });
                  if (!store.state.crop) tools.startCrop();
                  tools.applyCropRatio();
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <Toggle label="Delete cropped pixels" checked={o.cropDelete} onChange={(v) => set({ cropDelete: v })} />
        </>
      );
    case 'move':
      return (
        <>
          <Select value={o.autoSelect} title="Click selects" onChange={(v) => set({ autoSelect: v })} options={[{ value: 'layer', label: 'Auto-select: Layer' }, { value: 'group', label: 'Auto-select: Group' }, { value: 'off', label: 'Auto-select: Off (⌘-click)' }]} />
          <Toggle label="Show transform controls" checked={o.transformControls} onChange={(v) => set({ transformControls: v })} />
          <div className="tc-align">
            {ALIGN.map(([edge, icon]) => (
              <button key={edge} className="icon-btn" title={`Align ${edge}`} aria-label={`Align ${edge}`} onClick={() => alignActive(edge)}>
                {icon()}
              </button>
            ))}
          </div>
        </>
      );
    case 'type':
      return (
        <>
          <Colors both={false} />
          <Slider label="Font size" value={o.fontSize} min={4} max={1000} def={72} unit=" px" onChange={(v) => set({ fontSize: v })} />
          <Select value={o.fontWeight} title="Weight" onChange={(v) => set({ fontWeight: v })} options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: `Weight ${w}` }))} />
          <Select value={o.textAlign} title="Align" onChange={(v) => set({ textAlign: v })} options={[{ value: 'left', label: 'Align left' }, { value: 'center', label: 'Align centre' }, { value: 'right', label: 'Align right' }]} />
          <Toggle label="ALL CAPS" checked={o.textCaps} onChange={(v) => set({ textCaps: v })} />
        </>
      );
    case 'shape':
      return (
        <>
          <Select
            value={o.shapeType}
            title="Shape"
            onChange={(v) => set({ shapeType: v })}
            options={[{ value: 'rectangle', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }, { value: 'triangle', label: 'Triangle' }, { value: 'polygon', label: 'Polygon' }, { value: 'star', label: 'Star' }, { value: 'line', label: 'Line' }, { value: 'arrow', label: 'Arrow' }]}
          />
          <Colors both={false} />
          <Toggle label="Fill" checked={o.shapeFill} onChange={(v) => set({ shapeFill: v })} />
          <Slider label="Stroke" value={o.shapeStrokeWidth} min={0} max={100} def={0} unit=" px" onChange={(v) => set({ shapeStrokeWidth: v })} />
          {o.shapeStrokeWidth > 0 && <ColorInput value={o.shapeStrokeColor} onChange={(v) => set({ shapeStrokeColor: v })} title="Stroke colour" />}
          {o.shapeType === 'rectangle' && <Slider label="Corner radius" value={o.shapeRadius} min={0} max={500} def={0} unit=" px" onChange={(v) => set({ shapeRadius: v })} />}
          {(o.shapeType === 'polygon' || o.shapeType === 'star') && <Slider label={o.shapeType === 'star' ? 'Points' : 'Sides'} value={o.shapeSides} min={3} max={40} def={5} onChange={(v) => set({ shapeSides: v })} />}
        </>
      );
    case 'pen':
      return <Select value={o.penMode} title="Pen makes" onChange={(v) => set({ penMode: v })} options={[{ value: 'shape', label: 'Shape layer' }, { value: 'selection', label: 'Selection' }]} />;
    case 'view':
      return (
        <div className="smart-actions">
          <button className="btn ghost compact" onClick={cmd('fit')}>Fit on screen</button>
          <button className="btn ghost compact" onClick={cmd('actual')}>100%</button>
        </div>
      );
  }
}

/** Next steps for the selection tools: make a selection fast, then do something with it. */
function SelectionActions() {
  useStore();
  const doc = store.doc;
  const has = !!doc?.selection;
  return (
    <div className="tc-actions">
      <div className="mini-title">{has ? 'With this selection' : 'Select in one click'}</div>
      <div className="smart-actions">
        <button className="btn ghost compact" onClick={() => void smart.selectSubject()} title="Find the main subject (⌥⌘⇧S)">
          <UserRound size={12} /> Subject
        </button>
        <button className="btn ghost compact" onClick={() => void smart.selectSky()} title="Select the sky">
          <CloudSun size={12} /> Sky
        </button>
        <button className="btn ghost compact" onClick={() => void smart.selectRange('skin')} title="Select skin tones">
          Skin
        </button>
        <button className="btn accent compact" onClick={() => store.set({ dialog: { type: 'selectMask' } })} title="Refine edges, hair and output (⌥⌘R)">
          <Sparkles size={12} /> Select and Mask…
        </button>
      </div>
      <div className="mini-title">Background</div>
      <div className="smart-actions">
        <button className="btn ghost compact" onClick={() => void smart.removeBackground()} title="On-device AI finds the subject; the background is hidden with an editable layer mask">
          <Scissors size={12} /> Remove BG
        </button>
        <button className="btn ghost compact" onClick={() => void smart.cutOutSubject()} title="On-device AI cut-out to a new layer, edge colours cleaned (no halo)">
          <Layers2 size={12} /> Cut out to layer
        </button>
      </div>
      {has && (
        <>
          <div className="smart-actions">
            <button className="btn ghost compact" onClick={() => ops.invertSelection()}>
              <FlipHorizontal2 size={12} /> Invert
            </button>
            <button className="btn ghost compact" onClick={() => ops.modifySelection('expand', 4)}>Expand 4</button>
            <button className="btn ghost compact" onClick={() => ops.modifySelection('contract', 4)}>Contract 4</button>
            <button className="btn ghost compact" onClick={() => ops.modifySelection('feather', 4)}>Feather 4</button>
            <button className="btn ghost compact" onClick={() => ops.modifySelection('smooth', 4)}>Smooth</button>
            <button className="btn ghost compact" onClick={() => ops.deselect()}>Deselect</button>
          </div>
          <div className="smart-actions">
            <button className="btn ghost compact" onClick={cmd('via-copy')} title="Copy the selection to a new layer (⌘J)">→ New Layer</button>
            <button className="btn ghost compact" onClick={() => ops.addMask(true)} title="Hide everything outside the selection with a mask">→ Mask</button>
            <button className="btn ghost compact" onClick={cmd('caf')} title="Remove what's selected and fill from surroundings (⇧⌫)">Remove Object</button>
            <button className="btn ghost compact" onClick={() => tune.applyIntent('auto')} title="Auto Tune only the selected area">Auto Tune Area</button>
            <button className="btn ghost compact" onClick={cmd('crop-sel')}>Crop to It</button>
          </div>
        </>
      )}
    </div>
  );
}

export function ToolCard() {
  const s = useStore();
  const t = s.tool;
  const status = toolStatus(t);
  const tips = keyTips(t);
  const fam = toolFamily(t);
  return (
    <div className="panel-section tool-card" data-testid="tool-card" data-tool={t}>
      <div className="tool-card-head">
        <span className="tool-card-icon">{toolIcon(t)}</span>
        <span className="tool-card-name">{toolLabel(t)}</span>
        {toolKey(t) && <kbd className="kbd">{toolKey(t)}</kbd>}
      </div>
      {status ? <div className="tool-card-status">{status}</div> : <div className="hint">{toolHint(t)}</div>}
      <div className="tool-card-settings">
        <ToolSettings t={t} />
      </div>
      {fam === 'select' && <SelectionActions />}
      {fam === 'crop' && (
        <div className="smart-actions">
          <button className="btn primary compact" onClick={() => tools.commitCrop()} disabled={!s.crop}>Crop</button>
          <button className="btn ghost compact" onClick={() => tools.startCrop()}>Reset</button>
          <button className="btn ghost compact" onClick={() => tools.cancelCrop()}>Cancel</button>
          {store.doc?.selection && <button className="btn ghost compact" onClick={() => ops.cropToSelection()}>Crop to Selection</button>}
        </div>
      )}
      {tips.length > 0 && (
        <div className="key-tips">
          {tips.map(([k, v]) => (
            <span key={k + v} className="key-tip">
              <kbd>{k}</kbd> {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
