import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  def?: number;
  unit?: string;
  onChange: (v: number) => void;
  gradient?: string; // optional track gradient (e.g. temperature)
  format?: (v: number) => string;
}

/** Range slider with zero-centered fill, editable value, double-click to reset. */
export function Slider({ label, value, min, max, step = 1, def, unit = '', onChange, gradient, format }: SliderProps) {
  const [editing, setEditing] = useState(false);
  const zero = def ?? (min < 0 && max > 0 ? 0 : min);
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  const a = Math.min(pct(zero), pct(value));
  const b = Math.max(pct(zero), pct(value));
  const track = gradient
    ? gradient
    : `linear-gradient(90deg, var(--track) ${a}%, var(--accent) ${a}%, var(--accent) ${b}%, var(--track) ${b}%)`;
  const shown = format ? format(value) : `${step < 1 ? value.toFixed(step < 0.1 ? 2 : 1) : Math.round(value)}${unit}`;
  const changed = def !== undefined && Math.abs(value - def) > 1e-9;
  return (
    <div className={`slider ${changed ? 'changed' : ''}`} onDoubleClick={() => def !== undefined && onChange(def)}>
      <div className="slider-head">
        <span className="slider-label">{label}</span>
        {editing ? (
          <input
            className="slider-input"
            autoFocus
            defaultValue={String(value)}
            onBlur={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
              e.stopPropagation();
            }}
          />
        ) : (
          <span className="slider-value" onClick={() => setEditing(true)} title="Click to type a value">
            {shown}
          </span>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ background: track }}
        className={gradient ? 'has-gradient' : ''}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        title={def !== undefined ? 'Double-click to reset' : undefined}
      />
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`section ${open ? 'open' : ''}`}>
      <div className="section-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{title}</span>
        <div className="section-right" onClick={(e) => e.stopPropagation()}>
          {right}
        </div>
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function IconButton({
  icon,
  title,
  onClick,
  active,
  disabled,
  className = '',
}: {
  icon: ReactNode;
  title: string;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button className={`icon-btn ${active ? 'active' : ''} ${className}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {icon}
    </button>
  );
}

export function Select<T extends string | number>({ value, options, onChange, title, className = '' }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; title?: string; className?: string }) {
  return (
    <select
      className={`select ${className}`}
      title={title}
      value={String(value)}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Compact numeric field with drag-to-scrub on its label. */
export function NumberField({ label, value, min, max, step = 1, unit, onChange, width = 46 }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; width?: number }) {
  const [text, setText] = useState(String(value));
  const drag = useRef<{ x: number; v: number } | null>(null);
  useEffect(() => setText(String(Math.round(value * 100) / 100)), [value]);
  const commit = (raw: string) => {
    const v = parseFloat(raw);
    if (!Number.isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
    else setText(String(value));
  };
  return (
    <label className="numfield">
      <span
        className="numfield-label"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, v: value };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dv = Math.round((e.clientX - drag.current.x) / 2) * step;
          onChange(Math.max(min, Math.min(max, drag.current.v + dv)));
        }}
        onPointerUp={() => (drag.current = null)}
        title="Drag to scrub"
      >
        {label}
      </span>
      <input
        style={{ width }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            onChange(Math.max(min, Math.min(max, value + d)));
          }
        }}
      />
      {unit && <span className="numfield-unit">{unit}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <label className="toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-box" />
      <span>{label}</span>
    </label>
  );
}

export function ColorInput({ value, onChange, title }: { value: string; onChange: (v: string) => void; title?: string }) {
  return (
    <label className="color-input" title={title} style={{ background: value }}>
      <input type="color" value={value.length === 7 ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/**
 * Canva-style value block: drag left / right anywhere on it to change the value (Shift = ×5 faster),
 * click to type, double-click to reset, ↑ ↓ to nudge while focused.
 */
export function ScrubBlock({
  icon, label, value, min, max, unit = 'px', def = 0, onChange, title, active, className,
}: {
  icon?: ReactNode; label?: string; value: number; min: number; max: number; unit?: string; def?: number;
  onChange: (v: number) => void; title?: string; active?: boolean; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const shown = Math.round(value * 10) / 10;
  return (
    <div
      className={`scrub-block ${active ? 'active' : ''} ${editing ? 'editing' : ''} ${className ?? ''}`}
      title={title ? `${title} — drag left / right · click to type · double-click resets` : undefined}
      tabIndex={0}
      role="spinbutton"
      aria-label={title ?? label}
      aria-valuenow={shown}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={(e) => {
        if (editing || e.button !== 0) return;
        drag.current = { x: e.clientX, v: value, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 3) return;
        d.moved = true;
        onChange(clamp(d.v + dx * (e.shiftKey ? 5 : 1)));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) setEditing(true);
      }}
      onDoubleClick={() => {
        setEditing(false);
        onChange(clamp(def));
      }}
      onKeyDown={(e) => {
        if (editing) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          const d = (e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1);
          onChange(clamp(value + d));
        } else if (e.key === 'Enter') setEditing(true);
      }}
    >
      {icon && <span className="scrub-icon">{icon}</span>}
      {label && <span className="scrub-label">{label}</span>}
      {editing ? (
        <input
          className="scrub-input"
          autoFocus
          defaultValue={String(shown)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const v = parseFloat(e.currentTarget.value);
            if (!Number.isNaN(v)) onChange(clamp(v));
            setEditing(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.currentTarget.value = String(shown);
              e.currentTarget.blur();
            }
          }}
        />
      ) : (
        <span className="scrub-value">
          {shown}
          {unit && <small>{unit}</small>}
        </span>
      )}
    </div>
  );
}
