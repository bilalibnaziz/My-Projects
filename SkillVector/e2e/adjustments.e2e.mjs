// New adjustment stages on the GPU: Gradient Map (incl. a one-click duotone from the panel),
// Channel Mixer, Selective Color and Photo Filter, checked against their formulas.
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
const docPx = (x, y) => st(`Array.from(store.renderer.render(store.doc, store.overrides).getContext('2d').getImageData(${x}, ${y}, 1, 1).data)`);
const near = (a, e, tol = 3) => a.slice(0, 3).every((v, i) => Math.abs(v - e[i]) <= tol);
const fresh = (color) =>
  b.eval(`const { store, ops } = window.__ps; store.set({ dialog: null }); while (store.state.docs.length) store.closeDoc(store.state.docs[0].id); ops.newDocument(64, 64, '${color}', 'Adj', undefined);`);
/** Adds an adjustment layer whose settings are the defaults plus `patch`. */
const adjust = (patch) => b.eval(`const { store, ops } = window.__ps; const { defaultAdjust } = await import('/src/core/types.ts'); ops.newAdjustmentLayer({ ...defaultAdjust(), ...${patch} }, 'Test');`);

// 1. Gradient map: red (luma 0.2126) on a black→blue map = 21% blue
{
  await fresh('#ff0000');
  await adjust(`{ gradientMap: { amount: 100, shadow: '#000000', mid: '#808080', highlight: '#0000ff', useMid: false } }`);
  await sleep(150);
  const px = await docPx(10, 10);
  check('Gradient Map maps luminance onto the colors', near(px, [0, 0, 54]), px);
}

// 2. Channel mixer: red output from nothing, green output from red → pure red becomes pure green
{
  await fresh('#ff0000');
  await adjust(`{ mixer: { r: [0, 0, 0], g: [100, 0, 0], b: [0, 0, 100], mono: false } }`);
  await sleep(150);
  const px = await docPx(10, 10);
  check('Channel Mixer routes red into green', near(px, [0, 255, 0]), px);
}

// 3. Selective color: +100% cyan in reds removes the red; blue pixels are untouched
{
  await fresh('#ff0000');
  await b.eval(`const { store } = window.__ps; const c = store.doc.layers[0].canvas; const g = c.getContext('2d'); g.fillStyle = '#0000ff'; g.fillRect(32, 0, 32, 64); (await import('/src/core/canvas.ts')).touch(c);`);
  const sel = `Object.fromEntries(['reds','yellows','greens','cyans','blues','magentas','whites','neutrals','blacks'].map(r => [r, { c: r === 'reds' ? 100 : 0, m: 0, y: 0, k: 0 }]))`;
  await adjust(`{ selective: ${sel} }`);
  await sleep(150);
  const red = await docPx(10, 10);
  const blue = await docPx(50, 10);
  check('Selective Color shifts only the chosen range', near(red, [0, 0, 0]) && near(blue, [0, 0, 255]), { red, blue });
}

// 4. Photo filter: full-density blue on white without luminosity preservation = blue
{
  await fresh('#ffffff');
  await adjust(`{ photoFilter: { color: '#0000ff', density: 100, preserve: false } }`);
  await sleep(150);
  const px = await docPx(10, 10);
  await b.eval(`const { store, ops } = window.__ps; const { defaultAdjust } = await import('/src/core/types.ts'); ops.setAdjust(store.activeLayer.id, { ...defaultAdjust(), photoFilter: { color: '#ec8a00', density: 40, preserve: true } }, 'PF');`);
  await sleep(150);
  const warm = await docPx(10, 10);
  check('Photo Filter tints; preserve luminosity keeps brightness', near(px, [0, 0, 255]) && warm[0] > warm[2] + 20, { px, warm });
}

// 5. The panel: open Gradient Map, click a duotone → a new adjustment layer with that map
{
  await fresh('#808080');
  await b.eval(`window.__ps.store.setDockTab('adjust')`);
  await sleep(150);
  const head = await b.eval(`const h = [...document.querySelectorAll('.section-head')].find(h => h.textContent.includes('Gradient Map')); if (!h) return null; h.scrollIntoView(); const r = h.getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 };`);
  if (head) await b.click(head.x, head.y);
  await sleep(150);
  const p = await b.eval(`const el = [...document.querySelectorAll('.gm-preset')].find(e => e.textContent.trim() === 'Neon'); if (!el) return null; el.scrollIntoView(); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  if (p) await b.click(p.x, p.y);
  await sleep(200);
  const r = await st(`({ kind: store.activeLayer.kind, gm: store.activeLayer.adjust?.gradientMap })`);
  const px = await docPx(10, 10);
  check('one click on a duotone adds a Gradient Map adjustment layer', r.kind === 'adjustment' && r.gm?.amount === 100 && r.gm?.mid === '#ff2a6d' && !('name' in r.gm) && !near(px, [128, 128, 128], 10), { r, px });
}

// 6. Color balance: +100 red in midtones on mid gray reddens it, preserve-luminosity keeps the brightness
{
  await fresh('#808080');
  await adjust(`{ colorBalance: { shadows: [0, 0, 0], midtones: [100, 0, 0], highlights: [0, 0, 0], preserve: false } }`);
  await sleep(150);
  const px = await docPx(10, 10);
  check('Color Balance shifts midtones toward red', px[0] > 150 && Math.abs(px[1] - 128) <= 3 && Math.abs(px[2] - 128) <= 3, px);
}

// 7. Black & White mixer: reds at 100% turn pure red white, reds at 0% turn it black
{
  await fresh('#ff0000');
  const mix = (r) => `{ bwMix: { enabled: true, reds: ${r}, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#e1d3b3' } }`;
  await adjust(mix(100));
  await sleep(150);
  const white = await docPx(10, 10);
  await b.eval(`const { store, ops } = window.__ps; const { defaultAdjust } = await import('/src/core/types.ts'); ops.setAdjust(store.activeLayer.id, { ...defaultAdjust(), ...${mix(0)} }, 'BW');`);
  await sleep(150);
  const black = await docPx(10, 10);
  check('Black & White mixer weights colors like Photoshop', near(white, [255, 255, 255]) && near(black, [0, 0, 0]), { white, black });
}

// 8. Color lookup: an inverting .cube LUT at 100% and 50%
{
  await fresh('#ff8000');
  const r = await b.eval(`
    const { store, ops } = window.__ps;
    const { defaultAdjust } = await import('/src/core/types.ts');
    const lut = await import('/src/core/lut.ts');
    const cube = ['LUT_3D_SIZE 2', '1 1 1', '0 1 1', '1 0 1', '0 0 1', '1 1 0', '0 1 0', '1 0 0', '0 0 0'].join(String.fromCharCode(10));
    const parsed = lut.parseCube(cube);
    ops.newAdjustmentLayer({ ...defaultAdjust(), lut: { name: 'invert', size: 2, data: lut.encodeLut(parsed), amount: 100 } }, 'LUT');
    return true;`);
  await sleep(150);
  const inv = await docPx(10, 10);
  await b.eval(`const { store, ops } = window.__ps; const a = store.activeLayer.adjust; ops.setAdjust(store.activeLayer.id, { ...a, lut: { ...a.lut, amount: 50 } }, 'LUT');`);
  await sleep(150);
  const half = await docPx(10, 10);
  check('Color Lookup applies a .cube LUT and blends by amount', r && near(inv, [0, 127, 255]) && near(half, [128, 128, 128], 3), { inv, half });
}

const errors = b.logs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]'));
check('no console errors', errors.length === 0, errors);
b.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
