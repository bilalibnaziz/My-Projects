// The added tools, driven with real mouse / keyboard input and checked against exact pixels:
// single row marquee, quick selection, magic & background eraser, color replacement, red eye,
// history brush, healing brush, pen, ruler + straighten, color sampler, sample size, multi-layer
// selection with move / align / distribute, and the tool shortcuts.
import { connect, sleep, ALT, META, CTRL, SHIFT } from './cdp.mjs';
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
/** Screen point at the centre of document pixel (x, y). */
const P = (g, x, y) => S(g, x + 0.5, y + 0.5);
const layerPx = (x, y) => st(`Array.from(store.activeLayer.canvas.getContext('2d').getImageData(${x} - store.activeLayer.x, ${y} - store.activeLayer.y, 1, 1).data)`);
const tool = async (id) => {
  await b.eval(`window.__ps.store.setTool(${JSON.stringify(id)})`);
  await sleep(60);
};
/** Fresh 400×300 document whose background is drawn by `paint(ctx)`. */
const setup = async (paint, opts = '{}') => {
  await b.eval(`
    const { store, ops } = window.__ps;
    store.set({ dialog: null, paletteOpen: false });
    while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
    ops.newDocument(400, 300, 'white', 'Pro');
    const ctx = store.activeLayer.canvas.getContext('2d');
    (${paint})(ctx);
    store.renderer.invalidate(); store.emit();
    store.setOpts({ smoothing: 0, opacity: 1, flow: 1, spacing: 0.1, pressureSize: false, ...${opts} });
  `);
  await sleep(250);
  return geo();
};
const redSquare = `(c) => { c.fillStyle = '#dd2222'; c.fillRect(100, 80, 120, 100); }`;

// 1. Single Row Marquee: exactly one pixel row across the canvas
{
  const g = await setup(redSquare);
  await tool('marquee-row');
  const p = P(g, 50, 123);
  await b.click(p.x, p.y);
  const r = await st(`store.doc.selection && store.doc.selection.bounds`);
  check('Single Row Marquee selects exactly row 123, full width', r && r.x === 0 && r.y === 123 && r.width === 400 && r.height === 1, r);
}

// 2. Quick Selection: painting inside the red square selects exactly the square
{
  const g = await setup(redSquare, `{ size: 20, tolerance: 32 }`);
  await tool('quick-select');
  await b.drag([P(g, 130, 110), P(g, 160, 130), P(g, 190, 150)]);
  await sleep(150);
  const r = await st(`store.doc.selection && store.doc.selection.bounds`);
  check('Quick Selection grows to exactly the painted object', r && r.x === 100 && r.y === 80 && r.width === 120 && r.height === 100, r);
  const h = await st(`store.doc.history[store.doc.hIndex].label`);
  check('…as one history step', h === 'Quick Selection', h);
}

// 3. Magic Eraser: click the white background → transparent, red untouched
{
  const g = await setup(redSquare, `{ tolerance: 20, contiguous: true, sampleAll: false }`);
  await tool('magic-eraser');
  const p = P(g, 10, 10);
  await b.click(p.x, p.y);
  await sleep(80);
  const white = await layerPx(10, 10);
  const red = await layerPx(150, 120);
  check('Magic Eraser erases the clicked color region exactly', white[3] === 0 && red[3] === 255 && red[0] === 221, { white, red });
}

// 4. Background Eraser: sample white at the brush centre, keep the red edge
{
  const g = await setup(redSquare, `{ size: 40, hardness: 1, tolerance: 30, bgSampling: 'once', protectFg: false }`);
  await tool('bg-eraser');
  // Stroke along the outside of the left edge; the brush overlaps the red square
  await b.drag([P(g, 88, 100), P(g, 88, 130), P(g, 88, 160)]);
  await sleep(80);
  const bg = await layerPx(88, 130);
  const red = await layerPx(102, 130);
  check('Background Eraser removes the sampled background and keeps the object edge', bg[3] === 0 && red[3] === 255, { bg, red });
}

// 5. Color Replacement: red becomes blue but keeps its luminosity
{
  const g = await setup(redSquare, `{ size: 30, hardness: 1, tolerance: 40, replaceMode: 'color', bgSampling: 'continuous' }`);
  await b.eval(`window.__ps.store.set({ fg: '#0050ff' })`);
  await tool('color-replace');
  await b.drag([P(g, 140, 130), P(g, 160, 130)]);
  await sleep(80);
  const px = await layerPx(150, 130);
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const before = lum([221, 34, 34]);
  check('Color Replacement recolors to blue and preserves luminosity (±1)', px[2] > px[0] && Math.abs(lum(px) - before) <= 1, { px, lum: lum(px), before });
  const white = await layerPx(110, 60);
  check('…and leaves other colors alone', white.join() === '255,255,255,255', white);
}

// 6. Red Eye: a red pupil on a gray face turns neutral and dark
{
  const g = await setup(`(c) => { c.fillStyle = '#9a8070'; c.fillRect(0, 0, 400, 300); c.fillStyle = '#c81e1e'; c.beginPath(); c.arc(200, 150, 12, 0, Math.PI * 2); c.fill(); }`, `{ size: 40, redEyePupil: 0.5, redEyeDarken: 0.5 }`);
  await tool('red-eye');
  const p = P(g, 200, 150);
  await b.click(p.x, p.y);
  await sleep(80);
  const pupil = await layerPx(200, 150);
  const skin = await layerPx(200, 175);
  check('Red Eye neutralizes the pupil', Math.abs(pupil[0] - pupil[1]) < 12 && pupil[0] < 60, pupil);
  check('…and leaves skin untouched', skin.join() === '154,128,112,255', skin);
}

// 7. History Brush: paint over a stroke to restore the original pixels exactly
{
  // Skill Vector paints pixels on a pixel layer (on the page the brush draws vector strokes)
  const g = await setup(`() => {}`, `{ size: 30, hardness: 1 }`);
  await b.eval(`
    const { store } = window.__ps;
    store.newRasterLayer('Paint');
    const c = store.activeLayer.canvas.getContext('2d'); (${redSquare})(c);
    store.renderer.invalidate(); store.commit('Paint');
    store.set({ fg: '#000000', historySource: store.doc.history[store.doc.hIndex] });`);
  await tool('brush');
  await b.drag([P(g, 120, 130), P(g, 200, 130)]);
  const painted = await layerPx(160, 130);
  await tool('history-brush');
  await b.drag([P(g, 110, 130), P(g, 210, 130)]);
  await sleep(80);
  const restored = await layerPx(160, 130);
  check('History Brush paints the opening state back exactly', painted[0] === 0 && restored.join() === '221,34,34,255', { painted, restored });
}

// 8. Healing Brush: texture from the source, tone from the destination
{
  // Left half darker, right half lighter, both with a fine stripe texture; a black blemish on the right
  const g = await setup(`(c) => {
    for (let x = 0; x < 400; x++) { const base = x < 200 ? 90 : 170; c.fillStyle = 'rgb(' + base + ',' + base + ',' + base + ')'; c.fillRect(x, 0, 1, 300); }
    for (let y = 0; y < 300; y += 4) { c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, y, 400, 1); }
    c.fillStyle = '#000'; c.beginPath(); c.arc(300, 150, 6, 0, Math.PI * 2); c.fill(); }`, `{ size: 24, hardness: 1, cloneAligned: false, sampleAll: false }`);
  await tool('heal-brush');
  // Source on the DARK half: a clone stamp would paint dark; healing must match the light surroundings
  const src = P(g, 100, 150);
  await b.click(src.x, src.y, { modifiers: ALT });
  await b.drag([P(g, 300, 150), P(g, 301, 150)]);
  await sleep(150);
  const healed = await layerPx(300, 150);
  const around = await layerPx(320, 150);
  check('Healing Brush removes the blemish and matches surrounding tone (±12)', Math.abs(healed[0] - around[0]) <= 12, { healed, around });
}

// 9. Pen: three corners + click the first point → closed path shape layer with exact bounds
{
  const g = await setup(`(c) => {}`);
  await b.eval(`window.__ps.store.setOpts({ penMode: 'shape', shapeFill: true, shapeStrokeWidth: 0 })`);
  await tool('pen');
  for (const [x, y] of [[100, 100], [300, 100], [200, 250], [100, 100]]) {
    const p = S(g, x, y);
    await b.click(p.x, p.y);
  }
  await sleep(120);
  const r = await st(`(() => { const l = store.activeLayer; return { kind: l.kind, shape: l.shape && l.shape.shape, closed: l.shape && l.shape.closed, x: l.x, y: l.y, w: l.width, h: l.height, n: l.shape && l.shape.points.length }; })()`);
  check('Pen: clicking the first point closes the path into a shape layer', r.kind === 'shape' && r.shape === 'path' && r.closed && r.n === 3, r);
  check('…with exact geometry', Math.abs(r.x - 100) < 0.5 && Math.abs(r.y - 100) < 0.5 && Math.abs(r.w - 200) < 0.5 && Math.abs(r.h - 150) < 0.5, r);
  const inside = await st(`Array.from(store.renderer.render(store.doc, store.overrides).getContext('2d').getImageData(200, 150, 1, 1).data)`);
  check('…and the triangle is filled', inside[3] === 255 && inside.join() !== '255,255,255,255', inside);
}

// 10. Pen: a dragged point makes a smooth curve; Enter makes a selection in selection mode
{
  const g = await setup(`(c) => {}`);
  await b.eval(`window.__ps.store.setOpts({ penMode: 'selection' })`);
  await tool('pen');
  let p = S(g, 100, 200);
  await b.click(p.x, p.y);
  const a = S(g, 200, 100);
  await b.drag([a, S(g, 240, 100), S(g, 260, 100)]); // pull a handle out to the right
  p = S(g, 300, 200);
  await b.click(p.x, p.y);
  const anchors = await b.eval(`return import('/src/core/proTools.ts').then(m => m.pen.path.anchors.map(a => [a.x, a.y, a.ix, a.iy, a.ox, a.oy].map(Math.round)))`);
  check('Pen: dragging pulls out symmetric handles', anchors[1].join() === '200,100,140,100,260,100', anchors);
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(150);
  const r = await st(`store.doc.selection && store.doc.selection.bounds`);
  check('Enter turns the path into a selection', r && r.x >= 99 && r.x <= 101 && r.y >= 99 && r.y <= 112 && r.x + r.width >= 299 && r.y + r.height >= 199, r);
}

// 11. Ruler: exact measurement, then Straighten Layer levels a tilted line
{
  const g = await setup(`(c) => {}`);
  await b.eval(`
    const { store } = window.__ps;
    store.newRasterLayer('Horizon');
    const c = store.activeLayer.canvas.getContext('2d'); c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(100, 100); c.lineTo(300, 120); c.stroke();
    store.renderer.invalidate(); store.emit();`);
  await tool('ruler');
  await b.drag([S(g, 100, 100), S(g, 200, 110), S(g, 300, 120)]);
  await sleep(80);
  const m = await b.eval(`return import('/src/core/proTools.ts').then(p => { const l = p.ruler.line; return p.measure(l.a, l.b); })`);
  check('Ruler measures length and angle', Math.abs(m.length - Math.hypot(200, 20)) < 0.01 && Math.abs(m.angle + (Math.atan2(20, 200) * 180) / Math.PI) < 0.01, m);
  const btn = await b.eval(`const el = [...document.querySelectorAll('.options-bar .btn')].find(e => e.textContent.includes('Straighten')); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 };`);
  await b.click(btn.x, btn.y);
  await sleep(200);
  const box = await b.eval(`return import('/src/core/align.ts').then(m => m.layerBounds(window.__ps.store.activeLayer))`);
  check('Straighten Layer makes the line level (≤ 3 px tall, was 20)', box && box.height <= 4 && Math.abs(box.width - Math.hypot(200, 20)) <= 3, box);
}

// 12. Color Sampler + 3×3 sample size + Info panel readout
{
  const g = await setup(`(c) => { c.fillStyle = '#204060'; c.fillRect(0, 0, 400, 300); c.fillStyle = '#ff0000'; c.fillRect(200, 150, 1, 1); }`, `{ samplerSize: 1 }`);
  await tool('color-sampler');
  const p = P(g, 50, 60);
  await b.click(p.x, p.y);
  await sleep(250);
  const r = await st(`({ samplers: store.doc.samplers, info: [...document.querySelectorAll('.sampler-row')].map(e => e.textContent) })`);
  check('Color Sampler pins the clicked pixel and the Info panel reads it', r.samplers.length === 1 && r.samplers[0].x === 50 && r.samplers[0].y === 60 && r.info[0]?.includes('32, 64, 96'), r);
  await tool('eyedropper');
  await b.eval(`window.__ps.store.setOpts({ samplerSize: 3 })`);
  const e = P(g, 200, 150);
  await b.click(e.x, e.y);
  const fg = await st(`store.state.fg`);
  // 8 × #204060 + 1 × #ff0000 averaged
  const exp = '#' + [Math.round((32 * 8 + 255) / 9), Math.round((64 * 8) / 9), Math.round((96 * 8) / 9)].map((v) => v.toString(16).padStart(2, '0')).join('');
  check('Eyedropper 3×3 average is exact', fg === exp, { fg, exp });
}

// 13. Multi-layer: ⌘-click layers, move together, distribute, align
{
  await setup(`(c) => {}`);
  await b.eval(`
    const { store } = window.__ps;
    for (const [name, x] of [['A', 20], ['B', 90], ['C', 300]]) {
      store.newRasterLayer(name);
      const c = store.activeLayer.canvas.getContext('2d'); c.fillStyle = '#36c'; c.fillRect(x, 40 + x / 4, 40, 40);
    }
    store.renderer.invalidate(); store.emit(); store.setTool('move');`);
  await sleep(150);
  const row = (name) => b.eval(`const el = [...document.querySelectorAll('.layer-row')].find(r => r.querySelector('.layer-name span')?.textContent === ${JSON.stringify(name)}); const r = el.getBoundingClientRect(); return { x: r.x + r.width - 60, y: r.y + r.height / 2 };`);
  let p = await row('A');
  await b.click(p.x, p.y);
  p = await row('B');
  await b.click(p.x, p.y, { modifiers: MOD });
  p = await row('C');
  await b.click(p.x, p.y, { modifiers: MOD });
  await sleep(100);
  const sel = await st(`store.selectedLayers.map(l => l.name)`);
  check('⌘-click selects several layers', sel.join() === 'A,B,C', sel);
  const before = await st(`store.doc.layers.filter(l => ['A','B','C'].includes(l.name)).map(l => [l.x, l.y])`);
  const g = await geo();
  await b.drag([S(g, 110, 82), S(g, 120, 90), S(g, 130, 102)], { modifiers: MOD }); // ⌘ = no snapping
  await sleep(100);
  const after = await st(`store.doc.layers.filter(l => ['A','B','C'].includes(l.name)).map(l => [l.x, l.y])`);
  const deltas = after.map((a, i) => [a[0] - before[i][0], a[1] - before[i][1]]);
  check('Move tool drags all selected layers by the same whole-pixel offset', deltas.every((d) => d[0] === 20 && d[1] === 20), deltas);
  const dist = await b.eval(`const el = document.querySelector('.options-bar [title="Distribute horizontal spacing"]'); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 };`);
  await b.click(dist.x, dist.y);
  await sleep(100);
  const boxes = await b.eval(`return import('/src/core/align.ts').then(m => window.__ps.store.selectedLayers.map(l => m.layerBounds(l)).sort((a, b) => a.x - b.x))`);
  const gaps = [boxes[1].x - (boxes[0].x + boxes[0].width), boxes[2].x - (boxes[1].x + boxes[1].width)];
  check('Distribute spacing makes equal gaps (±1 px)', Math.abs(gaps[0] - gaps[1]) <= 1, gaps);
  const al = await b.eval(`const el = document.querySelector('.options-bar [title^="Align Top Edges"]'); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 };`);
  await b.click(al.x, al.y);
  await sleep(100);
  const tops = await b.eval(`return import('/src/core/align.ts').then(m => window.__ps.store.selectedLayers.map(l => m.layerBounds(l).y))`);
  check('Align Top Edges lines selected layers up to each other', new Set(tops).size === 1, tops);
  await b.key('ArrowRight', { code: 'ArrowRight', vk: 39, modifiers: SHIFT });
  const nudged = await b.eval(`return import('/src/core/align.ts').then(m => window.__ps.store.selectedLayers.map(l => m.layerBounds(l).x))`);
  check('Shift+→ nudges every selected layer 10 px', nudged.every((x, i) => x === boxes[i].x + 10), { nudged, was: boxes.map((x) => x.x) });
  await b.key('Backspace', { code: 'Backspace', vk: 8 });
  void nudged;
  const left = await st(`store.doc.layers.map(l => l.name)`);
  check('Delete removes all selected layers in one step', left.join() === 'Background' || left.join() === 'Layer 1', left);
  await b.key('z', { modifiers: MOD });
  const back = await st(`store.doc.layers.map(l => l.name)`);
  check('…and ⌘Z brings them all back', back.length === 4, back);
}

// 15. alphaBounds (strip scan) agrees with a brute-force scan on random canvases
{
  const r = await b.eval(`
    const { alphaBounds } = await import('/src/core/canvas.ts');
    let bad = 0, runs = 0;
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let t = 0; t < 300; t++) {
      const w = 1 + Math.floor(rnd() * 300), h = 1 + Math.floor(rnd() * 300);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const n = Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) { ctx.fillStyle = 'rgba(0,0,0,' + (0.02 + rnd()) + ')'; ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1 + Math.floor(rnd() * 40), 1 + Math.floor(rnd() * 40)); }
      const th = rnd() < 0.5 ? 0 : 8;
      const d = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > th) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const want = x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
      const got = alphaBounds(c, th);
      runs++;
      if (JSON.stringify(got) !== JSON.stringify(want)) bad++;
    }
    return { runs, bad };`);
  check('alphaBounds strip scan is exact on 300 random canvases', r.bad === 0 && r.runs === 300, r);
}

// 14. Tool shortcuts follow Illustrator
{
  await b.eval(`window.__ps.store.setTool('brush')`);
  const got = [];
  for (const k of ['p', 'y', 'w']) {
    await b.key(k);
    got.push(await st(`store.state.tool`));
  }
  await b.key('i');
  await b.key('I', { modifiers: SHIFT, code: 'KeyI' });
  got.push(await st(`store.state.tool`));
  check('P / Y / W / Shift+I select Pen, Magic Wand, Width, and cycle the I group', got.join() === 'pen,wand,width,ruler', got);
}

console.log('\nexceptions in page:', b.logs.filter((l) => /exception|error/i.test(l)).slice(0, 10));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
b.close();
