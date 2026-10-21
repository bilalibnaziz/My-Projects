import { useState } from 'react';
import { Play, Circle, Square, Plus, Trash2, ChevronDown, ChevronRight, Layers3, Download, Upload } from 'lucide-react';
import { store, useStore } from '../core/store';
import * as A from '../core/actions';
import { pickFiles, saveBlob } from '../core/io';

/** Actions: record steps, play them back, and batch-process files. */
export function ActionsPanel() {
  useStore();
  const actions = A.getActions();
  const rec = A.isRecording();
  const playing = A.isPlaying();
  const [open, setOpen] = useState<string | null>(actions[0]?.id ?? null);
  const [sel, setSel] = useState<string | null>(actions[0]?.id ?? null);
  const [naming, setNaming] = useState<string | null>(null);
  const selected = actions.find((a) => a.id === sel) ?? null;

  return (
    <div className="actions-panel">
      <div className="actions-list">
        {actions.map((a) => {
          const expanded = open === a.id;
          return (
            <div key={a.id} className={`action ${sel === a.id ? 'sel' : ''} ${rec === a.id ? 'rec' : ''}`}>
              <div className="action-head" onClick={() => setSel(a.id)} onDoubleClick={() => setNaming(a.id)}>
                <button
                  className="action-chevron"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(expanded ? null : a.id);
                  }}
                  aria-label={expanded ? 'Collapse' : 'Expand'}
                >
                  {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                {naming === a.id ? (
                  <input
                    autoFocus
                    defaultValue={a.name}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setNaming(null);
                    }}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v) A.updateAction(a.id, { name: v });
                      setNaming(null);
                    }}
                  />
                ) : (
                  <span className="action-name">{a.name}</span>
                )}
                {rec === a.id && <span className="rec-dot" title="Recording" />}
                <span className="action-count">{a.steps.length}</span>
              </div>
              {expanded && (
                <div className="action-steps">
                  {a.steps.map((st, i) => (
                    <div key={i} className={`action-step ${st.enabled ? '' : 'off'}`}>
                      <input
                        type="checkbox"
                        checked={st.enabled}
                        aria-label={`Include ${st.label}`}
                        onChange={(e) => A.updateAction(a.id, { steps: a.steps.map((x, k) => (k === i ? { ...x, enabled: e.target.checked } : x)) })}
                      />
                      <span title={st.kind}>{st.label}</span>
                      <button className="action-del" title="Delete step" onClick={() => A.updateAction(a.id, { steps: a.steps.filter((_, k) => k !== i) })}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                  {!a.steps.length && <div className="hint">{rec === a.id ? 'Do something — it appears here' : 'Empty: press record and work as usual'}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="actions-foot">
        {rec ? (
          <button className="icon-btn rec-on" title="Stop recording" onClick={() => A.stopRecording()}>
            <Square size={13} />
          </button>
        ) : (
          <button className="icon-btn" title="Record into the selected action" disabled={!selected} onClick={() => selected && (setOpen(selected.id), A.startRecording(selected.id))}>
            <Circle size={13} />
          </button>
        )}
        <button
          className="icon-btn"
          title="Play the selected action on this document"
          disabled={!selected || !store.doc || playing || !!rec}
          onClick={async () => {
            if (!selected) return;
            const ok = await store.task(`Playing ${selected.name}`, () => A.playAction(selected.id));
            if (ok) store.toast(`Played “${selected.name}”`, 'success');
          }}
        >
          <Play size={13} />
        </button>
        <button
          className="icon-btn"
          title="New action (starts recording)"
          onClick={() => {
            const a = A.newAction(`Action ${actions.length + 1}`);
            setSel(a.id);
            setOpen(a.id);
            A.startRecording(a.id);
          }}
        >
          <Plus size={13} />
        </button>
        <button className="icon-btn" title="Batch: run the selected action on many files" disabled={!selected || !!rec} onClick={() => selected && store.set({ dialog: { type: 'batch', actionId: selected.id } })}>
          <Layers3 size={13} />
        </button>
        <div className="opt-spacer" />
        <button className="icon-btn" title="Save actions to a file" onClick={() => saveBlob(new Blob([A.exportActionsJson()], { type: 'application/json' }), 'Photoscale Actions.json')}>
          <Download size={13} />
        </button>
        <button
          className="icon-btn"
          title="Load actions from a file"
          onClick={async () => {
            const [f] = await pickFiles('.json,application/json', false);
            if (!f) return;
            try {
              store.toast(`Added ${A.importActionsJson(await f.text())} actions`, 'success');
            } catch (err) {
              store.toast((err as Error).message, 'error');
            }
          }}
        >
          <Upload size={13} />
        </button>
        <button className="icon-btn" title="Delete the selected action" disabled={!selected} onClick={() => selected && A.deleteAction(selected.id)}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/** Batch dialog body: pick files, run, download one ZIP. */
export function BatchBody({ actionId, onDone }: { actionId: string; onDone: () => void }) {
  const action = A.getActions().find((a) => a.id === actionId);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  if (!action) return <div className="hint">That action no longer exists.</div>;
  const hasExport = action.steps.some((s) => s.kind === 'export' && s.enabled);
  return (
    <div className="batch">
      <div>
        Action: <b>{action.name}</b> ({action.steps.filter((s) => s.enabled).length} steps)
      </div>
      <div className="batch-row">
        <button className="btn" disabled={!!progress} onClick={async () => setFiles(await pickFiles('image/*,.tif,.tiff', true))}>
          Choose images…
        </button>
        <span className="hint">{files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : 'No files chosen'}</span>
      </div>
      {!hasExport && <div className="hint">This action has no Export step, so each result is saved as PNG.</div>}
      {progress && (
        <div className="batch-progress">
          <span style={{ width: `${(progress[0] / progress[1]) * 100}%` }} />
        </div>
      )}
      {result && <div className="hint">{result}</div>}
      <div className="batch-row">
        <div className="opt-spacer" />
        <button className="btn ghost" onClick={onDone} disabled={!!progress && progress[0] < progress[1]}>
          Close
        </button>
        <button
          className="btn primary"
          disabled={!files.length || (!!progress && progress[0] < progress[1])}
          onClick={async () => {
            setResult(null);
            setProgress([0, files.length]);
            const r = await A.batch(actionId, files, (d, t) => setProgress([d, t]));
            if (r.ok) await saveBlob(r.zip, `${action.name.replace(/[^\w\- ]+/g, '').trim() || 'Batch'}.zip`);
            setResult(`${r.ok} file${r.ok === 1 ? '' : 's'} processed${r.failed.length ? ` · failed: ${r.failed.join(', ')}` : ''}`);
          }}
        >
          Run batch
        </button>
      </div>
    </div>
  );
}
