import React, { useRef, useState } from 'react';
import { Palette, Sun, Eye, Sliders, Activity, RotateCcw, Sparkles, Wand2, Download } from 'lucide-react';
import { fxStore, EffectsScaleState } from '../store';

interface ColorPanelProps {
  state: EffectsScaleState;
}

interface InteractiveWheelProps {
  label: string;
  color: string;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
  onReset: () => void;
}

function InteractiveGradeWheel({ label, color, x, y, onChange, onReset }: InteractiveWheelProps) {
  const wheelRef = useRef<HTMLDivElement>(null);

  const handlePointer = (e: React.PointerEvent) => {
    if (!wheelRef.current) return;
    const rect = wheelRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const px = e.clientX - rect.left - cx;
    const py = e.clientY - rect.top - cy;
    const maxR = cx - 6;
    const dist = Math.hypot(px, py);
    const clampedDist = Math.min(maxR, dist);
    const angle = Math.atan2(py, px);

    const nx = (Math.cos(angle) * clampedDist) / maxR;
    const ny = (Math.sin(angle) * clampedDist) / maxR;
    onChange(Number(nx.toFixed(2)), Number(ny.toFixed(2)));
  };

  const handleDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handlePointer(e);
  };

  const handleMove = (e: React.PointerEvent) => {
    if (e.buttons) handlePointer(e);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#202024', padding: '8px 4px', borderRadius: 8, border: '1px solid #2e2e38' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '0 6px', marginBottom: 4 }}>
        <span style={{ fontSize: '9px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>{label}</span>
        <button
          onClick={onReset}
          title="Reset wheel"
          style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0 }}
        >
          <RotateCcw size={10} />
        </button>
      </div>
      <div
        ref={wheelRef}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onDoubleClick={onReset}
        title="Drag to tint. Double-click to reset."
        style={{
          width: '68px',
          height: '68px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, #27272a 0%, #18181b 65%, #09090b 100%)',
          border: `1.5px solid ${color}44`,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'crosshair',
          touchAction: 'none',
          boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.6)',
        }}
      >
        {/* Crosshair guidelines */}
        <div style={{ position: 'absolute', width: '100%', height: 1, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', height: '100%', width: 1, background: 'rgba(255,255,255,0.08)' }} />
        {/* Knob */}
        <div
          style={{
            position: 'absolute',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: color,
            border: '2px solid #ffffff',
            boxShadow: '0 0 6px rgba(0,0,0,0.8)',
            transform: `translate(${x * 26}px, ${y * 26}px)`,
            pointerEvents: 'none',
          }}
        />
      </div>
      <span style={{ fontSize: '8px', color: '#6b7280', marginTop: 4 }}>
        {x === 0 && y === 0 ? 'Center' : `${x > 0 ? '+' : ''}${x}, ${y > 0 ? '+' : ''}${y}`}
      </span>
    </div>
  );
}

export const ColorPanel: React.FC<ColorPanelProps> = ({ state }) => {
  const clip = state.clips.find((c) => c.id === state.selectedClipId) || state.clips[0];

  const lumetriFx = clip?.vfxStack?.find((f) => f.type === 'lumetri');

  // Default values
  const exposure = Number(lumetriFx?.params?.exposure ?? 0);
  const contrast = Number(lumetriFx?.params?.contrast ?? 20);
  const saturation = Number(lumetriFx?.params?.saturation ?? 110);
  const temperature = Number(lumetriFx?.params?.temperature ?? 10);
  const tint = Number(lumetriFx?.params?.tint ?? 0);
  const currentLut = String(lumetriFx?.params?.lutPreset ?? 'teal-orange');

  // 3-way wheels coordinates
  const liftX = Number(lumetriFx?.params?.liftX ?? 0.15);
  const liftY = Number(lumetriFx?.params?.liftY ?? 0.15);
  const gammaX = Number(lumetriFx?.params?.gammaX ?? -0.08);
  const gammaY = Number(lumetriFx?.params?.gammaY ?? -0.12);
  const gainX = Number(lumetriFx?.params?.gainX ?? -0.16);
  const gainY = Number(lumetriFx?.params?.gainY ?? 0.08);

  const updateParam = (key: string, val: any) => {
    if (!clip) return;
    if (!lumetriFx) {
      fxStore.addVFX(clip.id, 'lumetri');
    }
    const targetFx = clip.vfxStack.find((f) => f.type === 'lumetri');
    if (targetFx) {
      fxStore.updateVFXParam(clip.id, targetFx.id, key, val);
    }
  };

  const [lutCategory, setLutCategory] = useState<'All' | 'Food' | 'Person' | 'Product' | 'Cinematic'>('All');

  const handleSmartAutoGrade = () => {
    updateParam('exposure', 0.2);
    updateParam('contrast', 15);
    updateParam('saturation', 108);
    updateParam('temperature', 6);
    updateParam('tint', 0);
    updateParam('liftX', -0.04);
    updateParam('liftY', 0.02);
    updateParam('gainX', 0.04);
    updateParam('gainY', -0.02);
  };

  const exportCubeLut = () => {
    const size = 17;
    const lines = [`TITLE "Skill Motion - ${clip?.name ?? 'Grade'}"`, `LUT_3D_SIZE ${size}`];
    const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const expMult = Math.pow(2, exposure);
    const satFactor = saturation / 100;

    for (let b = 0; b < size; b++) {
      const b0 = b / (size - 1);
      for (let g = 0; g < size; g++) {
        const g0 = g / (size - 1);
        for (let r = 0; r < size; r++) {
          const r0 = r / (size - 1);
          let cr = r0 * 255 * expMult;
          let cg = g0 * 255 * expMult;
          let cb = b0 * 255 * expMult;

          cr += temperature * 0.35;
          cb -= temperature * 0.35;
          cg -= tint * 0.25;
          cr += tint * 0.15;
          cb += tint * 0.15;

          cr = contrastFactor * (cr - 128) + 128;
          cg = contrastFactor * (cg - 128) + 128;
          cb = contrastFactor * (cb - 128) + 128;

          const gray = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
          cr = gray + satFactor * (cr - gray);
          cg = gray + satFactor * (cg - gray);
          cb = gray + satFactor * (cb - gray);

          const nr = Math.max(0, Math.min(1, cr / 255));
          const ng = Math.max(0, Math.min(1, cg / 255));
          const nb = Math.max(0, Math.min(1, cb / 255));
          lines.push(`${nr.toFixed(6)} ${ng.toFixed(6)} ${nb.toFixed(6)}`);
        }
      }
    }

    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(clip?.name || 'Custom_Grade').replace(/\s+/g, '_')}.cube`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fx-side-panel right" style={{ width: '400px' }}>
      <div className="fx-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Palette size={14} style={{ color: '#4daafc' }} />
          <span>Lumetri & Affinity Color Grading</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={exportCubeLut}
            className="fx-chip-btn"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              borderColor: 'var(--fx-border)',
              color: '#cccccc',
              fontSize: '10px',
              padding: '2px 6px',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
            title="Export 3D LUT (.cube): Export active grade to load into cameras, DaVinci Resolve, or Premiere"
          >
            <Download size={10} /> .cube
          </button>
          <button
            onClick={handleSmartAutoGrade}
            className="fx-chip-btn"
            style={{
              background: 'rgba(0, 120, 212, 0.2)',
              borderColor: '#4daafc',
              color: '#4daafc',
              fontSize: '10px',
              padding: '2px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
            title="Smart Auto-Grade: Automatically balance exposure, dynamic contrast and 3-way color wheels"
          >
            <Wand2 size={11} /> Auto Grade
          </button>
        </div>
      </div>

      <div className="fx-panel-content">
        {/* Scopes Preview Bar */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#9d9d9d', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Activity size={12} />
            Waveform & RGB Parade Scope
          </div>
          <div
            style={{
              height: '80px',
              background: '#181818',
              border: '1px solid var(--fx-border)',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              padding: '6px 12px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {Array.from({ length: 32 }).map((_, i) => {
              const hR = 20 + Math.sin(i * 0.4 + exposure * 3 + liftX * 10) * 20 + 25;
              const hG = 15 + Math.sin(i * 0.35 + (contrast / 100) + gammaY * 10) * 25 + 20;
              const hB = 25 + Math.cos(i * 0.45 + (temperature / 50) + gainX * 10) * 22 + 25;
              return (
                <div key={i} style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: '100%' }}>
                  <div style={{ width: 2, height: `${hR}%`, background: 'rgba(239, 68, 68, 0.7)' }} />
                  <div style={{ width: 2, height: `${hG}%`, background: 'rgba(34, 197, 94, 0.7)' }} />
                  <div style={{ width: 2, height: `${hB}%`, background: 'rgba(0, 120, 212, 0.7)' }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Interactive 3-Way Color Wheels: Lift, Gamma, Gain */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#9d9d9d' }}>
              3-Way Interactive Grading Wheels
            </div>
            <span style={{ fontSize: '9px', color: '#6b7280' }}>Double-click to reset</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <InteractiveGradeWheel
              label="LIFT (Shadows)"
              color="#38bdf8"
              x={liftX}
              y={liftY}
              onChange={(x, y) => {
                updateParam('liftX', x);
                updateParam('liftY', y);
              }}
              onReset={() => {
                updateParam('liftX', 0);
                updateParam('liftY', 0);
              }}
            />
            <InteractiveGradeWheel
              label="GAMMA (Mids)"
              color="#c084fc"
              x={gammaX}
              y={gammaY}
              onChange={(x, y) => {
                updateParam('gammaX', x);
                updateParam('gammaY', y);
              }}
              onReset={() => {
                updateParam('gammaX', 0);
                updateParam('gammaY', 0);
              }}
            />
            <InteractiveGradeWheel
              label="GAIN (Highs)"
              color="#fbbf24"
              x={gainX}
              y={gainY}
              onChange={(x, y) => {
                updateParam('gainX', x);
                updateParam('gainY', y);
              }}
              onReset={() => {
                updateParam('gainX', 0);
                updateParam('gainY', 0);
              }}
            />
          </div>
        </div>

        {/* Basic Color Sliders */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#9d9d9d', marginBottom: 8 }}>
            Tone & Color Balance
          </div>

          <div className="fx-property-row">
            <span style={{ fontSize: '12px', color: '#9d9d9d' }}>Temperature</span>
            <div className="fx-slider-input">
              <input
                type="range"
                min={-50}
                max={50}
                value={temperature}
                onChange={(e) => updateParam('temperature', Number(e.target.value))}
                className="fx-slider"
              />
              <span className="fx-val-badge">{temperature}°</span>
            </div>
          </div>

          <div className="fx-property-row">
            <span style={{ fontSize: '12px', color: '#9d9d9d' }}>Tint</span>
            <div className="fx-slider-input">
              <input
                type="range"
                min={-50}
                max={50}
                value={tint}
                onChange={(e) => updateParam('tint', Number(e.target.value))}
                className="fx-slider"
              />
              <span className="fx-val-badge">{tint}</span>
            </div>
          </div>

          <div className="fx-property-row">
            <span style={{ fontSize: '12px', color: '#9d9d9d' }}>Exposure (EV)</span>
            <div className="fx-slider-input">
              <input
                type="range"
                min={-2}
                max={2}
                step={0.1}
                value={exposure}
                onChange={(e) => updateParam('exposure', Number(e.target.value))}
                className="fx-slider"
              />
              <span className="fx-val-badge">{exposure.toFixed(1)}</span>
            </div>
          </div>

          <div className="fx-property-row">
            <span style={{ fontSize: '12px', color: '#9d9d9d' }}>Contrast</span>
            <div className="fx-slider-input">
              <input
                type="range"
                min={-50}
                max={50}
                value={contrast}
                onChange={(e) => updateParam('contrast', Number(e.target.value))}
                className="fx-slider"
              />
              <span className="fx-val-badge">{contrast}</span>
            </div>
          </div>

          <div className="fx-property-row">
            <span style={{ fontSize: '12px', color: '#9d9d9d' }}>Saturation</span>
            <div className="fx-slider-input">
              <input
                type="range"
                min={0}
                max={200}
                value={saturation}
                onChange={(e) => updateParam('saturation', Number(e.target.value))}
                className="fx-slider"
              />
              <span className="fx-val-badge">{saturation}%</span>
            </div>
          </div>
        </div>

        {/* 3D Cinematic & Commercial LUT Presets */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#9d9d9d', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Sparkles size={12} color="#fbbf24" />
              Categorized 3D LUT Color Presets
            </div>
            <span style={{ fontSize: '9px', color: '#6e7681' }}>HDR Rec.709</span>
          </div>

          {/* Category Tabs */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {(['All', 'Food', 'Person', 'Product', 'Cinematic'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setLutCategory(cat)}
                style={{
                  fontSize: '10px',
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: 'none',
                  background: lutCategory === cat ? 'var(--fx-cyan, #0078d4)' : 'rgba(255,255,255,0.06)',
                  color: lutCategory === cat ? '#fff' : '#9ca3af',
                  cursor: 'pointer',
                  fontWeight: lutCategory === cat ? 600 : 400,
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', maxHeight: '180px', overflowY: 'auto', paddingRight: 2 }}>
            {[
              // Food & Culinary
              { id: 'food-warm-gourmet', category: 'Food', label: 'Warm Gourmet', desc: 'Appetizing warm pastry & dining glow' },
              { id: 'food-fresh-greens', category: 'Food', label: 'Fresh Greens', desc: 'Vibrant organic crisp produce' },
              { id: 'food-rich-coffee', category: 'Food', label: 'Rich Roast Cafe', desc: 'Deep espresso & bakery contrast' },
              { id: 'food-citrus-punch', category: 'Food', label: 'Citrus Pop', desc: 'Juicy saturated oranges & drinks' },
              // Person & Model / Portrait
              { id: 'portrait-natural-skin', category: 'Person', label: 'Natural Skin Glow', desc: 'Authentic healthy skin graduation' },
              { id: 'portrait-model-editorial', category: 'Person', label: 'Runway Editorial', desc: 'High-fashion model contrast' },
              { id: 'portrait-warm-amber', category: 'Person', label: 'Golden Hour Skin', desc: 'Sun-kissed bronze radiance' },
              { id: 'portrait-melanin-rich', category: 'Person', label: 'Melanin Rich', desc: 'Lustrous bronze highlights' },
              { id: 'portrait-porcelain-glow', category: 'Person', label: 'Porcelain Beauty', desc: 'Soft-key luminous skin tones' },
              // Product & Commercial
              { id: 'product-clean-studio', category: 'Product', label: 'Clean Studio 5500K', desc: 'Pristine neutral white e-commerce' },
              { id: 'product-luxury-dark', category: 'Product', label: 'Obsidian & Gold', desc: 'Champagne highlights for jewelry' },
              { id: 'product-tech-minimalist', category: 'Product', label: 'Tech Anodized', desc: 'Cool aluminum slate hardware' },
              { id: 'product-vibrant-ecommerce', category: 'Product', label: 'E-Commerce Pop', desc: 'High saturation online feed punch' },
              // Cinematic & Creative
              { id: 'teal-orange', category: 'Cinematic', label: 'Teal & Orange', desc: 'Blockbuster complementary cinema' },
              { id: 'kodak-portra', category: 'Cinematic', label: 'Kodak Portra 400', desc: 'Analog 35mm warm pastel grain' },
              { id: 'fuji-400h', category: 'Cinematic', label: 'Fuji Pro 400H', desc: 'Cyan-tinted airy flora highlights' },
              { id: 'bleach-bypass', category: 'Cinematic', label: 'Bleach Bypass', desc: 'Gritty silver retention action' },
              { id: 'cyberpunk', category: 'Cinematic', label: 'Cyberpunk Neon', desc: 'Blade Runner electric magenta' },
              { id: 'vintage-35mm', category: 'Cinematic', label: 'Vintage 70s Stock', desc: 'Warm analogous nostalgic film' },
              { id: 'noir', category: 'Cinematic', label: 'Film Noir Silver', desc: 'High contrast panchromatic B&W' },
              { id: 'golden-hour', category: 'Cinematic', label: 'Sunset Radiance', desc: 'Warm triadic golden magic hour' },
              { id: 'none', category: 'Cinematic', label: 'Rec.709 Neutral', desc: 'Standard natural balanced master' },
            ]
              .filter((lut) => lutCategory === 'All' || lut.category === lutCategory)
              .map((lut) => (
                <button
                  key={lut.id}
                  className="fx-chip-btn"
                  style={{
                    padding: '6px 8px',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    background: currentLut === lut.id ? 'rgba(0, 120, 212,0.25)' : '#252526',
                    borderColor: currentLut === lut.id ? '#4daafc' : 'var(--fx-border)',
                  }}
                  onClick={() => updateParam('lutPreset', lut.id)}
                  title={`${lut.label} (${lut.category}): ${lut.desc}`}
                >
                  <div style={{ fontWeight: 600, color: '#cccccc', fontSize: '10px' }}>{lut.label}</div>
                  <div style={{ fontSize: '8px', color: '#6e7681', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{lut.desc}</div>
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};
