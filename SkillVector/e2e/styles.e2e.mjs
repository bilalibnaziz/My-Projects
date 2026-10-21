// Layer styles: the fx button opens the floating Layer Style panel, presets and effect toggles
// change the rendered pixels live, undo works while the panel is open, and styles export and
// survive a project save / load.
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
const centerOf = (selector, text) =>
  b.eval(`const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = ${text ? `els.find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}) || e.title.startsWith(${JSON.stringify(text)}) || e.getAttribute('aria-label') === ${JSON.stringify(text)})` : 'els[0]'}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
const clickEl = async (selector, text) => {
  const p = await centerOf(selector, text);
  if (p) await b.click(p.x, p.y);
  await sleep(150);
  return !!p;
};
/** Rendered document pixel. */
const docPx = (x, y) => st(`Array.from(store.renderer.render(store.doc, store.overrides).getContext('2d').getImageData(${x}, ${y}, 1, 1).data)`);

// A 400×300 white document with a red square shape layer at (150, 100) 100×100
await b.eval(`const { store, ops } = window.__ps; store.set({ dialog: null }); while (store.state.docs.length) store.closeDoc(store.state.docs[0].id); ops.newDocument(400, 300, 'white', 'Styles', undefined);`);
await sleep(200);
await b.eval(`
  const { store } = window.__ps;
  const doc = store.doc;
  const layer = { ...doc.layers[0], id: 'sq', v: 999999, kind: 'shape', name: 'Square', canvas: undefined, x: 150, y: 100, width: 100, height: 100,
    shape: { shape: 'rectangle', fill: '#ff0000', fillEnabled: true, stroke: '#000000', strokeWidth: 0, radius: 0, sides: 5 } };
  store.commit('Add Square', { layers: [...doc.layers, layer], activeId: 'sq' });
`);
await sleep(150);
const before = await docPx(140, 150); // 10 px left of the square: white page

// 1. fx button opens the floating panel without covering the canvas with a veil
{
  await clickEl('.layers-foot .icon-btn', 'Layer style');
  const r = await b.eval(`return { panel: !!document.querySelector('.fx-panel'), veil: !!document.querySelector('.overlay'), presets: document.querySelectorAll('.fx-preset').length }`);
  check('fx button opens the Layer Style panel (no modal veil) with preset previews', r.panel && !r.veil && r.presets >= 8, r);
}

// 2. The Stroke switch enables a stroke; 10 px left of the square turns to the stroke color
{
  await clickEl('.fx-item-head', 'Stroke');
  // Clicking the row expands it; the switch enables it
  const toggled = await b.eval(`const row = [...document.querySelectorAll('.fx-item')].find(r => r.textContent.includes('Stroke')); row.querySelector('.toggle-box').click(); return true;`);
  await sleep(150);
  await b.eval(`const m = await import('/src/core/layerStyle.ts'); m.setEffect('stroke', { color: '#0000ff', size: 12 });`);
  await sleep(150);
  const px = await docPx(140, 150);
  const inside = await docPx(200, 150);
  check('stroke paints 12 px around the shape and leaves the fill alone', toggled && px.join() === '0,0,255,255' && inside.join() === '255,0,0,255' && before.join() === '255,255,255,255', { before, px, inside });
}

// 3. Undo (⌘Z) works while the panel is open, and the panel stays open
{
  await b.key('z', { modifiers: MOD });
  await sleep(150);
  const px = await docPx(140, 150);
  const open = await b.eval(`return !!document.querySelector('.fx-panel')`);
  check('⌘Z undoes style edits with the panel open', px.join() !== '0,0,255,255' && open, { px, open });
  await b.key('z', { modifiers: MOD | 8 });
  await sleep(150);
}

// 4. Preset: Retro Offset (hard shadow, 135°, 12 px) lands down-right of the square
{
  await clickEl('.fx-preset', 'Retro Offset');
  const shadow = await docPx(254, 205); // shadow is offset (8, 8): just below-right of the corner
  const notLeft = await docPx(145, 150);
  const fx = await st(`store.activeLayer.fx.dropShadow`);
  check('Retro Offset preset casts a hard shadow down-right only', fx.enabled && shadow[0] < 40 && notLeft.join() === '255,255,255,255', { shadow, notLeft, fx });
}

// 5. Fill opacity 0 hides the pixels but keeps the effects
{
  await b.eval(`const m = await import('/src/core/layerStyle.ts'); m.applyPreset('outline'); m.setEffect('stroke', { color: '#00ff00', size: 6 }); m.setFill(0);`);
  await sleep(150);
  const inside = await docPx(200, 150);
  const ring = await docPx(147, 150);
  check('fill 0% shows the page through the shape but keeps the stroke', inside.join() === '255,255,255,255' && ring.join() === '0,255,0,255', { inside, ring });
}

// 6. Moving a styled layer moves its effects (cached, not recomputed)
{
  await b.eval(`const { store } = window.__ps; store.updateLayer('sq', { x: 170 }, 'Move');`);
  await sleep(150);
  const ring = await docPx(167, 150);
  check('effects follow the layer when it moves', ring.join() === '0,255,0,255', { ring });
}

// 7. Styles survive save / load
{
  const r = await b.eval(`
    const io = await import('/src/core/io.ts');
    const { store } = window.__ps;
    const json = io.serializeProject(store.doc);
    const doc = await io.loadProject(json, 'Reloaded');
    const l = doc.layers.find(l => l.name === 'Square');
    return { stroke: l.fx?.stroke?.enabled, fill: l.fill };
  `);
  await sleep(150);
  const ring = await docPx(167, 150);
  check('styles and fill survive a project round-trip', r.stroke === true && r.fill === 0 && ring.join() === '0,255,0,255', { r, ring });
}

// 8. Esc closes the panel; the layer row shows an fx badge
{
  await b.eval(`window.__ps.store.set({ dialog: { type: 'layerStyle' } })`);
  await sleep(100);
  await b.key('Escape', { code: 'Escape', vk: 27 });
  await sleep(120);
  const r = await b.eval(`return { open: !!document.querySelector('.fx-panel'), badge: !!document.querySelector('.layer-row .fx-badge') }`);
  check('Esc closes the panel and the layer shows an fx badge', !r.open && r.badge, r);
}

// 9. Blend modes Canvas 2D lacks: Subtract (white − red = cyan) and Divide (white ÷ red = white/cyan)
{
  await b.eval(`const { store } = window.__ps; store.updateLayer('sq', { fx: undefined, fill: 1, blend: 'subtract' }, 'Blend');`);
  await sleep(150);
  const sub = await docPx(200, 150);
  await b.eval(`const { store } = window.__ps; store.updateLayer('sq', { blend: 'linear-burn', opacity: 0.5 }, 'Blend');`);
  await sleep(150);
  const burn = await docPx(200, 150);
  const menu = await b.eval(`return document.querySelector('.blend-select').options.length`);
  check('Subtract and Linear Burn composite correctly; the menu lists all 27 modes', sub.join() === '0,255,255,255' && Math.abs(burn[0] - 255) <= 1 && Math.abs(burn[1] - 128) <= 1 && menu === 27, { sub, burn, menu });
}

// 10. Warp Text from the text properties: Arc bends the block (taller bounds), undo restores it
{
  await b.eval(`const { store, ops } = window.__ps; store.set({ dialog: null }); while (store.state.docs.length) store.closeDoc(store.state.docs[0].id); ops.newDocument(800, 400, 'white', 'Warp', undefined);
    const { createTextAt } = await import('/src/core/tools.ts'); createTextAt(150, 150); store.set({ textEditId: null });
    const { updateText } = await import('/src/core/tools.ts'); updateText(store.activeLayer.id, { text: 'CURVED HEADLINE', size: 60, color: '#000000' }, 'Text');`);
  await sleep(150);
  const h0 = await b.eval(`const { store } = window.__ps; const s = await import('/src/core/snap.ts'); return s.contentBounds(store.activeLayer).height;`);
  const sel = await b.eval(`const row = [...document.querySelectorAll('.props-row')].find(r => r.textContent.startsWith('Warp')); const s = row?.querySelector('select'); if (!s) return false; s.value = 'arc'; s.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
  await sleep(200);
  const r = await b.eval(`const { store } = window.__ps; const s = await import('/src/core/snap.ts'); return { warp: store.activeLayer.text.warp, h: s.contentBounds(store.activeLayer).height };`);
  const bend = await b.eval(`return !![...document.querySelectorAll('.props-row .numfield-label')].find(l => l.textContent === 'Bend')`);
  check('Warp ▸ Arc curves the text (taller bounds) and shows a Bend field', sel && r.warp?.style === 'arc' && r.warp.bend === 50 && r.h > h0 * 1.5 && bend, { h0, r, bend });
}

if (process.env.SHOT) {
  await b.eval(`const { store } = window.__ps; store.set({ dialog: null }); while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);`);
  const p = await centerOf('.welcome-template', 'Quote Post');
  if (p) await b.click(p.x, p.y);
  await sleep(300);
  await b.eval(`const { store } = window.__ps; const t = store.doc.layers.filter(l => l.kind === 'text'); store.selectLayer(t[0].id); store.set({ dialog: { type: 'layerStyle' } });`);
  await sleep(200);
  await clickEl('.fx-preset', 'Neon');
  await sleep(150);
  await clickEl('.fx-item-head', 'Outer Glow');
  await b.eval(`const { store } = window.__ps; const { updateText } = await import('/src/core/tools.ts'); const t = store.doc.layers.filter(l => l.kind === 'text'); const author = t.find(l => /JOBS/i.test(l.text.text)); if (author) updateText(author.id, { warp: { style: 'arc', bend: 35 } }, 'Warp');`);
  await sleep(400);
  await b.shot(process.env.SHOT);
}

const errors = b.logs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]'));
check('no console errors', errors.length === 0, errors);
b.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
