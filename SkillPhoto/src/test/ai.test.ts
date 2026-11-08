import { describe, it, expect, vi, afterEach } from 'vitest';
import { chat, DEFAULT_SETTINGS } from '../ai/providers';
import type { AiSettings, Turn } from '../ai/providers';
import { runAgent, commandTools } from '../ai/agent';
import type { AppAdapter } from '../ai/agent';

const settings = (p: AiSettings['provider']): AiSettings => ({ ...DEFAULT_SETTINGS, provider: p, keys: { claude: 'k', openai: 'k', gemini: 'k' } });
const tool = { name: 'paint', description: 'paint', parameters: { type: 'object', properties: { color: { type: 'string' } } } };

afterEach(() => vi.unstubAllGlobals());

/** A server-sent-events body, split into small chunks so events straddle reads. */
function sse(events: unknown[], done = false): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '');
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** OpenAI streaming chunks for a full message (content and tool calls split into pieces). */
function oaChunks(m: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }, finish: string, model = 'gpt-x') {
  const out: unknown[] = [];
  const text = m.content ?? '';
  for (let i = 0; i < text.length; i += 4) out.push({ model, choices: [{ delta: { content: text.slice(i, i + 4) } }] });
  (m.tool_calls ?? []).forEach((tc, index) => {
    out.push({ model, choices: [{ delta: { tool_calls: [{ index, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: '' } }] } }] });
    const a = tc.function.arguments;
    for (let i = 0; i < a.length; i += 5) out.push({ model, choices: [{ delta: { tool_calls: [{ index, function: { arguments: a.slice(i, i + 5) } }] } }] });
  });
  out.push({ model, choices: [{ delta: {}, finish_reason: finish }] });
  return out;
}

/** Replies: OpenAI-style { choices:[{finish_reason, message}] } become an OpenAI stream; { candidates } a Gemini stream. */
function stubFetch(replies: unknown[]) {
  const bodies: Record<string, unknown>[] = [];
  const f = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const r = replies.shift() as { choices?: { finish_reason: string; message: Parameters<typeof oaChunks>[0] }[]; model?: string; candidates?: unknown };
    if (r.choices) return sse(oaChunks(r.choices[0].message, r.choices[0].finish_reason, r.model), true);
    return sse([r]);
  });
  vi.stubGlobal('fetch', f);
  return { f, bodies };
}

describe('AI connectors', () => {
  it('ChatGPT: tools, tool calls and tool results in Chat Completions shape', async () => {
    const { f, bodies } = stubFetch([{ model: 'gpt-x', choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'paint', arguments: '{"color":"red"}' } }] } }] }]);
    const turns: Turn[] = [{ role: 'user', text: 'hi', images: ['data:image/jpeg;base64,AAAA'] }];
    const r = await chat({ settings: settings('openai'), system: 'sys', turns, tools: [tool] });
    expect(f.mock.calls[0][0]).toContain('api.openai.com/v1/chat/completions');
    expect((bodies[0] as { stream: boolean }).stream).toBe(true);
    expect(r.calls).toEqual([{ id: 'c1', name: 'paint', args: { color: 'red' } }]);
    expect(r.stop).toBe('tools');
    const b = bodies[0] as { messages: { role: string; content: unknown }[]; tools: { function: { name: string } }[] };
    expect(b.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(JSON.stringify(b.messages[1].content)).toContain('image_url');
    expect(b.tools[0].function.name).toBe('paint');
  });

  it('ChatGPT: tool results become tool messages, images follow as a user message', async () => {
    const { bodies } = stubFetch([{ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] }]);
    const turns: Turn[] = [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'paint', args: {} }], provider: 'openai' },
      { role: 'tool', results: [{ id: 'c1', name: 'paint', text: 'ok', image: 'data:image/png;base64,BBBB' }] },
    ];
    const streamed: string[] = [];
    const r = await chat({ settings: settings('openai'), system: 's', turns, tools: [tool], onText: (d) => streamed.push(d) });
    expect(r.text).toBe('done');
    expect(streamed.join('')).toBe('done');
    const msgs = (bodies[0] as { messages: { role: string; tool_call_id?: string }[] }).messages;
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
    expect(msgs[3].tool_call_id).toBe('c1');
  });

  it('Gemini: function calls round-trip with their raw parts (thought signatures kept)', async () => {
    const parts = [{ functionCall: { name: 'paint', args: { color: 'blue' } }, thoughtSignature: 'SIG' }];
    const { f, bodies } = stubFetch([{ candidates: [{ finishReason: 'STOP', content: { parts } }] }, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }] }]);
    const turns: Turn[] = [{ role: 'user', text: 'hi' }];
    const r = await chat({ settings: settings('gemini'), system: 's', turns, tools: [tool] });
    expect(f.mock.calls[0][0]).toContain(':streamGenerateContent?alt=sse');
    expect(r.calls[0].name).toBe('paint');
    turns.push({ role: 'assistant', text: r.text, calls: r.calls, provider: 'gemini', raw: r.raw });
    turns.push({ role: 'tool', results: [{ id: r.calls[0].id, name: 'paint', text: 'painted' }] });
    await chat({ settings: settings('gemini'), system: 's', turns, tools: [tool] });
    const contents = (bodies[1] as { contents: { role: string; parts: Record<string, unknown>[] }[] }).contents;
    expect(contents[1]).toEqual({ role: 'model', parts });
    expect(contents[2].parts[0]).toEqual({ functionResponse: { name: 'paint', response: { result: 'painted' } } });
    expect((bodies[0] as { tools: { functionDeclarations: { parametersJsonSchema: unknown }[] }[] }).tools[0].functionDeclarations[0].parametersJsonSchema).toEqual(tool.parameters);
  });

  it('reports a missing key without calling the network', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(chat({ settings: { ...DEFAULT_SETTINGS, provider: 'openai' }, system: '', turns: [], tools: [] })).rejects.toThrow(/API key/);
    expect(f).not.toHaveBeenCalled();
  });

  it('maps HTTP 401 to a clear auth error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })));
    await expect(chat({ settings: settings('openai'), system: '', turns: [{ role: 'user', text: 'x' }], tools: [] })).rejects.toThrow(/rejected the API key/);
  });
});

describe('streaming', () => {
  it('ChatGPT: long multi-chunk tool arguments reassemble; text streams in order', async () => {
    const args = JSON.stringify({ color: 'x'.repeat(300) });
    stubFetch([{ choices: [{ finish_reason: 'tool_calls', message: { content: 'Painting now…', tool_calls: [{ id: 'p', function: { name: 'paint', arguments: args } }] } }] }]);
    const deltas: string[] = [];
    const r = await chat({ settings: settings('openai'), system: '', turns: [{ role: 'user', text: 'go' }], tools: [tool], onText: (d) => deltas.push(d) });
    expect(r.calls[0].args).toEqual({ color: 'x'.repeat(300) });
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe('Painting now…');
  });

  it('ChatGPT: a reply cut off by the length limit runs no tools', async () => {
    stubFetch([{ choices: [{ finish_reason: 'length', message: { content: null, tool_calls: [{ id: 'p', function: { name: 'paint', arguments: '{"color":"re' } }] } }] }]);
    const r = await chat({ settings: settings('openai'), system: '', turns: [{ role: 'user', text: 'go' }], tools: [tool] });
    expect(r.stop).toBe('length');
    expect(r.calls).toEqual([]);
  });

  it('Gemini: text parts across events stream and join; finish reason from the last event', async () => {
    const res = sse([
      { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'lo' }] } }] },
      { candidates: [{ content: { parts: [{ text: '!' }] }, finishReason: 'STOP' }], modelVersion: 'gemini-x' },
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => res));
    const deltas: string[] = [];
    const r = await chat({ settings: settings('gemini'), system: '', turns: [{ role: 'user', text: 'hi' }], tools: [], onText: (d) => deltas.push(d) });
    expect(deltas).toEqual(['Hel', 'lo', '!']);
    expect(r).toMatchObject({ text: 'Hello!', stop: 'done', model: 'gemini-x' });
  });
});

describe('agent loop', () => {
  it('runs tool calls, returns results and stops on a plain answer', async () => {
    stubFetch([
      { choices: [{ finish_reason: 'tool_calls', message: { content: 'working', tool_calls: [{ id: 'a', type: 'function', function: { name: 'paint', arguments: '{"color":"red"}' } }, { id: 'b', type: 'function', function: { name: 'nope', arguments: '{}' } }] } }] },
      { choices: [{ finish_reason: 'stop', message: { content: 'Painted it red.' } }] },
    ]);
    const painted: unknown[] = [];
    const adapter: AppAdapter = { app: 'Test', system: '', context: () => '', snapshot: () => null, starters: [], tools: () => [{ ...tool, run: (a) => (painted.push(a.color), 'ok') }] };
    const turns: Turn[] = [{ role: 'user', text: 'paint' }];
    const events: string[] = [];
    await runAgent(adapter, settings('openai'), turns, new AbortController().signal, (e) => events.push(e.type));
    expect(painted).toEqual(['red']);
    const toolTurn = turns.find((t) => t.role === 'tool');
    expect(toolTurn && toolTurn.role === 'tool' && toolTurn.results.map((r) => !!r.isError)).toEqual([false, true]);
    expect(turns.at(-1)).toMatchObject({ role: 'assistant', text: 'Painted it red.' });
    expect(events.filter((e) => e !== 'text')).toEqual(['reply', 'tool-start', 'tool-end', 'tool-start', 'tool-end', 'reply']);
    expect(events[0]).toBe('text');
  });

  it('command tools search and run menu commands, refusing disabled ones', async () => {
    let ran = 0;
    const cmds = [
      { id: 'align-center', label: 'Align Center', menu: 'Object', run: () => ran++ },
      { id: 'export', label: 'Export As…', menu: 'File', enabled: () => false, run: () => ran++ },
    ];
    const [list, run] = commandTools(() => cmds);
    const ctx = { settings: DEFAULT_SETTINGS, signal: new AbortController().signal };
    expect(await list.run({ query: 'align' }, ctx)).toContain('align-center');
    expect(await run.run({ id: 'align-center' }, ctx)).toContain('Align Center');
    await expect(Promise.resolve().then(() => run.run({ id: 'export' }, ctx))).rejects.toThrow(/can't run/);
    expect(ran).toBe(1);
  });
});
