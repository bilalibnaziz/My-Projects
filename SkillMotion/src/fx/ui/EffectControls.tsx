import React, { useState } from 'react';
import { 
  Timer, 
  Trash2, 
  Eye, 
  EyeOff, 
  Plus, 
  Sparkles, 
  Sliders, 
  ChevronDown, 
  Layers, 
  Maximize2,
  Type 
} from 'lucide-react';
import { fxStore, EffectsScaleState } from '../store';
import { VFXType, VFXEffect } from '../types';
import { FontPicker } from './FontPicker';

interface EffectControlsProps {
  state: EffectsScaleState;
}

const AVAILABLE_EFFECTS: { type: VFXType; name: string; category: string }[] = [
  { type: 'glow', name: 'Optical Bloom Glow', category: 'Stylize' },
  { type: 'chromatic', name: 'RGB Chromatic Aberration', category: 'Distort' },
  { type: 'glitch', name: 'Cyberpunk VHS Glitch', category: 'Stylize' },
  { type: 'film-grain', name: '35mm Film Grain & Halation', category: 'Film' },
  { type: 'lens-flare', name: 'Anamorphic Lens Flare', category: 'Lighting' },
  { type: 'chroma-key', name: 'Green/Blue Chroma Key', category: 'Keying' },
  { type: 'blur', name: 'Directional Gaussian Blur', category: 'Blur' },
  { type: 'camera-shake', name: 'Handheld Camera Shake', category: 'Motion' },
  { type: 'vignette', name: 'Cinematic Radial Vignette', category: 'Color' },
  { type: 'letterbox', name: '2.39:1 Cinema Scope Letterbox', category: 'Cinema' },
  { type: 'lumetri', name: 'Lumetri 3D Color Engine', category: 'Color' },
];

export const EffectControls: React.FC<EffectControlsProps> = ({ state }) => {
  const [showAddMenu, setShowAddMenu] = useState(false);

  const clip = state.clips.find((c) => c.id === state.selectedClipId);

  if (!clip) {
    return (
      <div className="fx-side-panel right">
        <div className="fx-panel-header">Effect Controls · Inspector</div>
        <div className="fx-panel-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6e7681', textAlign: 'center', height: '100%' }}>
          <Sparkles size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontWeight: 600, fontSize: '13px', color: '#9d9d9d', marginBottom: 4 }}>
            No Clip Selected
          </div>
          <div style={{ fontSize: '11px', maxWidth: '220px' }}>
            Click any clip on the timeline to animate keyframes and apply visual effects.
          </div>
        </div>
      </div>
    );
  }

  const transform = clip.transform;
  const keyframes = clip.keyframes || {};

  // Check if property has keyframe at current local playhead
  const localTime = Math.max(0, state.currentTime - clip.startTime + clip.offset);
  const isKeyframed = (prop: string) => (keyframes[prop] || []).length > 0;

  const renderEasingSelect = (prop: string) => {
    if (!isKeyframed(prop)) return null;
    const currentEasing = keyframes[prop]?.[0]?.easing || 'ease-in-out';
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: '4px', marginTop: '-2px' }}>
        <select
          style={{
            fontSize: '9px',
            background: '#1c1c1c',
            color: '#4daafc',
            border: '1px solid rgba(0, 120, 212, 0.3)',
            borderRadius: '3px',
            padding: '2px 4px',
            cursor: 'pointer',
          }}
          value={currentEasing}
          onChange={(e) => fxStore.setKeyframeEasing(clip.id, prop, e.target.value as any)}
          title="Select Keyframe Animation Easing Curve"
        >
          <option value="ease-in-out">Ease In-Out</option>
          <option value="spring">⚡ Spring (Physics)</option>
          <option value="overshoot">🎯 Overshoot</option>
          <option value="anticipate">🏹 Anticipate</option>
          <option value="snappy">💥 Snappy Punch</option>
          <option value="easy-ease">Easy Ease</option>
          <option value="bounce">Bounce</option>
          <option value="elastic">Elastic</option>
          <option value="linear">Linear</option>
          <option value="hold">Hold</option>
        </select>
      </div>
    );
  };

  return (
    <div className="fx-side-panel right">
      {/* Panel Header */}
      <div className="fx-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sliders size={14} style={{ color: '#4daafc' }} />
          <span>Effect Controls</span>
        </div>
        <span style={{ fontSize: '10px', color: '#4daafc', background: 'rgba(0, 120, 212,0.15)', padding: '2px 6px', borderRadius: 4 }}>
          {clip.type.toUpperCase()}
        </span>
      </div>

      <div className="fx-panel-content">
        {/* Clip Name Bar */}
        <div style={{ padding: '8px 10px', background: '#252526', borderRadius: 6, marginBottom: 12, border: '1px solid var(--fx-border)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#cccccc' }}>{clip.name}</div>
          <div style={{ fontSize: '10px', color: '#6e7681' }}>
            Start: {clip.startTime.toFixed(2)}s · Dur: {clip.duration.toFixed(2)}s · Local: {localTime.toFixed(2)}s
          </div>
        </div>

        {/* Section 0: Typography & Motion Text Inspector */}
        {clip.textData && (
          <div style={{ marginBottom: 16, padding: '10px', background: '#1c1c1f', borderRadius: 8, border: '1px solid #2e2e34' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#60a5fa', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Type size={13} />
              Typography & Text Engine
            </div>

            {/* Text String Input */}
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: '11px', color: '#9d9d9d', display: 'block', marginBottom: 4 }}>Text String</span>
              <textarea
                value={clip.textData.text}
                onChange={(e) => fxStore.updateTextData(clip.id, { text: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  background: '#252528',
                  border: '1px solid #38383e',
                  borderRadius: 6,
                  color: '#fff',
                  fontSize: 12,
                  padding: '6px 8px',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Font Family Picker */}
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: '11px', color: '#9d9d9d', display: 'block', marginBottom: 4 }}>Font Family (1,800+ World Best)</span>
              <FontPicker
                value={clip.textData.fontFamily || 'Inter'}
                onChange={(fam) => fxStore.updateTextData(clip.id, { fontFamily: fam })}
              />
            </div>

            {/* Font Size & Weight */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                <span style={{ fontSize: '10px', color: '#9d9d9d', display: 'block', marginBottom: 2 }}>Font Size</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="range"
                    min={12}
                    max={200}
                    value={clip.textData.fontSize}
                    onChange={(e) => fxStore.updateTextData(clip.id, { fontSize: Number(e.target.value) })}
                    className="fx-slider"
                  />
                  <span className="fx-val-badge">{clip.textData.fontSize}px</span>
                </div>
              </div>

              <div>
                <span style={{ fontSize: '10px', color: '#9d9d9d', display: 'block', marginBottom: 2 }}>Font Weight</span>
                <select
                  value={clip.textData.fontWeight}
                  onChange={(e) => fxStore.updateTextData(clip.id, { fontWeight: e.target.value })}
                  className="fx-chip-btn"
                  style={{ width: '100%', background: '#252528', height: 26, fontSize: 11 }}
                >
                  <option value="300">300 Light</option>
                  <option value="400">400 Regular</option>
                  <option value="500">500 Medium</option>
                  <option value="600">600 SemiBold</option>
                  <option value="700">700 Bold</option>
                  <option value="800">800 ExtraBold</option>
                  <option value="900">900 Black</option>
                </select>
              </div>
            </div>

            {/* Alignment & Animation */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                <span style={{ fontSize: '10px', color: '#9d9d9d', display: 'block', marginBottom: 2 }}>Alignment</span>
                <div style={{ display: 'flex', gap: 3 }}>
                  {(['left', 'center', 'right'] as const).map((al) => (
                    <button
                      key={al}
                      type="button"
                      onClick={() => fxStore.updateTextData(clip.id, { align: al })}
                      style={{
                        flex: 1,
                        padding: '4px 0',
                        background: clip.textData?.align === al ? '#2563eb' : '#252528',
                        color: clip.textData?.align === al ? '#fff' : '#9ca3af',
                        border: '1px solid #38383e',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 10,
                        textTransform: 'capitalize',
                      }}
                    >
                      {al}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span style={{ fontSize: '10px', color: '#9d9d9d', display: 'block', marginBottom: 2 }}>Motion FX</span>
                <select
                  value={clip.textData.animation}
                  onChange={(e) => fxStore.updateTextData(clip.id, { animation: e.target.value as any })}
                  className="fx-chip-btn"
                  style={{ width: '100%', background: '#252528', height: 26, fontSize: 11 }}
                >
                  <option value="none">None</option>
                  <option value="typewriter">Typewriter</option>
                  <option value="pop-in">Pop-In Bounce</option>
                  <option value="slide-up">Slide-Up Kinetic</option>
                  <option value="glow-pulse">Glow Pulse</option>
                </select>
              </div>
            </div>

            {/* Colors: Fill & Stroke */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid #2a2a30' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '11px', color: '#9d9d9d' }}>Color</span>
                <input
                  type="color"
                  value={clip.textData.color}
                  onChange={(e) => fxStore.updateTextData(clip.id, { color: e.target.value })}
                  style={{ border: 'none', background: 'transparent', width: 24, height: 24, cursor: 'pointer', padding: 0 }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '11px', color: '#9d9d9d' }}>Stroke</span>
                <input
                  type="color"
                  value={clip.textData.strokeColor}
                  onChange={(e) => fxStore.updateTextData(clip.id, { strokeColor: e.target.value })}
                  style={{ border: 'none', background: 'transparent', width: 24, height: 24, cursor: 'pointer', padding: 0 }}
                />
                <input
                  type="range"
                  min={0}
                  max={12}
                  value={clip.textData.strokeWidth}
                  onChange={(e) => fxStore.updateTextData(clip.id, { strokeWidth: Number(e.target.value) })}
                  style={{ width: 60 }}
                  className="fx-slider"
                />
                <span className="fx-val-badge">{clip.textData.strokeWidth}px</span>
              </div>
            </div>
          </div>
        )}

        {/* Section 1: Motion / Transform (After Effects Core) */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#9d9d9d', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Maximize2 size={12} />
            Motion & Transform
          </div>

          {/* Position X */}
          <div className="fx-property-row">
            <div className="fx-property-label">
              <button
                className={`fx-stopwatch-btn ${isKeyframed('positionX') ? 'active' : ''}`}
                onClick={() => fxStore.toggleKeyframe(clip.id, 'positionX', transform.positionX)}
                title="Toggle Position X Keyframe Stopwatch"
              >
                <Timer size={13} />
              </button>
              <span>Position X</span>
            </div>
            <div className="fx-slider-input">
              <input
                type="range"
                min={-800}
                max={800}
                value={transform.positionX}
                onChange={(e) => fxStore.updateTransform(clip.id, { positionX: Number(e.target.value) })}
                className="fx-slider"
              />
              <span className="fx-val-badge">{transform.positionX.toFixed(0)}</span>
            </div>
          </div>
          {renderEasingSelect('positionX')}

          {/* Position Y */}
          <div className="fx-property-row">
            <div className="fx-property-label">
              <button
                className={`fx-stopwatch-btn ${isKeyframed('positionY') ? 'active' : ''}`}
                onClick={() => fxStore.toggleKeyframe(clip.id, 'positionY', transform.positionY)}
                title="Toggle Position Y Keyframe Stopwatch"
              >
                <Timer size={13} />
              </button>
              <span>Position Y</span>
            </div>
            <div className="fx-slider-input">
              <input
                type="range"
                min={-600}
                max={600}
                value={transform.positionY}
                onChange={(e) => fxStore.updateTransform(clip.id, { positionY: Number(e.target.value) })}
                className="fx-slider"
              />
              <span className="fx-val-badge">{transform.positionY.toFixed(0)}</span>
            </div>
          </div>
          {renderEasingSelect('positionY')}

          {/* Scale */}
          <div className="fx-property-row">
            <div className="fx-property-label">
              <button
                className={`fx-stopwatch-btn ${isKeyframed('scaleX') ? 'active' : ''}`}
                onClick={() => fxStore.toggleKeyframe(clip.id, 'scaleX', transform.scaleX)}
                title="Toggle Scale Keyframe Stopwatch"
              >
                <Timer size={13} />
              </button>
              <span>Scale</span>
            </div>
            <div className="fx-slider-input">
              <input
                type="range"
                min={10}
                max={300}
                value={transform.scaleX}
                onChange={(e) => fxStore.updateTransform(clip.id, { scaleX: Number(e.target.value), scaleY: Number(e.target.value) })}
                className="fx-slider"
              />
              <span className="fx-val-badge">{transform.scaleX.toFixed(0)}%</span>
            </div>
          </div>
          {renderEasingSelect('scaleX')}

          {/* Rotation */}
          <div className="fx-property-row">
            <div className="fx-property-label">
              <button
                className={`fx-stopwatch-btn ${isKeyframed('rotation') ? 'active' : ''}`}
                onClick={() => fxStore.toggleKeyframe(clip.id, 'rotation', transform.rotation)}
                title="Toggle Rotation Keyframe Stopwatch"
              >
                <Timer size={13} />
              </button>
              <span>Rotation</span>
            </div>
            <div className="fx-slider-input">
              <input
                type="range"
                min={-180}
                max={180}
                value={transform.rotation}
                onChange={(e) => fxStore.updateTransform(clip.id, { rotation: Number(e.target.value) })}
                className="fx-slider"
              />
              <span className="fx-val-badge">{transform.rotation.toFixed(0)}°</span>
            </div>
          </div>
          {renderEasingSelect('rotation')}

          {/* Opacity */}
          <div className="fx-property-row">
            <div className="fx-property-label">
              <button
                className={`fx-stopwatch-btn ${isKeyframed('opacity') ? 'active' : ''}`}
                onClick={() => fxStore.toggleKeyframe(clip.id, 'opacity', transform.opacity)}
                title="Toggle Opacity Keyframe Stopwatch"
              >
                <Timer size={13} />
              </button>
              <span>Opacity</span>
            </div>
            <div className="fx-slider-input">
              <input
                type="range"
                min={0}
                max={100}
                value={transform.opacity}
                onChange={(e) => fxStore.updateTransform(clip.id, { opacity: Number(e.target.value) })}
                className="fx-slider"
              />
              <span className="fx-val-badge">{transform.opacity.toFixed(0)}%</span>
            </div>
          </div>
          {renderEasingSelect('opacity')}

          {/* Blend Mode */}
          <div className="fx-property-row">
            <span style={{ color: '#9d9d9d', fontSize: '12px' }}>Blend Mode</span>
            <select
              value={clip.blendMode || 'source-over'}
              onChange={(e) => {
                const updated = state.clips.map((c) =>
                  c.id === clip.id ? { ...c, blendMode: e.target.value as any } : c
                );
                (fxStore as any).state = { ...state, clips: updated };
                (fxStore as any).notify();
              }}
              className="fx-chip-btn"
              style={{ background: '#252526', width: '130px' }}
            >
              <option value="source-over">Normal</option>
              <option value="screen">Screen (Lighten)</option>
              <option value="multiply">Multiply (Darken)</option>
              <option value="overlay">Overlay</option>
              <option value="color-dodge">Color Dodge</option>
              <option value="soft-light">Soft Light</option>
              <option value="difference">Difference</option>
            </select>
          </div>
        </div>

        {/* Section 2: Visual Effects Stack */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#9d9d9d', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={12} />
              VFX Effects Stack ({clip.vfxStack?.length || 0})
            </div>

            {/* Add Effect Button */}
            <div style={{ position: 'relative' }}>
              <button
                className="fx-chip-btn"
                onClick={() => setShowAddMenu(!showAddMenu)}
                style={{ color: '#4daafc', borderColor: 'rgba(0, 120, 212,0.4)' }}
              >
                <Plus size={12} /> Add Effect
              </button>

              {showAddMenu && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '100%',
                    marginTop: 4,
                    width: '220px',
                    background: '#1f1f1f',
                    border: '1px solid var(--fx-border-bright)',
                    borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.8)',
                    zIndex: 60,
                    padding: 4,
                  }}
                >
                  {AVAILABLE_EFFECTS.map((fx) => (
                    <button
                      key={fx.type}
                      className="fx-chip-btn"
                      style={{
                        width: '100%',
                        justifyContent: 'space-between',
                        border: 'none',
                        background: 'transparent',
                        padding: '6px 10px',
                      }}
                      onClick={() => {
                        fxStore.addVFX(clip.id, fx.type);
                        setShowAddMenu(false);
                      }}
                    >
                      <span>{fx.name}</span>
                      <span style={{ fontSize: '9px', color: '#6e7681' }}>{fx.category}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Render Active Effects */}
          {(clip.vfxStack || []).map((fx) => (
            <div key={fx.id} className="fx-effect-card">
              <div className="fx-effect-card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    className={`fx-track-icon-btn ${fx.enabled ? 'active' : ''}`}
                    onClick={() => fxStore.toggleVFX(clip.id, fx.id)}
                  >
                    {fx.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <span style={{ color: fx.enabled ? '#ffffff' : '#6e7681' }}>{fx.name}</span>
                </div>
                <button
                  className="fx-track-icon-btn"
                  onClick={() => fxStore.removeVFX(clip.id, fx.id)}
                  title="Remove Effect"
                >
                  <Trash2 size={13} style={{ color: '#f85149' }} />
                </button>
              </div>

              {/* Render Effect Parameters */}
              <div style={{ opacity: fx.enabled ? 1 : 0.4, pointerEvents: fx.enabled ? 'auto' : 'none' }}>
                {Object.entries(fx.params).map(([key, val]) => (
                  <div key={key} className="fx-property-row" style={{ padding: '3px 0' }}>
                    <span style={{ fontSize: '11px', color: '#9d9d9d', textTransform: 'capitalize' }}>
                      {key}
                    </span>
                    {typeof val === 'number' ? (
                      <div className="fx-slider-input">
                        <input
                          type="range"
                          min={key === 'exposure' ? -2 : 0}
                          max={key === 'exposure' ? 2 : key === 'contrast' ? 100 : key === 'saturation' ? 200 : 100}
                          step={key === 'exposure' || key === 'amount' ? 0.05 : 1}
                          value={val}
                          onChange={(e) =>
                            fxStore.updateVFXParam(clip.id, fx.id, key, Number(e.target.value))
                          }
                          className="fx-slider"
                        />
                        <span className="fx-val-badge">
                          {typeof val === 'number' ? val.toFixed(1) : val}
                        </span>
                      </div>
                    ) : typeof val === 'string' && val.startsWith('#') ? (
                      <input
                        type="color"
                        value={val}
                        onChange={(e) => fxStore.updateVFXParam(clip.id, fx.id, key, e.target.value)}
                        style={{ border: 'none', background: 'transparent', width: '28px', height: '24px', cursor: 'pointer' }}
                      />
                    ) : (
                      <span style={{ fontSize: '11px', color: '#4daafc' }}>{String(val)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
