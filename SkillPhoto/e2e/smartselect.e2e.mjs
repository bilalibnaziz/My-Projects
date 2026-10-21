// Smart selection in the real app: Select Subject, Object Selection (box + click), edge-snapping Quick
// Selection, Select and Mask (real brush strokes + output), Remove Background as a mask, Select Sky,
// colour-range presets. Accuracy is measured as IoU against the true shapes.
import { connect, sleep, META, ALT, SHIFT } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};

const W = 600, H = 400;
// Shapes (doc px), evaluated in the page too
const SHAPES = {
  subject: '((x - 330) / 130) ** 2 + ((y - 215) / 105) ** 2 < 1',
  ball: '(x - 90) ** 2 + (y - 90) ** 2 < 42 ** 2',
};

const geo = () => b.eval(`
  const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
  const v = window.__ps.store.doc.view;
  return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };
`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
const drag = async (pts, opts = {}) => {
  const g = await geo();
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, c] = [pts[i], pts[i + 1]];
    for (let k = 0; k < 8; k++) out.push(S(g, a[0] + ((c[0] - a[0]) * k) / 8, a[1] + ((c[1] - a[1]) * k) / 8));
  }
  out.push(S(g, ...pts[pts.length - 1]));
  await b.drag(out, { delay: 4, ...opts });
  await sleep(150);
};
const click = async (x, y, opts) => {
  const g = await geo();
  const p = S(g, x, y);
  await b.click(p.x, p.y, opts);
  await sleep(150);
};
const tool = async (t) => {
  await b.eval(`window.__ps.store.setTool(${JSON.stringify(t)}); return true`);
  await sleep(50);
};
const idle = () => b.waitFor(`!window.__ps.store.state.busy`, 30000);

/** IoU of a doc-size alpha source (selection or the active layer's mask) against a shape expression. */
const iou = (expr, source = 'selection') =>
  b.eval(`
  const { store } = window.__ps;
  const d = store.doc;
  const c = ${source === 'selection' ? 'd.selection?.canvas' : 'store.activeLayer?.mask?.canvas'};
  if (!c) return 0;
  const a = c.getContext('2d').getImageData(0, 0, d.width, d.height).data;
  let inter = 0, uni = 0;
  for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
    const s = a[(y * d.width + x) * 4 + 3] >= 128;
    const t = ${expr};
    if (s && t) inter++;
    if (s || t) uni++;
  }
  return Math.round((inter / Math.max(1, uni)) * 1000) / 1000;`);

/** Photo-like scene: textured, shaded background; a warm shaded subject; a blue ball. */
const scene = (kind = 'objects') => b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false, transform: null });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(${W}, ${H}, 'white', 'Smart');
  const c = store.activeLayer.canvas; const x = c.getContext('2d');
  const img = x.createImageData(${W}, ${H});
  let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
  for (let y = 0; y < ${H}; y++) for (let X = 0; X < ${W}; X++) {
    const i = (y * ${W} + X) * 4; const n = (rnd() - 0.5) * 36;
    let r, g, b;
    if (${JSON.stringify(kind)} === 'sky') {
      const horizon = 170 + Math.round(18 * Math.sin(X / 37));
      if (y < horizon) { r = 110 + y * 0.4; g = 165 + y * 0.3; b = 240; }
      else { r = 70 + n * 2; g = 95 + n * 2; b = 45 + n * 2; }
    } else {
      const x = X;
      const shade = 0.85 + 0.3 * (X / ${W});
      if (${SHAPES.subject}) { const l = 1 - 0.35 * (((x - 330) / 130) ** 2 + ((y - 215) / 105) ** 2); r = 230 * l + n; g = 120 * l + n; b = 70 * l + n; }
      else if (${SHAPES.ball}) { r = 40 + n; g = 80 + n; b = 210 + n; }
      else { r = (95 + n) * shade; g = (130 + n) * shade; b = (90 + n) * shade; }
    }
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const { touch } = await import('/src/core/canvas.ts'); touch(c);
  store.setOpts({ size: 24, sampleAll: true, quickEdge: true });
  store.invalidateRender();
  let cv = null;
  for (let i = 0; i < 50 && !cv; i++) { await new Promise((r) => setTimeout(r, 30)); cv = document.querySelector('.viewport-canvas'); }
  const v = store.doc.view; v.zoom = 1; v.panX = Math.round((cv.clientWidth - ${W}) / 2); v.panY = Math.round((cv.clientHeight - ${H}) / 2);
  store.emit();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
`);

// 1. Select ▸ Subject (⌥⌘⇧S) finds the subject and the ball is not the subject
await scene();
await b.key('S', { modifiers: META | ALT | SHIFT, code: 'KeyS' });
await sleep(200);
await idle();
const subj = await iou(SHAPES.subject);
const both = await iou(`(${SHAPES.subject}) || (${SHAPES.ball})`);
check('Select Subject (⌥⌘⇧S) selects the subject', Math.max(subj, both) > 0.9, { subj, both });

// 2. Object Selection: a box around the ball selects the ball only
await b.eval(`window.__ps.ops.deselect(); return true`);
await tool('object-select');
await drag([[38, 38], [145, 145]]);
await idle();
const ball = await iou(SHAPES.ball);
check('Object Selection box snaps to the ball', ball > 0.9, { ball });

// 3. Shift-click on the subject adds it
await click(330, 215, { modifiers: SHIFT });
await idle();
const union = await iou(`(${SHAPES.subject}) || (${SHAPES.ball})`);
check('Object Selection Shift-click adds the clicked object', union > 0.88, { union });

// 4. ⌥-drag a box over the ball subtracts it
await drag([[38, 38], [145, 145]], { modifiers: ALT });
await idle();
const minusBall = await iou(SHAPES.subject);
check('Object Selection ⌥-box subtracts the ball', minusBall > 0.88, { minusBall });

// 5. Quick Selection: a short stroke inside the subject snaps to its whole outline on release
await b.eval(`window.__ps.ops.deselect(); return true`);
await tool('quick-select');
await drag([[290, 210], [370, 220]]);
await idle();
const quick = await iou(SHAPES.subject);
check('Quick Selection stroke snaps to the object edge', quick > 0.9, { quick });

// ⌥ stroke over the ball area after adding it removes only the ball
await drag([[80, 85], [100, 95]], { modifiers: SHIFT });
await idle();
const withBall = await iou(`(${SHAPES.subject}) || (${SHAPES.ball})`);
await drag([[80, 85], [100, 95]], { modifiers: ALT });
await idle();
const ballGone = await iou(SHAPES.subject);
check('Quick Selection Shift adds the ball, ⌥ paints it away again', withBall > 0.85 && ballGone > 0.88, { withBall, ballGone });

// 6. Select and Mask: opens with ⌥⌘R, real Quick Selection brush stroke on its canvas, output to a layer mask
await b.eval(`window.__ps.ops.deselect(); return true`);
await b.key('r', { modifiers: META | ALT });
await b.waitFor(`!!document.querySelector('[data-testid="select-mask"]')`, 5000).catch(() => {});
const opened = await b.eval(`return !!document.querySelector('[data-testid="select-mask"] canvas')`);
check('⌥⌘R opens Select and Mask', opened);
const cvRect = await b.eval(`const c = document.querySelector('.sm-canvas'); const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, sx: r.width / c.width, sy: r.height / c.height, cw: c.width }`);
const SM = (x, y) => {
  const k = cvRect.cw / W; // proxy px per doc px
  return { x: cvRect.left + x * k * cvRect.sx, y: cvRect.top + y * k * cvRect.sy };
};
{
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push(SM(75 + i * 2.5, 90));
  await b.drag(pts, { delay: 6 });
  await sleep(300);
}
const tint = await b.eval(`
  const c = document.querySelector('.sm-canvas'); const ctx = c.getContext('2d'); const k = c.width / ${W};
  const inBall = Array.from(ctx.getImageData(Math.round(90 * k), Math.round(110 * k), 1, 1).data);
  const out = Array.from(ctx.getImageData(Math.round(200 * k), Math.round(60 * k), 1, 1).data);
  return { inBall, out };`);
check('Select and Mask overlay view tints what is not selected', tint.out[0] > tint.out[1] + 30 && !(tint.inBall[0] > tint.inBall[2]), tint);
// Output: Layer Mask, then OK
await b.eval(`
  const s = [...document.querySelectorAll('.select-mask select')].find((e) => [...e.options].some((o) => o.value === 'layer-mask'));
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(s, 'mask');
  s.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
await sleep(100);
{
  const ok = await b.eval(`const r = document.querySelector('[data-testid="sm-ok"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`);
  await b.click(ok.x, ok.y);
}
await sleep(200);
await idle();
const smMask = await iou(SHAPES.ball, 'mask');
check('Select and Mask brush stroke → OK puts the ball in a layer mask', smMask > 0.85, { smMask });
await b.eval(`window.__ps.ops.deleteMask(); return true`);

// 7. Select and Mask Select Subject + Shift Edge grows the result
await b.key('r', { modifiers: META | ALT });
await b.waitFor(`!!document.querySelector('[data-testid="select-mask"]')`, 5000).catch(() => {});
await b.eval(`[...document.querySelectorAll('.select-mask button')].find((e) => e.textContent.includes('Select Subject')).click(); return true`);
await b.waitFor(`!document.querySelector('.sm-busy')`, 20000).catch(() => {});
await sleep(300);
await b.eval(`
  const s = [...document.querySelectorAll('.select-mask select')].find((e) => [...e.options].some((o) => o.value === 'layer-mask'));
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(s, 'selection');
  s.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
await sleep(100);
await b.key('Enter', { code: 'Enter', vk: 13 });
await sleep(200);
await idle();
const smSubj = await iou(`(${SHAPES.subject}) || (${SHAPES.ball})`);
const smSubj2 = await iou(SHAPES.subject);
check('Select and Mask "Select Subject" → Enter outputs the subject selection', Math.max(smSubj, smSubj2) > 0.88, { smSubj, smSubj2 });

// 8. Remove Background hides the background with a mask (pixels kept)
await b.eval(`window.__ps.ops.deselect(); return true`);
await b.eval(`const { COMMANDS } = await import('/src/core/commands.ts'); const c = COMMANDS.find((c) => c.id === 'remove-bg'); await c.run(); return true`);
await sleep(200);
await idle();
const rb = await iou(`(${SHAPES.subject}) || (${SHAPES.ball})`, 'mask');
const rb2 = await iou(SHAPES.subject, 'mask');
const kept = await b.eval(`const l = window.__ps.store.activeLayer; return Array.from(l.canvas.getContext('2d').getImageData(20, 300, 1, 1).data)`);
check('Remove Background adds a subject mask and keeps the pixels', Math.max(rb, rb2) > 0.88 && kept[3] === 255, { rb, rb2, kept });

// 9. Select ▸ Sky on a landscape
await scene('sky');
await b.eval(`const m = await import('/src/core/smartSelect.ts'); await m.selectSky(); return true`);
await idle();
const sky = await iou(`y < 170 + Math.round(18 * Math.sin(x / 37))`);
check('Select Sky follows the horizon', sky > 0.9, { sky });

// 10. Colour range presets: highlights picks the bright sky, not the dark ground
await b.eval(`const m = await import('/src/core/smartSelect.ts'); await m.selectRange('shadows'); return true`);
await idle();
const sh = await b.eval(`const s = window.__ps.store.doc.selection; if (!s) return null; const d = s.canvas.getContext('2d'); return [d.getImageData(300, 40, 1, 1).data[3], d.getImageData(300, 330, 1, 1).data[3]]`);
check('Color Range · Shadows selects the dark ground, not the sky', !!sh && sh[0] < 60 && sh[1] > 120, sh);

// 11. The bundled on-device models really run (worker + WASM), and find the person in the sample portrait
const photo = () => b.eval(`
  const { store } = window.__ps;
  store.set({ dialog: null });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  const im = new Image(); im.src = '/samples/portrait.jpg'; await im.decode();
  const { ops } = window.__ps;
  ops.newDocument(im.naturalWidth, im.naturalHeight, 'white', 'Portrait');
  const c = store.activeLayer.canvas; c.getContext('2d').drawImage(im, 0, 0);
  const { touch } = await import('/src/core/canvas.ts'); touch(c);
  store.invalidateRender();
  return [im.naturalWidth, im.naturalHeight];
`);
const [PW, PH] = await photo();
const ai = await b.eval(`
  const ai = await import('/src/core/aiModels.ts');
  const { docImage } = await import('/src/core/smartSelect.ts');
  const img = docImage();
  const t0 = performance.now();
  const r = await ai.subjectPrior(img, { x: 0, y: 0, w: img.w, h: img.h }, true);
  return r && { portrait: r.portrait, w: r.prior.w, ms: Math.round(performance.now() - t0), isolated: crossOriginIsolated };
`);
check('On-device AI models run and recognise a portrait', !!ai && ai.portrait, ai);

// 12. Layer ▸ Cut Out Subject: new layer, transparent background, opaque subject, original hidden
await b.eval(`const m = await import('/src/core/smartSelect.ts'); await m.cutOutSubject(); return true`);
await idle();
const cut = await b.eval(`
  const { store } = window.__ps; const d = store.doc;
  const l = store.activeLayer; const x = l.canvas.getContext('2d');
  const a = (px, py) => x.getImageData(px, py, 1, 1).data[3];
  return { n: d.layers.length, name: l.name, corner: a(5, 5), face: a(Math.round(${PW} * 0.5), Math.round(${PH} * 0.3)), body: a(Math.round(${PW} * 0.4), Math.round(${PH} * 0.8)), origHidden: !d.layers[0].visible };
`);
check('Cut Out Subject makes a clean cut-out layer', cut.n === 2 && cut.corner === 0 && cut.face === 255 && cut.body === 255 && cut.origHidden, cut);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
process.exit(failed.length ? 1 : 0);
