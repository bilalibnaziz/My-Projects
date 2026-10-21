// Every menu command, run on a realistic document (two overlapping shapes selected, a text layer, a
// pixel layer). A command fails when it throws, logs an error, or leaves a document that can't render.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  if (!ok || process.env.VERBOSE) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
// No real downloads or pickers
await b.eval(`
  window.__dl = 0;
  HTMLAnchorElement.prototype.click = function () { window.__dl++; };
  window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined;
  HTMLInputElement.prototype.click = function () {};
  window.print = () => {};
  window.confirm = () => true; window.prompt = () => null; window.alert = () => {};
  return true;`);
const SKIP = new Set(['new', 'open', 'close', 'close-all', 'quit', 'new-from-clipboard', 'place', 'import', 'reload', 'about']);
const ids = await b.eval(`const c = await import('/src/core/commands.ts'); return c.COMMANDS.map((x) => x.id)`);
const setup = () => b.eval(`
  const { store, ops } = window.__ps;
  const { makeLayer, withLayer } = await import('/src/core/types.ts');
  const { syncTextBounds } = await import('/src/core/render.ts');
  store.set({ dialog: null, paletteOpen: false, transform: null, crop: null });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(800, 600, 'white', 'Cmd');
  const A = makeLayer({ kind: 'shape', name: 'A', x: 100, y: 100, width: 300, height: 200, shape: { shape: 'rectangle', fill: '#e33333', stroke: '#000000', strokeWidth: 4, fillEnabled: true, radius: 0 } });
  const B = makeLayer({ kind: 'shape', name: 'B', x: 250, y: 180, width: 250, height: 250, shape: { shape: 'ellipse', fill: '#3355ee', stroke: '#000000', strokeWidth: 2, fillEnabled: true, radius: 0 } });
  const t0 = makeLayer({ kind: 'text', name: 'T', x: 120, y: 450, text: { text: 'Skill', font: 'Arial', size: 60, weight: 700, italic: false, color: '#111111', align: 'left', lineHeight: 1.2, tracking: 0, shadow: false, stroke: 0, strokeColor: '#000' } });
  const T = withLayer(t0, syncTextBounds(t0));
  store.commit('Setup', { layers: [...store.doc.layers, A, B, T], activeId: B.id });
  store.doc.selectedIds = [A.id, B.id];
  store.emit();
  return true;`);
for (const id of ids) {
  if (SKIP.has(id)) continue;
  await setup();
  b.logs.length = 0;
  let err = null;
  const r = await b.eval(`
    const c = await import('/src/core/commands.ts');
    const cmd = c.COMMANDS.find((x) => x.id === ${JSON.stringify(id)});
    const { store } = window.__ps;
    if (cmd.enabled && !cmd.enabled()) return { skipped: true };
    try { await cmd.run(); } catch (e) { return { threw: String(e && e.stack || e).slice(0, 300) }; }
    await new Promise((r) => setTimeout(r, 60));
    // Still renders?
    try {
      const { renderDocument } = await import('/src/core/render.ts');
      if (store.doc) { const t = document.createElement('canvas'); renderDocument(store.doc, t); }
    } catch (e) { return { renderFail: String(e).slice(0, 200) }; }
    const out = { dialog: store.state.dialog ?? null, layers: store.doc?.layers.length };
    store.set({ dialog: null, paletteOpen: false, transform: null });
    try { (await import('/src/core/tools.ts')).cancelCrop?.(); } catch {}
    return out;
  `).catch((e) => ({ evalErr: String(e.message).slice(0, 300) }));
  await sleep(40);
  const errors = b.logs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]'));
  if (r.threw || r.renderFail || r.evalErr) err = r;
  check(id, !err && errors.length === 0, err ?? (errors.length ? { errors: errors.slice(0, 3) } : r));
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} commands OK`);
if (failed.length) console.log('Failing: ' + failed.map((f) => f.name).join(', '));
b.close();
process.exit(failed.length ? 1 : 0);
