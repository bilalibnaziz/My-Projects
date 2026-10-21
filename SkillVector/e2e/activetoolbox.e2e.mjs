// Canva-style corner blocks (drag left / right, click to type), the Active Toolbox strip (family of the
// active tool, recent tools, hover card, click switches) and the tool settings that every tool family
// shows in Properties / the options bar. Real pointer and keyboard input.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 300) : '');
};
const rect = (sel) => b.eval(`
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getBoundingClientRect().width > 0);
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, w: r.width };
`);
const shape = () => b.eval(`const l = window.__ps.store.activeLayer; return l?.shape && { radius: l.shape.radius, radii: l.shape.radii }`);
const tool = () => b.eval(`return window.__ps.store.state.tool`);

await b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(900, 600, 'white', 'Toolbox');
  store.setOpts({ shapeFill: true, shapeStrokeWidth: 0, shapeRadius: 0, shapeExtras: {}, activeToolbox: true });
  store.setDockTab('properties');
  store.setTool('shape-rect');
`);
await sleep(300);
const g = await b.eval(`const r=document.querySelector('.viewport-canvas').getBoundingClientRect();const v=window.__ps.store.doc.view;return {l:r.left+v.panX,t:r.top+v.panY,z:v.zoom}`);
const S = (x, y) => ({ x: g.l + x * g.z, y: g.t + y * g.z });
await b.drag([S(100, 100), S(250, 200), S(400, 300)]);
await sleep(200);

// ---- corner blocks
let r = await rect('.corner-blocks .corner-2');
check('four corner blocks around the preview', (await b.eval(`return document.querySelectorAll('.corner-blocks .scrub-block').length`)) === 4);
await b.drag([{ x: r.l + 10, y: r.y }, { x: r.l + 20, y: r.y }, { x: r.l + 35, y: r.y }, { x: r.l + 40, y: r.y }]);
await sleep(150);
let sh = await shape();
check('dragging the bottom-right block right rounds only that corner (30)', sh.radii && sh.radii[2] === 30 && sh.radii[0] === 0, sh);
r = await rect('.corner-blocks .corner-2');
await b.drag([{ x: r.l + 40, y: r.y }, { x: r.l + 30, y: r.y }, { x: r.l + 25, y: r.y }]);
await sleep(150);
sh = await shape();
check('dragging back left lowers it (15)', sh.radii[2] === 15, sh.radii);
r = await rect('.corner-blocks .corner-0');
await b.click(r.x, r.y);
await sleep(100);
await b.eval(`const i = document.querySelector('.corner-blocks .corner-0 input'); i.value = '24'; i.dispatchEvent(new Event('input', { bubbles: true }));`);
await b.key('Enter', { code: 'Enter', vk: 13 });
await sleep(150);
sh = await shape();
check('click a block to type a value (24)', sh.radii[0] === 24, sh.radii);
r = await rect('.scrub-block.all-corners');
await b.drag([{ x: r.l + 20, y: r.y }, { x: r.l + 30, y: r.y }, { x: r.l + 70, y: r.y }]);
await sleep(150);
sh = await shape();
check('the All block sets all four corners alike', !sh.radii && sh.radius > 0, sh);
const px = await b.eval(`
  const { renderDocument } = await import('/src/core/render.ts');
  const d = window.__ps.store.doc; const t = document.createElement('canvas'); t.width = d.width; t.height = d.height;
  renderDocument(d, t); return Array.from(t.getContext('2d').getImageData(101, 101, 1, 1).data);
`);
check('canvas corner is rounded', px[0] > 240 && px[1] > 240, px);

// ---- Active Toolbox
check('Active Toolbox shows the shape family', (await b.eval(`return [...document.querySelectorAll('.active-toolbox .atb-tool')].map((e) => e.getAttribute('aria-label')).join('|')`)).includes('Star'));
r = await rect('.active-toolbox .atb-tool[aria-label^="Star"]');
await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
await sleep(150);
const card = await b.eval(`return document.querySelector('.atb-card')?.innerText ?? ''`);
check('hover card names the tool with its gestures', card.includes('Star') && card.includes('Inner dot'), card.slice(0, 120));
await b.click(r.x, r.y);
await sleep(100);
check('clicking a toolbox tool switches to it', (await tool()) === 'shape-star');
await b.eval(`window.__ps.store.setTool('pencil')`);
await sleep(100);
const strip = await b.eval(`return [...document.querySelectorAll('.active-toolbox .atb-tool')].map((e) => e.getAttribute('aria-label').split(' (')[0])`);
check('pencil family + recent tools', strip.includes('Pencil Tool') && strip.some((x) => /Smooth/.test(x)) && strip.some((x) => /Star/.test(x)), strip);
await b.eval(`window.__ps.store.setOpts({ activeToolbox: false })`);
await sleep(100);
check('Window ▸ Active Toolbox hides it', !(await b.eval(`return !!document.querySelector('.active-toolbox')`)));
await b.eval(`window.__ps.store.setOpts({ activeToolbox: true })`);

// ---- every type tool has font settings; tools that had nothing now have their own
for (const t of ['area-type', 'vertical-type', 'path-type', 'touch-type']) {
  await b.eval(`window.__ps.store.setTool('${t}'); window.__ps.store.setDockTab('properties')`);
  await sleep(80);
  const bar = await b.eval(`return document.querySelector('.options-bar').innerText`);
  const cardTxt = await b.eval(`return document.querySelector('.tool-card')?.innerText ?? ''`);
  check(`${t}: font controls in the bar and the tool card`, /Size/.test(bar) && /Font size/i.test(cardTxt), { bar: bar.slice(0, 60) });
}
const expects = { smooth: /Brush size/i, mesh: /Point colour/i, zoom: /Fit/, hand: /100%/, slice: /Create (Slice )?from Selection/i, join: /Join/i, 'graph-column': /Data/ };
for (const [t, re] of Object.entries(expects)) {
  await b.eval(`window.__ps.store.setTool('${t}'); window.__ps.store.setDockTab('properties')`);
  await sleep(80);
  const txt = await b.eval(`return document.querySelector('.tool-card')?.innerText ?? ''`);
  check(`${t}: has its own settings`, re.test(txt), txt.slice(0, 100));
}
await b.eval(`window.__ps.store.setTool('zoom'); window.__ps.store.setDockTab('properties')`);
await sleep(80);
const z0 = await b.eval(`return window.__ps.store.doc.view.zoom`);
r = await rect('.tool-card .preset-chip[title="Actual Size (100%)"]');
await b.click(r.x, r.y);
await sleep(150);
check('Zoom tool card: 100% button works', Math.abs((await b.eval(`return window.__ps.store.doc.view.zoom`)) - 1) < 1e-6 && z0 !== 1, z0);

// ---- Live knobs in the strip
const knob = (id) => rect(`.active-toolbox .atb-knob[data-knob="${id}"]`);
const dragUp = async (k, dy) => b.drag([{ x: k.x, y: k.y }, { x: k.x, y: k.y - dy / 3 }, { x: k.x, y: k.y - dy }]);
await b.eval(`window.__ps.store.setTool('pencil'); window.__ps.store.setOpts({ pencilFidelity: 4, shapeStrokeWidth: 2 })`);
await sleep(100);
let k = await knob('fidelity');
check('pencil shows Stroke / Fidelity / StreamLine knobs', !!k && !!(await knob('stroke')) && !!(await knob('streamline')));
await dragUp(k, 12);
await sleep(100);
check('dragging the Fidelity knob up raises it', (await b.eval(`return window.__ps.store.state.opts.pencilFidelity`)) > 4, await b.eval(`return window.__ps.store.state.opts.pencilFidelity`));
// Rectangle tool with a rectangle selected: the Rad knob edits it live
await b.eval(`window.__ps.store.setTool('shape-rect'); window.__ps.store.setOpts({ shapeRadius: 0, shapeExtras: {} })`);
await b.drag([S(500, 150), S(600, 250), S(750, 400)]);
await sleep(150);
k = await knob('radius');
await dragUp(k, 40);
await sleep(120);
let lr = await b.eval(`return window.__ps.store.activeLayer.shape.radius`);
check('Rad knob rounds the selected rectangle live (≈20)', lr >= 18 && lr <= 22, lr);
k = await knob('stroke');
await dragUp(k, 10);
await sleep(120);
check('Stroke knob sets the selected shape’s stroke', (await b.eval(`return window.__ps.store.activeLayer.shape.strokeWidth`)) > 0);
// Double-click a knob to type
k = await knob('radius');
await b.click(k.x, k.y);
await b.click(k.x, k.y, { clickCount: 2 });
await sleep(100);
await b.eval(`const i = document.querySelector('.atb-knob-input'); i.value = '33'; i.dispatchEvent(new Event('input', { bubbles: true }));`);
await b.key('Enter', { code: 'Enter', vk: 13 });
await sleep(120);
lr = await b.eval(`return window.__ps.store.activeLayer.shape.radius`);
check('double-click a knob to type a value (33)', lr === 33, lr);
await b.eval(`window.__ps.store.setTool('shape-star')`);
await sleep(80);
check('star shows Points / Inner / Round knobs', !!(await knob('sides')) && !!(await knob('inner')) && !!(await knob('round')));
await b.eval(`window.__ps.store.setTool('text')`);
await sleep(80);
check('type tools show a Font size knob', !!(await knob('font')));

const exc = b.logs.filter((l) => l.startsWith('[exception]'));
check('no exceptions', !exc.length, exc);
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
