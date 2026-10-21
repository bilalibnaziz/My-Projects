// Minimal Chrome DevTools Protocol driver for the e2e suites: real Input.* events (mouse, pen,
// wheel, keys) sent through Chrome, plus page evaluation. Started by e2e/run.mjs.
import { writeFileSync } from 'node:fs';

const CDP = `http://127.0.0.1:${process.env.CDP_PORT ?? 9333}`;

export async function connect(url = process.env.APP_URL ?? 'http://localhost:5173/') {
  const targets = await (await fetch(`${CDP}/json`)).json();
  // Fresh tab per run: a stale tab may be stuck on a beforeunload prompt
  for (const t of targets.filter((t) => t.type === 'page')) await fetch(`${CDP}/json/close/` + t.id).catch(() => {});
  const page = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      // beforeunload / alert prompts would otherwise block navigation forever
      ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      logs.push('[exception] ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  const api = {
    send,
    logs,
    async nav(u = url) {
      await send('Page.navigate', { url: u });
      // Not readyState "complete": the load event also waits for the web-font stylesheet, which can hang
      await api.waitFor('document.readyState !== "loading" && !!window.__effectsScale && !!document.querySelector(".fx-monitor-canvas")', 30000);
    },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(cond, ms = 15000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const ok = await api.eval(`return !!(${cond})`).catch(() => false);
        if (ok) return true;
        await sleep(100);
      }
      throw new Error('timeout waiting for ' + cond);
    },
    mouse(type, x, y, opts = {}) {
      return send('Input.dispatchMouseEvent', {
        type, x, y,
        button: opts.button ?? (type === 'mouseMoved' && !opts.buttons ? 'none' : 'left'),
        buttons: opts.buttons ?? (type === 'mousePressed' ? 1 : 0),
        clickCount: opts.clickCount ?? 1,
        modifiers: opts.modifiers ?? 0,
        pointerType: opts.pointerType ?? 'mouse',
        force: opts.force,
        deltaX: opts.deltaX, deltaY: opts.deltaY,
      });
    },
    async drag(points, opts = {}) {
      const [p0, ...rest] = points;
      await api.mouse('mouseMoved', p0.x, p0.y);
      await api.mouse('mousePressed', p0.x, p0.y, opts);
      for (const p of rest) {
        await api.mouse('mouseMoved', p.x, p.y, { ...opts, buttons: 1, button: 'left', force: p.force ?? opts.force });
        if (opts.delay) await sleep(opts.delay);
      }
      const last = points[points.length - 1];
      await api.mouse('mouseReleased', last.x, last.y, { ...opts, buttons: 0 });
      await sleep(50);
    },
    async click(x, y, opts = {}) {
      await api.mouse('mouseMoved', x, y);
      await api.mouse('mousePressed', x, y, opts);
      await api.mouse('mouseReleased', x, y, { ...opts, buttons: 0 });
      await sleep(30);
    },
    async key(key, opts = {}) {
      const code = opts.code ?? (key.length === 1 ? (/[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : /\d/.test(key) ? 'Digit' + key : '') : key);
      const base = { key, code, modifiers: opts.modifiers ?? 0, windowsVirtualKeyCode: opts.vk ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0) };
      await send('Input.dispatchKeyEvent', { type: key.length === 1 && !(opts.modifiers & 6) ? 'keyDown' : 'rawKeyDown', text: key.length === 1 && !(opts.modifiers & 6) ? key : undefined, ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(30);
    },
    async shot(path) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
    },
    close() { ws.close(); },
  };
  return api;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// CDP modifier bits
export const ALT = 1, CTRL = 2, META = 4, SHIFT = 8;
