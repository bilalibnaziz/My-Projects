// Edit a look like a filter app: light, colour, split toning and per-colour sliders on top of the applied
// look (they start at 0), baked live into its LUT. Save the result to My Looks to reuse it on any photo.
import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { store, useStore } from '../core/store';
import { currentTweak, editLook, isNeutral, saveLookAsMine, TWEAK_SLIDERS, type TweakSlider } from '../core/lookStudio';
import { currentLookLayer } from '../core/lookOps';
import type { LookRecipe } from '../core/looks';
import { Slider } from './widgets';

const GROUPS: TweakSlider['group'][] = ['Light', 'Color', 'Tone', 'Split', 'Colors'];
const HUE_TRACK = 'linear-gradient(90deg, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)';
const TRACKS: Record<string, string> = {
  temp: 'linear-gradient(90deg, #4a90e2, #d8d8d8 50%, #f5a623)',
  tint: 'linear-gradient(90deg, #4caf50, #d8d8d8 50%, #e040fb)',
};

export function LookEditor({ onSaved }: { onSaved?: () => void }) {
  useStore();
  const look = currentLookLayer();
  const lookId = look?.id ?? null;
  const [r, setR] = useState<LookRecipe>(() => currentTweak());
  const [name, setName] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set(['Light', 'Color']));
  const pending = useRef<LookRecipe | null>(null);
  const frame = useRef(0);

  // Another look layer selected: show its own edits
  useEffect(() => {
    setR(currentTweak());
    setName('');
  }, [lookId]);

  // Sliders move at pointer speed; the LUT is rebaked at most once per frame
  const push = (next: LookRecipe) => {
    setR(next);
    pending.current = next;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pending.current) editLook(pending.current);
      pending.current = null;
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const toggle = (g: string) => {
    const n = new Set(open);
    if (n.has(g)) n.delete(g);
    else n.add(g);
    setOpen(n);
  };
  const changed = (g: TweakSlider['group']) => TWEAK_SLIDERS.some((s) => s.group === g && !s.hue && s.get(r) !== 0);

  return (
    <div className="look-editor" aria-label="Edit look">
      <div className="look-editor-head">
        <span className="mini-title" style={{ margin: 0 }}>Edit look</span>
        <button className="btn ghost" disabled={isNeutral(r)} title="Back to the look as it was" onClick={() => push({})}>
          <RotateCcw size={12} /> Reset
        </button>
      </div>
      {GROUPS.map((g) => (
        <div key={g} className="look-editor-group">
          <button className={`look-editor-group-head ${open.has(g) ? 'open' : ''}`} onClick={() => toggle(g)} aria-expanded={open.has(g)}>
            <span>{g === 'Split' ? 'Split toning' : g === 'Colors' ? 'Per colour' : g}</span>
            {changed(g) && <span className="look-editor-dot" title="Edited" />}
          </button>
          {open.has(g) &&
            TWEAK_SLIDERS.filter((s) => s.group === g).map((s) => (
              <Slider
                key={s.id}
                label={s.label}
                value={s.get(r)}
                min={s.min}
                max={s.max}
                def={s.hue ? undefined : 0}
                unit={s.hue ? '°' : ''}
                gradient={s.hue ? HUE_TRACK : TRACKS[s.id]}
                onChange={(v) => push(s.set(r, v))}
              />
            ))}
        </div>
      ))}
      <div className="look-editor-save">
        <input className="input" placeholder={look?.adjust?.lut?.name ?? 'My look'} value={name} onChange={(e) => setName(e.target.value)} aria-label="Look name" onKeyDown={(e) => e.stopPropagation()} />
        <button
          className="btn primary"
          disabled={!look}
          title="Keep this look in My Looks: one tap on any photo, exports as .cube"
          onClick={() => {
            if (saveLookAsMine(name || undefined)) {
              setName('');
              onSaved?.();
            }
          }}
        >
          <Save size={12} /> Save to My Looks
        </button>
      </div>
      {!look && <div className="hint">Moving a slider starts a new custom look layer.</div>}
      <div className="hint">{store.doc ? 'Sliders stack on top of the look and stay editable — select the look layer later to change them.' : ''}</div>
    </div>
  );
}
