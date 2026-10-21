// Design features: social templates and presets, safe zones, align & X/Y/W/H, shape/text options bar,
// place-into-frame and appearance preferences — all driven through the real UI.
import { connect, sleep, ALT, META, CTRL } from './cdp.mjs';
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
const centerOf = (selector, text) =>
  b.eval(`const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = ${text ? `els.find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}) || e.title === ${JSON.stringify(text)})` : 'els[0]'}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
/** Types into the options-bar number field with the given label and presses Enter. */
async function typeField(label, value) {
  const p = await b.eval(`const f = [...document.querySelectorAll('.options-bar .numfield')].find(f => f.querySelector('.numfield-label').textContent.trim() === ${JSON.stringify(label)}); if (!f) return null; const r = f.querySelector('input').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  if (!p) return false;
  await b.click(p.x, p.y, { clickCount: 1 });
  await b.eval(`document.activeElement?.select?.()`);
  await b.send('Input.insertText', { text: String(value) });
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(80);
  return true;
}
const reset = () => b.eval(`const { store } = window.__ps; store.set({ dialog: null, paletteOpen: false }); while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);`);

// 1. Welcome screen → template click opens an editable, safe-zoned document
await reset();
await sleep(150);
{
  const p = await centerOf('.welcome-template', 'Sale Announcement');
  if (p) await b.click(p.x, p.y);
  await sleep(250);
  const r = await st(`({ w: store.doc?.width, h: store.doc?.height, zone: store.doc?.safeZone, kinds: store.doc?.layers.map(l => l.kind), boxed: store.doc?.layers.some(l => l.text?.box) })`);
  check('welcome template opens an editable 1080×1080 doc with text, shapes and a safe zone', r.w === 1080 && r.h === 1080 && r.zone === 'margin' && r.kinds.includes('text') && r.kinds.includes('shape') && r.boxed, r);
}

// 2. Safe zone overlay draws on screen but never into the image
{
  await b.eval(`window.__ps.store.set({ showSafeZones: true })`);
  await sleep(120);
  const g = await geo();
  const at = S(g, 540, 10); // inside the 5% margin band
  const px = () => b.eval(`const c = document.querySelector('.viewport-canvas'); const r = c.getBoundingClientRect(); const k = c.width / r.width; return Array.from(c.getContext('2d').getImageData(Math.round((${at.x} - r.left) * k), Math.round((${at.y} - r.top) * k), 1, 1).data);`);
  const on = await px();
  await b.eval(`window.__ps.store.set({ showSafeZones: false })`);
  await sleep(120);
  const off = await px();
  const flat = await st(`Array.from(store.renderer.render(store.doc, store.overrides).getContext('2d').getImageData(540, 10, 1, 1).data)`);
  check('safe zone tints the margin on screen only', on.join() !== off.join() && flat[3] === 255, { on, off, flat });
  await b.eval(`window.__ps.store.set({ showSafeZones: true })`);
}

// 3. ⌘N → Video tab → YouTube Thumbnail preset → Create
{
  await b.key('n', { modifiers: MOD });
  await sleep(150);
  let p = await centerOf('.modal .seg button', 'Video');
  if (p) await b.click(p.x, p.y);
  await sleep(80);
  p = await centerOf('.preset-doc', 'YouTube Thumbnail');
  if (p) await b.click(p.x, p.y);
  p = await centerOf('.modal-foot .btn.primary');
  if (p) await b.click(p.x, p.y);
  await sleep(200);
  const r = await st(`({ w: store.doc.width, h: store.doc.height, zone: store.doc.safeZone, title: store.doc.title, dlg: store.state.dialog })`);
  check('New dialog: Video ▸ YouTube Thumbnail creates 1280×720 with its safe zone', r.w === 1280 && r.h === 720 && r.zone === 'yt-thumb' && !r.dlg, r);
}

// 4. Move tool: align buttons and typed X / W (proportional) in the options bar
{
  await b.eval(`
    const { store } = window.__ps;
    store.newRasterLayer('Box');
    const c = store.activeLayer.canvas.getContext('2d'); c.fillStyle = '#e33'; c.fillRect(300, 200, 200, 100);
    store.renderer.invalidate(); store.emit(); store.setTool('move'); store.setOpts({ lockAspect: true });`);
  await sleep(150);
  const bounds = () => b.eval(`return import('/src/core/align.ts').then(m => m.layerBounds(window.__ps.store.activeLayer))`);
  let p = await centerOf('.options-bar .icon-btn', 'Align Right Edges (to canvas)');
  if (p) await b.click(p.x, p.y);
  await sleep(100);
  let r = await bounds();
  check('align right button puts the layer flush with the canvas edge', r && r.x + r.width === 1280, r);
  p = await centerOf('.options-bar .icon-btn', 'Center on canvas');
  if (p) await b.click(p.x, p.y);
  await sleep(100);
  r = await bounds();
  check('center button centres on both axes', r && r.x === 540 && r.y === 310, r);
  await typeField('X', 40);
  r = await bounds();
  check('typing X moves the layer to that exact position', r && r.x === 40 && r.y === 310, r);
  await typeField('W', 400);
  r = await bounds();
  check('typing W resizes proportionally from the top-left', r && r.x === 40 && r.y === 310 && Math.abs(r.width - 400) <= 1 && Math.abs(r.height - 200) <= 1, r);
  await typeField('W', 99999);
  const big = await bounds();
  const toast = await st(`store.state.toasts.map(t => t.kind + ':' + t.text).join(' | ')`);
  check('an impossible size is refused with a message instead of crashing', big && big.width === r.width && /too large/.test(toast), { big, toast });
  const undo = await st(`store.doc.history.slice(-3).map(h => h.label)`);
  check('each placement step is undoable', undo.includes('Resize Layer') && undo.includes('Move Layer'), undo);
}

// 5. Shape tool: ⌥-drag draws from the centre; the options bar then edits that shape
{
  await b.eval(`window.__ps.store.setTool('shape'); window.__ps.store.setOpts({ shapeType: 'rectangle', shapeFill: true, shapeStrokeWidth: 0 });`);
  await sleep(80);
  const g = await geo();
  const a = S(g, 640, 360);
  const c = S(g, 740, 410);
  await b.drag([a, { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, c], { modifiers: ALT });
  await sleep(100);
  let r = await st(`(() => { const l = store.activeLayer; return { kind: l.kind, x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.width), h: Math.round(l.height) }; })()`);
  check('⌥-drag draws the shape out from its centre', r.kind === 'shape' && Math.abs(r.x - 540) <= 1 && Math.abs(r.y - 310) <= 1 && Math.abs(r.w - 200) <= 1 && Math.abs(r.h - 100) <= 1, r);
  await typeField('Corners', 24);
  await typeField('Layer opacity', 50);
  r = await st(`({ radius: store.activeLayer.shape.radius, opacity: store.activeLayer.opacity, def: store.state.opts.shapeRadius })`);
  check('options bar edits the selected shape (radius, opacity) and keeps it as the default', r.radius === 24 && r.opacity === 0.5 && r.def === 24, r);
}

// 6. Place image into the selected shape: covers the frame and clips to it
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const io = await import('/src/core/io.ts');
    const c = document.createElement('canvas'); c.width = 400; c.height = 400;
    const x = c.getContext('2d'); x.fillStyle = '#0a0'; x.fillRect(0, 0, 400, 400);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    const frameId = store.activeLayer.id;
    await io.placeImage(blob, 'Photo');
    const l = store.activeLayer; const ls = store.doc.layers;
    const below = ls[ls.findIndex(q => q.id === l.id) - 1];
    return { clip: l.clip, aboveFrame: below.id === frameId, x: l.x, y: l.y, w: l.width, h: l.height };`);
  // Frame is 200×100 at (540,310): a square image must cover it → 200×200, centred vertically
  check('Place Image into a selected shape covers and clips to it', r.clip && r.aboveFrame && r.w === 200 && r.h === 200 && r.x === 540 && r.y === 260, r);
}

// 7. Text tool options bar edits the active text layer (size, caps, box)
{
  await b.eval(`
    const { store } = window.__ps;
    const t = store.doc.layers.find(l => l.kind === 'text') ?? null;
    store.setTool('text');
    if (!t) { const m = await import('/src/core/tools.ts'); m.createTextAt(100, 100); store.set({ textEditId: null }); }`);
  await sleep(120);
  await typeField('Size', 96);
  const p = await centerOf('.options-bar .toggle', 'All caps');
  if (p) await b.click(p.x, p.y);
  await sleep(80);
  const r = await st(`({ size: store.activeLayer.text.size, caps: store.activeLayer.text.caps, defSize: store.state.opts.fontSize })`);
  check('type options bar edits the selected text layer', r.size === 96 && r.caps === true && r.defSize === 96, r);
}

// 8. Preferences: ⌘, → Light theme + accent apply live and persist
{
  await b.key(',', { modifiers: MOD, code: 'Comma', vk: 188 });
  await sleep(150);
  let p = await centerOf('.theme-card', 'Light');
  if (p) await b.click(p.x, p.y);
  p = await centerOf('.accent-dot', '#a855f7');
  if (p) await b.click(p.x, p.y);
  await sleep(100);
  const r = await b.eval(`return { theme: document.documentElement.dataset.theme, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), bg: getComputedStyle(document.querySelector('.menubar')).backgroundColor, saved: JSON.parse(localStorage.getItem('photoscale.prefs') || '{}') }`);
  check('Preferences switch to the light theme and a purple accent, saved for next launch', r.theme === 'light' && r.accent === 'rgb(168, 85, 247)' && r.bg === 'rgb(247, 247, 249)' && r.saved.theme === 'light', r);
  await b.eval(`const { store } = window.__ps; return import('/src/core/store.ts').then(m => store.set({ prefs: { ...m.DEFAULT_PREFS }, dialog: null }))`);
  await sleep(80);
  const back = await b.eval(`return document.documentElement.dataset.theme`);
  check('Reset restores the default VS Code theme', back === 'vscode', back);
}

console.log('\nexceptions in page:', b.logs.filter((l) => /exception|error/i.test(l)).slice(0, 10));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
b.close();
