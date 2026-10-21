// Pointer accuracy, zoom/pan, selections, keyboard and every menu command, with real input.
import { connect, sleep, ALT, META, SHIFT, CTRL } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info) : '');
};

const setup = async (w = 800, h = 600) => {
  await b.eval(`
    const { store, ops } = window.__ps;
    while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
    ops.newDocument(${w}, ${h}, 'white', 'Audit');
    store.newRasterLayer('Paint');
    store.set({ fg: '#000000', bg: '#ffffff' });
    store.setOpts({ size: 10, hardness: 1, opacity: 1, flow: 1, selFeather: 0 });
  `);
  await sleep(250);
};
const geo = () => b.eval(`
  const { store } = window.__ps;
  const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
  const v = store.doc.view;
  return { left: r.left, top: r.top, w: r.width, h: r.height, zoom: v.zoom, panX: v.panX, panY: v.panY };
`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
const D = (g, sx, sy) => ({ x: (sx - g.left - g.panX) / g.zoom, y: (sy - g.top - g.panY) / g.zoom });
const extent = () => b.eval(`
  const l = window.__ps.store.activeLayer; const c = l.canvas;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, n = 0, sx = 0, sy = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const a = d[(y * c.width + x) * 4 + 3]; if (a > 127) {
    n++; sx += x; sy += y; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } }
  return { minX, maxX, minY, maxY, n, cx: sx / n + 0.5, cy: sy / n + 0.5 };
`);

// ---------------------------------------------------------------- 1. brush tip-to-tip (default smoothing)
await setup();
await b.eval(`window.__ps.store.setTool('brush')`);
let g = await geo();
{
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push(S(g, 100 + i * 50, 300));
  await b.drag(pts);
  const e = await extent();
  check('brush stroke reaches release point (maxX≈705)', Math.abs(e.maxX - 704.5) <= 1.5, e);
}

// ---------------------------------------------------------------- 2. single click dab centred under pointer at 800%
await setup(64, 64);
await b.eval(`const { store } = window.__ps; const d = store.doc; d.view.zoom = 8; d.view.panX = 200; d.view.panY = 100; store.emit(); store.setTool('brush'); store.setOpts({ size: 4, smoothing: 0 });`);
await sleep(100);
g = await geo();
{
  const p = S(g, 20.5, 30.5); // centre of pixel (20,30)
  await b.click(p.x, p.y);
  const e = await extent();
  check('800% click: dab centred on clicked pixel (20.5,30.5)', Math.abs(e.cx - 20.5) < 0.6 && Math.abs(e.cy - 30.5) < 0.6, e);
}

// ---------------------------------------------------------------- 3. wheel zoom keeps doc point under cursor
await setup();
g = await geo();
{
  const sp = S(g, 250, 150);
  const before = D(g, sp.x, sp.y);
  await b.mouse('mouseMoved', sp.x, sp.y);
  for (let i = 0; i < 5; i++) await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: sp.x, y: sp.y, deltaX: 0, deltaY: -40, modifiers: META });
  await sleep(150);
  const g2 = await geo();
  const after = D(g2, sp.x, sp.y);
  check('⌘+wheel zoom anchors at cursor', Math.hypot(after.x - before.x, after.y - before.y) < 0.5 && g2.zoom > g.zoom, { before, after, z0: g.zoom, z1: g2.zoom });
  // pinch = ctrl+wheel
  for (let i = 0; i < 5; i++) await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: sp.x, y: sp.y, deltaX: 0, deltaY: 10, modifiers: CTRL });
  await sleep(150);
  const g3 = await geo();
  const after3 = D(g3, sp.x, sp.y);
  check('pinch (ctrl+wheel) zoom anchors at cursor', Math.hypot(after3.x - before.x, after3.y - before.y) < 0.5 && g3.zoom < g2.zoom, { after3, z: g3.zoom });
  // plain wheel pans
  await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: sp.x, y: sp.y, deltaX: 30, deltaY: 50 });
  await sleep(100);
  const g4 = await geo();
  check('plain wheel pans by delta', g4.panX === g3.panX - 30 && g4.panY === g3.panY - 50, { dx: g4.panX - g3.panX, dy: g4.panY - g3.panY });
  // line-mode wheel (Firefox / some mice)
  await b.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: sp.x, y: sp.y, deltaX: 0, deltaY: 3, deltaMode: 1 });
}

// ---------------------------------------------------------------- 4. keyboard zoom
await setup();
{
  await b.key('=', { modifiers: META, code: 'Equal' });
  await sleep(80);
  const z1 = (await geo()).zoom;
  await b.key('+', { modifiers: META | SHIFT, code: 'Equal' });
  await sleep(80);
  const z2 = (await geo()).zoom;
  check('⌘= zooms in', z1 > g.zoom, { z0: g.zoom, z1 });
  check('⌘⇧= (⌘+) zooms in too', z2 > z1, { z1, z2 });
  await b.key('1', { modifiers: META, code: 'Digit1' });
  await sleep(80);
  const g1 = await geo();
  check('⌘1 = 100%', Math.abs(g1.zoom - 1) < 1e-6, g1.zoom);
  await b.key('0', { modifiers: META, code: 'Digit0' });
  await sleep(80);
  const g0 = await geo();
  const inside = g0.panX >= 0 && g0.panY >= 0 && g0.panX + 800 * g0.zoom <= g0.w && g0.panY + 600 * g0.zoom <= g0.h;
  check('⌘0 fits document inside view', inside, g0);
  await b.key('-', { modifiers: META, code: 'Minus' });
  await sleep(80);
  check('⌘- zooms out', (await geo()).zoom < g0.zoom);
}

// ---------------------------------------------------------------- 5. zoom tool click anchors
await setup();
await b.eval(`window.__ps.store.setTool('zoom')`);
g = await geo();
{
  const sp = S(g, 400, 300);
  await b.click(sp.x, sp.y);
  await sleep(80);
  const g2 = await geo();
  const after = D(g2, sp.x, sp.y);
  check('zoom tool click zooms in at cursor', g2.zoom > g.zoom && Math.hypot(after.x - 400, after.y - 300) < 0.5, { zoom: g2.zoom, after });
  await b.click(sp.x, sp.y, { modifiers: ALT });
  await sleep(80);
  check('zoom tool alt-click zooms out', (await geo()).zoom < g2.zoom);
}

// ---------------------------------------------------------------- 6. rectangular marquee exact
await setup();
await b.eval(`window.__ps.store.setTool('marquee-rect')`);
g = await geo();
{
  await b.drag([S(g, 100, 100), S(g, 200, 150), S(g, 300, 200)]);
  const sel = await b.eval(`const s = window.__ps.store.doc.selection; return s && s.bounds`);
  check('marquee selection matches drag (100,100)-(300,200)', sel && Math.abs(sel.x - 100) <= 1 && Math.abs(sel.y - 100) <= 1 && Math.abs(sel.width - 200) <= 2 && Math.abs(sel.height - 100) <= 2, sel);
  // click without drag deselects
  await b.click(S(g, 500, 400).x, S(g, 500, 400).y);
  const after = await b.eval(`return !!window.__ps.store.doc.selection`);
  check('click outside deselects', !after);
}

// ---------------------------------------------------------------- 7. move tool exact delta
await setup();
await b.eval(`
  const { store } = window.__ps; const l = store.activeLayer;
  const ctx = l.canvas.getContext('2d'); ctx.fillStyle = '#f00'; ctx.fillRect(10, 10, 20, 20);
  window.__ps.store.setTool('move');
`);
g = await geo();
{
  await b.drag([S(g, 20, 20), S(g, 60, 50), S(g, 120, 90)]);
  const l = await b.eval(`const l = window.__ps.store.activeLayer; return { x: l.x, y: l.y }`);
  check('move tool moves layer by exact drag delta (100,70)', l.x === 100 && l.y === 70, l);
  await b.key('z', { modifiers: META, code: 'KeyZ' });
  const u = await b.eval(`const l = window.__ps.store.activeLayer; return { x: l.x, y: l.y }`);
  check('⌘Z undoes the move', u.x === 0 && u.y === 0, u);
  await b.key('z', { modifiers: META | SHIFT, code: 'KeyZ' });
  const r = await b.eval(`const l = window.__ps.store.activeLayer; return { x: l.x, y: l.y }`);
  check('⌘⇧Z redoes the move', r.x === 100 && r.y === 70, r);
}

// ---------------------------------------------------------------- 8. eyedropper exact pixel at 400%
await setup(64, 64);
await b.eval(`
  const { store } = window.__ps; const l = store.activeLayer; const ctx = l.canvas.getContext('2d');
  for (let x = 0; x < 64; x++) { ctx.fillStyle = 'rgb(' + (x * 4) + ',10,20)'; ctx.fillRect(x, 0, 1, 64); }
  window.__ps.pixelsDirty = true; store.renderer.invalidate(); store.emit();
  const d = store.doc; d.view.zoom = 4; d.view.panX = 100; d.view.panY = 100; store.emit(); store.setTool('eyedropper');
`);
await sleep(100);
g = await geo();
{
  const p = S(g, 37.2, 12.7);
  await b.click(p.x, p.y);
  const fg = await b.eval(`return window.__ps.store.state.fg`);
  check('eyedropper samples the exact pixel under the pointer (x=37 → #940a14)', fg === '#940a14', fg);
}

// ---------------------------------------------------------------- 9. space-drag pans, and doesn't stick after window blur
await setup();
await b.eval(`window.__ps.store.setTool('brush')`);
g = await geo();
{
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
  await b.drag([S(g, 300, 300), S(g, 350, 330)]);
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  const g2 = await geo();
  const painted = (await extent()).n;
  check('space+drag pans without painting', Math.round(g2.panX - g.panX) === Math.round(50 * g.zoom) && painted === 0, { dx: g2.panX - g.panX, painted });
  // keydown space, then window blur, then a drag must paint (space not stuck)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
  await b.eval(`window.dispatchEvent(new Event('blur'))`);
  const g3 = await geo();
  await b.drag([S(g3, 300, 300), S(g3, 400, 300)]);
  check('space not stuck after window loses focus', (await extent()).n > 0);
}

// ---------------------------------------------------------------- 10. tool shortcuts don't fire with ⌘ held, ⌘C doesn't switch tool
await setup();
await b.eval(`window.__ps.store.setTool('brush')`);
{
  await b.key('c', { modifiers: META, code: 'KeyC' });
  const t = await b.eval(`return window.__ps.store.state.tool`);
  check('⌘C does not switch to crop tool', t === 'brush', t);
  await b.key('v');
  check('V selects move tool', (await b.eval(`return window.__ps.store.state.tool`)) === 'move');
}

// ---------------------------------------------------------------- 11. run every menu command; none may throw
await setup();
await b.eval(`
  const { store } = window.__ps; const l = store.activeLayer;
  const ctx = l.canvas.getContext('2d'); ctx.fillStyle = '#36c'; ctx.fillRect(100, 100, 300, 200);
  store.emit();
`);
{
  const res = await b.eval(`
    const { COMMANDS } = await import('/src/core/commands.ts');
    const { store, ops } = window.__ps;
    const skip = new Set(['open', 'place', 'save', 'export', 'quick-export', 'close', 'copy', 'copy-merged', 'cut']);
    const errors = [];
    const orig = console.error; const caught = []; console.error = (...a) => { caught.push(a.map(String).join(' ')); };
    for (const c of COMMANDS) {
      if (skip.has(c.id)) continue;
      // fresh selection for selection-dependent commands
      if (!store.doc) ops.newDocument(800, 600, 'white', 'Audit');
      try {
        if (!store.doc.selection) ops.selectAll();
        if (c.enabled && !c.enabled()) continue;
        c.run();
        await new Promise(r => setTimeout(r, 60));
        const dlg = store.state.dialog;
        if (dlg && dlg.type === 'number') { dlg.onOk(dlg.value); store.set({ dialog: null }); }
        else if (dlg) store.set({ dialog: null });
        if (store.state.crop) { const { cancelCrop } = await import('/src/core/tools.ts'); cancelCrop(); }
        if (store.state.transform) ops.cancelTransform();
        store.set({ paletteOpen: false });
      } catch (e) { errors.push(c.id + ': ' + e.message); }
    }
    await new Promise(r => setTimeout(r, 1500));
    console.error = orig;
    return { errors, caught: caught.slice(0, 10), toasts: store.state.toasts.map(t => t.kind + ':' + t.text) };
  `);
  check('every menu command runs without throwing', res.errors.length === 0 && res.caught.length === 0, res);
}

console.log('\nexceptions in page:', b.logs.filter((l) => /exception|error/i.test(l)).slice(0, 10));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
b.close();
