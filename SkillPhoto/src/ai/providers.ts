/**
 * AI connectors: Claude (Anthropic SDK), ChatGPT (OpenAI REST) and Gemini (Google REST).
 * Shared copy — keep identical in SkillVector/src/ai, SkillPhoto/src/ai and SkillMotion/src/fx/ai.
 *
 * Keys are the user's own, kept in this device's localStorage and sent only to the provider.
 * Every provider is driven through one neutral transcript (agent.ts), so the assistant can switch
 * provider mid-conversation; each provider's raw reply is kept so thinking blocks / thought
 * signatures go back unchanged on the next turn.
 */
import Anthropic from '@anthropic-ai/sdk';

export type ProviderId = 'claude' | 'openai' | 'gemini';

export const PROVIDERS: { id: ProviderId; label: string; keyHint: string; keyUrl: string; defaultModel: string; suggested: string[] }[] = [
  { id: 'claude', label: 'Claude', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys', defaultModel: 'claude-opus-5-5', suggested: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'] },
  { id: 'openai', label: 'ChatGPT', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys', defaultModel: 'gpt-5', suggested: ['gpt-5', 'gpt-5-mini'] },
  { id: 'gemini', label: 'Gemini', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey', defaultModel: 'gemini-pro-latest', suggested: ['gemini-pro-latest', 'gemini-flash-latest'] },
];

export type Effort = 'low' | 'medium' | 'high';

export interface AiSettings {
  provider: ProviderId;
  keys: Partial<Record<ProviderId, string>>;
  models: Partial<Record<ProviderId, string>>;
  /** Reasoning depth (Claude effort / OpenAI reasoning_effort / Gemini thinking level). */
  effort: Effort;
  /** Attach a snapshot of the canvas / monitor to each message so the model can see the work. */
  seeCanvas: boolean;
  /** Image generation: which provider makes pixels ('auto' = first of OpenAI / Gemini with a key). */
  imageProvider: 'auto' | 'openai' | 'gemini';
  imageModels: { openai: string; gemini: string };
}

const KEY = 'skill.ai.settings';
export const DEFAULT_SETTINGS: AiSettings = {
  provider: 'claude',
  keys: {},
  models: {},
  effort: 'medium',
  seeCanvas: true,
  imageProvider: 'auto',
  imageModels: { openai: 'gpt-image-1', gemini: 'gemini-2.5-flash-image' },
};

export function loadSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...s, keys: { ...s.keys }, models: { ...s.models }, imageModels: { ...DEFAULT_SETTINGS.imageModels, ...s.imageModels } };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AiSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage blocked: settings last for this session only
  }
}

export const modelOf = (s: AiSettings, p: ProviderId = s.provider) => s.models[p]?.trim() || PROVIDERS.find((x) => x.id === p)!.defaultModel;
export const providerLabel = (p: ProviderId) => PROVIDERS.find((x) => x.id === p)!.label;

// ------------------------------------------------------------------ neutral transcript

/** JSON Schema for a tool's arguments (type: 'object'). */
export type JsonSchema = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolOutcome {
  id: string;
  name: string;
  text: string;
  /** JPEG/PNG data URL the tool wants the model to see. */
  image?: string;
  isError?: boolean;
}

export type Turn =
  | { role: 'user'; text: string; images?: string[] }
  | { role: 'assistant'; text: string; calls: ToolCall[]; provider: ProviderId; raw?: unknown }
  | { role: 'tool'; results: ToolOutcome[] };

export interface Reply {
  text: string;
  calls: ToolCall[];
  raw: unknown;
  /** 'refusal' when the provider declined; 'length' when it ran out of room. */
  stop: 'done' | 'tools' | 'refusal' | 'length';
  model: string;
}

export interface ChatRequest {
  settings: AiSettings;
  system: string;
  turns: Turn[];
  tools: ToolSpec[];
  signal?: AbortSignal;
  /** Streamed reply text as it arrives (all providers stream). */
  onText?: (delta: string) => void;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate' | 'network' | 'bad-request' | 'server' | 'no-key' = 'server',
  ) {
    super(message);
  }
}

const splitDataUrl = (url: string) => {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url);
  return m ? { mime: m[1], data: m[2] } : { mime: 'image/png', data: url };
};

let idSeq = 0;
const newId = (p: string) => `${p}_${Date.now().toString(36)}${(idSeq++).toString(36)}`;

function keyFor(s: AiSettings, p: ProviderId): string {
  const k = s.keys[p]?.trim();
  if (!k) throw new AiError(`Add your ${providerLabel(p)} API key in AI settings.`, 'no-key');
  return k;
}

async function httpError(res: Response, who: string): Promise<AiError> {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message ?? j?.message ?? '';
  } catch {
    // body not JSON
  }
  const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate' : res.status >= 500 ? 'server' : 'bad-request';
  const lead = kind === 'auth' ? `${who} rejected the API key.` : kind === 'rate' ? `${who} rate limit or quota reached.` : `${who} error ${res.status}.`;
  return new AiError(detail ? `${lead} ${detail}` : lead, kind);
}

/** Server-sent events: yields each event's `data:` payload. */
async function* sseData(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) yield data;
    }
    if (done) {
      const rest = buf
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (rest) yield rest;
      return;
    }
  }
}

// ------------------------------------------------------------------ Claude

function claudeClient(s: AiSettings) {
  return new Anthropic({ apiKey: keyFor(s, 'claude'), dangerouslyAllowBrowser: true, maxRetries: 2 });
}

function claudeMessages(turns: Turn[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of turns) {
    if (t.role === 'user') {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      for (const im of t.images ?? []) {
        const { mime, data } = splitDataUrl(im);
        content.push({ type: 'image', source: { type: 'base64', media_type: mime as 'image/png', data } });
      }
      content.push({ type: 'text', text: t.text || '(see image)' });
      out.push({ role: 'user', content });
    } else if (t.role === 'assistant') {
      if (t.provider === 'claude' && t.raw) {
        // The provider's own blocks, unchanged (thinking blocks must round-trip as sent)
        out.push({ role: 'assistant', content: t.raw as Anthropic.Beta.BetaContentBlockParam[] });
      } else {
        const content: Anthropic.Beta.BetaContentBlockParam[] = [];
        if (t.text) content.push({ type: 'text', text: t.text });
        for (const c of t.calls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
        if (!content.length) content.push({ type: 'text', text: '…' });
        out.push({ role: 'assistant', content });
      }
    } else {
      out.push({
        role: 'user',
        content: t.results.map((r) => {
          const parts: Anthropic.Beta.BetaToolResultBlockParam['content'] = [{ type: 'text', text: r.text || 'ok' }];
          if (r.image) {
            const { mime, data } = splitDataUrl(r.image);
            (parts as unknown[]).push({ type: 'image', source: { type: 'base64', media_type: mime, data } });
          }
          return { type: 'tool_result' as const, tool_use_id: r.id, content: parts, is_error: r.isError || undefined };
        }),
      });
    }
  }
  return out;
}

async function chatClaude(req: ChatRequest): Promise<Reply> {
  const s = req.settings;
  const model = modelOf(s, 'claude');
  const client = claudeClient(s);
  try {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 16000,
        system: req.system,
        messages: claudeMessages(req.turns),
        // Tool inputs stream as they are generated; validated below before anything runs
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema, eager_input_streaming: true })),
        thinking: { type: 'adaptive' },
        output_config: { effort: s.effort },
        // Server-side fallback: if a safety classifier declines, the API retries on a suitable model
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        cache_control: { type: 'ephemeral' },
      },
      { signal: req.signal },
    );
    if (req.onText) stream.on('text', (d) => req.onText!(d));
    const res = await stream.finalMessage();
    const calls: ToolCall[] = [];
    let text = '';
    for (const b of res.content) {
      if (b.type === 'text') text += b.text;
      else if (b.type === 'tool_use') {
        const input = b.input;
        // A streamed input that isn't a JSON object (cut off / invalid) is sent back as an error, not run
        calls.push({ id: b.id, name: b.name, args: input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : { __invalid_json: String(input) } });
      }
    }
    const stop = res.stop_reason === 'refusal' ? 'refusal' : res.stop_reason === 'max_tokens' ? 'length' : calls.length ? 'tools' : 'done';
    if (stop === 'refusal' && !text) text = 'Claude declined this request.';
    // A reply cut off by max_tokens may hold half-written tool inputs: run nothing
    return { text, calls: stop === 'tools' ? calls : [], raw: res.content, stop, model: res.model };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError('Claude rejected the API key.', 'auth');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('Claude rate limit reached — try again in a moment.', 'rate');
    if (e instanceof Anthropic.BadRequestError) throw new AiError(`Claude: ${e.message}`, 'bad-request');
    if (e instanceof Anthropic.APIConnectionError) throw new AiError('Could not reach Claude (offline?).', 'network');
    if (e instanceof Anthropic.APIError) throw new AiError(`Claude: ${e.message}`, 'server');
    throw e;
  }
}

// ------------------------------------------------------------------ OpenAI (ChatGPT)

type OaMsg = Record<string, unknown>;

function openaiMessages(system: string, turns: Turn[]): OaMsg[] {
  const out: OaMsg[] = [{ role: 'system', content: system }];
  for (const t of turns) {
    if (t.role === 'user') {
      const content: unknown[] = [{ type: 'text', text: t.text || '(see image)' }];
      for (const im of t.images ?? []) content.push({ type: 'image_url', image_url: { url: im } });
      out.push({ role: 'user', content });
    } else if (t.role === 'assistant') {
      const m: OaMsg = { role: 'assistant', content: t.text || null };
      if (t.calls.length) m.tool_calls = t.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
      out.push(m);
    } else {
      for (const r of t.results) out.push({ role: 'tool', tool_call_id: r.id, content: (r.isError ? 'ERROR: ' : '') + (r.text || 'ok') });
      // Tool messages carry text only: images a tool returned follow as a user message
      const imgs = t.results.filter((r) => r.image);
      if (imgs.length) out.push({ role: 'user', content: [{ type: 'text', text: `Image(s) returned by ${imgs.map((r) => r.name).join(', ')}:` }, ...imgs.map((r) => ({ type: 'image_url', image_url: { url: r.image } }))] });
    }
  }
  return out;
}

async function chatOpenAI(req: ChatRequest): Promise<Reply> {
  const s = req.settings;
  const model = modelOf(s, 'openai');
  const body: Record<string, unknown> = {
    model,
    messages: openaiMessages(req.system, req.turns),
    tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
    max_completion_tokens: 16000,
    stream: true,
  };
  if (/^(gpt-5|o\d)/.test(model)) body.reasoning_effort = s.effort;
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyFor(s, 'openai')}` },
      body: JSON.stringify(body),
      signal: req.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError' || e instanceof AiError) throw e;
    throw new AiError('Could not reach ChatGPT (offline?).', 'network');
  }
  if (!res.ok) throw await httpError(res, 'ChatGPT');
  let text = '';
  let refusal = '';
  let finish = '';
  let modelId = model;
  const parts = new Map<number, { id: string; name: string; args: string }>();
  for await (const data of sseData(res)) {
    if (data === '[DONE]') break;
    let j: { model?: string; choices?: { delta?: { content?: string; refusal?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[] };
    try {
      j = JSON.parse(data);
    } catch {
      continue;
    }
    if (j.model) modelId = j.model;
    const ch = j.choices?.[0];
    if (!ch) continue;
    const d = ch.delta ?? {};
    if (d.content) {
      text += d.content;
      req.onText?.(d.content);
    }
    if (d.refusal) refusal += d.refusal;
    for (const tc of d.tool_calls ?? []) {
      const cur = parts.get(tc.index) ?? { id: '', name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      parts.set(tc.index, cur);
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  }
  const calls: ToolCall[] = [...parts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => {
      let args: Record<string, unknown>;
      try {
        const v = JSON.parse(c.args || '{}');
        args = v && typeof v === 'object' && !Array.isArray(v) ? v : { __invalid_json: c.args };
      } catch {
        args = { __invalid_json: c.args };
      }
      return { id: c.id || newId('oa'), name: c.name, args };
    });
  const stop = refusal ? 'refusal' : finish === 'length' ? 'length' : calls.length ? 'tools' : 'done';
  const raw = { role: 'assistant', content: text || null, tool_calls: calls.length ? calls : undefined };
  return { text: refusal || text, calls: stop === 'tools' ? calls : [], raw, stop, model: modelId };
}

// ------------------------------------------------------------------ Gemini

type GPart = Record<string, unknown>;

function geminiContents(turns: Turn[]): { role: string; parts: GPart[] }[] {
  const out: { role: string; parts: GPart[] }[] = [];
  for (const t of turns) {
    if (t.role === 'user') {
      const parts: GPart[] = (t.images ?? []).map((im) => {
        const { mime, data } = splitDataUrl(im);
        return { inlineData: { mimeType: mime, data } };
      });
      parts.push({ text: t.text || '(see image)' });
      out.push({ role: 'user', parts });
    } else if (t.role === 'assistant') {
      if (t.provider === 'gemini' && t.raw) out.push({ role: 'model', parts: t.raw as GPart[] });
      else {
        const parts: GPart[] = [];
        if (t.text) parts.push({ text: t.text });
        for (const c of t.calls) parts.push({ functionCall: { name: c.name, args: c.args } });
        out.push({ role: 'model', parts: parts.length ? parts : [{ text: '…' }] });
      }
    } else {
      const parts: GPart[] = t.results.map((r) => ({ functionResponse: { name: r.name, response: r.isError ? { error: r.text } : { result: r.text || 'ok' } } }));
      for (const r of t.results) {
        if (!r.image) continue;
        const { mime, data } = splitDataUrl(r.image);
        parts.push({ inlineData: { mimeType: mime, data } });
      }
      out.push({ role: 'user', parts });
    }
  }
  return out;
}

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

async function chatGemini(req: ChatRequest): Promise<Reply> {
  const s = req.settings;
  const model = modelOf(s, 'gemini').replace(/^models\//, '');
  const body = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: geminiContents(req.turns),
    tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }],
    generationConfig: { maxOutputTokens: 16000 },
  };
  let res: Response;
  try {
    res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keyFor(s, 'gemini') },
      body: JSON.stringify(body),
      signal: req.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError' || e instanceof AiError) throw e;
    throw new AiError('Could not reach Gemini (offline?).', 'network');
  }
  if (!res.ok) throw await httpError(res, 'Gemini');
  // Each event is a partial response; the parts are kept in order (thought signatures included) for replay
  const parts: GPart[] = [];
  let text = '';
  let finish = '';
  let blockReason = '';
  let modelId = model;
  for await (const data of sseData(res)) {
    let j: { candidates?: { content?: { parts?: GPart[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string }; modelVersion?: string };
    try {
      j = JSON.parse(data);
    } catch {
      continue;
    }
    if (j.modelVersion) modelId = j.modelVersion;
    if (j.promptFeedback?.blockReason) blockReason = j.promptFeedback.blockReason;
    const cand = j.candidates?.[0];
    if (cand?.finishReason) finish = cand.finishReason;
    for (const p of cand?.content?.parts ?? []) {
      parts.push(p);
      if (typeof p.text === 'string' && !p.thought && p.text) {
        text += p.text;
        req.onText?.(p.text);
      }
    }
  }
  const calls: ToolCall[] = [];
  for (const p of parts) {
    const fc = p.functionCall as { name: string; args?: Record<string, unknown>; id?: string } | undefined;
    if (fc) calls.push({ id: fc.id ?? newId('gem'), name: fc.name, args: fc.args ?? {} });
  }
  const blocked = !!blockReason || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT';
  if (blocked && !text) text = 'Gemini declined this request.';
  const stop = blocked ? 'refusal' : finish === 'MAX_TOKENS' ? 'length' : calls.length ? 'tools' : 'done';
  return { text, calls: stop === 'tools' ? calls : [], raw: parts, stop, model: modelId };
}

// ------------------------------------------------------------------ entry points

export function chat(req: ChatRequest): Promise<Reply> {
  switch (req.settings.provider) {
    case 'claude':
      return chatClaude(req);
    case 'openai':
      return chatOpenAI(req);
    case 'gemini':
      return chatGemini(req);
  }
}

/** Live model list from the provider, newest-looking first. */
export async function listModels(s: AiSettings, p: ProviderId): Promise<string[]> {
  if (p === 'claude') {
    const ids: string[] = [];
    for await (const m of claudeClient(s).models.list()) ids.push(m.id);
    return ids;
  }
  if (p === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${keyFor(s, 'openai')}` } });
    if (!res.ok) throw await httpError(res, 'ChatGPT');
    const j = await res.json();
    return (j.data as { id: string; created: number }[])
      .filter((m) => /^(gpt-|o\d|chatgpt)/.test(m.id) && !/(audio|realtime|tts|transcribe|search|image|embedding)/.test(m.id))
      .sort((a, b) => b.created - a.created)
      .map((m) => m.id);
  }
  const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': keyFor(s, 'gemini') } });
  if (!res.ok) throw await httpError(res, 'Gemini');
  const j = await res.json();
  return (j.models as { name: string; supportedGenerationMethods?: string[] }[])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/.test(m.name) && !/(image|tts|embedding|audio)/.test(m.name))
    .map((m) => m.name.replace(/^models\//, ''))
    .reverse();
}

/** Quick key check: lists models with the key. */
export async function testKey(s: AiSettings, p: ProviderId): Promise<string> {
  const ids = await listModels(s, p);
  return `${providerLabel(p)} connected — ${ids.length} models available.`;
}

// ------------------------------------------------------------------ image generation

export function imageProviderOf(s: AiSettings): 'openai' | 'gemini' | null {
  if (s.imageProvider !== 'auto') return s.keys[s.imageProvider]?.trim() ? s.imageProvider : null;
  if (s.keys.openai?.trim()) return 'openai';
  if (s.keys.gemini?.trim()) return 'gemini';
  return null;
}

export interface ImageRequest {
  prompt: string;
  /** Source image to edit (data URL). Without it a new image is generated. */
  image?: string;
  /** PNG data URL, same size as image: transparent where the image may change (OpenAI). */
  mask?: string;
  size?: { width: number; height: number };
  transparent?: boolean;
  signal?: AbortSignal;
}

const dataUrlToBlob = (url: string) => {
  const { mime, data } = splitDataUrl(url);
  const bin = atob(data);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: mime });
};

/** Generates or edits an image with OpenAI or Gemini. Returns a data URL. */
export async function generateImage(s: AiSettings, r: ImageRequest): Promise<string> {
  const p = imageProviderOf(s);
  if (!p) throw new AiError('Image generation needs a ChatGPT (OpenAI) or Gemini key in AI settings — Claude does not make images.', 'no-key');
  if (p === 'openai') {
    const ar = r.size ? r.size.width / r.size.height : 1;
    const size = ar > 1.2 ? '1536x1024' : ar < 0.83 ? '1024x1536' : '1024x1024';
    let res: Response;
    const auth = { Authorization: `Bearer ${keyFor(s, 'openai')}` };
    try {
      if (r.image) {
        const fd = new FormData();
        fd.append('model', s.imageModels.openai);
        fd.append('prompt', r.prompt);
        fd.append('size', size);
        fd.append('image', dataUrlToBlob(r.image), 'image.png');
        if (r.mask) fd.append('mask', dataUrlToBlob(r.mask), 'mask.png');
        if (r.transparent) fd.append('background', 'transparent');
        res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: auth, body: fd, signal: r.signal });
      } else {
        res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: s.imageModels.openai, prompt: r.prompt, size, n: 1, ...(r.transparent ? { background: 'transparent' } : {}) }),
          signal: r.signal,
        });
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError' || e instanceof AiError) throw e;
      throw new AiError('Could not reach OpenAI images (offline?).', 'network');
    }
    if (!res.ok) throw await httpError(res, 'OpenAI images');
    const j = await res.json();
    const b64 = j.data?.[0]?.b64_json;
    if (b64) return `data:image/png;base64,${b64}`;
    if (j.data?.[0]?.url) return j.data[0].url;
    throw new AiError('OpenAI returned no image.', 'server');
  }
  const parts: GPart[] = [];
  if (r.image) {
    const { mime, data } = splitDataUrl(r.image);
    parts.push({ inlineData: { mimeType: mime, data } });
  }
  const shape = r.size ? ` Aspect ratio about ${r.size.width}:${r.size.height}.` : '';
  parts.push({ text: (r.image ? `Edit this image: ${r.prompt}. Keep everything else unchanged.` : r.prompt) + shape + (r.transparent ? ' Plain flat background.' : '') });
  let res: Response;
  try {
    res = await fetch(`${GEMINI}/models/${encodeURIComponent(s.imageModels.gemini)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keyFor(s, 'gemini') },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }),
      signal: r.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError' || e instanceof AiError) throw e;
    throw new AiError('Could not reach Gemini images (offline?).', 'network');
  }
  if (!res.ok) throw await httpError(res, 'Gemini images');
  const j = await res.json();
  for (const part of (j.candidates?.[0]?.content?.parts ?? []) as { inlineData?: { mimeType: string; data: string } }[]) {
    if (part.inlineData?.data) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
  }
  throw new AiError('Gemini returned no image (it may have declined the prompt).', 'server');
}

// ------------------------------------------------------------------ speech to text

export interface Segment {
  start: number;
  end: number;
  text: string;
}

/** Transcribes speech with OpenAI (timed segments). Needs an OpenAI key. */
export async function transcribe(s: AiSettings, audio: Blob, opts: { language?: string; prompt?: string; signal?: AbortSignal } = {}): Promise<Segment[]> {
  const fd = new FormData();
  fd.append('model', 'whisper-1');
  fd.append('file', audio, 'audio.wav');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'segment');
  if (opts.language) fd.append('language', opts.language);
  if (opts.prompt) fd.append('prompt', opts.prompt);
  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${keyFor(s, 'openai')}` }, body: fd, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError' || e instanceof AiError) throw e;
    throw new AiError('Could not reach OpenAI transcription (offline?).', 'network');
  }
  if (!res.ok) throw await httpError(res, 'OpenAI transcription');
  const j = await res.json();
  return ((j.segments ?? []) as { start: number; end: number; text: string }[]).map((x) => ({ start: x.start, end: x.end, text: x.text.trim() })).filter((x) => x.text);
}
