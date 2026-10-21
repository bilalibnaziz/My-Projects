import { useRef, useState } from 'react';
import { RotateCcw, SquareDashed, Info } from 'lucide-react';
import { AutoTuneCard } from './AutoTuneCard';
import type { Adjust, CurvePoint, HslBand, SelRange } from '../core/types';
import { HSL_BANDS, SEL_RANGES, defaultAdjust } from '../core/types';
import { store, useStore } from '../core/store';
import * as ops from '../core/ops';
import { curveLut } from '../core/curves';
import { encodeLut, parseCube, BUILTIN_LUTS, getBuiltinLutData, type LutCategory } from '../core/lut';
import { LOOK_CATEGORIES } from '../core/looks';
import { pickFiles } from '../core/io';
import { ColorInput, Section, Slider, Toggle } from './widgets';

type AdjKey = keyof Adjust;

const BAND_COLORS: Record<HslBand, string> = {
  red: '#ff4b4b', orange: '#ff9b3b', yellow: '#f6dc3e', green: '#3fcf5a', aqua: '#36d4d0', blue: '#3d7bff', purple: '#9b5cff', magenta: '#ff4bd2',
};

export function AdjustPanel() {
  useStore();
  const layer = store.activeLayer;
  const doc = store.doc;
  const isAdj = layer?.kind === 'adjustment' && !!layer.adjust;
  const a = isAdj ? layer!.adjust! : defaultAdjust();

  const change = (patch: Partial<Adjust>, label: string) => {
    const target = ops.ensureAdjustmentTarget();
    if (!target?.adjust) return;
    const cur = store.doc?.layers.find((l) => l.id === target.id)?.adjust ?? target.adjust;
    ops.setAdjust(target.id, { ...cur, ...patch }, label);
  };
  const num = (key: AdjKey, label: string, min: number, max: number, step = 1, extra: Partial<React.ComponentProps<typeof Slider>> = {}) => (
    <Slider
      label={label}
      value={a[key] as number}
      min={min}
      max={max}
      step={step}
      def={defaultAdjust()[key] as number}
      onChange={(v) => change({ [key]: v } as Partial<Adjust>, label)}
      {...extra}
    />
  );

  if (!doc) return <div className="panel-empty">Open an image to start editing</div>;

  return (
    <div className="adjust-panel">
      <div className="adjust-target">
        {isAdj ? (
          <>
            <span className="dot live" />
            <span>
              Editing <b>{layer!.name}</b>
            </span>
            <div className="opt-spacer" />
            <button className="link-btn" title="Reset all values" onClick={() => change(defaultAdjust(), 'Reset Adjustments')}>
              <RotateCcw size={12} /> Reset
            </button>
          </>
        ) : (
          <>
            <Info size={13} />
            <span>Changes go on a new non-destructive adjustment layer</span>
          </>
        )}
      </div>

      <AutoTuneCard />

      <div className="quick-row">
        {isAdj && (
          <button
            className="btn ghost"
            title="Paint on the adjustment's mask to apply it only to some areas"
            onClick={() => {
              doc.editMask = true;
              store.setTool('brush');
              store.set({ fg: '#000000', bg: '#ffffff' });
              store.toast('Paint black to hide the adjustment, white to reveal. Q toggles back.');
            }}
          >
            <SquareDashed size={13} /> Paint mask
          </button>
        )}
      </div>

      <Section title="Presets">
        <div className="preset-grid">
          {ops.ADJUST_PRESETS.map((p) => (
            <button
              key={p.id}
              className="preset"
              onClick={() => {
                if (isAdj) change({ ...defaultAdjust(), ...structuredClone(p.adjust) }, `Preset: ${p.name}`);
                else ops.newAdjustmentLayer(p.adjust, p.name);
              }}
              title={isAdj ? `Apply ${p.name} to this adjustment layer` : `Add ${p.name} as an adjustment layer`}
            >
              <span className="preset-swatch" style={{ background: p.tint }} />
              {p.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Light">
        {num('exposure', 'Exposure', -5, 5, 0.01, { format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV` })}
        {num('contrast', 'Contrast', -100, 100)}
        {num('highlights', 'Highlights', -100, 100)}
        {num('shadows', 'Shadows', -100, 100)}
        {num('whites', 'Whites', -100, 100)}
        {num('blacks', 'Blacks', -100, 100)}
      </Section>

      <Section title="Color">
        {num('temperature', 'Temperature', -100, 100, 1, { gradient: 'linear-gradient(90deg,#3b7bff,#d8d8d8,#ffb02e)' })}
        {num('tint', 'Tint', -100, 100, 1, { gradient: 'linear-gradient(90deg,#33c95a,#d8d8d8,#e84bd8)' })}
        {num('vibrance', 'Vibrance', -100, 100)}
        {num('saturation', 'Saturation', -100, 100)}
        {num('hue', 'Hue Shift', -180, 180, 1, { unit: '°', gradient: 'linear-gradient(90deg,#0ff,#00f,#f0f,#f00,#ff0,#0f0,#0ff)' })}
      </Section>

      <Section title="Presence & Effects">
        {num('clarity', 'Clarity', -100, 100)}
        {num('dehaze', 'Dehaze', -100, 100)}
        {num('sharpen', 'Sharpen', 0, 100)}
        {num('vignette', 'Vignette', -100, 100)}
        {num('grain', 'Grain', 0, 100)}
        {num('fade', 'Fade', 0, 100)}
      </Section>

      <Section title="Curves" defaultOpen={false}>
        <CurvesEditor a={a} onChange={(curves) => change({ curves }, 'Curves')} />
      </Section>

      <Section title="Levels" defaultOpen={false}>
        <Slider label="Input black" value={a.levels.inBlack} min={0} max={254} def={0} onChange={(v) => change({ levels: { ...a.levels, inBlack: Math.min(v, a.levels.inWhite - 1) } }, 'Levels')} />
        <Slider label="Gamma" value={a.levels.gamma} min={0.1} max={3} step={0.01} def={1} onChange={(v) => change({ levels: { ...a.levels, gamma: v } }, 'Levels')} />
        <Slider label="Input white" value={a.levels.inWhite} min={1} max={255} def={255} onChange={(v) => change({ levels: { ...a.levels, inWhite: Math.max(v, a.levels.inBlack + 1) } }, 'Levels')} />
        <Slider label="Output black" value={a.levels.outBlack} min={0} max={255} def={0} onChange={(v) => change({ levels: { ...a.levels, outBlack: v } }, 'Levels')} />
        <Slider label="Output white" value={a.levels.outWhite} min={0} max={255} def={255} onChange={(v) => change({ levels: { ...a.levels, outWhite: v } }, 'Levels')} />
      </Section>

      <Section title="Color Mixer (HSL)" defaultOpen={false}>
        <HslMixer a={a} onChange={(hsl) => change({ hsl }, 'Color Mixer')} />
      </Section>

      <Section title="Color Grading" defaultOpen={false}>
        <Slider label="Shadows hue" value={a.grade.shadowHue} min={0} max={360} def={220} unit="°" gradient="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" onChange={(v) => change({ grade: { ...a.grade, shadowHue: v } }, 'Color Grading')} />
        <Slider label="Shadows amount" value={a.grade.shadowSat} min={0} max={100} def={0} onChange={(v) => change({ grade: { ...a.grade, shadowSat: v } }, 'Color Grading')} />
        <Slider label="Highlights hue" value={a.grade.highlightHue} min={0} max={360} def={40} unit="°" gradient="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" onChange={(v) => change({ grade: { ...a.grade, highlightHue: v } }, 'Color Grading')} />
        <Slider label="Highlights amount" value={a.grade.highlightSat} min={0} max={100} def={0} onChange={(v) => change({ grade: { ...a.grade, highlightSat: v } }, 'Color Grading')} />
        <Slider label="Balance" value={a.grade.balance} min={-100} max={100} def={0} onChange={(v) => change({ grade: { ...a.grade, balance: v } }, 'Color Grading')} />
      </Section>

      <Section title="Creative" defaultOpen={false}>
        <div className="toggle-row">
          <Toggle label="Black & White" checked={a.bw} onChange={(v) => change({ bw: v }, 'Black & White')} />
          <Toggle label="Invert" checked={a.invert} onChange={(v) => change({ invert: v }, 'Invert')} />
        </div>
        {num('threshold', 'Threshold (0 = off)', 0, 255)}
        {num('posterize', 'Posterize (0 = off)', 0, 32)}
      </Section>

      <Section title="Color Balance" defaultOpen={false}>
        <ColorBalanceEditor a={a} onChange={(colorBalance) => change({ colorBalance }, 'Color Balance')} />
      </Section>

      <Section title="Black & White Mixer" defaultOpen={false}>
        <BwMixEditor a={a} onChange={(bwMix) => change({ bwMix }, 'Black & White')} />
      </Section>

      <Section title="Color Lookup (LUT)" defaultOpen={false}>
        <LutEditor a={a} onChange={(lut) => change({ lut }, 'Color Lookup')} />
      </Section>

      <Section title="Gradient Map" defaultOpen={false}>
        <GradientMapEditor a={a} onChange={(gradientMap) => change({ gradientMap }, 'Gradient Map')} />
      </Section>

      <Section title="Photo Filter" defaultOpen={false}>
        <PhotoFilterEditor a={a} onChange={(photoFilter) => change({ photoFilter }, 'Photo Filter')} />
      </Section>

      <Section title="Selective Color" defaultOpen={false}>
        <SelectiveColorEditor a={a} onChange={(selective) => change({ selective }, 'Selective Color')} />
      </Section>

      <Section title="Channel Mixer" defaultOpen={false}>
        <ChannelMixerEditor a={a} onChange={(mixer) => change({ mixer }, 'Channel Mixer')} />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- gradient map, photo filter, selective color, mixer

function ColorBalanceEditor({ a, onChange }: { a: Adjust; onChange: (c: Adjust['colorBalance']) => void }) {
  const [tone, setTone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const cb = a.colorBalance ?? defaultAdjust().colorBalance;
  const v = cb[tone];
  const set = (i: number, n: number) => {
    const next = [...v] as [number, number, number];
    next[i] = n;
    onChange({ ...cb, [tone]: next });
  };
  return (
    <div>
      <div className="seg">
        {(['shadows', 'midtones', 'highlights'] as const).map((t) => (
          <button key={t} className={tone === t ? 'active' : ''} onClick={() => setTone(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <Slider label="Cyan ↔ Red" value={v[0]} min={-100} max={100} def={0} gradient="linear-gradient(90deg,#00c8ff,#d8d8d8,#ff4040)" onChange={(n) => set(0, n)} />
      <Slider label="Magenta ↔ Green" value={v[1]} min={-100} max={100} def={0} gradient="linear-gradient(90deg,#ff40d0,#d8d8d8,#40ff60)" onChange={(n) => set(1, n)} />
      <Slider label="Yellow ↔ Blue" value={v[2]} min={-100} max={100} def={0} gradient="linear-gradient(90deg,#ffe040,#d8d8d8,#4060ff)" onChange={(n) => set(2, n)} />
      <Toggle label="Preserve luminosity" checked={cb.preserve} onChange={(preserve) => onChange({ ...cb, preserve })} />
    </div>
  );
}

const BW_CHANNELS = [
  { k: 'reds', label: 'Reds', color: '#ff4b4b' },
  { k: 'yellows', label: 'Yellows', color: '#f6dc3e' },
  { k: 'greens', label: 'Greens', color: '#3fcf5a' },
  { k: 'cyans', label: 'Cyans', color: '#36d4d0' },
  { k: 'blues', label: 'Blues', color: '#3d7bff' },
  { k: 'magentas', label: 'Magentas', color: '#ff4bd2' },
] as const;

const BW_PRESETS: { name: string; v: [number, number, number, number, number, number] }[] = [
  { name: 'Default', v: [40, 60, 40, 60, 20, 80] },
  { name: 'High Contrast Red', v: [120, 120, -10, -50, -50, 120] },
  { name: 'Blue Filter', v: [0, 0, 30, 110, 110, 70] },
  { name: 'Infrared', v: [-40, 235, 144, -68, -3, -107] },
  { name: 'Darker', v: [20, 40, 20, 40, 0, 60] },
];

function BwMixEditor({ a, onChange }: { a: Adjust; onChange: (b: Adjust['bwMix']) => void }) {
  const bw = a.bwMix ?? defaultAdjust().bwMix;
  const d = defaultAdjust().bwMix;
  return (
    <div className="gm">
      <div className="gm-stops">
        <Toggle label="Convert to black & white" checked={bw.enabled} onChange={(enabled) => onChange({ ...bw, enabled })} />
      </div>
      <div className="gm-presets">
        {BW_PRESETS.map((p) => (
          <button
            key={p.name}
            className="gm-preset"
            onClick={() => onChange({ ...bw, enabled: true, reds: p.v[0], yellows: p.v[1], greens: p.v[2], cyans: p.v[3], blues: p.v[4], magentas: p.v[5] })}
          >
            {p.name}
          </button>
        ))}
      </div>
      {BW_CHANNELS.map((ch) => (
        <Slider
          key={ch.k}
          label={ch.label}
          value={bw[ch.k]}
          min={-200}
          max={300}
          def={d[ch.k]}
          unit="%"
          gradient={`linear-gradient(90deg, #111, ${ch.color})`}
          onChange={(n) => onChange({ ...bw, enabled: true, [ch.k]: n })}
        />
      ))}
      <div className="gm-stops">
        <Toggle label="Tint" checked={bw.tint} onChange={(tint) => onChange({ ...bw, tint, enabled: true })} />
        {bw.tint && <ColorInput value={bw.tintColor} onChange={(tintColor) => onChange({ ...bw, tintColor })} title="Tint color" />}
      </div>
    </div>
  );
}

function LutEditor({ a, onChange }: { a: Adjust; onChange: (l: Adjust['lut']) => void }) {
  const lut = a.lut ?? null;
  const [category, setCategory] = useState<LutCategory | 'All'>('All');

  const filtered = category === 'All' ? BUILTIN_LUTS : BUILTIN_LUTS.filter((p) => p.category === category);

  const applyPreset = (id: string) => {
    const data = getBuiltinLutData(id);
    if (!data) return;
    onChange({ name: data.name, size: data.size, data: data.data, amount: lut?.amount ?? 100 });
    store.toast(`Applied 3D LUT: ${data.name}`, 'info');
  };

  const load = async () => {
    const [file] = await pickFiles('.cube', false);
    if (!file) return;
    try {
      const parsed = parseCube(await file.text());
      onChange({ name: file.name.replace(/\.cube$/i, ''), size: parsed.size, data: encodeLut(parsed), amount: 100 });
      store.toast(`Loaded ${file.name} (${parsed.size}³)`, 'success');
    } catch (err) {
      store.toast(`Could not load LUT: ${(err as Error).message}`, 'error');
    }
  };

  return (
    <div className="gm" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Category selector */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 2 }}>
        {(['All', ...LOOK_CATEGORIES] as const).map((cat) => (
          <button
            key={cat}
            className={`btn-subtle ${category === cat ? 'active' : ''}`}
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: 4,
              background: category === cat ? 'var(--accent, #0078d4)' : 'rgba(255,255,255,0.06)',
              color: category === cat ? '#fff' : 'inherit',
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={() => setCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Preset Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 4,
          maxHeight: 160,
          overflowY: 'auto',
          paddingRight: 2,
        }}
      >
        {filtered.map((p) => {
          const isActive = lut?.name === p.name;
          return (
            <button
              key={p.id}
              className={`preset-chip ${isActive ? 'active' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 6px',
                fontSize: '11px',
                borderRadius: 4,
                border: isActive ? '1px solid #4daafc' : '1px solid rgba(255,255,255,0.08)',
                background: isActive ? 'rgba(0,120,212,0.25)' : 'rgba(255,255,255,0.03)',
                color: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onClick={() => applyPreset(p.id)}
              title={`${p.name} (${p.category}): ${p.description}`}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.tint, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            </button>
          );
        })}
      </div>

      {lut && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px', background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
          <span className="lut-name" title={lut.name} style={{ fontSize: '11px', fontWeight: 600 }}>
            {lut.name} · {lut.size}³
          </span>
          <button className="link-btn" onClick={() => onChange(null)} title="Remove LUT">
            <RotateCcw size={11} />
          </button>
        </div>
      )}

      {lut ? (
        <Slider label="Amount" value={lut.amount} min={0} max={100} def={100} unit="%" onChange={(amount) => onChange({ ...lut, amount })} />
      ) : (
        <div className="hint" style={{ fontSize: '10px', color: '#888' }}>
          Select a categorized preset above or import any 3D .cube LUT file.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
        <button className="btn" style={{ fontSize: '11px', padding: '3px 8px' }} onClick={load}>
          Load custom .cube…
        </button>
      </div>
    </div>
  );
}

const DUOTONES: { name: string; shadow: string; mid: string; highlight: string; useMid: boolean }[] = [
  { name: 'Sunset', shadow: '#1b0f3b', mid: '#e8505b', highlight: '#f9d56e', useMid: true },
  { name: 'Ocean', shadow: '#061a40', mid: '#0f6aa8', highlight: '#7ee8fa', useMid: true },
  { name: 'Neon', shadow: '#0d0221', mid: '#ff2a6d', highlight: '#05d9e8', useMid: true },
  { name: 'Violet', shadow: '#240046', mid: '#7b2cbf', highlight: '#ffd6ff', useMid: true },
  { name: 'Sepia', shadow: '#2b1a0e', mid: '#a87a4c', highlight: '#f6ead3', useMid: true },
  { name: 'Mint', shadow: '#0b3d2e', mid: '#2fbf71', highlight: '#e9fff2', useMid: true },
  { name: 'Mono', shadow: '#000000', mid: '#808080', highlight: '#ffffff', useMid: false },
  { name: 'Fire', shadow: '#150000', mid: '#d62828', highlight: '#fcbf49', useMid: true },
];

const gmCss = (g: { shadow: string; mid: string; highlight: string; useMid: boolean }) =>
  `linear-gradient(90deg, ${g.shadow}, ${g.useMid ? `${g.mid}, ` : ''}${g.highlight})`;

function GradientMapEditor({ a, onChange }: { a: Adjust; onChange: (g: Adjust['gradientMap']) => void }) {
  const g = a.gradientMap ?? defaultAdjust().gradientMap;
  return (
    <div className="gm">
      <div className="gm-presets">
        {DUOTONES.map((d) => (
          <button key={d.name} className="gm-preset" title={d.name} onClick={() => onChange({ ...g, shadow: d.shadow, mid: d.mid, highlight: d.highlight, useMid: d.useMid, amount: g.amount || 100 })}>
            <span style={{ background: gmCss(d) }} />
            {d.name}
          </button>
        ))}
      </div>
      <div className="gm-bar" style={{ background: gmCss(g) }} />
      <div className="gm-stops">
        <ColorInput value={g.shadow} onChange={(shadow) => onChange({ ...g, shadow, amount: g.amount || 100 })} title="Shadows" />
        {g.useMid && <ColorInput value={g.mid} onChange={(mid) => onChange({ ...g, mid, amount: g.amount || 100 })} title="Midtones" />}
        <ColorInput value={g.highlight} onChange={(highlight) => onChange({ ...g, highlight, amount: g.amount || 100 })} title="Highlights" />
        <div className="opt-spacer" />
        <Toggle label="Midtone stop" checked={g.useMid} onChange={(useMid) => onChange({ ...g, useMid })} />
      </div>
      <Slider label="Amount (0 = off)" value={g.amount} min={0} max={100} def={0} unit="%" onChange={(amount) => onChange({ ...g, amount })} />
    </div>
  );
}

const PHOTO_FILTERS = [
  { name: 'Warming (85)', color: '#ec8a00' },
  { name: 'Warming (81)', color: '#ebb113' },
  { name: 'Cooling (80)', color: '#006dff' },
  { name: 'Cooling (82)', color: '#00b5ff' },
  { name: 'Sepia', color: '#ac7a33' },
  { name: 'Deep Blue', color: '#0022cd' },
  { name: 'Emerald', color: '#00af6e' },
  { name: 'Magenta', color: '#ec00ec' },
];

function PhotoFilterEditor({ a, onChange }: { a: Adjust; onChange: (p: Adjust['photoFilter']) => void }) {
  const p = a.photoFilter ?? defaultAdjust().photoFilter;
  return (
    <div className="gm">
      <div className="gm-presets">
        {PHOTO_FILTERS.map((f) => (
          <button key={f.name} className={`gm-preset ${p.color === f.color && p.density > 0 ? 'on' : ''}`} onClick={() => onChange({ ...p, color: f.color, density: p.density || 25 })}>
            <span style={{ background: f.color }} />
            {f.name}
          </button>
        ))}
      </div>
      <div className="gm-stops">
        <ColorInput value={p.color} onChange={(color) => onChange({ ...p, color, density: p.density || 25 })} title="Filter color" />
        <div className="opt-spacer" />
        <Toggle label="Preserve luminosity" checked={p.preserve} onChange={(preserve) => onChange({ ...p, preserve })} />
      </div>
      <Slider label="Density (0 = off)" value={p.density} min={0} max={100} def={0} unit="%" onChange={(density) => onChange({ ...p, density })} />
    </div>
  );
}

const RANGE_SWATCH: Record<SelRange, string> = {
  reds: '#ff3b3b', yellows: '#ffd23b', greens: '#3bd25a', cyans: '#3bd2e0', blues: '#3b6bff', magentas: '#e03bd2', whites: '#ffffff', neutrals: '#8a8a8a', blacks: '#000000',
};

function SelectiveColorEditor({ a, onChange }: { a: Adjust; onChange: (s: Adjust['selective']) => void }) {
  const [range, setRange] = useState<SelRange>('reds');
  const sel = a.selective ?? defaultAdjust().selective;
  const v = sel[range] ?? { c: 0, m: 0, y: 0, k: 0 };
  const set = (k: 'c' | 'm' | 'y' | 'k', n: number) => onChange({ ...sel, [range]: { ...v, [k]: n } });
  return (
    <div>
      <div className="sel-ranges">
        {SEL_RANGES.map((r) => {
          const e = sel[r];
          const edited = !!e && (e.c || e.m || e.y || e.k);
          return (
            <button key={r} className={`sel-range ${range === r ? 'on' : ''} ${edited ? 'edited' : ''}`} onClick={() => setRange(r)} title={r[0].toUpperCase() + r.slice(1)}>
              <span style={{ background: RANGE_SWATCH[r] }} />
            </button>
          );
        })}
        <span className="sel-name">{range[0].toUpperCase() + range.slice(1)}</span>
      </div>
      <Slider label="Cyan" value={v.c} min={-100} max={100} def={0} unit="%" gradient="linear-gradient(90deg,#ff4040,#d8d8d8,#00c8ff)" onChange={(n) => set('c', n)} />
      <Slider label="Magenta" value={v.m} min={-100} max={100} def={0} unit="%" gradient="linear-gradient(90deg,#40ff60,#d8d8d8,#ff40d0)" onChange={(n) => set('m', n)} />
      <Slider label="Yellow" value={v.y} min={-100} max={100} def={0} unit="%" gradient="linear-gradient(90deg,#4060ff,#d8d8d8,#ffe040)" onChange={(n) => set('y', n)} />
      <Slider label="Black" value={v.k} min={-100} max={100} def={0} unit="%" gradient="linear-gradient(90deg,#ffffff,#202020)" onChange={(n) => set('k', n)} />
    </div>
  );
}

function ChannelMixerEditor({ a, onChange }: { a: Adjust; onChange: (m: Adjust['mixer']) => void }) {
  const [out, setOut] = useState<'r' | 'g' | 'b'>('r');
  const mix = a.mixer ?? defaultAdjust().mixer;
  const row = mix[out];
  const def = defaultAdjust().mixer[out];
  const set = (i: number, n: number) => {
    const next = [...row] as [number, number, number];
    next[i] = n;
    onChange({ ...mix, [out]: next });
  };
  const total = row[0] + row[1] + row[2];
  return (
    <div>
      <div className="seg">
        {(mix.mono ? (['r'] as const) : (['r', 'g', 'b'] as const)).map((k) => (
          <button key={k} className={out === k ? 'active' : ''} onClick={() => setOut(k)}>
            {mix.mono ? 'Gray output' : k === 'r' ? 'Red out' : k === 'g' ? 'Green out' : 'Blue out'}
          </button>
        ))}
      </div>
      <Slider label="Red" value={row[0]} min={-200} max={200} def={def[0]} unit="%" onChange={(n) => set(0, n)} />
      <Slider label="Green" value={row[1]} min={-200} max={200} def={def[1]} unit="%" onChange={(n) => set(1, n)} />
      <Slider label="Blue" value={row[2]} min={-200} max={200} def={def[2]} unit="%" onChange={(n) => set(2, n)} />
      <div className="gm-stops">
        <span className={`hint ${total !== 100 ? 'warn' : ''}`}>Total {total}%</span>
        <div className="opt-spacer" />
        <Toggle
          label="Monochrome"
          checked={mix.mono}
          onChange={(mono) => {
            setOut('r');
            // Turning on monochrome from the identity mix starts from a pleasant gray conversion
            onChange({ ...mix, mono, r: mono && mix.r.join() === '100,0,0' ? [40, 40, 20] : mix.r });
          }}
        />
      </div>
    </div>
  );
}

const CH = [
  { k: 'rgb', label: 'RGB', color: '#e8e8ee' },
  { k: 'r', label: 'R', color: '#ff5a5a' },
  { k: 'g', label: 'G', color: '#4fd16b' },
  { k: 'b', label: 'B', color: '#4f8dff' },
] as const;

function CurvesEditor({ a, onChange }: { a: Adjust; onChange: (c: Adjust['curves']) => void }) {
  const [ch, setCh] = useState<'rgb' | 'r' | 'g' | 'b'>('rgb');
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const pts = a.curves[ch];
  const S = 220;
  const toSvg = (p: CurvePoint) => ({ x: (p.x / 255) * S, y: S - (p.y / 255) * S });
  const fromEvent = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(255, Math.round(((e.clientX - r.left) / r.width) * 255))),
      y: Math.max(0, Math.min(255, Math.round((1 - (e.clientY - r.top) / r.height) * 255))),
    };
  };
  const setPts = (next: CurvePoint[]) => onChange({ ...a.curves, [ch]: next });
  const lut = curveLut(pts);
  let path = '';
  for (let i = 0; i < 256; i += 3) path += `${i ? 'L' : 'M'}${(i / 255) * S},${S - (lut[i] / 255) * S}`;
  path += `L${S},${S - (lut[255] / 255) * S}`;
  const color = CH.find((c) => c.k === ch)!.color;

  return (
    <div className="curves">
      <div className="seg">
        {CH.map((c) => (
          <button key={c.k} className={ch === c.k ? 'active' : ''} style={{ color: c.color }} onClick={() => setCh(c.k)}>
            {c.label}
          </button>
        ))}
        <div className="opt-spacer" />
        <button className="link-btn" onClick={() => setPts([{ x: 0, y: 0 }, { x: 255, y: 255 }])} title="Reset this channel">
          <RotateCcw size={11} />
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${S} ${S}`}
        className="curves-svg"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const p = fromEvent(e);
          const hit = pts.findIndex((q) => Math.abs(q.x - p.x) < 10 && Math.abs(q.y - p.y) < 14);
          if (hit >= 0) drag.current = hit;
          else {
            const next = [...pts, p].sort((u, v) => u.x - v.x);
            drag.current = next.indexOf(p);
            setPts(next);
          }
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const p = fromEvent(e);
          const i = drag.current;
          const next = pts.map((q) => ({ ...q }));
          const lo = i > 0 ? next[i - 1].x + 1 : 0;
          const hi = i < next.length - 1 ? next[i + 1].x - 1 : 255;
          next[i] = { x: i === 0 ? Math.min(p.x, hi) : i === next.length - 1 ? Math.max(p.x, lo) : Math.max(lo, Math.min(hi, p.x)), y: p.y };
          setPts(next);
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={(e) => {
          const p = fromEvent(e as unknown as React.PointerEvent);
          const hit = pts.findIndex((q) => Math.abs(q.x - p.x) < 10 && Math.abs(q.y - p.y) < 14);
          if (hit > 0 && hit < pts.length - 1) setPts(pts.filter((_, i) => i !== hit));
        }}
      >
        <rect width={S} height={S} className="curves-bg" />
        {[1, 2, 3].map((i) => (
          <g key={i} className="curves-grid">
            <line x1={(S * i) / 4} y1={0} x2={(S * i) / 4} y2={S} />
            <line x1={0} y1={(S * i) / 4} x2={S} y2={(S * i) / 4} />
          </g>
        ))}
        <line x1={0} y1={S} x2={S} y2={0} className="curves-diag" />
        <path d={path} fill="none" stroke={color} strokeWidth={2} />
        {pts.map((p, i) => {
          const q = toSvg(p);
          return <circle key={i} cx={q.x} cy={q.y} r={4.5} fill="#16161a" stroke={color} strokeWidth={2} />;
        })}
      </svg>
      <div className="hint">Click to add points · drag to shape · double-click a point to remove</div>
    </div>
  );
}

function HslMixer({ a, onChange }: { a: Adjust; onChange: (h: Adjust['hsl']) => void }) {
  const [mode, setMode] = useState<'h' | 's' | 'l'>('s');
  return (
    <div>
      <div className="seg">
        {(['h', 's', 'l'] as const).map((m) => (
          <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
            {m === 'h' ? 'Hue' : m === 's' ? 'Saturation' : 'Luminance'}
          </button>
        ))}
      </div>
      {HSL_BANDS.map((b) => (
        <Slider
          key={b}
          label={b[0].toUpperCase() + b.slice(1)}
          value={a.hsl[b][mode]}
          min={-100}
          max={100}
          def={0}
          gradient={`linear-gradient(90deg, #2a2a32, ${BAND_COLORS[b]})`}
          onChange={(v) => onChange({ ...a.hsl, [b]: { ...a.hsl[b], [mode]: v } })}
        />
      ))}
    </div>
  );
}
