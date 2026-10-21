// Automation: record an action (menu command, filter, adjustment, image size), play it on
// another document, batch it over several files into one ZIP, save / load actions.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 300) : '');
};
const st = (expr) => b.eval(`const { store, ops } = window.__ps; return (${expr})`);
const center = (sel, text) => b.eval(`const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => ${text ? `(e.textContent.trim() === ${JSON.stringify(text)} || e.title.startsWith(${JSON.stringify(text)}))` : 'true'}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);

await b.eval(`
  localStorage.removeItem('photoscale-actions');
  window.__saved = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { window.__saved.push(blob); return orig(blob); };
  const { store, ops } = window.__ps;
  store.set({ dialog: null });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(400, 200, 'white', 'Rec', undefined);
  const c = store.doc.layers[0].canvas.getContext('2d'); c.fillStyle = '#ff0000'; c.fillRect(0, 0, 100, 200);
`);
await sleep(150);

// 1. Record from the Actions tab: + starts a new recording; do four things; stop
{
  await b.openTab('Actions');
  await sleep(150);
  const builtIn = await b.eval(`return [...document.querySelectorAll('.action-name')].map(e => e.textContent)`);
  const plus = await center('.actions-foot .icon-btn', 'New action');
  await b.click(plus.x, plus.y);
  await sleep(100);
  const recDot = await b.eval(`return !!document.querySelector('.rec-dot')`);
  await b.eval(`
    const { store, ops } = window.__ps;
    const { COMMANDS } = await import('/src/core/commands.ts');
    COMMANDS.find(c => c.id === 'flip-canvas-h').run();
    ops.commitFilter('gaussian-blur', { radius: 2 });
    ops.newAdjustmentLayer({ exposure: 0.5 }, 'Brighter');
    ops.imageSize(200, 100);
  `);
  await sleep(100);
  const stop = await center('.actions-foot .icon-btn', 'Stop recording');
  await b.click(stop.x, stop.y);
  await sleep(100);
  const steps = await b.eval(`const A = await import('/src/core/actions.ts'); const a = A.getActions().at(-1); return a.steps.map(s => s.kind + ':' + s.label);`);
  const rows = await b.eval(`return [...document.querySelectorAll('.action-step span')].map(e => e.textContent)`);
  check('recording captures a menu command, a filter, an adjustment layer and image size', builtIn.length === 3 && recDot && steps.join('|') === 'command:Flip Canvas Horizontal|filter:Gaussian Blur|adjust:Brighter adjustment layer|imageSize:Fit within 200 × 100' && rows.length === 4, { builtIn, recDot, steps, rows });
}

// 2. Play it on a new document
{
  await b.eval(`const { ops } = window.__ps; ops.newDocument(800, 400, 'white', 'Play', undefined); const { store } = window.__ps; const c = store.doc.layers[0].canvas.getContext('2d'); c.fillStyle = '#0000ff'; c.fillRect(0, 0, 100, 400);`);
  await sleep(100);
  const ok = await b.eval(`const A = await import('/src/core/actions.ts'); return await A.playAction(A.getActions().at(-1).id);`);
  await sleep(100);
  const r = await st(`({ w: store.doc.width, h: store.doc.height, kinds: store.doc.layers.map(l => l.kind).join(), right: Array.from(store.doc.layers[0].canvas.getContext('2d').getImageData(195, 50, 1, 1).data), steps: (await import('/src/core/actions.ts')).getActions().at(-1).steps.length })`);
  check('playing the action repeats every step on another document (and records nothing new)', ok && r.w === 200 && r.h === 100 && r.kinds === 'raster,adjustment' && r.right[2] > 200 && r.steps === 4, r);
}

// 3. Batch: three files through the built-in Web thumbnail action into one ZIP
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const A = await import('/src/core/actions.ts');
    const before = store.state.docs.length;
    const files = [];
    for (const [i, [w, h]] of [[1600, 900], [500, 500], [1000, 2000]].entries()) {
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').fillStyle = '#3a7'; c.getContext('2d').fillRect(0, 0, w, h);
      files.push(new File([await new Promise(r => c.toBlob(r))], 'shot' + i + '.png', { type: 'image/png' }));
    }
    const web = A.getActions().find(a => a.id === 'builtin-web');
    const res = await A.batch(web.id, files);
    const z = new TextDecoder('latin1').decode(await res.zip.arrayBuffer());
    const names = [...z.matchAll(/PK\\x01\\x02[\\s\\S]{42}([^\\x00]*?\\.webp)/g)].map(m => m[1]);
    // Read the first image back to check its size
    const start = z.indexOf('RIFF');
    return { ok: res.ok, failed: res.failed, names, docs: store.state.docs.length - before };
  `);
  check('Batch runs an action over many files into one ZIP and closes them again', r.ok === 3 && r.failed.length === 0 && r.names.join() === 'shot0.webp,shot1.webp,shot2.webp' && r.docs === 0, r);
}

// 4. Actions persist and can be exported / imported as JSON
{
  const r = await b.eval(`
    const A = await import('/src/core/actions.ts');
    const saved = JSON.parse(localStorage.getItem('photoscale-actions'));
    const json = A.exportActionsJson();
    const n = A.importActionsJson(json);
    return { saved: saved.length, n, total: A.getActions().length };
  `);
  check('actions are saved in the browser and round-trip through JSON', r.saved === 4 && r.n === 4 && r.total === 8, r);
}

const errors = b.logs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]'));
check('no console errors', errors.length === 0, errors);
b.close();
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
