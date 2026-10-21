// Social + Photo tabs, Active Toolbox and customizable looks, with real clicks and drags:
// Essentials shows Social / Photo tabs (also for a saved tab order), the Active Toolbox lists the tool's
// family and its knob changes the brush size, layouts preview on the photo and add an editable group in
// the brand colours, elements land where dropped, buttons hug their text, the phone check fixes small
// text, Photo tab looks fit the photo, and the look editor warms the rendered pixels and saves to My Looks.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
// A saved tab order from before the new tabs existed: they must still show up near the front
await b.nav();
await b.eval(`
  const raw = JSON.parse(localStorage.getItem('skillphoto.layout') || '{}');
  raw.workspace = 'essentials';
  raw.order = { essentials: ['adjust', 'properties', 'looks', 'color', 'info', 'grids', 'history', 'actions', 'navigator'] };
  localStorage.setItem('skillphoto.layout', JSON.stringify(raw));
`);
await b.nav();
await sleep(500);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 300) : '');
};
const px = (x, y) => b.eval(`
  const { store } = window.__ps;
  const { renderDocument } = await import('/src/core/render.ts');
  const t = document.createElement('canvas'); t.width = store.doc.width; t.height = store.doc.height;
  renderDocument(store.doc, t);
  return Array.from(t.getContext('2d').getImageData(${x}, ${y}, 1, 1).data);
`);
const center = (sel, text) => b.eval(`
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${text ? `${text}.test(e.textContent.trim())` : 'true'});
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
`);
const clickEl = async (sel, text) => {
  const c = await center(sel, text);
  if (c) await b.click(c.x, c.y);
  await sleep(120);
  return !!c;
};
const tab = (re) => b.openTab(re.source.replace(/^\^|\$$/g, ''));
const setRange = (scope, labelRe, value) => b.eval(`
  const sl = [...document.querySelectorAll('${scope} .slider')].find((s) => ${labelRe}.test(s.querySelector('.slider-label')?.textContent ?? ''));
  if (!sl) return false;
  const input = sl.querySelector('input[type=range]');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, String(${value}));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
`);

// A warm "food" photo: orange-brown with a cream plate
await b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1080, 1350, 'white', 'Food');
  const l = store.doc.layers[0];
  const c = l.canvas.getContext('2d');
  c.fillStyle = '#c8783c'; c.fillRect(0, 0, 1080, 1350);
  c.fillStyle = '#efe6d6'; c.beginPath(); c.arc(540, 700, 300, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#a8461e'; c.beginPath(); c.arc(540, 700, 160, 0, Math.PI * 2); c.fill();
  store.commit('Paint photo', { layers: [...store.doc.layers] });
  store.invalidateRender?.();
  store.setOpts({ activeToolbox: true });
`);
await sleep(400);

// ---- tabs
const tabs = await b.eval(`return [...document.querySelectorAll('.dock-tabs button')].map((e) => e.textContent.trim())`);
check('Essentials shows Social and Photo tabs even with an old saved tab order', tabs.includes('Social') && tabs.includes('Photo') && tabs.indexOf('Social') < 4, tabs);

// ---- Active Toolbox
await b.eval(`window.__ps.store.setTool('brush')`);
await sleep(150);
const atb = await b.eval(`return [...document.querySelectorAll('.active-toolbox .atb-tool')].map((e) => e.getAttribute('aria-label'))`);
check('Active Toolbox lists the brush family', atb.some((a) => /^Brush/.test(a)) && atb.some((a) => /^Pencil/.test(a)) && atb.some((a) => /Eraser/.test(a)), atb);
await clickEl('.active-toolbox .atb-tool', null);
const pencil = await center('.active-toolbox .atb-tool[aria-label^="Pencil"]');
if (pencil) await b.click(pencil.x, pencil.y);
await sleep(100);
check('clicking a toolbox tool switches to it', (await b.eval(`return window.__ps.store.state.tool`)) === 'pencil');
await b.eval(`window.__ps.store.setTool('brush'); window.__ps.store.setOpts({ size: 40 })`);
await sleep(150);
const knob = await center('.active-toolbox [data-knob="size"]');
if (knob) await b.drag(Array.from({ length: 9 }, (_, i) => ({ x: knob.x, y: knob.y - i * 5 })));
await sleep(100);
const size = await b.eval(`return window.__ps.store.state.opts.size`);
check('dragging the Size knob up makes the brush bigger', !!knob && size > 50, size);

// ---- Social tab: layout
await b.eval(`window.__ps.store.setTool('move')`);
check('Social tab opens', await tab(/^Social$/));
await sleep(500);
const thumbs = await b.eval(`
  const cs = [...document.querySelectorAll('.post-thumb-canvas')];
  const drawn = cs.filter((c) => c.width > 1 && Array.from(c.getContext('2d').getImageData(c.width >> 1, c.height - 4, 1, 1).data)[3] > 0);
  return { n: cs.length, drawn: drawn.length };
`);
check('layout thumbnails render over the photo', thumbs.n >= 12 && thumbs.drawn >= 12, thumbs);
await clickEl('.palette-chip', /^Food$/);
await clickEl('.post-thumb', /^Sale Burst$/);
await sleep(200);
const lay = await b.eval(`
  const doc = window.__ps.store.doc;
  const g = doc.layers.find((l) => l.kind === 'group' && l.name === 'Layout · Sale Burst');
  const kids = doc.layers.filter((l) => l.parent === g?.id);
  return { top: doc.layers[doc.layers.length - 1]?.parent === g?.id || doc.layers[doc.layers.length - 1]?.id === g?.id, kinds: kids.map((k) => k.kind), texts: kids.filter((k) => k.kind === 'text').map((k) => k.text.text), burst: kids.find((k) => k.name === 'Burst')?.shape?.fill, hug: kids.some((k) => k.hug) };
`);
check('Sale Burst adds one editable group on top, in the Food palette', lay.top && lay.kinds.includes('text') && lay.kinds.includes('shape') && lay.burst === '#e4572e' && lay.hug, lay);
const burstPx = await px(1080 - 50 - 150, 50 + 40);
check('the burst badge renders in the accent colour', Math.abs(burstPx[0] - 0xe4) < 12 && Math.abs(burstPx[1] - 0x57) < 12, burstPx);

// ---- element dropped at a point + hugging button
const dropped = await b.eval(`
  const { dropPostItem } = await import('/src/ui/SocialPanel.tsx');
  const { store } = window.__ps;
  store.selectLayer(store.doc.layers[0].id);
  dropPostItem('element:cta', { x: 300, y: 1000 });
  const doc = store.doc;
  const g = doc.layers.find((l) => l.id === doc.activeId);
  const kids = doc.layers.filter((l) => l.parent === g.id);
  const shape = kids.find((k) => k.kind === 'shape'), text = kids.find((k) => k.kind === 'text');
  return { name: g.name, cx: shape.x + shape.width / 2, cy: shape.y + shape.height / 2, w: shape.width, tid: text.id };
`);
check('a dropped Button lands centred on the drop point', Math.abs(dropped.cx - 300) < 3 && Math.abs(dropped.cy - 1000) < 30, dropped);
const grown = await b.eval(`
  const t = await import('/src/core/tools.ts');
  t.updateText('${dropped.tid}', { text: 'Learn more about our menu' });
  return window.__ps.store.doc.layers.find((l) => l.hug?.target === '${dropped.tid}').width;
`);
check('the button grows with its label', grown > dropped.w + 150, { before: dropped.w, after: grown });

// ---- phone check
await b.eval(`
  const { store } = window.__ps;
  const { makeLayer } = await import('/src/core/types.ts');
  const { syncTextBounds } = await import('/src/core/render.ts');
  let l = makeLayer({ kind: 'text', name: 'Tiny note', x: 100, y: 100, text: { text: 'tiny print', font: 'Inter', size: 12, weight: 400, italic: false, color: '#000000', align: 'left', lineHeight: 1.2, tracking: 0, shadow: false, stroke: 0, strokeColor: '#000000' } });
  l = { ...l, ...syncTextBounds(l) };
  store.commit('Tiny', { layers: [...store.doc.layers, l] });
`);
await sleep(200);
check('phone check flags the tiny text', /Tiny note/.test(await b.eval(`return document.querySelector('.social-panel')?.innerText ?? ''`)));
await clickEl('.social-panel button', /^Make all readable$/);
const fixed = await b.eval(`const l = window.__ps.store.doc.layers.find((l) => l.name === 'Tiny note'); return { size: l.text.size, w: l.width }`);
check('Make all readable raises it to the phone minimum and re-measures it', fixed.size >= 24 && fixed.w > 60, fixed);

// ---- Photo tab
await b.eval(`
  const { store } = window.__ps;
  store.commit('Clean', { layers: [store.doc.layers[0]], activeId: store.doc.layers[0].id });
`);
check('Photo tab opens', await tab(/^Photo$/));
await sleep(400);
const picks = await b.eval(`return [...document.querySelectorAll('.photo-look .photo-look-cat')].map((e) => e.textContent)`);
check('Looks for this photo suggests Food looks for a food photo', picks.length === 6 && picks.filter((c) => c === 'Food').length >= 3, picks);
await clickEl('.photo-look', null);
await sleep(200);
const lookLayer = await b.eval(`const l = window.__ps.store.activeLayer; return l && { kind: l.kind, name: l.name, lut: !!l.adjust?.lut }`);
check('clicking a suggestion adds a non-destructive look layer', lookLayer?.kind === 'adjustment' && lookLayer.lut && /^Look · /.test(lookLayer.name), lookLayer);
await b.eval(`window.__ps.store.selectLayer(window.__ps.store.doc.layers[0].id)`);
await clickEl('.photo-crops button', /^4:5 Post$/);
await sleep(150);
const crop = await b.eval(`const s = window.__ps.store.state; return { tool: s.tool, ratio: s.opts.cropRatio, rect: s.crop?.rect }`);
check('4:5 Post starts a crop locked to 4:5', crop.tool === 'crop' && crop.ratio === '4:5' && crop.rect && Math.abs(crop.rect.width / crop.rect.height - 0.8) < 0.01, crop);
await b.eval(`(await import('/src/core/tools.ts')).cancelCrop(); window.__ps.store.setOpts({ cropRatio: 'free' }); window.__ps.store.setTool('move')`);

// ---- Look editor
await b.eval(`
  const { store } = window.__ps;
  store.commit('Clean', { layers: [store.doc.layers[0]], activeId: store.doc.layers[0].id });
`);
await tab(/^Looks$/);
await sleep(300);
check('Looks has a "For this photo" filter', await clickEl('.looks-chip', /^For this photo$/));
const before = await px(540, 700);
check('New Custom Look opens the editor', await clickEl('.looks-create .btn', /New Custom Look/) && !!(await center('.look-editor')));
check('Warmth slider moved', await setRange('.look-editor', '/^Warmth/', 80));
await sleep(250);
const after = await px(540, 700);
const lk = await b.eval(`const l = window.__ps.store.activeLayer; return { name: l.name, tweak: l.adjust.lut.tweak }`);
check('Warmth bakes into the look layer and warms the pixels', lk.tweak?.temp > 0.5 && after[0] - before[0] >= 2 && before[2] - after[2] >= 2, { before, after, lk });
await b.eval(`
  const input = document.querySelector('.look-editor-save input');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(input, 'My Warm Food');
  input.dispatchEvent(new Event('input', { bubbles: true }));
`);
await clickEl('.look-editor-save .btn', /Save to My Looks/);
const mine = await b.eval(`return JSON.parse(localStorage.getItem('skillphoto.looks.mine') || '[]').map((l) => ({ name: l.name, source: l.source }))`);
check('Save to My Looks keeps it for reuse', mine.some((m) => m.name === 'My Warm Food' && m.source === 'custom'), mine);
await clickEl('.look-editor-head .btn', /Reset/);
await sleep(250);
const reset = await px(540, 700);
check('Reset returns the look to how it was', Math.abs(reset[0] - before[0]) <= 2 && Math.abs(reset[2] - before[2]) <= 2, { before, reset });
const undo = await b.eval(`const d = window.__ps.store.doc; return d.history.slice(-3).map((h) => h.label)`);
check('a slider session is one undo step', undo.filter((l) => l === 'Edit Look').length <= 2, undo);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
process.exit(failed.length ? 1 : 0);
