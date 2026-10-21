import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, LayoutTemplate, Minus, Plus, RotateCcw } from 'lucide-react';
import { UI_SCALES } from './theme';
import { store, useStore } from '../core/store';
import type { Theme } from '../core/store';
import { NumberField, Toggle } from './widgets';
import { WORKSPACES, currentWorkspace, resetLayout, setLayout, switchWorkspace, useLayout } from './layout';

const THEMES: { id: Theme; label: string; color: string }[] = [
  { id: 'vscode', label: 'Dark Modern', color: '#1f1f1f' },
  { id: 'dark', label: 'Graphite', color: '#17171b' },
  { id: 'midnight', label: 'Midnight', color: '#0b1020' },
  { id: 'light', label: 'Light', color: '#f7f7f9' },
];

/** Menu-bar switcher: workspaces (modes), their guides, the interface theme and the panel layout. */
export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const s = useStore();
  const lay = useLayout();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const ws = currentWorkspace();
  return (
    <div className="ws-switch" ref={ref}>
      <button className={`ws-btn ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} title="Workspace: panels, guides and sizes tuned for a kind of work">
        <LayoutTemplate size={13} />
        {!compact && <span>{ws.label}</span>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="ws-pop">
          <div className="mini-title">Workspace</div>
          {WORKSPACES.map((w) => (
            <button
              key={w.id}
              className={`ws-item ${w.id === ws.id ? 'active' : ''}`}
              onClick={() => {
                switchWorkspace(w.id);
                setOpen(false);
              }}
            >
              <span className="ws-check">{w.id === ws.id ? <Check size={12} /> : null}</span>
              <span className="ws-text">
                <b>{w.label}</b>
                <span>{w.blurb}</span>
              </span>
            </button>
          ))}
          <div className="menu-sep" />
          <div className="ws-row">
            <Toggle label={ws.guides.length ? `Show ${ws.guides.join(' & ')} guides` : 'Show workspace guides'} checked={lay.guides} onChange={(v) => setLayout({ guides: v })} />
          </div>
          {ws.guides.includes('print') && (
            <div className="ws-row">
              <NumberField label="Bleed" value={lay.bleed} min={0} max={600} unit="px" onChange={(v) => setLayout({ bleed: v })} />
              <NumberField label="Safe" value={lay.safe} min={0} max={600} unit="px" onChange={(v) => setLayout({ safe: v })} />
              <span className="hint">36 px = 3 mm at 300 ppi</span>
            </div>
          )}
          <div className="menu-sep" />
          <div className="mini-title">Interface size</div>
          <UiScaleControl />
          <div className="menu-sep" />
          <div className="mini-title">Theme</div>
          <div className="ws-themes">
            {THEMES.map((t) => (
              <button key={t.id} className={`ws-theme ${s.prefs.theme === t.id ? 'active' : ''}`} onClick={() => store.set({ prefs: { ...s.prefs, theme: t.id } })} title={t.label}>
                <span style={{ background: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
          <div className="menu-sep" />
          <button
            className="ws-item small"
            onClick={() => {
              resetLayout();
              setOpen(false);
            }}
          >
            <span className="ws-check">
              <RotateCcw size={12} />
            </span>
            <span className="ws-text">
              <b>Reset panel layout</b>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** − / + and presets for the interface size (menus, panels, text); the canvas zoom is separate. */
export function UiScaleControl() {
  const s = useStore();
  const cur = s.prefs.uiScale ?? 1;
  const set = (v: number) => store.set({ prefs: { ...s.prefs, uiScale: Math.round(v * 100) / 100 } });
  const smaller = [...UI_SCALES].reverse().find((v) => v < cur - 0.001);
  const larger = UI_SCALES.find((v) => v > cur + 0.001);
  return (
    <div className="ui-scale">
      <button className="dock-mini" title="Smaller interface" disabled={smaller === undefined} onClick={() => smaller !== undefined && set(smaller)}>
        <Minus size={13} />
      </button>
      <span className="ui-scale-val mono">{Math.round(cur * 100)}%</span>
      <button className="dock-mini" title="Larger interface" disabled={larger === undefined} onClick={() => larger !== undefined && set(larger)}>
        <Plus size={13} />
      </button>
      <span className="seg compact">
        {[['Compact', 0.85], ['Default', 1], ['Large', 1.25]].map(([label, v]) => (
          <button key={label} className={Math.abs(cur - (v as number)) < 0.001 ? 'active' : ''} onClick={() => set(v as number)}>
            {label}
          </button>
        ))}
      </span>
    </div>
  );
}
