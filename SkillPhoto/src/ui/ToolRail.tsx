import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Move, Square, Circle, Lasso, Wand2, Crop, Pipette, Brush, Pencil, Eraser, Stamp, Bandage, Hand, Search,
  Type, Shapes, PaintBucket, Blend, Droplet, Sun, Moon, Sparkles, Fingerprint, ArrowLeftRight, Undo2, Hexagon,
  WandSparkles, SquareDashedMousePointer, PenTool, Ruler, Crosshair, History, Replace, ScanEye, PaintbrushVertical,
} from 'lucide-react';
import { store, useStore } from '../core/store';
import type { ToolId } from '../core/store';

interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  icon: ReactNode;
  hint: string;
}

const I = 16;
export const TOOLS: Record<ToolId, ToolDef> = {
  move: { id: 'move', label: 'Move', key: 'V', icon: <Move size={I} />, hint: 'Drag to move the layer. ⌘-click picks the layer under the cursor. With a selection, moves the selected pixels.' },
  'marquee-rect': { id: 'marquee-rect', label: 'Rectangular Marquee', key: 'M', icon: <Square size={I} />, hint: 'Shift = add, ⌥ = subtract. Shift while dragging = square.' },
  'marquee-ellipse': { id: 'marquee-ellipse', label: 'Elliptical Marquee', key: 'M', icon: <Circle size={I} />, hint: 'Shift = add, ⌥ = subtract.' },
  lasso: { id: 'lasso', label: 'Lasso', key: 'L', icon: <Lasso size={I} />, hint: 'Draw freehand. Pair with Shift+⌫ to remove objects.' },
  'poly-lasso': { id: 'poly-lasso', label: 'Polygonal Lasso', key: 'L', icon: <Hexagon size={I} />, hint: 'Click points; double-click or Enter to close.' },
  wand: { id: 'wand', label: 'Magic Wand', key: 'W', icon: <Wand2 size={I} />, hint: 'Select similar colors. Tolerance in the options bar.' },
  crop: { id: 'crop', label: 'Crop', key: 'C', icon: <Crop size={I} />, hint: 'Drag handles, Enter to apply, Esc to cancel. Non-destructive by default.' },
  eyedropper: { id: 'eyedropper', label: 'Eyedropper', key: 'I', icon: <Pipette size={I} />, hint: 'Click to sample color. ⌥ samples to background.' },
  brush: { id: 'brush', label: 'Brush', key: 'B', icon: <Brush size={I} />, hint: '[ ] size, ⇧[ ] hardness, 1–0 opacity, ⌥-click to sample.' },
  pencil: { id: 'pencil', label: 'Pencil', key: 'B', icon: <Pencil size={I} />, hint: 'Hard-edged, aliased strokes for pixel art.' },
  eraser: { id: 'eraser', label: 'Eraser', key: 'E', icon: <Eraser size={I} />, hint: 'Erase to transparency.' },
  clone: { id: 'clone', label: 'Clone Stamp', key: 'S', icon: <Stamp size={I} />, hint: '⌥-click to set the source, then paint.' },
  heal: { id: 'heal', label: 'Spot Healing Brush', key: 'J', icon: <Bandage size={I} />, hint: 'Paint over blemishes or objects — they vanish (content-aware).' },
  smudge: { id: 'smudge', label: 'Smudge', key: 'R', icon: <Fingerprint size={I} />, hint: 'Push pixels around like wet paint.' },
  dodge: { id: 'dodge', label: 'Dodge', key: 'O', icon: <Sun size={I} />, hint: 'Lighten areas. Choose tonal range in the options bar.' },
  burn: { id: 'burn', label: 'Burn', key: 'O', icon: <Moon size={I} />, hint: 'Darken areas.' },
  sponge: { id: 'sponge', label: 'Sponge', key: 'O', icon: <Droplet size={I} />, hint: 'Saturate or desaturate locally.' },
  blur: { id: 'blur', label: 'Blur', key: 'R', icon: <Blend size={I} />, hint: 'Soften details locally.' },
  sharpen: { id: 'sharpen', label: 'Sharpen', key: 'R', icon: <Sparkles size={I} />, hint: 'Crisp up details locally.' },
  bucket: { id: 'bucket', label: 'Paint Bucket', key: 'G', icon: <PaintBucket size={I} />, hint: 'Flood fill similar colors.' },
  gradient: { id: 'gradient', label: 'Gradient', key: 'G', icon: <GradientIcon />, hint: 'Drag to draw. On a mask = graduated filter.' },
  text: { id: 'text', label: 'Type', key: 'T', icon: <Type size={I} />, hint: 'Click to add text, click existing text to edit.' },
  shape: { id: 'shape', label: 'Shape', key: 'U', icon: <Shapes size={I} />, hint: 'Drag to draw vector shapes. Shift constrains.' },
  hand: { id: 'hand', label: 'Hand', key: 'H', icon: <Hand size={I} />, hint: 'Pan. Hold Space anywhere for a quick pan.' },
  zoom: { id: 'zoom', label: 'Zoom', key: 'Z', icon: <Search size={I} />, hint: 'Click to zoom in, ⌥-click out. Pinch / ⌘-scroll also zoom.' },
  'marquee-row': { id: 'marquee-row', label: 'Single Row Marquee', key: 'M', icon: <LineIcon dir="row" />, hint: 'Click to select a 1-pixel row across the canvas. Shift adds, ⌥ subtracts.' },
  'marquee-col': { id: 'marquee-col', label: 'Single Column Marquee', key: 'M', icon: <LineIcon dir="col" />, hint: 'Click to select a 1-pixel column down the canvas.' },
  'object-select': { id: 'object-select', label: 'Object Selection', key: 'W', icon: <SquareDashedMousePointer size={I} />, hint: 'Drag a box around an object, or click it — the selection snaps to its edges. Shift adds, ⌥ subtracts.' },
  'quick-select': { id: 'quick-select', label: 'Quick Selection', key: 'W', icon: <WandSparkles size={I} />, hint: 'Paint over an object — on release the selection snaps to its real edges. ⌥ subtracts.' },
  'magic-eraser': { id: 'magic-eraser', label: 'Magic Eraser', key: 'E', icon: <MagicEraserIcon />, hint: 'Click to erase all similar connected pixels (Tolerance in the options bar).' },
  'bg-eraser': { id: 'bg-eraser', label: 'Background Eraser', key: 'E', icon: <BgEraserIcon />, hint: 'Erases the color under the brush centre and keeps edges of other colors.' },
  'color-replace': { id: 'color-replace', label: 'Color Replacement', key: 'B', icon: <Replace size={I} />, hint: 'Recolor with the foreground color while keeping shading and texture.' },
  'red-eye': { id: 'red-eye', label: 'Red Eye', key: 'J', icon: <ScanEye size={I} />, hint: 'Click an eye or drag a box around it to neutralize red pupils.' },
  'history-brush': { id: 'history-brush', label: 'History Brush', key: 'Y', icon: <History size={I} />, hint: 'Paint pixels back from a history state. Pick the state in History (brush icon).' },
  'heal-brush': { id: 'heal-brush', label: 'Healing Brush', key: 'J', icon: <PaintbrushVertical size={I} />, hint: '⌥-click a clean area, then paint: texture from the source, color and light from around the stroke.' },
  pen: { id: 'pen', label: 'Pen', key: 'P', icon: <PenTool size={I} />, hint: 'Click for corners, drag for curves. Click the first point to close. Enter finishes, Esc cancels, ⌫ removes a point.' },
  ruler: { id: 'ruler', label: 'Ruler', key: 'I', icon: <Ruler size={I} />, hint: 'Drag to measure distance and angle. "Straighten Layer" levels the line.' },
  'color-sampler': { id: 'color-sampler', label: 'Color Sampler', key: 'I', icon: <Crosshair size={I} />, hint: 'Click to pin up to 10 color readouts (Info panel). Drag to move, ⌥-click to remove.' },
};

export const GROUPS: ToolId[][] = [
  ['move'],
  ['marquee-rect', 'marquee-ellipse', 'marquee-row', 'marquee-col'],
  ['lasso', 'poly-lasso'],
  ['object-select', 'quick-select', 'wand'],
  ['crop'],
  ['eyedropper', 'color-sampler', 'ruler'],
  ['heal', 'heal-brush', 'red-eye'],
  ['clone'],
  ['brush', 'pencil', 'color-replace'],
  ['history-brush'],
  ['eraser', 'bg-eraser', 'magic-eraser'],
  ['gradient', 'bucket'],
  ['blur', 'sharpen', 'smudge'],
  ['dodge', 'burn', 'sponge'],
  ['pen'],
  ['text'],
  ['shape'],
  ['hand'],
  ['zoom'],
];

/** Groups that start a new section in the rail. */
const SECTION_STARTS = new Set([6, 15, 17]);

function LineIcon({ dir }: { dir: 'row' | 'col' }) {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 2.5">
      {dir === 'row' ? <line x1="3" y1="12" x2="21" y2="12" /> : <line x1="12" y1="3" x2="12" y2="21" />}
      <rect x="3" y="3" width="18" height="18" rx="2" strokeOpacity="0.35" strokeDasharray="none" />
    </svg>
  );
}

function MagicEraserIcon() {
  return (
    <span className="icon-stack">
      <Eraser size={I} />
      <Sparkles size={9} className="icon-badge" />
    </span>
  );
}

function BgEraserIcon() {
  return (
    <span className="icon-stack">
      <Eraser size={I} />
      <Crosshair size={9} className="icon-badge" />
    </span>
  );
}

function GradientIcon() {
  return (
    <svg width={I} height={I} viewBox="0 0 24 24">
      <defs>
        <linearGradient id="gi" x1="0" x2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="1" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect x="3" y="5" width="18" height="14" rx="2" fill="url(#gi)" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Tools in rail order, for docs and the shortcut guide. */
export const TOOL_INFO = GROUPS.flat().map((id) => ({ id, label: TOOLS[id].label, key: TOOLS[id].key, hint: TOOLS[id].hint }));

export function toolLabel(id: ToolId) {
  return TOOLS[id]?.label ?? id;
}
export function toolIcon(id: ToolId) {
  return TOOLS[id]?.icon ?? null;
}

export function toolKey(id: ToolId) {
  return TOOLS[id]?.key ?? '';
}

export function toolHint(id: ToolId) {
  return TOOLS[id]?.hint ?? '';
}

/**
 * How many columns the tool bar needs so every tool fits above the color controls: 1 normally,
 * 2 or 3 on short windows (like Photoshop's double-column toolbar).
 */
function useRailColumns(count: number) {
  const railRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const fit = () => {
      const avail = rail.clientHeight - (bottomRef.current?.offsetHeight ?? 0) - 16;
      const tools = toolsRef.current;
      // Height of one column: every slot plus the separators between groups
      const seps = tools ? tools.querySelectorAll('.tool-slot.sep').length : 0;
      const need = count * 27 + seps * 9;
      const next = avail > 0 ? Math.max(1, Math.min(3, Math.ceil(need / avail))) : 1;
      setCols((c) => (c === next ? c : next));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(rail);
    return () => ro.disconnect();
  }, [count]);
  return { cols, railRef, toolsRef, bottomRef };
}

/** Puts a flyout beside the whole tool bar, opening upwards for tools in the lower half. */
function flyoutPlacement(index: number, cols: number, tools: HTMLElement | null): React.CSSProperties {
  const col = index % cols;
  const style: React.CSSProperties = { left: `calc(100% + 6px + ${(cols - 1 - col) * 32}px)` };
  const slot = tools?.children[index] as HTMLElement | undefined;
  if (slot && tools && slot.offsetTop > tools.clientHeight / 2 && slot.offsetTop > 240) {
    style.top = 'auto';
    style.bottom = -4;
  }
  return style;
}

export function ToolRail() {
  const s = useStore();
  const [flyout, setFlyout] = useState<number | null>(null);
  const [remembered, setRemembered] = useState<Record<number, ToolId>>({});
  const { cols, railRef, toolsRef, bottomRef } = useRailColumns(GROUPS.length);

  return (
    <div className={`tool-rail cols-${cols}`} ref={railRef} onMouseLeave={() => setFlyout(null)}>
      {/* More columns when the window is short */}
      <div className="rail-tools" ref={toolsRef} style={{ gridTemplateColumns: `repeat(${cols}, 30px)` }}>
      {GROUPS.map((group, gi) => {
        const activeInGroup = group.includes(s.tool);
        const shown = activeInGroup ? s.tool : remembered[gi] ?? group[0];
        const t = TOOLS[shown];
        return (
          <div key={gi} className={`tool-slot ${SECTION_STARTS.has(gi) ? 'sep' : ''}`}>
            <button
              className={`tool-btn ${activeInGroup ? 'active' : ''}`}
              title={`${t.label} (${t.key})\n${t.hint}`}
              onClick={() => store.setTool(shown)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (group.length > 1) setFlyout(gi);
              }}
              onPointerDown={(e) => {
                if (group.length < 2) return;
                const timer = window.setTimeout(() => setFlyout(gi), 380);
                const clear = () => window.clearTimeout(timer);
                e.currentTarget.addEventListener('pointerup', clear, { once: true });
                e.currentTarget.addEventListener('pointerleave', clear, { once: true });
              }}
            >
              {t.icon}
              {group.length > 1 && <span className="tool-corner" />}
            </button>
            {flyout === gi && (
              <div className="tool-flyout" style={flyoutPlacement(gi, cols, toolsRef.current)}>
                {group.map((id) => (
                  <button
                    key={id}
                    className={`flyout-item ${s.tool === id ? 'active' : ''}`}
                    onClick={() => {
                      store.setTool(id);
                      setRemembered({ ...remembered, [gi]: id });
                      setFlyout(null);
                    }}
                  >
                    {TOOLS[id].icon}
                    <span>{TOOLS[id].label}</span>
                    <kbd className="kbd">{TOOLS[id].key}</kbd>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      </div>
      <div className="rail-spacer" />
      <div className="rail-bottom" ref={bottomRef}>
      <div className="color-chips">
        <button className="chip chip-bg" style={{ background: s.bg }} title="Background color: click to pick" aria-label="Background color" onClick={() => store.set({ dialog: { type: 'colorPicker', target: 'bg' } })} />
        <button className="chip chip-fg" style={{ background: s.fg }} title="Foreground color: click to pick" aria-label="Foreground color" onClick={() => store.set({ dialog: { type: 'colorPicker', target: 'fg' } })} />
        <button className="chip-swap" title="Swap colors (X)" onClick={() => store.set({ fg: s.bg, bg: s.fg })}>
          <ArrowLeftRight size={10} />
        </button>
        <button className="chip-reset" title="Default black & white (D)" onClick={() => store.set({ fg: '#000000', bg: '#ffffff' })}>
          <Undo2 size={10} />
        </button>
      </div>
      <div className="quick-mask-toggle" style={{ marginTop: 6, display: 'flex', justifyContent: 'center' }}>
        <button
          className={`tool-btn ${s.quickMask ? 'active' : ''}`}
          style={{
            width: 28,
            height: 28,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: s.quickMask ? 'rgba(225, 29, 72, 0.25)' : 'transparent',
            border: s.quickMask ? '1px solid #e11d48' : '1px solid transparent',
            color: s.quickMask ? '#f43f5e' : 'var(--text-sub)',
          }}
          title={`Edit in Quick Mask Mode (Q)\n${s.quickMask ? 'Active: Red overlay highlights masked region' : 'Click or press Q to toggle Quick Mask'}`}
          onClick={() => store.toggleQuickMask()}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
            <circle cx="12" cy="12" r="4" fill={s.quickMask ? '#f43f5e' : 'currentColor'} />
          </svg>
        </button>
      </div>
      </div>
    </div>
  );
}
