// Super zoom: at any magnification shapes, text, rotated objects and group contents are drawn from
// their geometry at screen resolution — never a stretched bitmap. Checks the real viewport pixels.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};

await b.eval(`
  const { store, ops } = window.__ps;
  const { makeLayer, withLayer } = await import('/src/core/types.ts');
  const { syncTextBounds } = await import('/src/core/render.ts');
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Zoom');
  const shape = (name, x, y, w, h, kind, extra = {}) => makeLayer({ kind: 'shape', name, x, y, width: w, height: h, ...extra, shape: { shape: kind, fill: '#000000', stroke: '#000', strokeWidth: 0, fillEnabled: true, radius: 0 } });
  const circle = shape('Circle', 100, 100, 200, 200, 'ellipse');
  const turned = shape('Turned', 500, 100, 160, 160, 'rectangle', { rotation: 30 });
  const g = makeLayer({ kind: 'group', name: 'G', x: 0, y: 0, width: 1000, height: 700 });
  const inner = { ...shape('Inner', 100, 420, 200, 200, 'ellipse'), parent: g.id };
  const t0 = makeLayer({ kind: 'text', name: 'Word', x: 520, y: 400, text: { text: 'O', font: 'Arial', size: 160, weight: 400, italic: false, color: '#000000', align: 'left', lineHeight: 1.2, tracking: 0, shadow: false, stroke: 0, strokeColor: '#000' } });
  const t = withLayer(t0, syncTextBounds(t0));
  store.commit('Setup', { layers: [...store.doc.layers, circle, turned, g, inner, t], activeId: store.doc.layers[0].id });
  store.setTool('hand');
`);
await sleep(300);

/** Centres document point (x, y) in the viewport at `zoom` and returns the screen centre. */
const focus = (x, y, zoom) => b.eval(`
  const { store } = window.__ps;
  const c = document.querySelector('.viewport-canvas');
  const W = c.clientWidth, H = c.clientHeight;
  const v = store.doc.view;
  v.zoom = ${zoom};
  v.panX = Math.round(W / 2 - ${x} * ${zoom});
  v.panY = Math.round(H / 2 - ${y} * ${zoom});
  store.emit();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { cx: Math.round(W / 2), cy: Math.round(H / 2), panX: v.panX, panY: v.panY, dpr: c.width / W };
`);
/** First dark pixel scanning right from `x0` on each listed row of the viewport canvas. */
const edges = (rows, x0, x1) => b.eval(`
  const c = document.querySelector('.viewport-canvas');
  const ctx = c.getContext('2d');
  return ${JSON.stringify(rows)}.map((y) => {
    const d = ctx.getImageData(${x0}, y, ${x1 - x0}, 1).data;
    // First light → dark transition (the scan may start inside dark artwork)
    let seenLight = false;
    for (let i = 0; i < d.length / 4; i++) {
      if (d[i * 4] >= 128) seenLight = true;
      else if (seenLight) return ${x0} + i;
    }
    return -1;
  });
`);

// 1. Circle edge at 6400%: every row's boundary sits where the true circle is (±1.5 px)
{
  const Z = 64;
  const p = 200 - 100 / Math.SQRT2;
  const f = await focus(p, p, Z);
  const rows = Array.from({ length: 25 }, (_, i) => f.cy - 96 + i * 8);
  const found = await edges(rows, f.cx - 200, f.cx + 200);
  const errs = rows.map((sy, i) => {
    const y = (sy + 0.5 - f.panY) / Z;
    const x = 200 - Math.sqrt(100 * 100 - (y - 200) ** 2);
    return Math.abs(found[i] - (f.panX + x * Z));
  });
  check('6400%: circle edge follows the true curve (no pixel blocks)', Math.max(...errs) <= 1.5, { maxErr: Math.max(...errs).toFixed(2) });
}

// 2. Rotated rectangle edge at 3200%: boundary moves every row (a staircase would repeat)
const distinct = async (x, y, Z) => {
  const f = await focus(x, y, Z);
  const rows = Array.from({ length: 16 }, (_, i) => f.cy - 32 + i * 4);
  const found = await edges(rows, f.cx - 300, f.cx + 300);
  return { n: new Set(found.filter((v) => v >= 0)).size, found };
};
{
  // Left corner of the 30° square sits left of centre; probe along its lower-left edge
  const cx = 580, cy = 180, a = (30 * Math.PI) / 180;
  const corner = (dx, dy) => ({ x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) });
  const p0 = corner(-80, 80), p1 = corner(-80, -80);
  const r = await distinct((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, 32);
  check('3200%: rotated rectangle edge is smooth', r.n >= 12, r);
}

// 3. Shape inside a group stays sharp
{
  const p = 200 - 100 / Math.SQRT2;
  const r = await distinct(p, 520 - 100 / Math.SQRT2, 48);
  check('4800%: grouped shape edge is smooth', r.n >= 12, r);
}

// 4. Text glyph outline stays sharp (the bowl of an "O")
{
  // Find the O's outer left edge on a row through its upper bowl (document-resolution render)
  const p = await b.eval(`
    const { store } = window.__ps;
    const { renderDocument } = await import('/src/core/render.ts');
    const l = store.doc.layers.find((l) => l.name === 'Word');
    const t = document.createElement('canvas'); renderDocument(store.doc, t);
    const y = Math.round(l.y + l.height * 0.3);
    const d = t.getContext('2d').getImageData(Math.round(l.x), y, Math.round(l.width), 1).data;
    for (let i = 0; i < d.length / 4; i++) if (d[i * 4] < 128) return { x: Math.round(l.x) + i, y };
    return null;
  `);
  const r = p ? await distinct(p.x, p.y, 40) : { n: 0, found: [] };
  check('4000%: text outline is smooth', r.n >= 10, r);
}

// 5. Below 100% the document-resolution path still renders the artwork
{
  await focus(500, 350, 0.5);
  const dark = await b.eval(`
    const { store } = window.__ps; const v = store.doc.view;
    const c = document.querySelector('.viewport-canvas');
    const d = c.getContext('2d').getImageData(Math.round(v.panX + 200 * 0.5), Math.round(v.panY + 200 * 0.5), 1, 1).data;
    return d[0];
  `);
  check('50%: artwork still drawn', dark < 60, { dark });
}

// 6. Panning a busy document at 800% stays interactive
{
  const ms = await b.eval(`
    const { store } = window.__ps;
    const { makeLayer } = await import('/src/core/types.ts');
    const extra = [];
    for (let i = 0; i < 300; i++) extra.push(makeLayer({ kind: 'shape', name: 'S' + i, x: (i * 37) % 950, y: (i * 53) % 650, width: 40, height: 40, rotation: i % 45, shape: { shape: i % 2 ? 'ellipse' : 'star', fill: '#2266cc', stroke: '#000', strokeWidth: 2, fillEnabled: true, radius: 0, sides: 5 } }));
    store.commit('Many', { layers: [...store.doc.layers, ...extra] });
    const v = store.doc.view; v.zoom = 8;
    store.emit();
    await new Promise((r) => setTimeout(r, 300));
    // The hand tool and wheel only repaint the canvas (requestRender), never the panels. Time the
    // viewport's own draw: headless Chrome's compositor adds frame pacing of its own.
    const origRaf = window.requestAnimationFrame;
    const draws = [];
    window.requestAnimationFrame = (cb) => origRaf((t) => { const t0 = performance.now(); cb(t); draws.push(performance.now() - t0); });
    for (let i = 0; i < 20; i++) { v.panX -= 15; store.requestRender(); await new Promise((r) => origRaf(r)); }
    window.requestAnimationFrame = origRaf;
    return draws.reduce((a, b) => a + b, 0) / Math.max(1, draws.length);
  `);
  check('800%: viewport draw with 300 shapes under 12 ms', ms < 12, { ms: ms.toFixed(2) });
}

// 7. Real pinch / ⌘-wheel zoom reaches 64,000% and the status bar catches up when it pauses
{
  await b.eval(`const { store } = window.__ps; store.doc.view.zoom = 1; store.emit();`);
  const r = await b.eval(`const c = document.querySelector('.viewport-canvas').getBoundingClientRect(); return { x: c.left + c.width / 2, y: c.top + c.height / 2 };`);
  for (let i = 0; i < 8; i++) await b.mouse('mouseWheel', r.x, r.y, { deltaX: 0, deltaY: -120, modifiers: 2 });
  await sleep(250);
  const z = await b.eval(`return { zoom: window.__ps.store.doc.view.zoom, readout: document.querySelector('.sb-zoom')?.value }`);
  check('⌃-wheel zooms to 64,000% and the readout follows', Math.abs(z.zoom - 640) < 1e-6 && z.readout === '64000%', z);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
process.exit(failed.length ? 1 : 0);
