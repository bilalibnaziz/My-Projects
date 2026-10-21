import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Pipette, TriangleAlert, Copy, Check, Plus, Trash2, Sliders, Palette, Disc3 } from 'lucide-react';
import {
  hexToRgb,
  rgbToHex,
  rgbToHsb,
  hsbToRgb,
  rgbToLab,
  labToRgb,
  rgbToCmyk,
  cmykToRgb,
  contrastRatio,
  contrastGrade,
  outOfGamut,
  proofRgb,
  type RGB,
} from '../core/color';
import {
  type HarmonyMode,
  getHarmonyNodes,
  getColorHistory,
  pushColorHistory,
  getSavedSwatches,
  addSavedSwatch,
  removeSavedSwatch,
  CURATED_COLOR_THEMES,
} from '../core/colorHarmonies';

interface AffinityColorWheelProps {
  color: string;
  onChange: (hex: string) => void;
  initialColor?: string;
  onClose?: () => void;
}

type TabMode = 'wheel' | 'harmonies' | 'sliders' | 'themes';

export function AffinityColorWheel({
  color,
  onChange,
  initialColor = color,
  onClose,
}: AffinityColorWheelProps) {
  const [tab, setTab] = useState<TabMode>('wheel');
  const [hsb, setHsb] = useState<[number, number, number]>(() => rgbToHsb(hexToRgb(color)));
  const [harmonyMode, setHarmonyMode] = useState<HarmonyMode>('complementary');
  const [history, setHistory] = useState<string[]>(getColorHistory);
  const [savedSwatches, setSavedSwatches] = useState<string[]>(getSavedSwatches);
  const [copied, setCopied] = useState(false);
  const [hexInput, setHexInput] = useState<string | null>(null);

  const wheelCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingHue = useRef(false);
  const isDraggingSV = useRef(false);

  const currentRgb = useMemo(() => hsbToRgb(...hsb), [hsb]);
  const currentHex = useMemo(() => rgbToHex(currentRgb), [currentRgb]);

  // Keep external color in sync if changed outside
  useEffect(() => {
    const nextHsb = rgbToHsb(hexToRgb(color));
    setHsb((prev) => (nextHsb[1] === 0 ? [prev[0], nextHsb[1], nextHsb[2]] : nextHsb));
  }, [color]);

  const updateColor = useCallback(
    (newHsb: [number, number, number], pushHistory = false) => {
      setHsb(newHsb);
      const rgb = hsbToRgb(...newHsb);
      const hex = rgbToHex(rgb);
      onChange(hex);
      if (pushHistory) {
        setHistory(pushColorHistory(hex));
      }
    },
    [onChange]
  );

  const setRgbColor = useCallback(
    (rgb: RGB, pushHistory = false) => {
      const nextHsb = rgbToHsb(rgb);
      const finalHsb: [number, number, number] = [
        nextHsb[1] === 0 ? hsb[0] : nextHsb[0],
        nextHsb[1],
        nextHsb[2],
      ];
      updateColor(finalHsb, pushHistory);
    },
    [hsb, updateColor]
  );

  const setHexDirect = useCallback(
    (hex: string, pushHistory = true) => {
      const clean = hex.startsWith('#') ? hex : `#${hex}`;
      if (/^#[0-9a-f]{6}$/i.test(clean)) {
        setRgbColor(hexToRgb(clean), pushHistory);
      }
    },
    [setRgbColor]
  );

  // Wheel Dimensions
  const SIZE = 240;
  const CENTER = SIZE / 2;
  const OUTER_R = 112;
  const INNER_R = 88;
  const BOX_HALF = 48; // Inner SV Box: 96x96 px

  // Draw Wheel + Inner SV Box
  useEffect(() => {
    const canvas = wheelCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // 1. Draw outer hue ring
    const step = 0.5; // half-degree steps for smooth rendering
    for (let deg = 0; deg < 360; deg += step) {
      const radStart = ((deg - 0.5) * Math.PI) / 180;
      const radEnd = ((deg + step + 0.5) * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, OUTER_R, radStart, radEnd);
      ctx.arc(CENTER, CENTER, INNER_R, radEnd, radStart, true);
      ctx.closePath();
      ctx.fillStyle = `hsl(${deg}, 100%, 50%)`;
      ctx.fill();
    }

    // Outer and inner border ring lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, OUTER_R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, INNER_R, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Draw inner Saturation/Value box
    const bx = CENTER - BOX_HALF;
    const by = CENTER - BOX_HALF;
    const bSize = BOX_HALF * 2;

    // Base color gradient (horizontal: white -> pure hue)
    const pureHueHex = rgbToHex(hsbToRgb(hsb[0], 100, 100));
    const hGrad = ctx.createLinearGradient(bx, by, bx + bSize, by);
    hGrad.addColorStop(0, '#ffffff');
    hGrad.addColorStop(1, pureHueHex);
    ctx.fillStyle = hGrad;
    ctx.fillRect(bx, by, bSize, bSize);

    // Vertical gradient (transparent -> black)
    const vGrad = ctx.createLinearGradient(bx, by, bx, by + bSize);
    vGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vGrad.addColorStop(1, '#000000');
    ctx.fillStyle = vGrad;
    ctx.fillRect(bx, by, bSize, bSize);

    // Border for SV Box
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.strokeRect(bx, by, bSize, bSize);

    // 3. Draw Hue Handle on ring
    const hueRad = (hsb[0] * Math.PI) / 180;
    const midR = (OUTER_R + INNER_R) / 2;
    const hx = CENTER + Math.cos(hueRad) * midR;
    const hy = CENTER + Math.sin(hueRad) * midR;

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

    // 4. Draw Harmony Nodes on Ring if enabled
    const nodes = getHarmonyNodes(currentHex, harmonyMode);
    nodes.forEach((node) => {
      if (node.isBase) return;
      const nRad = (node.angle * Math.PI) / 180;
      const nx = CENTER + Math.cos(nRad) * midR;
      const ny = CENTER + Math.sin(nRad) * midR;

      // Dashed connector line from center
      ctx.beginPath();
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.moveTo(CENTER, CENTER);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      ctx.setLineDash([]);

      // Node pin
      ctx.beginPath();
      ctx.arc(nx, ny, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = node.hex;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    });

    // 5. Draw SV Handle inside box
    const svX = bx + (hsb[1] / 100) * bSize;
    const svY = by + (1 - hsb[2] / 100) * bSize;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(svX, svY, 6, 0, Math.PI * 2);
    ctx.fillStyle = currentHex;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }, [hsb, currentHex, harmonyMode]);

  // Pointer Interaction on Wheel
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - CENTER;
    const dy = y - CENTER;
    const dist = Math.hypot(dx, dy);

    // Clicked in Ring
    if (dist >= INNER_R - 6 && dist <= OUTER_R + 6) {
      isDraggingHue.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const hue = (angle + 360) % 360;
      updateColor([hue, hsb[1], hsb[2]]);
    }
    // Clicked in SV Box
    else if (Math.abs(dx) <= BOX_HALF && Math.abs(dy) <= BOX_HALF) {
      isDraggingSV.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      const s = Math.max(0, Math.min(100, ((dx + BOX_HALF) / (BOX_HALF * 2)) * 100));
      const b = Math.max(0, Math.min(100, (1 - (dy + BOX_HALF) / (BOX_HALF * 2)) * 100));
      updateColor([hsb[0], s, b]);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingHue.current && !isDraggingSV.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - CENTER;
    const dy = y - CENTER;

    if (isDraggingHue.current) {
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const hue = (angle + 360) % 360;
      updateColor([hue, hsb[1], hsb[2]]);
    } else if (isDraggingSV.current) {
      const s = Math.max(0, Math.min(100, ((dx + BOX_HALF) / (BOX_HALF * 2)) * 100));
      const b = Math.max(0, Math.min(100, (1 - (dy + BOX_HALF) / (BOX_HALF * 2)) * 100));
      updateColor([hsb[0], s, b]);
    }
  };

  const handlePointerUp = () => {
    if (isDraggingHue.current || isDraggingSV.current) {
      setHistory(pushColorHistory(currentHex));
    }
    isDraggingHue.current = false;
    isDraggingSV.current = false;
  };

  // Lab, CMYK, Gamut, Contrast
  const lab = useMemo(() => rgbToLab(currentRgb), [currentRgb]);
  const cmyk = useMemo(() => rgbToCmyk(currentRgb), [currentRgb]);
  const ratio = useMemo(() => contrastRatio(currentHex, '#ffffff'), [currentHex]);
  const grade = useMemo(() => contrastGrade(ratio), [ratio]);
  const gamut = useMemo(() => outOfGamut(currentRgb), [currentRgb]);
  const harmonyNodes = useMemo(() => getHarmonyNodes(currentHex, harmonyMode), [currentHex, harmonyMode]);

  const copyHex = () => {
    navigator.clipboard.writeText(currentHex);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const eyeDropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;

  return (
    <div className="affinity-color-wheel" style={{ width: 330, background: '#1c1c1f', color: '#e5e7eb', borderRadius: 12, padding: 14, boxShadow: '0 12px 36px rgba(0,0,0,0.65)', border: '1px solid #2e2e34', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Top Header: Comparison, EyeDropper, Hex, Copy */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', width: 44, height: 26, borderRadius: 6, overflow: 'hidden', border: '1px solid #3f3f46' }}>
            <div style={{ flex: 1, background: currentHex }} title="Active color" />
            <div
              style={{ flex: 1, background: initialColor, cursor: 'pointer' }}
              title="Click to restore original"
              onClick={() => setHexDirect(initialColor)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', background: '#27272a', borderRadius: 6, padding: '2px 8px', border: '1px solid #3f3f46' }}>
            <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 4 }}>#</span>
            <input
              value={hexInput ?? currentHex.slice(1)}
              onChange={(e) => setHexInput(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => {
                if (hexInput) setHexDirect(hexInput);
                setHexInput(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (hexInput) setHexDirect(hexInput);
                  setHexInput(null);
                }
              }}
              style={{ width: 62, background: 'transparent', border: 'none', color: '#f3f4f6', fontSize: 12, fontWeight: 600, outline: 'none', textTransform: 'uppercase' }}
            />
            <button onClick={copyHex} title="Copy Hex code" style={{ background: 'none', border: 'none', color: copied ? '#10b981' : '#9ca3af', cursor: 'pointer', padding: 2 }}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {eyeDropper && (
            <button
              onClick={async () => {
                try {
                  const res = await new eyeDropper().open();
                  setHexDirect(res.sRGBHex);
                } catch {}
              }}
              title="Sample screen color"
              style={{ background: '#27272a', border: '1px solid #3f3f46', borderRadius: 6, padding: '5px 7px', color: '#d1d5db', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <Pipette size={13} />
            </button>
          )}
          <button
            onClick={() => setSavedSwatches(addSavedSwatch(currentHex))}
            title="Save to favorites"
            style={{ background: '#27272a', border: '1px solid #3f3f46', borderRadius: 6, padding: '5px 7px', color: '#d1d5db', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Mode Tabs */}
      <div style={{ display: 'flex', background: '#141416', borderRadius: 8, padding: 3, marginBottom: 12, gap: 2 }}>
        <button
          onClick={() => setTab('wheel')}
          style={{ flex: 1, padding: '5px 0', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: tab === 'wheel' ? '#3b82f6' : 'transparent', color: tab === 'wheel' ? '#fff' : '#9ca3af' }}
        >
          <Disc3 size={12} /> Wheel
        </button>
        <button
          onClick={() => setTab('harmonies')}
          style={{ flex: 1, padding: '5px 0', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: tab === 'harmonies' ? '#3b82f6' : 'transparent', color: tab === 'harmonies' ? '#fff' : '#9ca3af' }}
        >
          Harmonies
        </button>
        <button
          onClick={() => setTab('sliders')}
          style={{ flex: 1, padding: '5px 0', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: tab === 'sliders' ? '#3b82f6' : 'transparent', color: tab === 'sliders' ? '#fff' : '#9ca3af' }}
        >
          <Sliders size={12} /> Sliders
        </button>
        <button
          onClick={() => setTab('themes')}
          style={{ flex: 1, padding: '5px 0', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: tab === 'themes' ? '#3b82f6' : 'transparent', color: tab === 'themes' ? '#fff' : '#9ca3af' }}
        >
          <Palette size={12} /> Themes
        </button>
      </div>

      {/* Tab 1: Affinity Color Wheel */}
      {tab === 'wheel' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <canvas
            ref={wheelCanvasRef}
            width={SIZE}
            height={SIZE}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{ cursor: 'crosshair', touchAction: 'none' }}
          />

          {/* Harmony Rules Selector */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>Harmonies:</span>
            <select
              value={harmonyMode}
              onChange={(e) => setHarmonyMode(e.target.value as HarmonyMode)}
              style={{ background: '#27272a', border: '1px solid #3f3f46', color: '#f3f4f6', fontSize: 11, borderRadius: 5, padding: '3px 8px', outline: 'none' }}
            >
              <option value="none">None (Single Pin)</option>
              <option value="complementary">Complementary (180°)</option>
              <option value="analogous">Analogous (±30°)</option>
              <option value="triadic">Triadic (120°)</option>
              <option value="split">Split Complementary</option>
              <option value="tetradic">Tetradic (Square 90°)</option>
              <option value="monochrome">Monochrome Tones</option>
            </select>
          </div>

          {/* Live Harmony Swatches Bar */}
          {harmonyMode !== 'none' && (
            <div style={{ display: 'flex', gap: 6, width: '100%', padding: '6px 0' }}>
              {harmonyNodes.map((node, i) => (
                <button
                  key={i}
                  onClick={() => setHexDirect(node.hex)}
                  title={`${node.label}: ${node.hex}`}
                  style={{
                    flex: 1,
                    height: 24,
                    borderRadius: 5,
                    border: currentHex.toLowerCase() === node.hex.toLowerCase() ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.2)',
                    background: node.hex,
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Harmonies Explorer */}
      {tab === 'harmonies' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
          {(['complementary', 'analogous', 'triadic', 'split', 'tetradic', 'monochrome'] as HarmonyMode[]).map((mode) => {
            const nodes = getHarmonyNodes(currentHex, mode);
            return (
              <div key={mode} style={{ background: '#242428', borderRadius: 8, padding: 8, border: '1px solid #33333a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'capitalize', color: '#d1d5db' }}>{mode}</span>
                  <button
                    onClick={() => {
                      setHarmonyMode(mode);
                      setTab('wheel');
                    }}
                    style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}
                  >
                    View on Wheel →
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {nodes.map((n, i) => (
                    <div
                      key={i}
                      onClick={() => setHexDirect(n.hex)}
                      title={`${n.label}: ${n.hex}`}
                      style={{
                        flex: 1,
                        height: 28,
                        borderRadius: 6,
                        background: n.hex,
                        cursor: 'pointer',
                        border: '1px solid rgba(255,255,255,0.15)',
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'center',
                        paddingBottom: 2,
                      }}
                    >
                      <span style={{ fontSize: 8, color: '#ffffff', textShadow: '0 1px 2px #000', opacity: 0.85 }}>{n.hex.slice(1, 4)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab 3: Sliders & Pro Color Models */}
      {tab === 'sliders' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
          {/* HSB Sliders */}
          <div style={{ background: '#242428', padding: 8, borderRadius: 8, border: '1px solid #33333a' }}>
            <div style={{ fontWeight: 700, color: '#9ca3af', marginBottom: 6 }}>HSB MODEL</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 14 }}>H</span>
              <input
                type="range"
                min={0}
                max={359}
                value={Math.round(hsb[0])}
                onChange={(e) => updateColor([Number(e.target.value), hsb[1], hsb[2]])}
                style={{ flex: 1 }}
              />
              <span style={{ width: 34, textAlign: 'right' }}>{Math.round(hsb[0])}°</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 14 }}>S</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(hsb[1])}
                onChange={(e) => updateColor([hsb[0], Number(e.target.value), hsb[2]])}
                style={{ flex: 1 }}
              />
              <span style={{ width: 34, textAlign: 'right' }}>{Math.round(hsb[1])}%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 14 }}>B</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(hsb[2])}
                onChange={(e) => updateColor([hsb[0], hsb[1], Number(e.target.value)])}
                style={{ flex: 1 }}
              />
              <span style={{ width: 34, textAlign: 'right' }}>{Math.round(hsb[2])}%</span>
            </div>
          </div>

          {/* RGB Sliders */}
          <div style={{ background: '#242428', padding: 8, borderRadius: 8, border: '1px solid #33333a' }}>
            <div style={{ fontWeight: 700, color: '#9ca3af', marginBottom: 6 }}>RGB MODEL</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 14, color: '#f87171' }}>R</span>
              <input
                type="range"
                min={0}
                max={255}
                value={Math.round(currentRgb[0])}
                onChange={(e) => setRgbColor([Number(e.target.value), currentRgb[1], currentRgb[2]])}
                style={{ flex: 1 }}
              />
              <span style={{ width: 34, textAlign: 'right' }}>{Math.round(currentRgb[0])}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 14, color: '#4ade80' }}>G</span>
              <input
                type="range"
                min={0}
                max={255}
                value={Math.round(currentRgb[1])}
                onChange={(e) => setRgbColor([currentRgb[0], Number(e.target.value), currentRgb[2]])}
                style={{ flex: 1 }}
              />
              <span style={{ width: 34, textAlign: 'right' }}>{Math.round(currentRgb[1])}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 14, color: '#60a5fa' }}>B</span>
              <input
                type="range"
                min={0}
                max={255}
                value={Math.round(currentRgb[2])}
                onChange={(e) => setRgbColor([currentRgb[0], currentRgb[1], Number(e.target.value)])}
                style={{ flex: 1 }}
              />
              <span style={{ width: 34, textAlign: 'right' }}>{Math.round(currentRgb[2])}</span>
            </div>
          </div>

          {/* CMYK & Gamut Warning */}
          <div style={{ background: '#242428', padding: 8, borderRadius: 8, border: '1px solid #33333a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ color: '#9ca3af', fontWeight: 600 }}>CMYK: </span>
              <span>{Math.round(cmyk[0])}% {Math.round(cmyk[1])}% {Math.round(cmyk[2])}% {Math.round(cmyk[3])}%</span>
            </div>
            {gamut && (
              <button
                onClick={() => setRgbColor(proofRgb(currentRgb))}
                title="Color is out of CMYK gamut. Click to snap to closest printable color."
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#7f1d1d', border: '1px solid #ef4444', color: '#fca5a5', borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}
              >
                <TriangleAlert size={11} /> Gamut Fix
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Curated Themes & Palettes (Canva & Affinity) */}
      {tab === 'themes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
          {/* User Saved Swatches */}
          <div style={{ background: '#242428', borderRadius: 8, padding: 8, border: '1px solid #33333a' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#f3f4f6' }}>★ My Saved Swatches</span>
              <button
                onClick={() => setSavedSwatches(addSavedSwatch(currentHex))}
                style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}
              >
                + Save Current
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {savedSwatches.map((hex, i) => (
                <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    onClick={() => setHexDirect(hex)}
                    title={hex}
                    style={{ width: 22, height: 22, borderRadius: 4, background: hex, border: '1px solid rgba(255,255,255,0.2)', cursor: 'pointer' }}
                  />
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setSavedSwatches(removeSavedSwatch(hex));
                    }}
                    title="Remove swatch"
                    style={{ position: 'absolute', top: -3, right: -3, background: '#ef4444', color: '#fff', borderRadius: '50%', width: 10, height: 10, fontSize: 8, display: 'none', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  >
                    ×
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Curated Themes */}
          {CURATED_COLOR_THEMES.map((theme) => (
            <div key={theme.id} style={{ background: '#242428', borderRadius: 8, padding: 8, border: '1px solid #33333a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#e5e7eb' }}>{theme.name}</span>
                <span style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase' }}>{theme.category}</span>
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                {theme.colors.map((hex, i) => (
                  <button
                    key={i}
                    onClick={() => setHexDirect(hex)}
                    title={hex}
                    style={{ flex: 1, height: 24, borderRadius: 5, background: hex, border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer' }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Persistent Color History Bar (at bottom of all tabs) */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #2e2e34' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' }}>Recent Colors</span>
          <span style={{ fontSize: 9, color: '#6b7280' }}>Click to apply</span>
        </div>
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
          {history.slice(0, 16).map((hex, i) => (
            <button
              key={i}
              onClick={() => setHexDirect(hex, false)}
              title={hex}
              style={{
                flexShrink: 0,
                width: 17,
                height: 17,
                borderRadius: 4,
                background: hex,
                border: currentHex.toLowerCase() === hex.toLowerCase() ? '1.5px solid #ffffff' : '1px solid rgba(255,255,255,0.2)',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
