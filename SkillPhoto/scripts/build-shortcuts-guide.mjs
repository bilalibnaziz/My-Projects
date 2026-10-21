#!/usr/bin/env node
/**
 * Builds Skill-Photo-Shortcuts-Guide.pdf (project root + public/) from the live app.
 *
 * Starts Vite and a headless Chrome, loads the real command table, tool list, filters and
 * presets from the running code, and prints a two-platform guide. Because the data comes
 * from the app itself, the PDF can't drift out of date — rerun after changing shortcuts.
 *
 * Usage: npm run docs:shortcuts        (needs Google Chrome / Chromium; set CHROME_PATH otherwise)
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CDP_PORT = 9347;

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => p && existsSync(p));
if (!chromePath) {
  console.error('Chrome/Chromium not found. Set CHROME_PATH to a Chromium-based browser.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const work = mkdtempSync(join(tmpdir(), 'photoscale-guide-'));
const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const appUrl = server.resolvedUrls.local[0];
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(work, 'profile')}`, 'about:blank',
], { stdio: 'ignore' });

try {
  // ---------------------------------------------------------------- connect
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find((t) => t.type === 'page');
    } catch {
      await sleep(100);
    }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      pending.set(++seq, { res, rej });
      ws.send(JSON.stringify({ id: seq, method, params }));
    });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  // ---------------------------------------------------------------- read the app's own tables
  await send('Page.enable');
  await send('Page.navigate', { url: appUrl });
  for (let i = 0; i < 150; i++) {
    if (await evaluate('return !!window.__ps').catch(() => false)) break;
    await sleep(100);
  }
  const data = await evaluate(`
    const c = await import('/src/core/commands.ts');
    const { FILTERS } = await import('/src/core/filters.ts');
    const { ADJUST_PRESETS } = await import('/src/core/ops.ts');
    const { TOOL_INFO } = await import('/src/ui/ToolRail.tsx');
    return {
      menus: c.MENU_ORDER,
      commands: c.COMMANDS.map((x) => ({ label: x.label, menu: x.menu, mac: c.formatKeys(x.keys, true), win: c.formatKeys(x.keys, false) })),
      extraMac: c.extraShortcuts(true),
      extraWin: c.extraShortcuts(false),
      tools: TOOL_INFO,
      filters: FILTERS.map((f) => ({ name: f.name, group: f.group })),
      presets: ADJUST_PRESETS.map((p) => p.name),
    };
  `);

  // ---------------------------------------------------------------- render
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const kbd = (s) => (s ? `<kbd>${esc(s)}</kbd>` : '<span class="none">—</span>');
  const table = (title, rows) => `
    <section class="card"><h3>${esc(title)}</h3><table>
      <thead><tr><th>Action</th><th>macOS</th><th>Windows / Linux</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${kbd(r[1])}</td><td>${kbd(r[2])}</td></tr>`).join('')}</tbody>
    </table></section>`;

  const menuTables = data.menus
    .map((menu) => {
      const rows = data.commands.filter((x) => x.menu === menu && x.mac).map((x) => [x.label.replace(/…$/, ''), x.mac, x.win]);
      return rows.length ? table(`${menu} menu`, rows) : '';
    })
    .filter(Boolean);
  // Grouped tools share a key; Shift+key cycles to the others
  const toolRows = data.tools.map((t) => {
    const first = data.tools.find((o) => o.key === t.key);
    const cycled = first.id !== t.id;
    return [t.label, cycled ? `⇧${t.key}` : t.key, cycled ? `Shift+${t.key}` : t.key];
  });
  // The "all tool letters" row is redundant next to the full tools table
  const extraRows = data.extraMac.map(([k, label], i) => [label, k, data.extraWin[i][0]]).filter((r) => !r[0].startsWith('Tools'));
  const filterGroups = [...new Set(data.filters.map((f) => f.group))]
    .map((g) => `<b>${esc(g)}:</b> ${data.filters.filter((f) => f.group === g).map((f) => esc(f.name)).join(', ')}`)
    .join('<br>');
  const toolList = data.tools.map((t) => `<li><b>${esc(t.label)}</b> (${esc(t.key)}) — ${esc(t.hint)}</li>`).join('');
  const today = new Date().toISOString().slice(0, 10);

  // Balance the menu tables over two columns by row count
  const weights = menuTables.map((h) => (h.match(/<tr>/g) || []).length + 3);
  const total = weights.reduce((a, b) => a + b, 0);
  let split = menuTables.length;
  for (let i = 0, acc = 0; i < weights.length; i++) {
    acc += weights[i];
    if (acc >= total / 2) {
      split = i + 1;
      break;
    }
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Skill Photo Shortcuts &amp; Guide</title><style>
    @page { size: A4; margin: 13mm 12mm 14mm; }
    * { box-sizing: border-box; }
    body { font: 9.5px/1.45 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1d1d1f; margin: 0; }
    header { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #ff6b00; padding-bottom: 9px; margin-bottom: 12px; }
    .logo { width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg,#ff6b00,#ff9900); }
    h1 { font-size: 19px; margin: 0; } .sub { color: #666; }
    h2 { font-size: 12px; margin: 14px 0 6px; color: #d65a00; text-transform: uppercase; letter-spacing: .04em; }
    h3 { font-size: 10.5px; margin: 0 0 4px; }
    p { margin: 0 0 6px; } ul { margin: 0; padding-left: 15px; } li { margin-bottom: 2px; break-inside: avoid; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
    .card { border: 1px solid #e3e3e6; border-radius: 6px; padding: 6px 8px; break-inside: avoid; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 8px; color: #777; text-transform: uppercase; border-bottom: 1px solid #e3e3e6; padding: 2px 3px; }
    td { padding: 1.5px 3px; border-bottom: 1px solid #f2f2f4; vertical-align: top; }
    td:first-child { width: 46%; } tr:last-child td { border-bottom: 0; }
    kbd { display: inline-block; font: 600 8.5px/1 ui-monospace, Menlo, Consolas, monospace; background: #f4f4f6; border: 1px solid #d6d6db;
          border-bottom-width: 2px; border-radius: 3px; padding: 1.5px 4px; white-space: nowrap; }
    .none { color: #bbb; }
    .tip { background: #fff5ec; border-left: 3px solid #ff6b00; padding: 6px 9px; border-radius: 3px; margin: 6px 0; }
    .page-break { break-before: page; }
    footer { margin-top: 8px; color: #999; font-size: 8px; text-align: center; }
  </style></head><body>
  <header><div class="logo"></div><div>
    <h1>Skill Photo — Shortcuts &amp; Guide</h1>
    <div class="sub">Generated ${today} from the app's own command table · macOS and Windows / Linux</div>
  </div></header>

  <h2>What Skill Photo is</h2>
  <p>A non-destructive, layer-based photo editor for desktop (Tauri) and the browser. Everything runs locally on your machine:
  adjustments render on the GPU (WebGL2), and object removal uses a content-aware fill (multi-scale PatchMatch) that runs in a
  background thread. Projects save as <b>.photoscale</b> files with every layer, mask and adjustment intact; unsaved work is
  autosaved for crash recovery every 45 seconds.</p>

  <div class="cols">
    <section class="card"><h3>Workflow essentials</h3><ul>
      <li><b>Open</b> images with ${kbd('⌘O')}, drag-and-drop, or paste (${kbd('⌘V')}). Shift-drop places files as layers.</li>
      <li><b>Adjust</b> — every adjustment goes on its own maskable adjustment layer. Presets: ${data.presets.map(esc).join(', ')}.</li>
      <li><b>Auto Enhance</b> analyses the photo and builds a tuned adjustment layer you can keep editing.</li>
      <li><b>Remove objects</b> — paint over them with the Spot Healing Brush, or select and press ${kbd('⇧⌫')}.</li>
      <li><b>Masks</b> — paint black to hide, white to reveal; ${kbd('Q')} toggles mask editing.</li>
      <li><b>Run anything</b> from the command palette, ${kbd('⌘K')}.</li>
    </ul></section>
    <section class="card"><h3>Filters (live preview, respect selections)</h3><p>${filterGroups}</p>
      <h3 style="margin-top:6px">Adjustment panel</h3><p>Light, Color, Presence &amp; Effects, Curves, Levels, Color Mixer (HSL), Color Grading.</p>
    </section>
  </div>

  <div class="tip"><b>Pointer precision:</b> paint lands exactly under the pointer. Brush <b>Smoothing</b> (options bar) adds a
  stabilizer: paint follows the pointer on a string of that length, drawn on screen, and every stroke still ends exactly where
  you release. Pen pressure controls size (and optionally opacity). Zoom with ${kbd('⌘+')} / ${kbd('⌘−')}, pinch, or ⌘-scroll;
  the point under the cursor stays put. ${kbd('⌘0')} fits, ${kbd('⌘1')} is 100%, hold ${kbd('Space')} to pan with any tool.
  Moving a layer snaps its edges and centre to the canvas and to other layers, with guides on screen; hold ⌘ to move freely.
  On Windows / Linux use Ctrl where macOS uses ⌘.</div>

  <h2>Tools</h2>
  <section class="card"><ul style="columns: 2; column-gap: 18px">${toolList}</ul></section>

  <div class="page-break"></div>
  <h2>Keyboard shortcuts — menus</h2>
  <div class="cols"><div>${menuTables.slice(0, split).join('')}</div><div>${menuTables.slice(split).join('')}</div></div>

  <div class="page-break"></div>
  <h2>Keyboard shortcuts — tools, brush &amp; pointer</h2>
  <div class="cols"><div>${table('Tools', toolRows)}</div><div>${table('Brush, color & pointer', extraRows)}</div></div>

  <footer>Regenerate with <b>npm run docs:shortcuts</b> · keys come from src/core/commands.ts and src/ui/ToolRail.tsx</footer>
  </body></html>`;

  const htmlPath = join(work, 'guide.html');
  writeFileSync(htmlPath, html);
  await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
  await sleep(600);
  const pdf = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
  const out = join(root, 'Skill-Photo-Shortcuts-Guide.pdf');
  writeFileSync(out, Buffer.from(pdf.data, 'base64'));
  copyFileSync(out, join(root, 'public', 'Skill-Photo-Shortcuts-Guide.pdf'));
  if (process.argv.includes('--keep-html')) copyFileSync(htmlPath, join(root, 'Skill-Photo-Shortcuts-Guide.html'));
  ws.close();
  console.log(`Wrote ${out} (${data.commands.filter((c) => c.mac).length} command shortcuts, ${data.tools.length} tools) and a public/ copy`);
} finally {
  chrome.kill();
  await server.close();
  await sleep(300);
  rmSync(work, { recursive: true, force: true });
}
