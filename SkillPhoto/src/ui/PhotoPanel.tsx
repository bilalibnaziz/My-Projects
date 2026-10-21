// Photo tab: the photo-editing workflow in the order you use it — fix the light and colour, pick a look
// made for this photo, select and cut out, retouch, sharpen, crop for where it is going.
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Bandage, Brush, Contrast, Crop, Droplets, Eraser, Focus, Mountain, ScanFace, Scissors, Sparkles, Stamp, Sun, Moon, Wand2 } from 'lucide-react';
import { store, useStore } from '../core/store';
import type { ToolId, ToolOptions } from '../core/store';
import { COMMANDS, panelHooks } from '../core/commands';
import { pickLooks, photoProfile } from '../core/lookStudio';
import { applyBuiltinLook, currentLookLayer, isLookLayer } from '../core/lookOps';
import { useDeferredSource } from './useDeferredSource';
import { ctx2d } from '../core/canvas';
import { startCrop, applyCropRatio } from '../core/tools';
import { AutoTuneCard } from './AutoTuneCard';
import { Section } from './widgets';

const ensureRaster = (): boolean => {
  if (store.activeLayer?.kind === 'raster' && !store.activeLayer.locked) return true;
  const r = store.doc?.layers.find((l) => l.kind === 'raster' && !l.locked);
  if (r) {
    store.selectLayer(r.id);
    return true;
  }
  const created = store.newRasterLayer();
  return !!created;
};

const run = (id: string) => {
  const c = COMMANDS.find((x) => x.id === id);
  if (!c) return;
  if (c.enabled && !c.enabled()) {
    if (ensureRaster() && (!c.enabled || c.enabled())) {
      c.run();
      return;
    }
    store.toast(id === 'caf' ? 'Select the object first (Lasso or Object Selection), then Remove Object' : `${c.label.replace(/…$/, '')}: select a pixel layer first`);
    return;
  }
  c.run();
};

function Btn({ icon, label, title, onClick, active }: { icon: ReactNode; label: string; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button className={`photo-btn ${active ? 'active' : ''}`} title={title} onClick={onClick}>
      <span className="photo-btn-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

const CROPS: { id: ToolOptions['cropRatio']; label: string }[] = [
  { id: '4:5', label: '4:5 Post' }, { id: '1:1', label: '1:1' }, { id: '9:16', label: '9:16 Story' }, { id: '16:9', label: '16:9' }, { id: '3:2', label: '3:2' }, { id: 'free', label: 'Free' },
];

export function PhotoPanel() {
  const s = useStore();
  const doc = store.doc;
  const key = doc ? `${doc.id}:${doc.layers.filter((l) => !isLookLayer(l)).map((l) => `${l.id}.${l.v}.${l.visible ? 1 : 0}`).join(',')}` : '';
  const src = useDeferredSource(key, 96);
  const picks = useMemo(() => (src ? pickLooks(photoProfile(ctx2d(src).getImageData(0, 0, src.width, src.height).data, 1), 6) : []), [src]);
  if (!doc) return <div className="photo-panel"><div className="hint">Open a photo (⌘O or drop it here) to start editing.</div></div>;
  const tool = (t: ToolId) => () => {
    if (['heal', 'clone', 'dodge', 'burn', 'red-eye'].includes(t)) {
      ensureRaster();
    }
    store.setTool(t);
  };
  const lookName = currentLookLayer()?.adjust?.lut?.name;

  return (
    <div className="photo-panel">
      <Section title="1 · Light & colour">
        <AutoTuneCard />
        <div className="photo-grid">
          <Btn icon={<Sparkles size={14} />} label="Auto Enhance" title="Fixes light, contrast and colour in one step (stays editable)" onClick={() => run('auto-enhance')} />
          <Btn icon={<Droplets size={14} />} label="White Balance" title="Removes colour casts" onClick={() => run('auto-wb')} />
          <Btn icon={<Contrast size={14} />} label="Contrast" title="Auto Contrast" onClick={() => run('auto-contrast')} />
        </div>
      </Section>

      <Section title="2 · Looks for this photo" right={<button className="link-btn" onClick={() => panelHooks.open('looks')}>All looks →</button>}>
        <div className="photo-looks">
          {picks.map((p) => (
            <button key={p.look.id} className={`photo-look ${lookName === p.look.name ? 'active' : ''}`} title={`${p.look.description} — fits this photo: ${p.why}`} onClick={() => applyBuiltinLook(p.look.id)}>
              <span className="photo-look-swatch" style={{ background: p.look.tint }} />
              <span className="photo-look-name">{p.look.name}</span>
              <span className="photo-look-cat">{p.look.category}</span>
            </button>
          ))}
        </div>
        <div className="hint">Picked from your photo's colours. Open Looks to change the strength, edit or save your own.</div>
      </Section>

      <Section title="3 · Select & cut out">
        <div className="photo-grid">
          <Btn icon={<ScanFace size={14} />} label="Subject" title="Select the main subject" onClick={() => run('select-subject')} />
          <Btn icon={<Mountain size={14} />} label="Sky" title="Select the sky" onClick={() => run('select-sky')} />
          <Btn icon={<Scissors size={14} />} label="Remove BG" title="Hide the background with a layer mask (stays editable)" onClick={() => run('remove-bg')} />
          <Btn icon={<Wand2 size={14} />} label="Object" title="Object Selection tool: drag a box around anything" active={s.tool === 'object-select'} onClick={tool('object-select')} />
          <Btn icon={<Brush size={14} />} label="Refine Edge" title="Select and Mask: hair, fur and soft edges" onClick={() => run('select-mask')} />
        </div>
      </Section>

      <Section title="4 · Retouch">
        <div className="photo-grid">
          <Btn icon={<Bandage size={14} />} label="Spot Heal" title="Paint over blemishes and small objects" active={s.tool === 'heal'} onClick={tool('heal')} />
          <Btn icon={<Eraser size={14} />} label="Remove Object" title="Select an object first, then fill it from its surroundings" onClick={() => run('caf')} />
          <Btn icon={<Stamp size={14} />} label="Clone" title="⌥-click a source, then paint" active={s.tool === 'clone'} onClick={tool('clone')} />
          <Btn icon={<ScanFace size={14} />} label="Smooth Skin" title="Frequency Separation: even skin while keeping its texture" onClick={() => run('frequency-separation')} />
          <Btn icon={<Sparkles size={14} />} label="Liquify" title="Push, pucker and bloat (⇧⌘X)" onClick={() => run('filter-liquify')} />
          <Btn icon={<Sun size={14} />} label="Dodge" title="Brighten areas" active={s.tool === 'dodge'} onClick={tool('dodge')} />
          <Btn icon={<Moon size={14} />} label="Burn" title="Darken areas" active={s.tool === 'burn'} onClick={tool('burn')} />
          <Btn icon={<ScanFace size={14} />} label="Red Eye" title="Click an eye" active={s.tool === 'red-eye'} onClick={tool('red-eye')} />
        </div>
      </Section>

      <Section title="5 · Detail">
        <div className="photo-grid">
          <Btn icon={<Focus size={14} />} label="Sharpen" title="Unsharp Mask" onClick={() => run('filter-unsharp')} />
          <Btn icon={<Droplets size={14} />} label="Reduce Noise" title="Clean up grain from high ISO or low light" onClick={() => run('filter-reduce-noise')} />
          <Btn icon={<Contrast size={14} />} label="High Pass" title="Crisp detail for products and textures" onClick={() => run('filter-high-pass')} />
        </div>
      </Section>

      <Section title="6 · Crop for where it's going">
        <div className="photo-crops">
          {CROPS.map((c) => (
            <button
              key={c.id}
              className={`looks-chip ${s.crop && s.opts.cropRatio === c.id ? 'active' : ''}`}
              onClick={() => {
                store.setOpts({ cropRatio: c.id });
                store.setTool('crop');
                if (!store.state.crop) startCrop();
                applyCropRatio();
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="photo-grid">
          <Btn icon={<Crop size={14} />} label="Straighten" title="Ruler: drag along something that should be level, then Straighten Layer" active={s.tool === 'ruler'} onClick={tool('ruler')} />
        </div>
      </Section>
    </div>
  );
}
