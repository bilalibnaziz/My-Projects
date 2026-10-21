import React, { useRef, useState, useEffect } from 'react';
import { Pipette, TriangleAlert, X, Disc3, Sliders, Palette, Check, Copy } from 'lucide-react';
import { store } from '../core/store';
import type { RGB } from '../core/color';
import {
  cmykToRgb,
  contrastGrade,
  contrastRatio,
  hexToRgb,
  hsbToRgb,
  labToRgb,
  outOfGamut,
  proofRgb,
  rgbToCmyk,
  rgbToHex,
  rgbToHsb,
  rgbToLab,
  harmony,
  type HarmonyKind,
  HARMONIES,
} from '../core/color';
import {
  getColorHistory,
  pushColorHistory,
  CURATED_COLOR_THEMES,
} from '../core/colorHarmonies';

type Field = { label: string; value: number; min: number; max: number; unit?: string; set: (v: number) => void };

function Num({ f }: { f: Field }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="cp-field">
      <span>{f.label}</span>
      <input
        value={text ?? String(Math.round(f.value))}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseFloat(text ?? '');
          if (Number.isFinite(v)) f.set(Math.max(f.min, Math.min(f.max, v)));
          setText(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            f.set(Math.max(f.min, Math.min(f.max, Math.round(f.value) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1))));
            setText(null);
          }
        }}
      />
      {f.unit && <i>{f.unit}</i>}
    </label>
  );
}

/** Affinity Designer & Photoshop hybrid Color Picker: Interactive Wheel, Harmonies, Themes, HSB, Lab, CMYK */
export function ColorPickerDialog({ target }: { target: 'fg' | 'bg' }) {
  const initial = target === 'fg' ? store.state.fg : store.state.bg;
  const other = target === 'fg' ? store.state.bg : store.state.fg;
  // Keep HSB as master
  const [hsb, setHsb] = useState<[number, number, number]>(() => rgbToHsb(hexToRgb(initial)));
  const rgb = hsbToRgb(...hsb);
  const hex = rgbToHex(rgb);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const [hexText, setHexText] = useState<string | null>(null);

  // View modes: 'wheel' (Affinity), 'classic' (PS), 'themes' (Canva)
  const [pickerTab, setPickerTab] = useState<'wheel' | 'classic' | 'themes'>('wheel');
  const [harmonyKind, setHarmonyKind] = useState<HarmonyKind>('complementary');
  const [history, setHistory] = useState<string[]>(getColorHistory);

  // Wheel canvas references
  const wheelCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingHueWheel = useRef(false);
  const isDraggingSVWheel = useRef(false);

  const W_SIZE = 256;
  const W_CENTER = W_SIZE / 2;
  const W_OUTER = 120;
  const W_INNER = 94;
  const W_BOX = 52;

  const setRgb = (c: RGB) => {
    const next = rgbToHsb(c);
    setHsb([next[1] === 0 ? hsb[0] : next[0], next[1], next[2]]);
  };

  const ok = () => {
    store.set(target === 'fg' ? { fg: hex, dialog: null } : { bg: hex, dialog: null });
    store.pushRecentColor(hex);
    pushColorHistory(hex);
  };
  const cancel = () => store.set({ dialog: null });

  const lab = rgbToLab(rgb);
  const cmyk = rgbToCmyk(rgb);
  const ratio = contrastRatio(hex, other);
  const grade = contrastGrade(ratio);
  const gamut = outOfGamut(rgb);
  const eyeDropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;

  // Classic drag
  const dragSV = (e: React.PointerEvent) => {
    const r = svRef.current!.getBoundingClientRect();
    setHsb([hsb[0], Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)), Math.max(0, Math.min(100, (1 - (e.clientY - r.top) / r.height) * 100))]);
  };
  const dragHue = (e: React.PointerEvent) => {
    const r = hueRef.current!.getBoundingClientRect();
    setHsb([Math.max(0, Math.min(359.9, (1 - (e.clientY - r.top) / r.height) * 360)), hsb[1], hsb[2]]);
  };

  // Affinity Wheel render effect
  useEffect(() => {
    if (pickerTab !== 'wheel') return;
    const canvas = wheelCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, W_SIZE, W_SIZE);

    // 1. Draw 360° hue ring
    const step = 0.5;
    for (let deg = 0; deg < 360; deg += step) {
      const radStart = ((deg - 0.5) * Math.PI) / 180;
      const radEnd = ((deg + step + 0.5) * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(W_CENTER, W_CENTER, W_OUTER, radStart, radEnd);
      ctx.arc(W_CENTER, W_CENTER, W_INNER, radEnd, radStart, true);
      ctx.closePath();
      ctx.fillStyle = `hsl(${deg}, 100%, 50%)`;
      ctx.fill();
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(W_CENTER, W_CENTER, W_OUTER, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W_CENTER, W_CENTER, W_INNER, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Draw inner Saturation/Value box
    const bx = W_CENTER - W_BOX;
    const by = W_CENTER - W_BOX;
    const bSize = W_BOX * 2;

    const pureHueHex = rgbToHex(hsbToRgb(hsb[0], 100, 100));
    const hGrad = ctx.createLinearGradient(bx, by, bx + bSize, by);
    hGrad.addColorStop(0, '#ffffff');
    hGrad.addColorStop(1, pureHueHex);
    ctx.fillStyle = hGrad;
    ctx.fillRect(bx, by, bSize, bSize);

    const vGrad = ctx.createLinearGradient(bx, by, bx, by + bSize);
    vGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vGrad.addColorStop(1, '#000000');
    ctx.fillStyle = vGrad;
    ctx.fillRect(bx, by, bSize, bSize);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.strokeRect(bx, by, bSize, bSize);

    // 3. Draw Hue Handle on ring
    const hueRad = (hsb[0] * Math.PI) / 180;
    const midR = (W_OUTER + W_INNER) / 2;
    const hx = W_CENTER + Math.cos(hueRad) * midR;
    const hy = W_CENTER + Math.sin(hueRad) * midR;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(hx, hy, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#121212';
    ctx.stroke();
    ctx.restore();

    // 4. Harmony indicator pins on ring
    const harmonyColors = harmony(hex, harmonyKind);
    if (harmonyColors.length > 1) {
      harmonyColors.slice(1).forEach((cHex) => {
        const [hh] = rgbToHsb(hexToRgb(cHex));
        const rad = (hh * Math.PI) / 180;
        const px = W_CENTER + Math.cos(rad) * midR;
        const py = W_CENTER + Math.sin(rad) * midR;

        ctx.beginPath();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.moveTo(W_CENTER, W_CENTER);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = cHex;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      });
    }

    // 5. Draw SV Handle inside box
    const svX = bx + (hsb[1] / 100) * bSize;
    const svY = by + (1 - hsb[2] / 100) * bSize;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(svX, svY, 6, 0, Math.PI * 2);
    ctx.fillStyle = hex;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }, [pickerTab, hsb, hex, harmonyKind]);

  // Wheel interaction
  const onWheelPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - W_CENTER;
    const dy = y - W_CENTER;
    const dist = Math.hypot(dx, dy);

    if (dist >= W_INNER - 8 && dist <= W_OUTER + 8) {
      isDraggingHueWheel.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const h = (angle + 360) % 360;
      setHsb([h, hsb[1], hsb[2]]);
    } else if (Math.abs(dx) <= W_BOX && Math.abs(dy) <= W_BOX) {
      isDraggingSVWheel.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      const s = Math.max(0, Math.min(100, ((dx + W_BOX) / (W_BOX * 2)) * 100));
      const b = Math.max(0, Math.min(100, (1 - (dy + W_BOX) / (W_BOX * 2)) * 100));
      setHsb([hsb[0], s, b]);
    }
  };

  const onWheelPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingHueWheel.current && !isDraggingSVWheel.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - W_CENTER;
    const dy = y - W_CENTER;

    if (isDraggingHueWheel.current) {
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const h = (angle + 360) % 360;
      setHsb([h, hsb[1], hsb[2]]);
    } else if (isDraggingSVWheel.current) {
      const s = Math.max(0, Math.min(100, ((dx + W_BOX) / (W_BOX * 2)) * 100));
      const b = Math.max(0, Math.min(100, (1 - (dy + W_BOX) / (W_BOX * 2)) * 100));
      setHsb([hsb[0], s, b]);
    }
  };

  const onWheelPointerUp = () => {
    isDraggingHueWheel.current = false;
    isDraggingSVWheel.current = false;
  };

  const harmonySwatches = harmony(hex, harmonyKind);

  const groups: Field[][] = [
    [
      { label: 'H', value: hsb[0], min: 0, max: 359, unit: '°', set: (v) => setHsb([v, hsb[1], hsb[2]]) },
      { label: 'S', value: hsb[1], min: 0, max: 100, unit: '%', set: (v) => setHsb([hsb[0], v, hsb[2]]) },
      { label: 'B', value: hsb[2], min: 0, max: 100, unit: '%', set: (v) => setHsb([hsb[0], hsb[1], v]) },
    ],
    [
      { label: 'R', value: rgb[0], min: 0, max: 255, set: (v) => setRgb([v, rgb[1], rgb[2]]) },
      { label: 'G', value: rgb[1], min: 0, max: 255, set: (v) => setRgb([rgb[0], v, rgb[2]]) },
      { label: 'B', value: rgb[2], min: 0, max: 255, set: (v) => setRgb([rgb[0], rgb[1], v]) },
    ],
    [
      { label: 'L', value: lab[0], min: 0, max: 100, set: (v) => setRgb(labToRgb([v, lab[1], lab[2]])) },
      { label: 'a', value: lab[1], min: -128, max: 127, set: (v) => setRgb(labToRgb([lab[0], v, lab[2]])) },
      { label: 'b', value: lab[2], min: -128, max: 127, set: (v) => setRgb(labToRgb([lab[0], lab[1], v])) },
    ],
    [
      { label: 'C', value: cmyk[0], min: 0, max: 100, unit: '%', set: (v) => setRgb(cmykToRgb(v, cmyk[1], cmyk[2], cmyk[3])) },
      { label: 'M', value: cmyk[1], min: 0, max: 100, unit: '%', set: (v) => setRgb(cmykToRgb(cmyk[0], v, cmyk[2], cmyk[3])) },
      { label: 'Y', value: cmyk[2], min: 0, max: 100, unit: '%', set: (v) => setRgb(cmykToRgb(cmyk[0], cmyk[1], v, cmyk[3])) },
      { label: 'K', value: cmyk[3], min: 0, max: 100, unit: '%', set: (v) => setRgb(cmykToRgb(cmyk[0], cmyk[1], cmyk[2], v)) },
    ],
  ];

  return (
    <div className="overlay" onPointerDown={cancel}>
      <div
        className="modal color-picker"
        role="dialog"
        aria-label={target === 'fg' ? 'Foreground color' : 'Background color'}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') cancel();
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'INPUT') ok();
        }}
      >
        <div className="modal-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 600 }}>Color Picker ({target === 'fg' ? 'Foreground' : 'Background'})</span>
            <div style={{ display: 'flex', background: '#1c1c1f', borderRadius: 6, padding: 2, gap: 2 }}>
              <button
                type="button"
                onClick={() => setPickerTab('wheel')}
                style={{
                  background: pickerTab === 'wheel' ? '#3b82f6' : 'transparent',
                  color: pickerTab === 'wheel' ? '#fff' : '#9ca3af',
                  border: 'none',
                  borderRadius: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Disc3 size={11} /> Wheel
              </button>
              <button
                type="button"
                onClick={() => setPickerTab('classic')}
                style={{
                  background: pickerTab === 'classic' ? '#3b82f6' : 'transparent',
                  color: pickerTab === 'classic' ? '#fff' : '#9ca3af',
                  border: 'none',
                  borderRadius: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Sliders size={11} /> Classic
              </button>
              <button
                type="button"
                onClick={() => setPickerTab('themes')}
                style={{
                  background: pickerTab === 'themes' ? '#3b82f6' : 'transparent',
                  color: pickerTab === 'themes' ? '#fff' : '#9ca3af',
                  border: 'none',
                  borderRadius: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Palette size={11} /> Themes
              </button>
            </div>
          </div>
          <button className="icon-btn" onClick={cancel} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="cp-body">
          {/* Main Visual Color Area based on tab */}
          {pickerTab === 'wheel' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 256 }}>
              <canvas
                ref={wheelCanvasRef}
                width={W_SIZE}
                height={W_SIZE}
                onPointerDown={onWheelPointerDown}
                onPointerMove={onWheelPointerMove}
                onPointerUp={onWheelPointerUp}
                style={{ cursor: 'crosshair', touchAction: 'none' }}
              />
              {/* Harmony Dropdown & Swatches */}
              <div style={{ width: '100%', marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600 }}>Harmonies:</span>
                  <select
                    value={harmonyKind}
                    onChange={(e) => setHarmonyKind(e.target.value as HarmonyKind)}
                    style={{ background: '#27272a', border: '1px solid #3f3f46', color: '#f3f4f6', fontSize: 10, borderRadius: 4, padding: '2px 6px' }}
                  >
                    {HARMONIES.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {harmonySwatches.map((cHex, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setRgb(hexToRgb(cHex))}
                      title={cHex}
                      style={{
                        flex: 1,
                        height: 20,
                        borderRadius: 4,
                        background: cHex,
                        border: hex.toLowerCase() === cHex.toLowerCase() ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {pickerTab === 'classic' && (
            <>
              <div
                ref={svRef}
                className="cp-sv"
                style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${rgbToHex(hsbToRgb(hsb[0], 100, 100))})` }}
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  dragSV(e);
                }}
                onPointerMove={(e) => e.buttons && dragSV(e)}
              >
                <div className="sv-knob" style={{ left: `${hsb[1]}%`, top: `${100 - hsb[2]}%`, background: hex }} />
              </div>
              <div
                ref={hueRef}
                className="cp-hue"
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  dragHue(e);
                }}
                onPointerMove={(e) => e.buttons && dragHue(e)}
              >
                <div className="cp-hue-knob" style={{ top: `${100 - (hsb[0] / 360) * 100}%` }} />
              </div>
            </>
          )}

          {pickerTab === 'themes' && (
            <div style={{ width: 256, maxHeight: 270, overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {CURATED_COLOR_THEMES.map((th) => (
                <div key={th.id} style={{ background: '#1c1c1f', padding: 6, borderRadius: 6, border: '1px solid #2e2e34' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: '#e5e7eb', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{th.name}</span>
                    <span style={{ fontSize: 8, color: '#9ca3af' }}>{th.category}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {th.colors.map((cHex, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setRgb(hexToRgb(cHex))}
                        title={cHex}
                        style={{ flex: 1, height: 20, borderRadius: 4, background: cHex, border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer' }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Right Side: Comparisons, Fields, Gamut, Contrast */}
          <div className="cp-side">
            <div className="cp-compare" title="New / current">
              <span style={{ background: hex }} />
              <span style={{ background: initial }} onClick={() => setRgb(hexToRgb(initial))} title="Back to the current color" />
            </div>
            {gamut && (
              <button className="cp-gamut" title="Out of the CMYK print gamut: click for the closest printable color" onClick={() => setRgb(proofRgb(rgb))}>
                <TriangleAlert size={13} />
                <span style={{ background: rgbToHex(proofRgb(rgb)) }} />
              </button>
            )}
            {eyeDropper && (
              <button
                className="btn ghost cp-eye"
                title="Pick a color from anywhere on screen"
                onClick={async () => {
                  try {
                    const r = await new eyeDropper().open();
                    setRgb(hexToRgb(r.sRGBHex));
                  } catch {}
                }}
              >
                <Pipette size={13} />
              </button>
            )}
            <div className="cp-fields">
              {groups.map((g, i) => (
                <div key={i} className="cp-group">
                  {g.map((f) => (
                    <Num key={f.label} f={f} />
                  ))}
                </div>
              ))}
              <label className="cp-field cp-hex">
                <span>#</span>
                <input
                  value={hexText ?? hex.slice(1)}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setHexText(e.target.value)}
                  onBlur={() => {
                    const v = (hexText ?? '').replace('#', '');
                    if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) setRgb(hexToRgb(v));
                    setHexText(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
              </label>
            </div>
            <div className={`cp-contrast ${grade === 'Fail' ? 'fail' : ''}`} title={`WCAG contrast against the ${target === 'fg' ? 'background' : 'foreground'} color`}>
              <span className="cp-contrast-sample" style={{ background: other, color: hex }}>
                Aa
              </span>
              <span>
                {ratio.toFixed(2)}:1 <b>{grade}</b>
              </span>
            </div>
          </div>
        </div>

        {/* Color History Strip */}
        <div style={{ padding: '8px 16px 0', display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid #282828' }}>
          <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' }}>Recent:</span>
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', flex: 1 }}>
            {history.slice(0, 14).map((cHex, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setRgb(hexToRgb(cHex))}
                title={cHex}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 3,
                  background: cHex,
                  border: hex.toLowerCase() === cHex.toLowerCase() ? '1.5px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        </div>

        <div className="modal-foot">
          <div className="opt-spacer" />
          <button className="btn ghost" onClick={cancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={ok}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
