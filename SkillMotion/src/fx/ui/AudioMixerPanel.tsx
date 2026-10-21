import React, { useState, useEffect } from 'react';
import { Volume2, Play, Gauge, Scissors } from 'lucide-react';
import { fxStore, EffectsScaleState, MAX_MASTER } from '../store';
import { audioEngine, meterFraction } from '../audioEngine';
import { LOUDNESS_TARGETS, type LoudnessReport } from '../loudness';
import { findSilence, masterFor, measureMix, throughMaster } from '../audioTools';
import { clipMediaKind } from '../media';

interface AudioMixerPanelProps {
  state: EffectsScaleState;
}

type Level = { rmsDb: number; peakDb: number };
const SILENT: Level = { rmsDb: -Infinity, peakDb: -Infinity };

const toDb = (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);
const fmtDb = (v: number, unit = 'dB') => (Number.isFinite(v) ? `${v > 0.05 ? '+' : ''}${v.toFixed(1).replace('-', '−')} ${unit}`.replace('−0.0', '0.0') : `−∞ ${unit}`);
const FADER_MIN_DB = -40;

const sectionTitle: React.CSSProperties = { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#9d9d9d', marginBottom: 8 };
const box: React.CSSProperties = { background: '#252526', border: '1px solid var(--fx-border)', borderRadius: 8, padding: 10, marginBottom: 16 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: '11px', color: '#cccccc', marginBottom: 6 };
const mono: React.CSSProperties = { fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' };
const select: React.CSSProperties = { background: '#181818', color: '#cccccc', border: '1px solid var(--fx-border)', borderRadius: 4, padding: '3px 4px', fontSize: '11px' };

// Meter bar on the −60…0 dBFS scale: RMS as the bar, peak as a tick (red over −1 dBFS)
const Meter: React.FC<{ level: Level; width?: number; id: string }> = ({ level, width = 4, id }) => (
  <div data-meter={id} data-db={Number.isFinite(level.rmsDb) ? level.rmsDb.toFixed(1) : '-inf'} style={{ width, height: '130px', background: '#181818', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        width: '100%',
        height: `${meterFraction(level.rmsDb) * 100}%`,
        background: 'linear-gradient(to top, #2ea043 0%, #2ea043 70%, #f59e0b 88%, #f85149 100%)',
      }}
    />
    <div style={{ position: 'absolute', left: 0, right: 0, height: 2, bottom: `${meterFraction(level.peakDb) * 100}%`, background: level.peakDb > -1 ? '#f85149' : '#cccccc', opacity: Number.isFinite(level.peakDb) ? 1 : 0 }} />
  </div>
);

// Fader in dB; the bottom of its travel is silence
const fromDb = (db: number) => (db <= FADER_MIN_DB ? 0 : Math.pow(10, db / 20));
const Fader: React.FC<{ db: number; onChange: (db: number) => void; label: string }> = ({ db, onChange, label }) => (
  <input
    type="range"
    aria-label={label}
    min={FADER_MIN_DB}
    max={12}
    step={0.1}
    value={Math.max(FADER_MIN_DB, Number.isFinite(db) ? db : FADER_MIN_DB)}
    onPointerDown={() => fxStore.beginGesture()}
    onPointerUp={() => fxStore.commitGesture()}
    onChange={(e) => onChange(Number(e.target.value))}
    onDoubleClick={() => onChange(0)}
    title="Double-click: 0 dB"
    style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '130px', width: '18px', accentColor: '#4daafc' }}
  />
);

export const AudioMixerPanel: React.FC<AudioMixerPanelProps> = ({ state }) => {
  const [levels, setLevels] = useState<{ tracks: Record<string, Level>; left: Level; right: Level }>({ tracks: {}, left: SILENT, right: SILENT });

  const [targetId, setTargetId] = useState('youtube');
  const [range, setRange] = useState<'all' | 'in-out'>('all');
  const [report, setReport] = useState<LoudnessReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [loudMsg, setLoudMsg] = useState('');

  const [threshold, setThreshold] = useState(-40);
  const [minPause, setMinPause] = useState(0.5);
  const [pad, setPad] = useState(0.1);
  const [silenceMsg, setSilenceMsg] = useState('');

  const trackIds = state.tracks.map((t) => t.id).join(',');
  useEffect(() => {
    let animId: number;
    const ids = trackIds.split(',');
    const poll = () => {
      const m = audioEngine.getMasterLevels();
      const tracks: Record<string, Level> = {};
      for (const id of ids) tracks[id] = audioEngine.getTrackLevel(id);
      setLevels({ tracks, left: m.left, right: m.right });
      animId = requestAnimationFrame(poll);
    };
    animId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(animId);
  }, [trackIds]);

  const target = LOUDNESS_TARGETS.find((t) => t.id === targetId) ?? LOUDNESS_TARGETS[0];

  const measure = async (): Promise<LoudnessReport | null> => {
    setBusy(true);
    setLoudMsg('Rendering the mix…');
    try {
      const s = fxStore.getState();
      const io = range === 'in-out' && s.inPoint !== null && s.outPoint !== null && s.outPoint > s.inPoint;
      const r = await measureMix(s.tracks, s.clips, io ? s.inPoint! : 0, io ? s.outPoint! : s.duration);
      setReport(r);
      setLoudMsg(Number.isFinite(r.integrated) ? `Measured ${r.duration.toFixed(1)} s` : 'The mix is silent here');
      return r;
    } catch (e) {
      setLoudMsg(`Could not measure: ${(e as Error).message}`);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const normalize = async () => {
    const r = report ?? (await measure());
    if (!r) return;
    const g = masterFor(r, target);
    if (g.limitedBy === 'silence') return setLoudMsg('Nothing to normalize: the mix is silent');
    const master = Math.min(MAX_MASTER, g.master);
    fxStore.setMasterVolume(master, true);
    const heard = throughMaster(r, master);
    const capped = master < g.master ? ' (the fader stops at +12 dB)' : '';
    setLoudMsg(
      g.limitedBy === 'peak'
        ? `Master ${fmtDb(toDb(master))}: held at the ${target.peak} dBTP peak ceiling → ${fmtDb(heard.integrated, 'LUFS')}${capped}`
        : `Master ${fmtDb(toDb(master))} → ${fmtDb(heard.integrated, 'LUFS')}, peak ${fmtDb(heard.truePeak, 'dBTP')}${capped}`
    );
  };

  const selected = state.clips.find((c) => c.id === state.selectedClipId);
  const kind = selected ? clipMediaKind(selected) : null;
  const canCut = !!selected && (kind === 'audio' || kind === 'video') && !selected.locked;

  const removeSilence = async (apply: boolean) => {
    if (!selected || !canCut) return;
    setSilenceMsg('Listening…');
    const silent = await findSilence(selected, threshold, minPause);
    if (!silent) return setSilenceMsg('This clip has no sound the browser can decode');
    if (!apply) {
      const total = silent.reduce((n, [a, b]) => n + (b - a), 0);
      return setSilenceMsg(silent.length ? `${silent.length} pause${silent.length > 1 ? 's' : ''}, ${total.toFixed(1)} s of source` : 'No pauses at this threshold');
    }
    const r = fxStore.removeSilence(selected.id, silent, { pad, minSilence: minPause });
    setSilenceMsg(r.cuts ? `Removed ${r.cuts} pause${r.cuts > 1 ? 's' : ''}, ${r.saved.toFixed(1)} s shorter (⌘Z undoes)` : 'No pauses at this threshold');
  };

  const heard = report ? throughMaster(report, state.masterVolume) : null;
  const masterDb = toDb(state.masterVolume);
  const stats: Array<[string, string, string]> = [
    ['Integrated', heard ? fmtDb(heard.integrated, 'LUFS') : '—', heard && Math.abs(heard.integrated - target.lufs) <= 1 ? '#2ea043' : '#cccccc'],
    ['True peak', heard ? fmtDb(heard.truePeak, 'dBTP') : '—', heard && heard.truePeak > target.peak ? '#f85149' : '#cccccc'],
    ['Short-term max', heard ? fmtDb(heard.shortTermMax, 'LUFS') : '—', '#cccccc'],
    ['Range (LRA)', report ? `${report.range.toFixed(1)} LU` : '—', '#cccccc'],
  ];

  return (
    <div className="fx-side-panel right fx-audio-mixer" style={{ width: '420px' }}>
      <div className="fx-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Volume2 size={14} style={{ color: '#4daafc' }} />
          <span>Multitrack Audio Mixer</span>
        </div>
        <span style={{ fontSize: '10px', color: '#4daafc' }}>48 kHz</span>
      </div>

      <div className="fx-panel-content">
        <div style={sectionTitle}>Channel Strips</div>
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: 10, marginBottom: 8 }}>
          {state.tracks.map((track) => (
            <div
              key={track.id}
              data-strip={track.id}
              style={{ width: '68px', minWidth: '68px', background: '#252526', border: '1px solid var(--fx-border)', borderRadius: 8, padding: '8px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
            >
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#cccccc' }} title={track.name}>{track.name.slice(0, 7)}</span>
              <div style={{ display: 'flex', gap: 3 }}>
                <button
                  className="fx-track-icon-btn"
                  title="Mute"
                  onClick={() => fxStore.toggleTrackMute(track.id)}
                  style={{ fontSize: '9px', fontWeight: 700, padding: '2px 4px', background: track.muted ? '#f85149' : 'rgba(255,255,255,0.05)', color: '#ffffff' }}
                >
                  M
                </button>
                <button
                  className="fx-track-icon-btn"
                  title="Solo"
                  data-solo={track.id}
                  onClick={() => fxStore.toggleTrackSolo(track.id)}
                  style={{ fontSize: '9px', fontWeight: 700, padding: '2px 4px', background: track.solo ? '#d29922' : 'rgba(255,255,255,0.05)', color: track.solo ? '#181818' : '#ffffff' }}
                >
                  S
                </button>
              </div>
              <div style={{ fontSize: '8px', color: '#6e7681' }}>PAN {track.pan === 0 ? 'C' : track.pan < 0 ? `L${Math.round(-track.pan * 100)}` : `R${Math.round(track.pan * 100)}`}</div>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.05}
                value={track.pan}
                title="Double-click: centre"
                onDoubleClick={() => fxStore.setTrackPan(track.id, 0)}
                onChange={(e) => fxStore.setTrackPan(track.id, Number(e.target.value))}
                style={{ width: '48px', accentColor: '#4daafc', height: '3px' }}
              />
              <div style={{ display: 'flex', gap: 4, height: '140px', alignItems: 'center' }}>
                <Fader label={`${track.name} volume`} db={toDb(track.volume)} onChange={(d) => fxStore.setTrackVolume(track.id, Math.min(1.5, fromDb(d)))} />
                <Meter level={levels.tracks[track.id] ?? SILENT} id={track.id} />
              </div>
              <span style={{ ...mono, fontSize: '9px', color: '#9d9d9d' }}>{fmtDb(toDb(track.volume))}</span>
            </div>
          ))}

          <div style={{ position: 'sticky', right: 0, zIndex: 1, boxShadow: '-8px 0 8px -4px rgba(0,0,0,0.5)', width: '78px', minWidth: '78px', background: '#1f1f1f', border: '1px solid rgba(0, 120, 212,0.4)', borderRadius: 8, padding: '8px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '10px', fontWeight: 900, color: '#4daafc' }}>MASTER</span>
            <div style={{ height: '18px' }} />
            <div style={{ fontSize: '8px', color: '#4daafc' }}>L · R</div>
            <div style={{ display: 'flex', gap: 4, height: '140px', alignItems: 'center' }}>
              <Fader label="Master volume" db={masterDb} onChange={(d) => fxStore.setMasterVolume(fromDb(d))} />
              <div style={{ display: 'flex', gap: 2 }}>
                <Meter level={levels.left} width={3} id="master-l" />
                <Meter level={levels.right} width={3} id="master-r" />
              </div>
            </div>
            <span data-master-db style={{ ...mono, fontSize: '9px', color: '#4daafc', fontWeight: 700 }}>{fmtDb(masterDb)}</span>
          </div>
        </div>

        <div style={sectionTitle}>
          <Gauge size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
          Loudness (EBU R128)
        </div>
        <div style={box} className="fx-loudness">
          <div style={row}>
            <select aria-label="Loudness target" value={targetId} onChange={(e) => setTargetId(e.target.value)} style={{ ...select, flex: 1 }}>
              {LOUDNESS_TARGETS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <select aria-label="Range" value={range} onChange={(e) => setRange(e.target.value as 'all' | 'in-out')} style={select}>
              <option value="all">Whole sequence</option>
              <option value="in-out">Work area</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', margin: '8px 0' }}>
            {stats.map(([k, v, color]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                <span style={{ color: '#9d9d9d' }}>{k}</span>
                <span data-value={k} style={{ ...mono, color }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="fx-chip-btn" data-action="measure" disabled={busy} onClick={measure} style={{ flex: 1, justifyContent: 'center', background: '#313131', color: '#cccccc' }}>
              {busy ? 'Measuring…' : 'Measure mix'}
            </button>
            <button className="fx-chip-btn" data-action="normalize" disabled={busy} onClick={normalize} style={{ flex: 1, justifyContent: 'center', background: '#0078d4', color: '#ffffff' }}>
              Normalize to {target.lufs} LUFS
            </button>
          </div>
          {loudMsg && <div data-loud-msg style={{ fontSize: '10px', color: '#9d9d9d', marginTop: 6 }}>{loudMsg}</div>}
          <div style={{ fontSize: '10px', color: '#6e7681', marginTop: 4 }}>Measures the exact mix the export writes. Normalize sets the master fader.</div>
        </div>

        <div style={sectionTitle}>
          <Scissors size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
          Remove Silence
        </div>
        <div style={box} className="fx-silence">
          <div style={{ fontSize: '11px', color: canCut ? '#cccccc' : '#6e7681', marginBottom: 8 }}>
            {canCut ? `Clip: ${selected!.name}` : 'Select an audio or video clip on the timeline'}
          </div>
          {(
            [
              ['Quieter than', threshold, setThreshold, -70, -15, 1, `${threshold} dB`],
              ['For at least', minPause, setMinPause, 0.1, 3, 0.05, `${minPause.toFixed(2)} s`],
              ['Keep around words', pad, setPad, 0, 0.4, 0.01, `${pad.toFixed(2)} s`],
            ] as const
          ).map(([label, value, set, min, max, step, text]) => (
            <div key={label} style={row}>
              <span style={{ width: 110 }}>{label}</span>
              <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} style={{ flex: 1, accentColor: '#4daafc' }} />
              <span style={{ ...mono, width: 52, textAlign: 'right' }}>{text}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button className="fx-chip-btn" data-action="find-silence" disabled={!canCut} onClick={() => removeSilence(false)} style={{ flex: 1, justifyContent: 'center', background: '#313131', color: '#cccccc' }}>
              Find pauses
            </button>
            <button className="fx-chip-btn" data-action="remove-silence" disabled={!canCut} onClick={() => removeSilence(true)} style={{ flex: 1, justifyContent: 'center', background: '#0078d4', color: '#ffffff' }}>
              Cut pauses
            </button>
          </div>
          {silenceMsg && <div data-silence-msg style={{ fontSize: '10px', color: '#9d9d9d', marginTop: 6 }}>{silenceMsg}</div>}
        </div>

        <div style={sectionTitle}>Sound Generators</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          {(
            [
              ['boom', 'Sub Bass Boom', '#4daafc'],
              ['whoosh', 'Whoosh Transition', '#a855f7'],
              ['glitch', 'Glitch Chirp', '#ec4899'],
              ['click', 'UI Tick', '#2ea043'],
            ] as const
          ).map(([id, label, color]) => (
            <button key={id} className="fx-chip-btn" onClick={() => audioEngine.playProceduralSound(id)} style={{ padding: '6px 10px', background: '#252526' }}>
              <Play size={11} style={{ color }} /> {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
