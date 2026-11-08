/**
 * The assistant's tool loop, provider-neutral. Shared copy — keep identical in all three apps.
 * An app hands in its tools (AppTool) and a system prompt; the loop asks the model, runs the
 * tool calls it makes (one at a time: they change the document), feeds the results back and
 * repeats until the model answers in plain text or the step cap is hit.
 */
import { chat, AiError } from './providers';
import type { AiSettings, ToolSpec, ToolCall, ToolOutcome, Turn, Reply } from './providers';

export interface ToolReturn {
  text: string;
  image?: string;
}

export interface AppTool extends ToolSpec {
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolReturn | string> | ToolReturn | string;
}

export interface ToolContext {
  settings: AiSettings;
  signal: AbortSignal;
}

export interface AppAdapter {
  /** Visible app name, e.g. "Skill Vector". */
  app: string;
  /** What the app is and how to work in it; the tool list is added automatically. */
  system: string;
  tools: () => AppTool[];
  /** Short live state summary sent with every message (document, selection, tool…). */
  context: () => string;
  /** Downscaled JPEG of what the user sees, or null when there is nothing to show. */
  snapshot: () => Promise<string | null> | string | null;
  /** One-click prompts shown on an empty conversation. */
  starters: { label: string; prompt: string }[];
  /** A marker of the undo history now, and a way back to it (returns how many steps were undone). */
  checkpoint?: () => unknown;
  revertTo?: (mark: unknown) => number;
}

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'reply'; reply: Reply }
  | { type: 'tool-start'; call: ToolCall }
  | { type: 'tool-end'; call: ToolCall; outcome: ToolOutcome };

export const MAX_STEPS = 16;

const clip = (s: string, n = 6000) => (s.length > n ? s.slice(0, n) + `… (${s.length - n} more characters)` : s);

export function systemPrompt(a: AppAdapter): string {
  return `You are the built-in assistant of ${a.app}, a professional creative app in the Skill Suite. You work directly in the user's open project through tools.

${a.system}

How to work:
- Look before you act: read the document state (and the snapshot when one is attached) before changing things. Use ids from tool results, never guess them.
- Do the work with tools instead of describing steps for the user, unless they only asked a question. Prefer the app's precise tools; fall back to list_commands / run_command for anything else the app's menus can do.
- Every change is a normal undoable step. After a multi-step edit, check the result (snapshot or state) and fix what is off.
- Design with taste: clear hierarchy, consistent spacing on an 8 px rhythm, limited palettes with real contrast (WCAG AA for text), well-paired fonts.
- If something cannot be done with the tools, say so plainly. Never claim a change you did not make.
- Keep replies short: one or two sentences on what you did and anything the user should check. Use plain text, no markdown headings.`;
}

/**
 * Runs one user message to completion. Mutates `turns` (appends assistant / tool turns) and
 * reports progress through `on`. Throws AiError on provider failures; AbortError on cancel.
 */
export async function runAgent(adapter: AppAdapter, settings: AiSettings, turns: Turn[], signal: AbortSignal, on: (e: AgentEvent) => void): Promise<void> {
  const tools = adapter.tools();
  const specs: ToolSpec[] = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const system = systemPrompt(adapter);
  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const reply = await chat({ settings, system, turns, tools: specs, signal, onText: (delta) => on({ type: 'text', delta }) });
    turns.push({ role: 'assistant', text: reply.text, calls: reply.calls, provider: settings.provider, raw: reply.raw });
    on({ type: 'reply', reply });
    if (!reply.calls.length) return;
    const results: ToolOutcome[] = [];
    for (const call of reply.calls) {
      if (signal.aborted) {
        results.push({ id: call.id, name: call.name, text: 'Cancelled by the user.', isError: true });
        continue;
      }
      on({ type: 'tool-start', call });
      const tool = tools.find((t) => t.name === call.name);
      let outcome: ToolOutcome;
      if (!tool) outcome = { id: call.id, name: call.name, text: `Unknown tool "${call.name}".`, isError: true };
      else if ('__invalid_json' in call.args) outcome = { id: call.id, name: call.name, text: 'The arguments were not valid JSON; send them again.', isError: true };
      else {
        try {
          const r = await tool.run(call.args, { settings, signal });
          const ret = typeof r === 'string' ? { text: r } : r;
          outcome = { id: call.id, name: call.name, text: clip(ret.text), image: ret.image };
        } catch (e) {
          if ((e as Error).name === 'AbortError') throw e;
          outcome = { id: call.id, name: call.name, text: e instanceof Error ? e.message : String(e), isError: true };
        }
      }
      results.push(outcome);
      on({ type: 'tool-end', call, outcome });
    }
    turns.push({ role: 'tool', results });
  }
  throw new AiError(`Stopped after ${MAX_STEPS} steps — ask again to continue.`, 'server');
}

/** Shared tool helpers for the command registry every app has. */
export interface CommandLike {
  id: string;
  label: string;
  menu?: string;
  submenu?: string;
  keys?: string;
  enabled?: () => boolean;
  run: () => unknown;
}

export function commandTools(list: () => CommandLike[], skip: (c: CommandLike) => boolean = () => false): AppTool[] {
  const usable = () => list().filter((c) => !skip(c));
  return [
    {
      name: 'list_commands',
      description: 'Search the app menu commands (every menu item and many panel actions). Returns id, menu path and whether it can run now. Use before run_command.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words to match in the label or menu, e.g. "align center" or "export". Empty lists everything.' } }, required: ['query'] },
      run: ({ query }) => {
        const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const hits = usable().filter((c) => {
          const hay = `${c.id} ${c.label} ${c.menu ?? ''} ${c.submenu ?? ''}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        });
        if (!hits.length) return 'No matching commands.';
        return hits
          .slice(0, 80)
          .map((c) => `${c.id} — ${[c.menu, c.submenu, c.label].filter(Boolean).join(' ▸ ')}${c.enabled && !c.enabled() ? ' (unavailable now)' : ''}`)
          .join('\n');
      },
    },
    {
      name: 'run_command',
      description: 'Run one menu command by id (from list_commands). Commands that open a dialog leave it open for the user.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: async ({ id }) => {
        const c = usable().find((x) => x.id === id);
        if (!c) throw new Error(`No command "${id}". Use list_commands to find one.`);
        if (c.enabled && !c.enabled()) throw new Error(`"${c.label}" can't run right now (needs a document, a selection or similar).`);
        await c.run();
        return `Ran "${c.label}".`;
      },
    },
  ];
}

/** Downscales a canvas to a JPEG data URL (long side ≤ max) for the model to look at. */
export function canvasToJpeg(src: HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement | ImageBitmap, w: number, h: number, max = 1024, bg = '#ffffff'): string {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src as CanvasImageSource, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
