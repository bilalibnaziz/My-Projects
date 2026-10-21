// Vector geometry tools with real pointer input: Paintbrush, Blob Brush, Eraser, Knife, Path Eraser,
// Shaper, Shear, Reshape, Puppet Warp, Liquify, Gradient / Mesh on shapes, Blend, Live Paint Bucket,
// Symbols, vertical type, type on a path, Slices, Perspective Grid and Packaging.
import { connect, sleep, SHIFT } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const geo = () => b.eval(`
  const { store } = window.__ps;
  const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
  const v = store.doc.view;
  return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };
`);
let g;
const S = (x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
const line = (x0, y0, x1, y1, n = 16) => Array.from({ length: n + 1 }, (_, i) => S(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n));
const drag = (pts, opts) => b.drag(pts, { delay: 4, ...opts });
const click = async (x, y, opts) => { const p = S(x, y); await b.click(p.x, p.y, opts); await sleep(60); };
const tool = (t) => b.eval(`window.__ps.store.setTool(${JSON.stringify(t)})`);
const st = (expr) => b.eval(`const { store, ops } = window.__ps; return (${expr})`);
const px = (x, y) => b.eval(`
  const { store } = window.__ps;
  const { renderDocument } = await import('/src/core/render.ts');
  const t = document.createElement('canvas'); t.width = store.doc.width; t.height = store.doc.height;
  renderDocument(store.doc, t);
  return Array.from(t.getContext('2d').getImageData(${x}, ${y}, 1, 1).data);
`);
const near = (a, c, tol = 24) => a && c.every((v, i) => Math.abs(a[i] - v) <= tol);
const shapes = () => st(`store.doc.layers.filter((l) => l.kind === 'shape').map((l) => ({ id: l.id, name: l.name, x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.width), h: Math.round(l.height), closed: !!l.shape.closed, pts: l.shape.points?.length ?? 0, fill: l.shape.fill, grad: l.shape.gradient?.type ?? null, mesh: l.shape.mesh?.length ?? 0, symbol: l.symbol ?? null, opacity: l.opacity }))`);
const setup = async (extra = '') => {
  await b.eval(`
    const { store, ops } = window.__ps;
    const { makeLayer } = await import('/src/core/types.ts');
    store.set({ dialog: null, paletteOpen: false, transform: null, textEditId: null });
    while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
    ops.newDocument(1000, 700, 'white', 'Vector');
    const sq = (name, x, y, w, h, fill, kind = 'rectangle') => makeLayer({ kind: 'shape', name, x, y, width: w, height: h, shape: { shape: kind, fill, stroke: '#000000', strokeWidth: 0, fillEnabled: true, radius: 0 } });
    const a = sq('A', 300, 200, 300, 250, '#e33333');
    store.insertLayer(a, undefined, 'Add A');
    ${extra}
    store.selectLayer(a.id);
    store.set({ fg: '#2255ee', bg: '#ffffff' });
    store.setOpts({ size: 20, strength: 0.5, blendSteps: 5 });
  `);
  await sleep(150);
  g = await geo();
};

// 1. Paintbrush: a vector stroke in the foreground colour
await setup();
await tool('brush');
await drag(line(100, 600, 900, 620));
{
  const l = (await shapes()).find((s) => s.name === 'Brush Stroke');
  check('Paintbrush draws an open vector path in the foreground colour', l && !l.closed && near(await px(500, 610), [34, 85, 238]), { l, p: await px(500, 610) });
}

// 2. Blob Brush: overlapping strokes merge into one filled shape
await setup();
await tool('blob-brush');
await drag(line(100, 560, 400, 560));
await drag(line(380, 560, 380, 660));
{
  const blobs = (await shapes()).filter((s) => s.name.startsWith('Blob'));
  check('Blob Brush strokes that touch merge into one filled shape', blobs.length === 1 && blobs[0].closed && near(await px(380, 640), [34, 85, 238]), blobs);
}

// 3. Eraser: cuts a channel through the shape and splits it
await setup();
await tool('eraser');
await drag(line(450, 150, 450, 500));
{
  const s = await shapes();
  check('Eraser cuts the shape in two along the drag', s.length === 2 && near(await px(450, 320), [255, 255, 255]) && near(await px(350, 320), [227, 51, 51]) && near(await px(560, 320), [227, 51, 51]), { s, mid: await px(450, 320) });
}

// 4. Knife: splits along the cut with no gap
await setup();
await tool('knife');
await drag(line(250, 300, 650, 340));
{
  const s = await shapes();
  check('Knife splits the shape into two pieces without a gap', s.length === 2 && near(await px(450, 320), [227, 51, 51], 40) && near(await px(450, 240), [227, 51, 51]) && near(await px(450, 420), [227, 51, 51]), s);
}

// 5. Path Eraser: erasing across an edge opens the path
await setup();
await b.eval(`const { store } = window.__ps; const { withLayer } = await import('/src/core/types.ts'); store.commit('Stroke', { layers: store.doc.layers.map((l) => l.name === 'A' ? withLayer(l, { shape: { ...l.shape, fillEnabled: false, strokeWidth: 6 } }) : l) });`);
await tool('path-eraser');
await drag(line(280, 320, 320, 320));
{
  const s = await shapes();
  check('Path Eraser removes the stroke under the drag and leaves an open path', s.length === 1 && !s[0].closed && near(await px(300, 320), [255, 255, 255]) && near(await px(300, 250), [0, 0, 0], 60), s);
}

// 6. Shaper: a rough rectangle becomes a clean rectangle
await setup();
await tool('shaper');
{
  const pts = [];
  const corners = [[600, 500], [880, 505], [875, 660], [602, 655], [600, 502]];
  for (let k = 0; k < corners.length - 1; k++) for (let i = 0; i < 10; i++) {
    const [x0, y0] = corners[k], [x1, y1] = corners[k + 1];
    pts.push(S(x0 + ((x1 - x0) * i) / 10 + (i % 2), y0 + ((y1 - y0) * i) / 10 - (i % 2)));
  }
  await drag(pts);
  const l = (await shapes()).find((s) => s.name.startsWith('Shaper'));
  check('Shaper turns a rough rectangle into a clean shape', !!l && /Rectangle|Rect/i.test(l.name), l);
}

// 7. Shear: dragging near the top edge slants the shape
await setup();
await tool('shear');
await drag(line(450, 210, 500, 210));
{
  const a = (await shapes())[0];
  check('Shear slants the selected shape', a.w > 380 && a.h >= 248 && a.h <= 252, a);
  await b.key('z', { modifiers: 4 });
  await sleep(100);
  const back = (await shapes())[0];
  check('Shear is one undo step', back.w === 300, back);
}

// 8. Reshape: pulling the middle of the top edge bends it up
await setup();
await tool('reshape');
await drag(line(450, 200, 450, 140));
{
  const a = (await shapes())[0];
  check('Reshape pulls the path where it is grabbed', a.y <= 145 && a.y >= 130 && near(await px(450, 160), [227, 51, 51]) && near(await px(305, 160), [255, 255, 255]), a);
}

// 9. Puppet Warp: the far corners stay pinned while the dragged pin moves
await setup();
await tool('puppet-warp');
await drag(line(600, 325, 680, 325));
{
  const a = (await shapes())[0];
  check('Puppet Warp bends the shape around its pins', a.x + a.w > 650 && near(await px(305, 205), [227, 51, 51]), a);
}

// 10. Warp (liquify): the edge follows the drag and gains detail; one undo step
await setup();
await tool('warp');
await b.eval(`window.__ps.store.setOpts({ size: 80 })`);
const steps0 = await st('store.doc.hIndex');
await drag(line(600, 325, 660, 325));
{
  const a = (await shapes())[0];
  const steps = (await st('store.doc.hIndex')) - steps0;
  check('Warp pushes the edge with the drag (not compounding) in one step', a.x + a.w >= 640 && a.x + a.w <= 675 && a.pts > 4 && steps === 1, { a, steps });
}

// 11. Twirl and Bloat change the outline
for (const t of ['twirl', 'bloat', 'pucker', 'crystallize']) {
  await setup();
  await tool(t);
  await b.eval(`window.__ps.store.setOpts({ size: 100 })`);
  await drag(line(590, 320, 600, 330, 10));
  const a = (await shapes())[0];
  // An untouched rectangle refits back to its 4 corners; a reshaped outline keeps extra points
  check(`${t} reshapes the outline`, a.pts > 4, { pts: a.pts, x: a.x, w: a.w });
}

// 12. Gradient on a shape
await setup();
await tool('gradient');
await drag(line(300, 325, 600, 325));
{
  const a = (await shapes())[0];
  const l = await px(305, 325), r = await px(595, 325);
  check('Gradient tool gives the shape a live gradient fill (fg → bg)', a.grad === 'linear' && near(l, [34, 85, 238], 30) && near(r, [255, 255, 255], 30), { a, l, r });
  const svg = await b.eval(`const { docToSvg } = await import('/src/core/formats/svg.ts'); return docToSvg(window.__ps.store.doc);`);
  check('SVG export writes the shape gradient', /<linearGradient[^>]+gradientUnits="userSpaceOnUse"/.test(svg) && /fill="url\(#grad/.test(svg));
}

// 13. Mesh point
await setup();
await b.eval(`window.__ps.store.set({ fg: '#00ff00' })`);
await tool('mesh');
await click(450, 325);
{
  const a = (await shapes())[0];
  const c = await px(450, 325);
  check('Mesh tool adds a colour point that blends into the fill', a.mesh === 1 && c[1] > 200 && c[0] < 60, { a, c });
}

// 14. Blend: steps between two shapes
await setup(`store.insertLayer(sq('B', 750, 500, 100, 100, '#3355ee'), undefined, 'Add B');`);
await tool('blend');
await click(450, 325);
await click(800, 550);
{
  const s = await shapes();
  const steps = s.filter((x) => x.name.startsWith('Blend Step'));
  check('Blend makes 5 steps between the two shapes', steps.length === 5 && steps[2].x > 300 && steps[2].x < 750, steps.map((x) => [x.x, x.y, x.fill]));
}

// 15. Live Paint Bucket
await setup();
await tool('bucket');
await click(450, 325);
check('Live Paint Bucket fills the clicked shape', (await shapes())[0].fill === '#2255ee' && near(await px(450, 325), [34, 85, 238]));

// 16. Symbols: spray, then size and screen
await setup();
await tool('symbol-sprayer');
const before16 = await st('store.doc.hIndex');
await drag(line(100, 600, 500, 600, 30));
{
  const syms = (await shapes()).filter((s) => s.symbol);
  check('Symbol Sprayer sprays instances along the drag in one step', syms.length >= 5 && (await st('store.doc.hIndex')) - before16 === 1, syms.length);
  const w0 = syms.reduce((a, s) => a + s.w, 0);
  await tool('symbol-sizer');
  await drag(line(300, 600, 302, 600, 20));
  const w1 = (await shapes()).filter((s) => s.symbol).reduce((a, s) => a + s.w, 0);
  check('Symbol Sizer enlarges the instances under the brush', w1 > w0 + 5, { w0, w1 });
  await tool('symbol-screener');
  await drag(line(300, 600, 302, 600, 10));
  const op = (await shapes()).filter((s) => s.symbol).some((s) => s.opacity < 1);
  check('Symbol Screener fades instances', op);
}

// 17. Vertical type
await setup();
await tool('vertical-type');
await click(800, 100);
await sleep(100);
{
  const t = await st(`(() => { const l = store.doc.layers.find((l) => l.kind === 'text'); return l && { vertical: !!l.text.vertical, w: l.width, h: l.height }; })()`);
  check('Vertical Type makes a vertical text column', t && t.vertical && t.h > t.w * 2, t);
}
await b.key('Escape');

// 18. Type on a path
await setup();
await tool('path-type');
await click(450, 200);
await sleep(100);
{
  const t = await st(`(() => { const l = store.doc.layers.find((l) => l.kind === 'text'); return l && { pts: l.text.path?.points.length ?? 0, closed: !!l.text.path?.closed }; })()`);
  // Glyphs are drawn above the top edge of the shape
  const ink = await b.eval(`
    const { store } = window.__ps;
    const { renderDocument } = await import('/src/core/render.ts');
    const t = document.createElement('canvas'); t.width = store.doc.width; t.height = store.doc.height;
    renderDocument(store.doc, t);
    const d = t.getContext('2d').getImageData(300, 160, 300, 38).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 2] < 200) n++; return n;`);
  check('Type on a Path sets the text along the clicked path', t && t.pts > 10 && t.closed && ink > 30, { t, ink });
  const svg = await b.eval(`const { docToSvg } = await import('/src/core/formats/svg.ts'); return docToSvg(window.__ps.store.doc);`);
  check('SVG export keeps type on a path as <textPath>', /<textPath /.test(svg));
}
await b.key('Escape');

// 19. Slices: drag one out, undo, delete
await setup();
await tool('slice');
await drag(line(100, 100, 300, 250, 6));
{
  const sl = await st('store.doc.slices');
  check('Slice tool drags out a slice', sl?.length === 1 && Math.abs(sl[0].width - 200) <= 2 && Math.abs(sl[0].height - 150) <= 2, sl);
  await b.key('z', { modifiers: 4 });
  await sleep(80);
  check('Undo removes the slice', ((await st('store.doc.slices')) ?? []).length === 0);
  await b.key('z', { modifiers: 4 | SHIFT });
  await sleep(80);
  await tool('slice-select');
  await click(200, 200);
  await b.key('Backspace');
  await sleep(80);
  check('Delete removes the selected slice', ((await st('store.doc.slices')) ?? []).length === 0 && (await shapes()).length === 1);
}

// 20. Perspective grid and attaching a shape to it
await setup();
await tool('perspective-grid');
await click(500, 600);
check('Perspective Grid tool shows the grid', (await st('store.doc.perspective?.visible')) === true);
await tool('perspective-select');
await drag(line(450, 325, 260, 325));
{
  const pts = await st(`(() => { const l = store.doc.layers.find((l) => l.name === 'A'); return l.shape.points.map((p) => [l.x + p.x * l.width, l.y + p.y * l.height]); })()`);
  const xs = pts.map((p) => p[0]);
  const left = pts.filter((p) => p[0] < Math.min(...xs) + 5).map((p) => p[1]);
  const right = pts.filter((p) => p[0] > Math.max(...xs) - 5).map((p) => p[1]);
  const lh = Math.max(...left) - Math.min(...left), rh = Math.max(...right) - Math.min(...right);
  check('Perspective Selection puts the shape on the receding plane', lh < rh - 20, { lh, rh });
}

// 21. Packaging tool places a dieline group
await setup();
await tool('packaging');
await click(500, 350);
check('Packaging tool places a dieline group', /Dieline/.test(await st(`store.activeLayer.name`)));

const errors = b.logs.filter((l) => l.startsWith('[exception]'));
check('no exceptions in the page', errors.length === 0, errors.slice(0, 3));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
