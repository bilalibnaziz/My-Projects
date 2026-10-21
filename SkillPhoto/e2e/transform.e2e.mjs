// Free Transform: Distort and Perspective modes from the options bar, ⌘-drag distort, the
// corner box following the quad, Apply / Cancel.
import { connect, sleep, META, CTRL } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const MOD = process.platform === 'darwin' ? META : CTRL;
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 300) : '');
};
const st = (expr) => b.eval(`const { store, ops } = window.__ps; return (${expr})`);
const geo = () => b.eval(`const { store } = window.__ps; const r = document.querySelector('.viewport-canvas').getBoundingClientRect(); const v = store.doc.view; return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
const docPx = (x, y) => st(`Array.from(store.renderer.render(store.doc, store.overrides).getContext('2d').getImageData(${x}, ${y}, 1, 1).data)`);
const clickText = async (selector, text) => {
  const p = await b.eval(`const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  if (p) await b.click(p.x, p.y);
  await sleep(100);
  return !!p;
};
const setup = async () => {
  await b.eval(`const { store, ops } = window.__ps; store.set({ dialog: null }); while (store.state.docs.length) store.closeDoc(store.state.docs[0].id); ops.newDocument(400, 300, 'white', 'Warp', undefined);
    const c = document.createElement('canvas'); c.width = 100; c.height = 100; const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 100, 100);
    store.newRasterLayer('Red', { canvas: c, x: 150, y: 100 });`);
  await sleep(150);
};
const drag = async (from, to) => {
  const g = await geo();
  const a = S(g, from[0], from[1]);
  const z = S(g, to[0], to[1]);
  await b.drag([a, { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 }, z]);
  await sleep(120);
};

// 1. Distort: drag the bottom-right corner out; Enter applies
{
  await setup();
  await b.key('t', { modifiers: MOD });
  await sleep(150);
  const modes = await b.eval(`return [...document.querySelectorAll('.transform-modes button')].map(b => b.textContent)`);
  await clickText('.transform-modes button', 'Distort');
  await drag([250, 200], [300, 260]);
  const quad = await st(`store.state.transform?.quad?.map(p => [Math.round(p.x), Math.round(p.y)])`);
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(150);
  const stretched = await docPx(285, 245);
  const corner = await docPx(152, 102);
  const outside = await docPx(290, 150);
  check('Distort mode moves one corner freely and Apply keeps the warp', modes.join() === 'Scale,Skew,Distort,Perspective,Warp' && quad?.[2].join() === '300,260' && stretched.join() === '255,0,0,255' && corner.join() === '255,0,0,255' && outside.join() === '255,255,255,255', { modes, quad, stretched, corner, outside });
}

// 2. Perspective: pulling the top-right corner in pulls the top-left corner in too (keystone)
{
  await setup();
  await b.key('t', { modifiers: MOD });
  await sleep(150);
  await clickText('.transform-modes button', 'Perspective');
  await drag([250, 100], [220, 100]);
  const quad = await st(`store.state.transform?.quad?.map(p => [Math.round(p.x), Math.round(p.y)])`);
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(150);
  const topLeft = await docPx(160, 102);
  const bottomLeft = await docPx(152, 197);
  const topMid = await docPx(200, 102);
  check('Perspective narrows the top edge symmetrically', quad?.[0].join() === '180,100' && quad?.[1].join() === '220,100' && topLeft.join() === '255,255,255,255' && bottomLeft.join() === '255,0,0,255' && topMid.join() === '255,0,0,255', { quad, topLeft, bottomLeft, topMid });
}

// 3. ⌘-drag a corner distorts in the default Scale mode; Esc cancels everything
{
  await setup();
  await b.key('t', { modifiers: MOD });
  await sleep(150);
  const g = await geo();
  const a = S(g, 150, 100);
  const z = S(g, 120, 60);
  await b.drag([a, { x: (a.x + z.x) / 2, y: (a.y + z.y) / 2 }, z], { modifiers: MOD });
  await sleep(120);
  const quad = await st(`store.state.transform?.quad?.map(p => [Math.round(p.x), Math.round(p.y)])`);
  const reset = await b.eval(`return !![...document.querySelectorAll('.options-bar button')].find(b => b.textContent.includes('Reset Corners'))`);
  await b.key('Escape', { code: 'Escape', vk: 27 });
  await sleep(150);
  const after = await st(`({ t: !!store.state.transform, x: store.activeLayer.x, w: store.activeLayer.canvas.width })`);
  const px = await docPx(130, 70);
  check('⌘-drag corner distorts; Esc cancels back to the original', quad?.[0].join() === '120,60' && reset && !after.t && after.x === 150 && after.w === 100 && px.join() === '255,255,255,255', { quad, reset, after, px });
}

// 4. Skew: dragging the top edge sideways slants the layer
{
  await setup();
  await b.key('t', { modifiers: MOD });
  await sleep(150);
  await clickText('.transform-modes button', 'Skew');
  await drag([200, 100], [240, 110]);
  const quad = await st(`store.state.transform?.quad?.map(p => [Math.round(p.x), Math.round(p.y)])`);
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(150);
  const shifted = await docPx(285, 103);
  const leftTop = await docPx(155, 103);
  check('Skew slides the top edge along itself', quad?.[0].join() === '190,100' && quad?.[1].join() === '290,100' && shifted.join() === '255,0,0,255' && leftTop.join() === '255,255,255,255', { quad, shifted, leftTop });
}

// 5. Warp: pull the top-middle control points up — the top edge bulges above the original box
{
  await setup();
  await b.key('t', { modifiers: MOD });
  await sleep(150);
  await clickText('.transform-modes button', 'Warp');
  const mesh = await st(`store.state.transform?.mesh?.length`);
  // Points 1 and 2 sit on the top edge at x ≈ 183 and 217
  await drag([183, 100], [183, 60]);
  await drag([217, 100], [217, 60]);
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(200);
  const above = await docPx(200, 80);
  const corner = await docPx(152, 102);
  const outside = await docPx(200, 50);
  check('Warp bends the layer with its 4×4 grid', mesh === 16 && above.join() === '255,0,0,255' && corner.join() === '255,0,0,255' && outside.join() === '255,255,255,255', { mesh, above, corner, outside });
}

// 6. A group transforms as one: both layers scale around the group's centre and stay separate
{
  await setup();
  const r = await b.eval(`
    const { store, ops } = window.__ps;
    const c = document.createElement('canvas'); c.width = 100; c.height = 100; c.getContext('2d').fillStyle = '#0000ff'; c.getContext('2d').fillRect(0, 0, 100, 100);
    const blue = store.newRasterLayer('Blue', { canvas: c, x: 250, y: 100 });
    store.setSelectedLayers(store.doc.layers.filter(l => l.name === 'Red' || l.name === 'Blue').map(l => l.id));
    ops.groupSelected();
    ops.beginTransform();
    const t = store.state.transform;
    const box = [t.sx, t.sy, t.source.width, t.source.height];
    store.state.transform = { ...t, scaleX: 0.5, scaleY: 0.5 };
    ops.updateTransformPreview();
    ops.commitTransform();
    const L = (n) => { const l = store.doc.layers.find(l => l.name === n); return [Math.round(l.x), Math.round(l.y), l.canvas.width, l.canvas.height]; };
    return { box, red: L('Red'), blue: L('Blue'), kinds: store.doc.layers.map(l => l.kind).join() };
  `);
  await sleep(100);
  check('a group transforms as a whole and keeps its layers', r.box.join() === '150,100,200,100' && r.red.join() === '200,125,50,50' && r.blue.join() === '250,125,50,50' && r.kinds === 'raster,raster,raster,group', r);
}

if (process.env.SHOT) {
  await setup();
  await b.key('t', { modifiers: MOD });
  await sleep(150);
  await clickText('.transform-modes button', 'Perspective');
  await drag([250, 100], [225, 100]);
  await sleep(200);
  await b.shot(process.env.SHOT);
}

const errors = b.logs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]'));
check('no console errors', errors.length === 0, errors);
b.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
