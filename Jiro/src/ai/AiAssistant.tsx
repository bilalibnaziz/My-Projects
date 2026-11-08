/**
 * Skill AI — the assistant drawer. Shared copy — keep identical in all three apps.
 * Mount once (<AiAssistant adapter={…} />) and open it with openAssistant().
 * Desktop: a drawer on the right edge. Narrow windows (≤ 720 px): a full-width bottom sheet.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Sparkles, Settings, X, SendHorizontal, Square, Undo2 } from 'lucide-react';
import './ai.css';
import { PROVIDERS, loadSettings, saveSettings, modelOf, providerLabel, listModels, testKey, AiError } from './providers';
import type { AiSettings, ProviderId, Turn, ToolCall, ToolOutcome } from './providers';
import { runAgent } from './agent';
import { subscribeAssistant, assistantOpen, closeAssistant, takePendingPrompt } from './open';
import type { AppAdapter } from './agent';

// ------------------------------------------------------------------ conversation model

interface Activity {
  call: ToolCall;
  outcome?: ToolOutcome;
}

type Entry =
  | { kind: 'user'; text: string; images: string[]; mark?: unknown; undone?: number }
  | { kind: 'assistant'; text: string; provider: ProviderId; model: string; refusal?: boolean; streaming?: boolean }
  | { kind: 'tools'; items: Activity[] }
  | { kind: 'error'; text: string; settings?: boolean };

const convo: { turns: Turn[]; entries: Entry[] } = { turns: [], entries: [] };

const TOOL_LABELS: Record<string, string> = {
  get_document: 'Read the document',
  look: 'Looked at the canvas',
  list_commands: 'Searched commands',
  run_command: 'Ran a command',
};
const toolLabel = (c: ToolCall) => {
  const base = TOOL_LABELS[c.name] ?? c.name.replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase());
  const id = c.name === 'run_command' && typeof c.args.id === 'string' ? ` · ${c.args.id}` : '';
  return base + id;
};

// ------------------------------------------------------------------ tiny markdown (bold, code, lists, paragraphs)

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? <strong key={`${key}b${i++}`}>{t.slice(2, -2)}</strong> : <code key={`${key}c${i++}`}>{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, bi) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]);
          const items = lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), `${bi}-${li}`)}</li>);
          return ordered ? <ol key={bi}>{items}</ol> : <ul key={bi}>{items}</ul>;
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {inline(l.replace(/^#+\s*/, ''), `${bi}-${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ icons

const Spark = () => <Sparkles size={16} aria-hidden="true" />;
const Gear = () => <Settings size={16} aria-hidden="true" />;
const Close = () => <X size={16} aria-hidden="true" />;
const Send = () => <SendHorizontal size={16} aria-hidden="true" />;
const Stop = () => <Square size={13} fill="currentColor" aria-hidden="true" />;

// ------------------------------------------------------------------ settings view

function SettingsView({ settings, onChange, onDone }: { settings: AiSettings; onChange: (s: AiSettings) => void; onDone: () => void }) {
  const [models, setModels] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [status, setStatus] = useState<Partial<Record<ProviderId, { ok: boolean; text: string }>>>({});
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [reveal, setReveal] = useState<ProviderId | null>(null);

  const check = async (p: ProviderId) => {
    setBusy(p);
    try {
      const text = await testKey(settings, p);
      setStatus((s) => ({ ...s, [p]: { ok: true, text } }));
      setModels((m) => ({ ...m, [p]: undefined }));
      const ids = await listModels(settings, p);
      setModels((m) => ({ ...m, [p]: ids }));
    } catch (e) {
      setStatus((s) => ({ ...s, [p]: { ok: false, text: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ai-settings">
      {PROVIDERS.map((p) => {
        const list = models[p.id] ?? p.suggested;
        const st = status[p.id];
        return (
          <section key={p.id} className="ai-card">
            <div className="ai-card-head">
              <span className={`ai-dot ai-dot-${p.id}`} aria-hidden="true" />
              <strong>{p.label}</strong>
              <a href={p.keyUrl} target="_blank" rel="noreferrer">
                Get a key
              </a>
            </div>
            <label className="ai-field">
              <span>API key</span>
              <div className="ai-row">
                <input
                  type={reveal === p.id ? 'text' : 'password'}
                  value={settings.keys[p.id] ?? ''}
                  placeholder={p.keyHint}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`${p.label} API key`}
                  onChange={(e) => onChange({ ...settings, keys: { ...settings.keys, [p.id]: e.target.value } })}
                />
                <button type="button" className="ai-btn ai-ghost" aria-label={reveal === p.id ? 'Hide key' : 'Show key'} onClick={() => setReveal(reveal === p.id ? null : p.id)}>
                  {reveal === p.id ? 'Hide' : 'Show'}
                </button>
                <button type="button" className="ai-btn" disabled={!settings.keys[p.id]?.trim() || busy === p.id} onClick={() => check(p.id)} aria-label={`Test ${p.label} key`}>
                  {busy === p.id ? 'Testing…' : 'Test'}
                </button>
              </div>
            </label>
            <label className="ai-field">
              <span>Model</span>
              <input
                list={`ai-models-${p.id}`}
                value={settings.models[p.id] ?? ''}
                placeholder={p.defaultModel}
                spellCheck={false}
                aria-label={`${p.label} model`}
                onChange={(e) => onChange({ ...settings, models: { ...settings.models, [p.id]: e.target.value } })}
              />
              <datalist id={`ai-models-${p.id}`}>
                {list.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            {st && <p className={st.ok ? 'ai-ok' : 'ai-bad'}>{st.text}</p>}
          </section>
        );
      })}
      <section className="ai-card">
        <label className="ai-field">
          <span>Reasoning effort</span>
          <select value={settings.effort} aria-label="Reasoning effort" onChange={(e) => onChange({ ...settings, effort: e.target.value as AiSettings['effort'] })}>
            <option value="low">Low — fastest</option>
            <option value="medium">Medium — balanced</option>
            <option value="high">High — most careful</option>
          </select>
        </label>
        <label className="ai-field">
          <span>Image generation</span>
          <select value={settings.imageProvider} aria-label="Image generation provider" onChange={(e) => onChange({ ...settings, imageProvider: e.target.value as AiSettings['imageProvider'] })}>
            <option value="auto">Automatic (ChatGPT, then Gemini)</option>
            <option value="openai">ChatGPT — {settings.imageModels.openai}</option>
            <option value="gemini">Gemini — {settings.imageModels.gemini}</option>
          </select>
        </label>
        <div className="ai-row ai-two">
          <label className="ai-field">
            <span>OpenAI image model</span>
            <input value={settings.imageModels.openai} aria-label="OpenAI image model" onChange={(e) => onChange({ ...settings, imageModels: { ...settings.imageModels, openai: e.target.value } })} />
          </label>
          <label className="ai-field">
            <span>Gemini image model</span>
            <input value={settings.imageModels.gemini} aria-label="Gemini image model" onChange={(e) => onChange({ ...settings, imageModels: { ...settings.imageModels, gemini: e.target.value } })} />
          </label>
        </div>
        <label className="ai-check">
          <input type="checkbox" checked={settings.seeCanvas} onChange={(e) => onChange({ ...settings, seeCanvas: e.target.checked })} />
          <span>Let the assistant see the canvas (sends a small snapshot with each message)</span>
        </label>
      </section>
      <p className="ai-note">
        Keys stay on this device and go only to the provider you pick. Requests are billed to your own account. Claude requests use server-side fallback, so if Claude's safety check declines a request, it is retried once on a suitable model.
      </p>
      <button type="button" className="ai-btn ai-primary ai-wide" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function UndoTurn({ at, onUndo }: { at: number; onUndo: (i: number) => void }) {
  if (at < 0) return null;
  return (
    <button type="button" className="ai-undo" onClick={() => onUndo(at)} title="Undo every change the assistant made for this request" aria-label="Undo these changes">
      <Undo2 size={12} aria-hidden="true" />
      Undo changes
    </button>
  );
}

// ------------------------------------------------------------------ main component

export function AiAssistant({ adapter }: { adapter: AppAdapter }) {
  const open = useSyncExternalStore(subscribeAssistant, assistantOpen);
  const [settings, setSettingsState] = useState<AiSettings>(loadSettings);
  const [entries, setEntries] = useState<Entry[]>(convo.entries);
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const setSettings = (s: AiSettings) => {
    setSettingsState(s);
    saveSettings(s);
  };
  const push = (e: Entry) => {
    convo.entries = [...convo.entries, e];
    setEntries(convo.entries);
  };
  const replaceLast = (e: Entry) => {
    convo.entries = [...convo.entries.slice(0, -1), e];
    setEntries(convo.entries);
  };
  const dropLast = () => {
    convo.entries = convo.entries.slice(0, -1);
    setEntries(convo.entries);
  };
  const patchLastTools = (fn: (items: Activity[]) => Activity[]) => {
    const last = convo.entries[convo.entries.length - 1];
    if (last?.kind !== 'tools') return;
    convo.entries = [...convo.entries.slice(0, -1), { kind: 'tools', items: fn(last.items) }];
    setEntries(convo.entries);
  };

  const hasKey = !!settings.keys[settings.provider]?.trim();

  useEffect(() => {
    if (open && view === 'chat') requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, view]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && assistantOpen() && !busy) {
        const t = e.target as HTMLElement | null;
        if (t?.closest('.ai-panel')) {
          e.stopPropagation();
          closeAssistant();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy]);

  const send = async (text: string) => {
    const prompt = text.trim();
    if ((!prompt && !images.length) || busy) return;
    if (!hasKey) {
      setView('settings');
      return;
    }
    const attached = images;
    setDraft('');
    setImages([]);
    let mark: unknown;
    try {
      mark = adapter.checkpoint?.();
    } catch {
      mark = undefined;
    }
    push({ kind: 'user', text: prompt, images: attached, mark });
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const shots = [...attached];
      if (settings.seeCanvas) {
        try {
          const snap = await adapter.snapshot();
          if (snap) shots.push(snap);
        } catch {
          // no snapshot this time
        }
      }
      const state = adapter.context();
      convo.turns.push({ role: 'user', text: `${prompt || 'Look at the attached image.'}\n\n<app_state>\n${state}\n</app_state>${settings.seeCanvas && shots.length > attached.length ? '\n(The last image is a snapshot of the current canvas.)' : ''}`, images: shots });
      await runAgent(adapter, settings, convo.turns, ac.signal, (ev) => {
        const last = convo.entries[convo.entries.length - 1];
        const live = last?.kind === 'assistant' && last.streaming ? last : null;
        if (ev.type === 'text') {
          // Streamed text grows one live bubble until the reply is complete
          if (live) replaceLast({ ...live, text: live.text + ev.delta });
          else push({ kind: 'assistant', text: ev.delta, provider: settings.provider, model: modelOf(settings), streaming: true });
        } else if (ev.type === 'reply') {
          const done: Entry = { kind: 'assistant', text: ev.reply.text, provider: settings.provider, model: ev.reply.model, refusal: ev.reply.stop === 'refusal' };
          if (live) {
            if (ev.reply.text.trim()) replaceLast(done);
            else dropLast();
          } else if (ev.reply.text.trim()) push(done);
          if (ev.reply.stop === 'length') push({ kind: 'error', text: 'The reply was cut off (too long). Ask it to continue.' });
        } else if (ev.type === 'tool-start') {
          const last = convo.entries[convo.entries.length - 1];
          if (last?.kind === 'tools') patchLastTools((items) => [...items, { call: ev.call }]);
          else push({ kind: 'tools', items: [{ call: ev.call }] });
        } else {
          patchLastTools((items) => items.map((a) => (a.call.id === ev.call.id ? { ...a, outcome: ev.outcome } : a)));
        }
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') push({ kind: 'error', text: 'Stopped.' });
      else push({ kind: 'error', text: e instanceof Error ? e.message : String(e), settings: e instanceof AiError && (e.kind === 'auth' || e.kind === 'no-key' || e.kind === 'bad-request') });
      // Keep the transcript valid: a dangling assistant tool call needs results before the next user turn
      const last = convo.turns[convo.turns.length - 1];
      if (last?.role === 'assistant' && last.calls.length) convo.turns.push({ role: 'tool', results: last.calls.map((c) => ({ id: c.id, name: c.name, text: 'Not run (stopped).', isError: true })) });
      if (last?.role === 'user') convo.turns.pop();
    } finally {
      const last = convo.entries[convo.entries.length - 1];
      if (last?.kind === 'assistant' && last.streaming) replaceLast({ ...last, streaming: false });
      setBusy(false);
      abortRef.current = null;
    }
  };

  /** Reverts everything the assistant changed since the user message at `index`. */
  const undoTurn = (index: number) => {
    const e = convo.entries[index];
    if (e?.kind !== 'user' || !adapter.revertTo || e.mark === undefined) return;
    const n = adapter.revertTo(e.mark);
    convo.entries = convo.entries.map((x, i) => (i === index ? { ...e, undone: n } : x));
    setEntries(convo.entries);
    // Tell the model on the next turn, so it doesn't assume its edits are still there
    convo.turns.push({ role: 'user', text: `(I undid all ${n} change${n === 1 ? '' : 's'} you made for my request "${e.text.slice(0, 80)}".)` });
    convo.turns.push({ role: 'assistant', text: 'Understood — those changes are undone.', calls: [], provider: settings.provider });
  };

  /** Index of the user message that started the turn ending at `i` (for the undo button). */
  const turnStart = (i: number) => {
    for (let k = i; k >= 0; k--) if (entries[k].kind === 'user') return k;
    return -1;
  };
  /** The undo button goes under the last entry of a finished turn that ran tools. */
  const undoAt = (i: number) => {
    if (busy && i >= entries.length - 2) return -1;
    const next = entries[i + 1];
    if (next && next.kind !== 'user') return -1;
    const k = turnStart(i);
    if (k < 0 || !adapter.revertTo) return -1;
    const u = entries[k] as Extract<Entry, { kind: 'user' }>;
    if (u.mark === undefined || u.undone !== undefined) return -1;
    const ranTools = entries.slice(k + 1, i + 1).some((x) => x.kind === 'tools');
    return ranTools ? k : -1;
  };

  useEffect(() => {
    if (open && !busy) {
      const p = takePendingPrompt();
      // Sent after this render (send updates state)
      if (p) queueMicrotask(() => void send(p));
    }
  });

  const clear = () => {
    convo.turns = [];
    convo.entries = [];
    setEntries([]);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    for (const f of files.slice(0, 4)) {
      const r = new FileReader();
      r.onload = () => setImages((xs) => [...xs, String(r.result)].slice(0, 4));
      r.readAsDataURL(f);
    }
  };

  if (!open) return null;

  return (
    <aside className="ai-panel" role="dialog" aria-label={`${adapter.app} AI assistant`}>
      <header className="ai-head">
        <span className="ai-mark">
          <Spark />
        </span>
        <strong className="ai-title">Skill AI</strong>
        <div className="ai-seg" role="tablist" aria-label="AI provider">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={settings.provider === p.id}
              className={settings.provider === p.id ? 'on' : ''}
              title={`${p.label} · ${modelOf(settings, p.id)}${settings.keys[p.id]?.trim() ? '' : ' (no key yet)'}`}
              onClick={() => setSettings({ ...settings, provider: p.id })}
            >
              <span className={`ai-dot ai-dot-${p.id}`} aria-hidden="true" />
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" className="ai-icon" aria-label="AI settings" title="AI settings" onClick={() => setView(view === 'settings' ? 'chat' : 'settings')}>
          <Gear />
        </button>
        <button type="button" className="ai-icon" aria-label="Close assistant" title="Close (Esc)" onClick={closeAssistant}>
          <Close />
        </button>
      </header>

      {view === 'settings' ? (
        <SettingsView settings={settings} onChange={setSettings} onDone={() => setView('chat')} />
      ) : (
        <>
          <div className="ai-list" ref={listRef} aria-live="polite">
            {!entries.length && (
              <div className="ai-empty">
                <div className="ai-hero">
                  <Spark />
                </div>
                <h3>What should we make?</h3>
                <p>
                  {providerLabel(settings.provider)} can see your {adapter.app === 'Skill Motion' ? 'timeline and monitor' : 'canvas'} and use the app's tools. Every change is one undo away.
                </p>
                {!hasKey && (
                  <button type="button" className="ai-btn ai-primary" onClick={() => setView('settings')}>
                    Connect {providerLabel(settings.provider)}
                  </button>
                )}
                <div className="ai-starters">
                  {adapter.starters.map((s) => (
                    <button key={s.label} type="button" className="ai-chip" onClick={() => send(s.prompt)} disabled={busy}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {entries.map((e, i) => {
              if (e.kind === 'user')
                return (
                  <div key={i} className="ai-msg ai-user">
                    {e.undone !== undefined && <span className="ai-undone">Changes undone ({e.undone})</span>}
                    {e.images.length > 0 && (
                      <div className="ai-thumbs">
                        {e.images.map((src, j) => (
                          <img key={j} src={src} alt="Attached" />
                        ))}
                      </div>
                    )}
                    {e.text && <p>{e.text}</p>}
                  </div>
                );
              if (e.kind === 'assistant')
                return (
                  <div key={i} className={`ai-msg ai-bot${e.refusal ? ' ai-refusal' : ''}${e.streaming ? ' ai-streaming' : ''}`}>
                    <Markdown text={e.text} />
                    {!e.streaming && (
                      <span className="ai-meta">
                        <span className={`ai-dot ai-dot-${e.provider}`} aria-hidden="true" />
                        {e.model}
                        <UndoTurn at={undoAt(i)} onUndo={undoTurn} />
                      </span>
                    )}
                  </div>
                );
              if (e.kind === 'tools')
                return (
                  <details key={i} className="ai-tools" open={busy && i === entries.length - 1}>
                    <summary>
                      {e.items.some((a) => !a.outcome) ? <span className="ai-spin" aria-hidden="true" /> : <span className="ai-tick" aria-hidden="true" />}
                      {e.items.length === 1 ? toolLabel(e.items[0].call) : `${e.items.length} actions`}
                      {e.items.some((a) => a.outcome?.isError) && <span className="ai-warn"> · some failed</span>}
                    </summary>
                    {undoAt(i) >= 0 && (
                      <div className="ai-tools-foot">
                        <UndoTurn at={undoAt(i)} onUndo={undoTurn} />
                      </div>
                    )}
                    <ul>
                      {e.items.map((a) => (
                        <li key={a.call.id} className={a.outcome?.isError ? 'bad' : ''}>
                          <span>{toolLabel(a.call)}</span>
                          {a.outcome && <small>{a.outcome.text.split('\n')[0].slice(0, 140)}</small>}
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              return (
                <div key={i} className="ai-msg ai-error" role="alert">
                  <p>{e.text}</p>
                  {e.settings && (
                    <button type="button" className="ai-btn" onClick={() => setView('settings')}>
                      Open AI settings
                    </button>
                  )}
                </div>
              );
            })}
            {busy && (
              <div className="ai-thinking" aria-label="Working">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          <form
            className="ai-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            {images.length > 0 && (
              <div className="ai-thumbs ai-pending">
                {images.map((src, j) => (
                  <button key={j} type="button" aria-label="Remove attached image" onClick={() => setImages(images.filter((_, k) => k !== j))}>
                    <img src={src} alt="" />
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              placeholder={hasKey ? `Ask ${providerLabel(settings.provider)} to design, edit or explain…` : `Connect ${providerLabel(settings.provider)} in settings to start`}
              aria-label="Message the assistant"
              onPaste={onPaste}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                e.stopPropagation(); // app shortcuts stay out of the composer
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
            />
            <div className="ai-bar">
              <label className="ai-check ai-small" title="Send a small snapshot of the canvas with each message">
                <input type="checkbox" checked={settings.seeCanvas} onChange={(e) => setSettings({ ...settings, seeCanvas: e.target.checked })} />
                <span>See canvas</span>
              </label>
              <span className="ai-model" title="Model (change in settings)">
                {modelOf(settings)}
              </span>
              {entries.length > 0 && !busy && (
                <button type="button" className="ai-btn ai-ghost" onClick={clear} aria-label="New conversation">
                  New chat
                </button>
              )}
              {busy ? (
                <button type="button" className="ai-send ai-stop" aria-label="Stop" title="Stop" onClick={() => abortRef.current?.abort()}>
                  <Stop />
                </button>
              ) : (
                <button type="submit" className="ai-send" aria-label="Send" title="Send (Enter)" disabled={!draft.trim() && !images.length}>
                  <Send />
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </aside>
  );
}
