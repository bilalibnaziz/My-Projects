// Pencil tool with real pointer input: fit accuracy (also zoomed in), corners, seamless closing, StreamLine,
// hold-to-QuickShape (circle, rotated rectangle), quick lifts staying freehand, and editing a selected path.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 500) : '');
};
const geo = () => b.eval(`
  const { store } = window.__ps;
  const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
  const v = store.doc.view;
  return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };
`);
let g;
const S = (p) => ({ x: g.left + g.panX + p.x * g.zoom, y: g.top + g.panY + p.y * g.zoom });
const st = (expr) => b.eval(`const { store } = window.__ps; return (${expr})`);
const setup = async (opts = {}, zoom = 1) => {
  await b.eval(`
    const { store, ops } = window.__ps;
    store.set({ dialog: null, paletteOpen: false, transform: null, textEditId: null });
    while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
    ops.newDocument(1000, 700, 'white', 'Pencil');
    store.set({ fg: '#2255ee', bg: '#ffffff' });
    store.setOpts({ shapeStrokeWidth: 3, shapeFill: false, pencilFidelity: 2, pencilStreamline: 0, pencilQuickShape: true, pencilSculpt: true, pencilAutoClose: true, pencilCloseThreshold: 20, ...${JSON.stringify(opts)} });
    store.setTool('pencil');
  `);
  await sleep(150);
  // Zoom after the new document has fitted itself to the view
  if (zoom !== 1) {
    await b.eval(`const { store } = window.__ps; const v = store.doc.view; v.zoom = ${zoom}; v.panX = -150 * ${zoom}; v.panY = -150 * ${zoom}; store.emit();`);
    await sleep(150);
  }
  g = await geo();
};
/** Presses, moves through the points, optionally holds still, then releases. */
const stroke = async (pts, holdMs = 0) => {
  const s = pts.map(S);
  await b.mouse('mouseMoved', s[0].x, s[0].y);
  await b.mouse('mousePressed', s[0].x, s[0].y);
  for (const p of s.slice(1)) {
    await b.mouse('mouseMoved', p.x, p.y, { buttons: 1, button: 'left' });
    await sleep(3);
  }
  if (holdMs) await sleep(holdMs);
  const l = s[s.length - 1];
  await b.mouse('mouseReleased', l.x, l.y, { buttons: 0 });
  await sleep(80);
};
const shapes = () => st(`store.doc.layers.filter((l) => l.kind === 'shape').map((l) => ({ id: l.id, name: l.name, kind: l.shape.shape, x: l.x, y: l.y, w: l.width, h: l.height, rot: l.rotation ?? 0, closed: !!l.shape.closed, fill: !!l.shape.fillEnabled, pts: l.shape.points?.length ?? 0, types: (l.shape.points ?? []).map((p) => p.type) }))`);
/** Worst distance (document px) from the given points to the top path layer, and from the path back to them. */
const deviation = (pts) => b.eval(`
  const { store } = window.__ps;
  const l = store.doc.layers.filter((l) => l.kind === 'shape').at(-1);
  const P = l.shape.points;
  const X = (v) => l.x + v * l.width, Y = (v) => l.y + v * l.height;
  const samples = [];
  const n = l.shape.closed ? P.length : P.length - 1;
  for (let i = 0; i < n; i++) {
    const a = P[i], c = P[(i + 1) % P.length];
    for (let k = 0; k <= 60; k++) {
      const t = k / 60, u = 1 - t;
      samples.push({
        x: u*u*u*X(a.x) + 3*u*u*t*X(a.ox) + 3*u*t*t*X(c.ix) + t*t*t*X(c.x),
        y: u*u*u*Y(a.y) + 3*u*u*t*Y(a.oy) + 3*u*t*t*Y(c.iy) + t*t*t*Y(c.y),
      });
    }
  }
  const pts = ${JSON.stringify(pts)};
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 8; k++) dense.push({ x: pts[i].x + (pts[i+1].x - pts[i].x) * k / 8, y: pts[i].y + (pts[i+1].y - pts[i].y) * k / 8 });
  dense.push(pts.at(-1));
  // Distance to a polyline (point-to-segment), so sparse samples don't inflate it
  const seg = (p, a, c) => {
    const dx = c.x - a.x, dy = c.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
  };
  const near = (p, line) => { let m = Infinity; for (let i = 0; i < line.length - 1; i++) m = Math.min(m, seg(p, line[i], line[i + 1])); return m; };
  return { toPath: Math.max(...dense.map((p) => near(p, samples))), toInput: Math.max(...samples.map((p) => near(p, dense))) };
`);
const wave = (x0, y0, len, amp, n = 90) => Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + (len * i) / n, y: y0 + amp * Math.sin((i / n) * Math.PI * 3) }));
const circle = (cx, cy, r, n = 72, turn = 1) => Array.from({ length: n + 1 }, (_, i) => ({ x: cx + r * Math.cos((i / n) * Math.PI * 2 * turn), y: cy + r * Math.sin((i / n) * Math.PI * 2 * turn) }));
const poly = (verts, step = 6) => {
  const out = [];
  for (let i = 0; i < verts.length - 1; i++) {
    const d = Math.hypot(verts[i + 1].x - verts[i].x, verts[i + 1].y - verts[i].y);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 0; k < n; k++) out.push({ x: verts[i].x + ((verts[i + 1].x - verts[i].x) * k) / n, y: verts[i].y + ((verts[i + 1].y - verts[i].y) * k) / n });
  }
  out.push(verts.at(-1));
  return out;
};

// 1. A wavy stroke is followed within the Fidelity tolerance, with few anchors
await setup();
{
  const pts = wave(100, 300, 700, 80);
  await stroke(pts);
  const s = await shapes();
  const dev = await deviation(pts);
  check('Pencil follows a wavy stroke within tolerance with few anchors', s.length === 1 && s[0].name === 'Pencil Path' && !s[0].closed && s[0].pts <= 9 && dev.toPath < 2.2 / g.zoom && dev.toInput < 2.2 / g.zoom, { s, dev, zoom: g.zoom });
}

// 2. Zoomed in 4×, Fidelity is in screen pixels: the fit is 4× tighter in document units
await setup({}, 4);
{
  const pts = wave(170, 230, 150, 20, 120);
  await stroke(pts);
  const dev = await deviation(pts);
  check('At 400% the fit is tight in document units (Fidelity is on screen)', g.zoom === 4 && dev.toPath < 0.6 && dev.toInput < 0.6, { zoom: g.zoom, ...dev });
}

// 3. Sharp corners stay sharp
await setup();
{
  const pts = poly([{ x: 150, y: 500 }, { x: 350, y: 150 }, { x: 550, y: 500 }, { x: 750, y: 150 }]);
  await stroke(pts);
  const s = (await shapes())[0];
  const dev = await deviation(pts);
  check('A zig-zag keeps its corners as corner anchors', s && s.pts === 4 && s.types.every((t) => t === 'corner') && dev.toPath < 2, { s, dev });
}

// 4. A loop that ends on its start closes seamlessly (smooth where the ends meet), quick lift = no QuickShape
await setup({ shapeFill: true });
{
  const pts = circle(500, 350, 150).map((p, i) => ({ x: p.x + 6 * Math.sin(i * 0.9), y: p.y }));
  await stroke(pts);
  const s = (await shapes())[0];
  check('A quick loop stays freehand, closed and filled, smooth at the join', s && s.kind === 'path' && s.closed && s.fill && s.types[0] === 'smooth', s);
}

// 5. Hold at the end: a rough circle snaps to a true circle
await setup();
{
  const pts = circle(500, 350, 150).map((p, i) => ({ x: p.x + 4 * Math.sin(i * 1.3), y: p.y + 3 * Math.cos(i * 0.7) }));
  await stroke(pts, 700);
  const s = (await shapes())[0];
  check('Holding at the end snaps a rough circle to a circle', s && s.kind === 'ellipse' && Math.abs(s.w - s.h) < 0.01 && Math.abs(s.w - 300) < 14 && Math.abs(s.x + s.w / 2 - 500) < 5, s);
}

// 6. Hold at the end: a rotated box snaps to a rotated rectangle
await setup();
{
  const t = (20 * Math.PI) / 180;
  const c = [[-200, -80], [200, -80], [200, 80], [-200, 80], [-200, -80]].map(([x, y]) => ({ x: 500 + x * Math.cos(t) - y * Math.sin(t), y: 350 + x * Math.sin(t) + y * Math.cos(t) }));
  await stroke(poly(c), 700);
  const s = (await shapes())[0];
  check('Holding at the end snaps a rotated box to a rotated rectangle', s && s.kind === 'rectangle' && Math.abs(s.rot - 20) < 1.5 && Math.abs(s.w - 400) < 12 && Math.abs(s.h - 160) < 12, s);
}

// 7. StreamLine: the stroke still ends exactly where the pen was lifted
await setup({ pencilStreamline: 30 });
{
  const pts = wave(100, 300, 700, 60);
  await stroke(pts);
  const end = await st(`(() => { const l = store.doc.layers.filter((l) => l.kind === 'shape').at(-1); const p = l.shape.points.at(-1); return { x: l.x + p.x * l.width, y: l.y + p.y * l.height }; })()`);
  check('With StreamLine the path ends at the release point', end && Math.hypot(end.x - 800, end.y - pts.at(-1).y) < 1, end);
}

// 8. Edit selected path: draw an arch from one point on a straight path to another → that stretch is reshaped
await setup();
{
  await stroke(poly([{ x: 100, y: 400 }, { x: 900, y: 400 }]));
  const before = await shapes();
  const arch = [{ x: 300, y: 402 }, ...Array.from({ length: 40 }, (_, i) => { const a = Math.PI + (Math.PI * (i + 1)) / 41; return { x: 400 + 100 * Math.cos(a), y: 400 + 100 * Math.sin(a) }; }), { x: 500, y: 401 }];
  await stroke(arch);
  const after = await shapes();
  const top = await b.eval(`
    const { store } = window.__ps;
    const l = store.doc.layers.filter((l) => l.kind === 'shape')[0];
    return l.y;
  `);
  check('Drawing over a selected path reshapes it in place (same layer, arch added, ends kept)', before.length === 1 && after.length === 1 && after[0].id === before[0].id && after[0].pts >= 4 && top < 330 && Math.abs(after[0].x - 100) < 1 && Math.abs(after[0].x + after[0].w - 900) < 1, { before, after, top });
}

// 9. Extend from an open end, then close end to end
await setup({ shapeFill: true });
{
  await stroke(poly([{ x: 200, y: 200 }, { x: 600, y: 200 }]));
  await stroke(poly([{ x: 602, y: 201 }, { x: 600, y: 500 }]));
  const ext = await shapes();
  await stroke(poly([{ x: 601, y: 499 }, { x: 200, y: 500 }, { x: 201, y: 202 }]));
  const closed = await shapes();
  check('Starting at an open end extends the path; end-to-end closes it', ext.length === 1 && !ext[0].closed && closed.length === 1 && closed[0].closed && closed[0].fill && closed[0].pts === 4, { ext, closed });
}

// 10. Undo restores the path before an edit
{
  await b.key('z', { modifiers: 4 });
  await sleep(100);
  const s = await shapes();
  check('Undo restores the open path', s.length === 1 && !s[0].closed, s);
}

const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} passed`);
b.close();
process.exit(failedCount ? 1 : 0);
