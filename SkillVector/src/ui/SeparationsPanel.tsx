import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { store, useStore } from '../core/store';
import { inkAt, PROCESS } from '../core/separations';
import { simulatePrint } from '../core/color';
import { Toggle } from './widgets';
import { currentSeparations, onSeparations } from './sepState';
import { onCursor } from './Viewport';

const INK_LIMIT_KEY = 'skillvector.inkLimit';

/**
 * Window ▸ Separations Preview + Attributes: overprint settings for the selection, the plates of the
 * document with eye toggles (or one plate alone), and the ink under the cursor with total coverage.
 */
export function SeparationsPanel() {
  const s = useStore();
  const doc = store.doc;
  const [, force] = useState(0);
  const [cur, setCur] = useState<{ x: number; y: number } | null>(null);
  const [limit, setLimit] = useState(() => Number(localStorage.getItem(INK_LIMIT_KEY)) || 300);
  useEffect(() => onSeparations(() => force((n) => n + 1)), []);
  useEffect(() => onCursor((c) => setCur(c ? { x: c.x, y: c.y } : null)), []);
  // Opening the panel turns the separations view on; closing the tab leaves the canvas as it was
  useEffect(() => {
    if (!store.state.separations) store.set({ separations: { hidden: [] } });
    return () => store.set({ separations: null });
  }, []);
  if (!doc) return <div className="panel-empty">No document</div>;
  const sel = store.selectedLayers;
  const sep = currentSeparations();
  const view = s.separations ?? { hidden: [] };
  const names = sep ? sep.plates.map((p) => p.name) : [...PROCESS];
  const toggle = (name: string) => {
    const hidden = view.hidden.includes(name) ? view.hidden.filter((x) => x !== name) : [...view.hidden, name];
    store.set({ separations: { ...view, hidden, solo: undefined } });
  };
  const solo = (name: string) => store.set({ separations: { ...view, solo: view.solo === name ? undefined : name } });
  let readout: ReturnType<typeof inkAt> = null;
  if (sep && cur) {
    const v = sep.view;
    readout = inkAt(sep, cur.x * v.s - v.ox, cur.y * v.s - v.oy);
  }
  const swatch = (name: string) => {
    const p = sep?.plates.find((x) => x.name === name);
    const ink = p ? p.ink : ([0, 1, 2, 3].map((j) => (j === PROCESS.indexOf(name as (typeof PROCESS)[number]) ? 1 : 0)) as [number, number, number, number]);
    const [r, g, b] = simulatePrint(ink[0] * 100, ink[1] * 100, ink[2] * 100, ink[3] * 100);
    return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
  };
  return (
    <div className="panel-body" data-separations-panel>
      <div className="section-title">Attributes</div>
      {sel.length ? (
        <>
          <Toggle label="Overprint Fill" checked={sel.every((l) => l.overprintFill)} onChange={(v) => store.setOverprint('overprintFill', v)} />
          <Toggle label="Overprint Stroke" checked={sel.every((l) => l.overprintStroke)} onChange={(v) => store.setOverprint('overprintStroke', v)} />
        </>
      ) : (
        <div className="hint">Select objects to set overprint.</div>
      )}
      <div className="section-title" style={{ marginTop: 10 }}>Separations</div>
      <Toggle label="Overprint Preview" checked={s.overprintPreview} onChange={(v) => store.set({ overprintPreview: v })} />
      {doc.colorMode !== 'CMYK' && <div className="hint">RGB document: plates are separated with the coated-paper model. Switch to File ▸ Document Color Mode ▸ CMYK for exact inks.</div>}
      <div className="sep-plates" role="list">
        {names.map((name) => {
          const hidden = view.hidden.includes(name);
          const value = readout?.plates.find((p) => p.name === name)?.value;
          return (
            <div key={name} className={`sep-plate ${view.solo === name ? 'solo' : ''}`} role="listitem" data-plate={name}>
              <button className="icon-btn" aria-label={`${hidden ? 'Show' : 'Hide'} ${name} plate`} onClick={() => toggle(name)} data-plate-eye={name}>
                {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <span className="sep-swatch" style={{ background: swatch(name) }} />
              <button className="sep-name" title="Show this plate alone (grayscale)" onClick={() => solo(name)} data-plate-solo={name}>{name}</button>
              <span className="sep-value" data-plate-value={name}>{value !== undefined ? `${value}%` : ''}</span>
            </div>
          );
        })}
      </div>
      <div className={`sep-total ${readout && readout.total > limit ? 'over' : ''}`} data-ink-total={readout?.total ?? ''}>
        Total ink: {readout ? `${readout.total}%` : '—'}
        {readout && readout.total > limit && <span> · over the {limit}% limit</span>}
      </div>
      <label className="sep-limit">
        Ink limit
        <input className="input" type="number" min={100} max={400} step={10} value={limit} aria-label="Total ink limit (%)"
          onChange={(e) => { const v = Math.max(100, Math.min(400, Number(e.target.value) || 300)); setLimit(v); try { localStorage.setItem(INK_LIMIT_KEY, String(v)); } catch { /* ignore */ } }} />
        %
      </label>
      <div className="hint">Hover the artwork to read its inks. Click a plate name to see it alone; the eye hides it.</div>
    </div>
  );
}
