// Tool-by-tool audit of the pixel tools with real input: each tool gets a realistic action on a known
// test image and its RESULT is measured — colours, alpha, selection bounds, luminance, saturation.
import { connect, sleep, ALT } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 500) : '');
};
const geo = () => b.eval(`
  const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
  const v = window.__ps.store.doc.view;
  return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };
`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
/**
 * 400 × 300 doc, zoom 2, one "Paint" layer: left half red, right half blue, a black wall at x 196–203,
 * a white 20 px square at (60, 60), a grey ramp strip at y 250–270 (x 0..399 → 0..255).
 */
const setup = (opts = {}) => b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false, transform: null, fg: '#00ff00', bg: '#ffffff' });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(400, 300, 'white', 'Audit');
  store.newRasterLayer('Paint');
  const c = store.activeLayer.canvas; const x = c.getContext('2d');
  x.fillStyle = '#ff0000'; x.fillRect(0, 0, 200, 240);
  x.fillStyle = '#0000ff'; x.fillRect(200, 0, 200, 240);
  x.fillStyle = '#000000'; x.fillRect(196, 0, 8, 240);
  x.fillStyle = '#ffffff'; x.fillRect(60, 60, 20, 20);
  for (let i = 0; i < 400; i++) { const v = Math.round((i / 399) * 255); x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; x.fillRect(i, 250, 1, 20); }
  const { touch } = await import('/src/core/canvas.ts'); touch(c);
  store.setOpts({ size: 20, hardness: 1, opacity: 1, flow: 1, spacing: 0.1, smoothing: 0, pressureSize: false, pressureOpacity: false, tolerance: 32, contiguous: true, sampleAll: false, strength: 0.8, exposure: 0.8, ...${JSON.stringify(opts)} });
  store.invalidateRender();
  let cv = null;
  for (let i = 0; i < 50 && !cv; i++) { await new Promise((r) => setTimeout(r, 30)); cv = document.querySelector('.viewport-canvas'); }
  const v = store.doc.view; v.zoom = 2; v.panX = Math.round((cv.clientWidth - 800) / 2); v.panY = Math.round((cv.clientHeight - 600) / 2);
  store.emit();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
`);
const tool = async (t) => { await b.eval(`window.__ps.store.setTool(${JSON.stringify(t)}); return true`); await sleep(40); };
/** RGBA of the Paint layer at (x, y). */
const px = (x, y) => b.eval(`const l = window.__ps.store.doc.layers.find((l) => l.name === 'Paint'); return Array.from(l.canvas.getContext('2d').getImageData(${x} - l.x, ${y} - l.y, 1, 1).data)`);
const sel = () => b.eval(`const s = window.__ps.store.doc.selection; return s ? (s.bounds ?? { x: s.x, y: s.y, width: s.width, height: s.height }) : null`);
const drag = async (pts, opts = {}) => {
  const g = await geo();
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, c] = [pts[i], pts[i + 1]];
    for (let k = 0; k < 8; k++) out.push(S(g, a[0] + ((c[0] - a[0]) * k) / 8, a[1] + ((c[1] - a[1]) * k) / 8));
  }
  out.push(S(g, ...pts[pts.length - 1]));
  await b.drag(out, { delay: 4, ...opts });
  await sleep(120);
};
const click = async (x, y, opts) => { const g = await geo(); const p = S(g, x, y); await b.click(p.x, p.y, opts); await sleep(120); };
const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
const sat = (p) => (Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2])) / Math.max(1, Math.max(p[0], p[1], p[2]));
const close = (p, q, t = 12) => q.every((v, i) => Math.abs(p[i] - v) <= t);

// Painting
{
  await setup({ size: 1 });
  await tool('pencil');
  await drag([[20, 150], [120, 150]]);
  const on = await px(70, 150), off = await px(70, 152);
  check('pencil: hard 1 px line in the foreground colour, no soft edge', close(on, [0, 255, 0, 255], 2) && close(off, [255, 0, 0, 255], 2), { on, off });
}
{
  await setup({ size: 20 });
  await tool('eraser');
  await drag([[20, 150], [120, 150]]);
  const on = await px(70, 150), off = await px(70, 180);
  check('eraser: clears pixels to transparent under the stroke only', on[3] < 10 && off[3] === 255, { on, off });
}
{
  await setup({ tolerance: 32, contiguous: true });
  await tool('bucket');
  await click(100, 120);
  const inside = await px(30, 20), other = await px(300, 100), wall = await px(200, 100), hole = await px(70, 70);
  check('bucket: fills the clicked region with the foreground, stops at the wall, spares other colours', close(inside, [0, 255, 0, 255], 3) && close(other, [0, 0, 255, 255], 3) && close(wall, [0, 0, 0, 255], 3) && close(hole, [255, 255, 255, 255], 3), { inside, other, wall, hole });
}
{
  await setup({ gradientType: 'linear', gradientMode: 'fg-bg', gradientReverse: false });
  await b.eval(`window.__ps.store.set({ fg: '#000000', bg: '#ffffff' }); return true`);
  await tool('gradient');
  await drag([[0, 100], [399, 100]]);
  const l = await px(5, 100), m = await px(200, 100), r = await px(394, 100);
  check('gradient: black → white left to right across the drag', lum(l) < 20 && lum(r) > 235 && lum(m) > 100 && lum(m) < 155, { l, m, r });
}

// Selections
{
  await setup({ tolerance: 32, contiguous: true });
  await tool('wand');
  await click(300, 100);
  const s = await sel();
  check('magic wand: selects exactly the blue area (204..399 × 0..239)', s && s.x === 204 && s.y === 0 && s.width === 196 && s.height === 240, s);
}
{
  await setup();
  await tool('lasso');
  await drag([[50, 50], [150, 50], [150, 120], [50, 120], [50, 50]]);
  const s = await sel();
  check('lasso: selection bounds follow the drawn loop', s && Math.abs(s.x - 50) <= 1 && Math.abs(s.width - 100) <= 2 && Math.abs(s.height - 70) <= 2, s);
}
{
  await setup({ size: 10 });
  await tool('quick-select');
  await drag([[250, 50], [350, 150]]);
  const s = await sel();
  check('quick selection: grows to the whole blue area it was brushed over', s && s.x >= 200 && s.x <= 206 && s.width >= 180 && s.height >= 200, s);
}
{
  await setup();
  await tool('marquee-row');
  await click(100, 77);
  const s = await sel();
  check('single-row marquee: a 1 px row across the canvas', s && s.y === 77 && s.height === 1 && s.width === 400, s);
}

// Retouching
{
  await setup({ size: 30, cloneAligned: true });
  await tool('clone');
  await click(70, 70, { modifiers: ALT }); // source: the white square
  await drag([[300, 100], [301, 101]]);
  const p = await px(300, 100);
  check('clone stamp: ⌥-click a source, paint copies it (white over blue)', lum(p) > 200, { p });
}
{
  await setup({ size: 20 });
  // A dark blemish inside the red area
  await b.eval(`const l = window.__ps.store.doc.layers.find((l) => l.name === 'Paint'); const x = l.canvas.getContext('2d'); x.fillStyle = '#202020'; x.fillRect(100, 150, 4, 4); const { touch } = await import('/src/core/canvas.ts'); touch(l.canvas); window.__ps.store.invalidateRender(); return true`);
  await tool('heal');
  await click(102, 152);
  // Healing runs in a worker: wait for its history step
  for (let i = 0; i < 30 && !(await b.eval(`return window.__ps.store.doc.history.at(-1).label === 'Spot Healing'`)); i++) await sleep(50);
  const p = await px(102, 152);
  check('spot healing: the blemish takes the surrounding red', p[0] > 180 && p[1] < 70 && p[2] < 70, { p });
}
{
  await setup({ size: 20, strength: 0.9 });
  await tool('smudge');
  await drag([[180, 100], [230, 100]]);
  const p = await px(215, 100);
  check('smudge: drags red into the blue across the wall', p[0] > 60, { p });
}
{
  await setup({ size: 30, exposure: 0.8, dodgeRange: 'midtones' });
  await tool('dodge');
  const before = await px(128, 260);
  await drag([[110, 260], [150, 260]]);
  const after = await px(128, 260);
  check('dodge: lightens the grey ramp', lum(after) > lum(before) + 10, { before, after });
}
{
  await setup({ size: 30, exposure: 0.8, dodgeRange: 'midtones' });
  await tool('burn');
  const before = await px(128, 260);
  await drag([[110, 260], [150, 260]]);
  const after = await px(128, 260);
  check('burn: darkens the grey ramp', lum(after) < lum(before) - 10, { before, after });
}
{
  await setup({ size: 30, strength: 0.8, spongeMode: 'desaturate' });
  await tool('sponge');
  await drag([[80, 150], [140, 150]]);
  const p = await px(110, 150);
  check('sponge (desaturate): red loses saturation', sat(p) < 0.85, { p, sat: sat(p) });
}
{
  await setup({ size: 30, strength: 1 });
  await tool('blur');
  for (let i = 0; i < 3; i++) await drag([[200, 60], [200, 160]]);
  const p = await px(194, 110);
  check('blur: softens the hard red/black edge', p[0] < 245 && p[0] > 30, { p });
}
{
  // Rows 240–249 of the layer are transparent: blurring along that edge must not pull in black
  await setup({ size: 30, strength: 1 });
  await tool('blur');
  for (let i = 0; i < 3; i++) await drag([[40, 238], [140, 238]]);
  const p = await px(90, 238);
  check('blur next to transparency keeps the colour (no dark fringe)', p[0] > 245 && p[1] < 10, { p });
}
{
  await setup({ size: 30, strength: 1 });
  // A soft step edge (grey 100 | 150) inside the red area
  await b.eval(`const l = window.__ps.store.doc.layers.find((l) => l.name === 'Paint'); const x = l.canvas.getContext('2d'); x.fillStyle = 'rgb(100,100,100)'; x.fillRect(20, 160, 50, 60); x.fillStyle = 'rgb(150,150,150)'; x.fillRect(70, 160, 50, 60); const { touch } = await import('/src/core/canvas.ts'); touch(l.canvas); window.__ps.store.invalidateRender(); return true`);
  await tool('sharpen');
  const ramp0 = await px(120, 258);
  await drag([[50, 190], [90, 190]]);
  await drag([[100, 258], [140, 258], [100, 262], [140, 262]]);
  const dark = await px(69, 190), light = await px(70, 190), ramp = await px(120, 258), flat = await px(40, 190);
  check('sharpen: boosts contrast at an edge, leaves flat and smooth areas alone (no blow-out next to transparency)', lum(dark) < 95 && lum(light) > 155 && Math.abs(lum(flat) - 100) < 3 && Math.abs(lum(ramp) - lum(ramp0)) < 25, { dark, light, flat, ramp0, ramp });
}
{
  await setup({ tolerance: 32, contiguous: true });
  await tool('magic-eraser');
  await click(300, 100);
  const blue = await px(300, 100), red = await px(100, 100);
  check('magic eraser: makes the clicked colour region transparent, nothing else', blue[3] < 10 && red[3] === 255, { blue, red });
}
{
  await setup({ size: 40, tolerance: 40, bgSampling: 'once', protectFg: false });
  await tool('bg-eraser');
  await drag([[260, 100], [330, 100]]);
  const blue = await px(300, 100), wall = await px(201, 100);
  check('background eraser: erases the sampled blue, keeps the black wall', blue[3] < 30 && wall[3] > 200, { blue, wall });
}
{
  await setup({ size: 30, tolerance: 60, replaceMode: 'color' });
  await b.eval(`window.__ps.store.set({ fg: '#00ff00' }); return true`);
  await tool('color-replace');
  await drag([[260, 100], [330, 100]]);
  const p = await px(300, 100);
  check('colour replacement: blue becomes green-ish, keeps it opaque', p[1] > p[2] && p[3] === 255, { p });
}
{
  await setup({ size: 40 });
  await b.eval(`const l = window.__ps.store.doc.layers.find((l) => l.name === 'Paint'); const x = l.canvas.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(260, 60, 60, 60); x.fillStyle = '#e01010'; x.beginPath(); x.arc(290, 90, 10, 0, Math.PI * 2); x.fill(); const { touch } = await import('/src/core/canvas.ts'); touch(l.canvas); window.__ps.store.invalidateRender(); return true`);
  await tool('red-eye');
  await drag([[275, 75], [305, 105]]);
  const p = await px(290, 90);
  check('red-eye: the red pupil becomes dark and neutral', p[0] < 120 && sat(p) < 0.5, { p });
}
{
  await setup({ size: 30 });
  await tool('brush');
  await drag([[50, 150], [150, 150]]);
  const painted = await px(100, 150);
  // Source: the state before the stroke (like picking it in the History panel)
  await b.eval(`const { store } = window.__ps; const d = store.doc; store.set({ historySource: d.history[d.hIndex - 1] }); return true`);
  await tool('history-brush');
  await drag([[50, 150], [150, 150]]);
  const restored = await px(100, 150);
  check('history brush: paints the earlier state back (green stroke → red again)', close(painted, [0, 255, 0, 255], 20) && close(restored, [255, 0, 0, 255], 30), { painted, restored });
}

// Layers & vector
{
  await setup();
  await tool('move');
  const l0 = await b.eval(`const l = window.__ps.store.activeLayer; return { x: l.x, y: l.y, name: l.name }`);
  await drag([[100, 100], [130, 115]]);
  const l1 = await b.eval(`const l = window.__ps.store.doc.layers.find((l) => l.name === 'Paint'); return { x: l.x, y: l.y }`);
  check('move: a pixel layer moves by whole pixels (30, 15)', l1.x - l0.x === 30 && l1.y - l0.y === 15, { l0, l1 });
}
{
  await setup();
  await b.eval(`window.__ps.store.setOpts({ shapeType: 'ellipse' }); return true`);
  await tool('shape');
  await drag([[100, 50], [250, 150]]);
  const s = await b.eval(`const l = window.__ps.store.activeLayer; return { kind: l.kind, x: l.x, y: l.y, w: l.width, h: l.height, shape: l.shape?.shape }`);
  check('shape: drag makes a live ellipse layer of the dragged box', s.kind === 'shape' && s.shape === 'ellipse' && s.x === 100 && s.y === 50 && s.w === 150 && s.h === 100, s);
}
{
  await setup();
  await tool('color-sampler');
  await click(300, 100);
  const sm = await b.eval(`return window.__ps.store.doc.samplers ?? []`);
  check('colour sampler: a click pins a sampler at that pixel', sm.length === 1 && Math.abs(sm[0].x - 300) <= 1, sm);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) console.log('Failing: ' + failed.map((f) => f.name).join(' | '));
b.close();
process.exit(failed.length ? 1 : 0);
