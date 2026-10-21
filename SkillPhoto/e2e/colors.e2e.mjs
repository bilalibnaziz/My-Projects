// Colors: the Color Picker (fields for every model, contrast, gamut), harmonies, saved swatches,
// and View ▸ Proof Colors / Gamut Warning on screen only.
import { connect, sleep, META, CTRL, SHIFT } from './cdp.mjs';
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
const center = (sel, text) => b.eval(`const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => ${text ? `e.textContent.trim().startsWith(${JSON.stringify(text)})` : 'true'}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
const typeField = async (label, value) => {
  const p = await b.eval(`const f = [...document.querySelectorAll('.cp-field')].filter(f => f.querySelector('span').textContent === ${JSON.stringify(label)}); const el = f[${label === 'B' ? 1 : 0}]?.querySelector('input'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 };`);
  await b.click(p.x, p.y);
  await b.send('Input.insertText', { text: String(value) });
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(60);
};

await b.eval(`const { store, ops } = window.__ps; store.set({ dialog: null, fg: '#000000', bg: '#ffffff' }); while (store.state.docs.length) store.closeDoc(store.state.docs[0].id); ops.newDocument(200, 100, 'white', 'Colors', undefined);`);
await sleep(150);

// 1. The rail's foreground chip opens the picker; RGB fields drive every other model
{
  const chip = await center('.chip-fg');
  await b.click(chip.x, chip.y);
  await sleep(150);
  const open = await b.eval(`return !!document.querySelector('.color-picker')`);
  await typeField('R', 255);
  await typeField('G', 0);
  await typeField('B', 0);
  const fields = await b.eval(`return Object.fromEntries([...document.querySelectorAll('.cp-field')].map((f, i) => [f.querySelector('span').textContent + i, f.querySelector('input').value]))`);
  const gamut = await b.eval(`return !!document.querySelector('.cp-gamut')`);
  const contrast = await b.eval(`return document.querySelector('.cp-contrast').textContent`);
  const ok = await center('.color-picker .btn.primary');
  await b.click(ok.x, ok.y);
  await sleep(100);
  const fg = await st(`store.state.fg`);
  check('Color Picker: RGB entry updates HSB, Lab, CMYK and hex; OK sets the color', open && fg === '#ff0000' && fields.H0 === '0' && fields.S1 === '100' && fields.L6 === '53' && fields.M10 === '100' && fields['#13'] === 'ff0000', { fg, fields });
  check('the picker shows WCAG contrast against the other color', /4\.00:1 AA Large/.test(contrast), { contrast, gamut });
}

// 2. Lab entry and the print-gamut warning (pure RGB green can't print; one click fixes it)
{
  await b.eval(`window.__ps.store.set({ dialog: { type: 'colorPicker', target: 'fg' } })`);
  await sleep(100);
  await typeField('R', 0);
  await typeField('G', 255);
  await typeField('B', 0);
  const warn = await b.eval(`return !!document.querySelector('.cp-gamut')`);
  const g = await center('.cp-gamut');
  await b.click(g.x, g.y);
  await sleep(80);
  const after = await b.eval(`return { warn: !!document.querySelector('.cp-gamut'), hex: document.querySelector('.cp-hex input').value }`);
  await b.key('Escape', { code: 'Escape', vk: 27 });
  await sleep(80);
  const fg = await st(`store.state.fg`);
  check('out-of-gamut green is flagged and snaps to a printable green; Esc cancels', warn && !after.warn && after.hex !== '00ff00' && fg === '#ff0000', { warn, after, fg });
}

// 3. Harmonies and saved swatches in the Color panel
{
  await b.eval(`window.__ps.store.set({ rightTab: 'adjust' })`);
  await b.openTab('Color');
  await sleep(150);
  await b.eval(`document.querySelector('.harmony').scrollIntoView({ block: 'center' })`);
  await sleep(100);
  const sw = await b.eval(`return [...document.querySelectorAll('.harmony-swatch')].map(e => e.title.slice(0, 7))`);
  const third = await center('.harmony-swatch:nth-child(3)');
  await b.click(third.x, third.y);
  await sleep(80);
  const fg = await st(`store.state.fg`);
  await b.eval(`[...document.querySelectorAll('.link-btn')].find(e => e.textContent.includes('+ Add')).scrollIntoView({ block: 'center' })`);
  await sleep(80);
  const add = await center('.link-btn', '+ Add');
  await b.click(add.x, add.y);
  await sleep(80);
  const saved = await b.eval(`return JSON.parse(localStorage.getItem('photoscale-swatches') || '[]')`);
  check('harmony swatches set the color; + Add saves it to My swatches', sw.length === 5 && sw[0] === '#ff0000' && fg === sw[2] && saved.includes(fg), { sw, fg, saved });
}

// 4. Proof Colors (⌘Y) and Gamut Warning (⇧⌘Y) change the screen, never the document
{
  await b.eval(`const { store } = window.__ps; const c = store.doc.layers[0].canvas; const g = c.getContext('2d'); g.fillStyle = '#00ff00'; g.fillRect(0, 0, 100, 100); g.fillStyle = '#808080'; g.fillRect(100, 0, 100, 100); (await import('/src/core/canvas.ts')).touch(c); store.requestRender();`);
  await sleep(120);
  const screen = (x, y) => b.eval(`const { store } = window.__ps; const c = document.querySelector('.viewport-canvas'); const r = c.getBoundingClientRect(); const v = store.doc.view; const k = c.width / r.width; return Array.from(c.getContext('2d').getImageData(Math.round((v.panX + ${x} * v.zoom) * k), Math.round((v.panY + ${y} * v.zoom) * k), 1, 1).data);`);
  const before = await screen(50, 50);
  await b.key('y', { modifiers: MOD });
  await sleep(250);
  const proof = await screen(50, 50);
  const grayProof = await screen(150, 50);
  await b.key('y', { modifiers: MOD | SHIFT });
  await sleep(250);
  const warn = await screen(50, 50);
  const mode = await st(`store.state.proof`);
  const docPx = await st(`Array.from(store.renderer.render(store.doc, store.overrides).getContext('2d').getImageData(50, 50, 1, 1).data)`);
  await b.key('y', { modifiers: MOD | SHIFT });
  check('Proof Colors dulls screen-only green; Gamut Warning marks it gray; the document is untouched', before[1] > 240 && proof[1] < 200 && Math.abs(grayProof[0] - grayProof[2]) < 12 && warn.join() === '128,128,128,255' && mode === 'gamut' && docPx.join() === '0,255,0,255', { before, proof, grayProof, warn, docPx });
}

const errors = b.logs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]'));
check('no console errors', errors.length === 0, errors);
b.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
