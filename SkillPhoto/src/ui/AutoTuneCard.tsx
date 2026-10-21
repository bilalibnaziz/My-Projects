// Auto Tune card: one-click, intent-aware photo correction as an editable adjustment layer.
import { useState } from 'react';
import { Pipette, Wand2 } from 'lucide-react';
import { store, useStore } from '../core/store';
import { INTENTS } from '../core/autoTune';
import type { Intent } from '../core/autoTune';
import * as tune from '../core/tuneOps';
import { Slider } from './widgets';

const SWATCH: Record<Intent, string> = {
  auto: 'conic-gradient(from 200deg, #0078d4, #2ea043, #e8a33d, #0078d4)',
  food: 'linear-gradient(135deg, #e8a33d, #d9472b)',
  portrait: 'linear-gradient(135deg, #f0c4a8, #b9826a)',
  landscape: 'linear-gradient(135deg, #5aa0e6, #4f9a3a)',
  product: 'linear-gradient(135deg, #ffffff, #9aa4ad)',
  night: 'linear-gradient(135deg, #1b2a4a, #e8b04b)',
  realestate: 'linear-gradient(135deg, #f4efe6, #c9a27e)',
  social: 'linear-gradient(135deg, #e8505b, #f9d56e)',
};

export function AutoTuneCard() {
  const s = useStore();
  const [strength, setStrength] = useState(100);
  const active = tune.activeIntent();
  const hasSel = !!store.doc?.selection;
  const wbMode = s.tool === 'eyedropper' && s.opts.eyedropperMode === 'wb';
  return (
    <div className="autotune" data-testid="autotune">
      <div className="autotune-head">
        <Wand2 size={13} />
        <span className="mini-title">Auto Tune</span>
        <span className="hint">{hasSel ? 'measures the selected area only' : 'measures your photo, stays editable'}</span>
      </div>
      <div className="autotune-grid">
        {(Object.keys(INTENTS) as Intent[]).map((id) => (
          <button
            key={id}
            data-intent={id}
            className={`autotune-chip ${active === id ? 'on' : ''}`}
            title={INTENTS[id].hint}
            onClick={() => tune.applyIntent(id, strength / 100)}
          >
            <span className="autotune-swatch" style={{ background: SWATCH[id] }} />
            {INTENTS[id].label}
          </button>
        ))}
      </div>
      {active && (
        <Slider label="Strength" value={strength} min={0} max={150} def={100} unit="%" onChange={(v) => {
          setStrength(v);
          tune.applyIntent(active, v / 100);
        }} />
      )}
      <div className="autotune-row">
        {(Object.keys(tune.AUTO_LABELS) as tune.AutoKind[]).map((k) => (
          <button key={k} className="btn ghost compact" onClick={() => tune.applyAuto(k)} title={`${tune.AUTO_LABELS[k]} as an adjustment layer`}>
            {tune.AUTO_LABELS[k].replace('Auto ', '').replace('White Balance', 'WB')}
          </button>
        ))}
        <button
          className={`btn compact ${wbMode ? 'accent' : 'ghost'}`}
          title="White balance picker: click something that should be white or grey"
          onClick={() => {
            store.setTool('eyedropper');
            store.setOpts({ eyedropperMode: wbMode ? 'color' : 'wb' });
          }}
        >
          <Pipette size={12} /> Pick WB
        </button>
      </div>
    </div>
  );
}
