// Precision audit with real input at high zoom: brush dabs land under the cursor, marquee and
// eyedropper hit the exact pixel, crop, type, zoom / hand tools and undo of a stroke.
import { connect, sleep, ALT } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const geo = () => b.eval(`
  const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
  const v = window.__ps.store.doc.view;
  return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };
`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
const fresh = () => b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false, transform: null });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(400, 300, 'white', 'Audit');
  return true;
`);
const zoomTo = (x, y, z) => b.eval(`
  const { store } = window.__ps;
  const c = document.querySelector('.viewport-canvas');
  const v = store.doc.view; v.zoom = ${z};
  v.panX = Math.round(c.clientWidth / 2 - ${x} * ${z}); v.panY = Math.round(c.clientHeight / 2 - ${y} * ${z});
  store.emit();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
`);
const tool = (t) => b.eval(`window.__ps.store.setTool(${JSON.stringify(t)}); return true`);
const pixel = (x, y) => b.eval(`
  const { renderDocument } = await import('/src/core/render.ts');
  const c = document.createElement('canvas'); renderDocument(window.__ps.store.doc, c);
  return Array.from(c.getContext('2d').getImageData(${x}, ${y}, 1, 1).data);
`);

// 1. Brush at 1600%: a click paints a dab centred under the cursor; ⌘Z removes it
{
  await fresh();
  await b.eval(`const { store } = window.__ps; store.newRasterLayer('Paint'); store.set({ fg: '#000000' }); store.setOpts({ size: 4, hardness: 1, opacity: 1, flow: 1 }); return true`);
  await zoomTo(100, 100, 16);
  await tool('brush');
  const g = await geo();
  const p = S(g, 100.5, 100.5);
  await b.click(p.x, p.y);
  await sleep(150);
  const centre = await pixel(100, 100);
  const far = await pixel(104, 100);
  await b.key('z', { modifiers: 4 });
  await sleep(120);
  const undone = await pixel(100, 100);
  check('1600%: brush dab lands under the cursor; undo removes it', centre[0] < 60 && far[0] > 200 && undone[0] > 200, { centre, far, undone });
}

// 2. Marquee at 800% selects exactly the pixels dragged over
{
  await fresh();
  await zoomTo(50, 50, 8);
  await tool('marquee-rect');
  const g = await geo();
  await b.drag([S(g, 40, 40), S(g, 50, 50), S(g, 60, 55)]);
  await sleep(120);
  const r = await b.eval(`const s = window.__ps.store.doc.selection; return s && s.bounds ? s.bounds : s && { x: s.x, y: s.y, width: s.width, height: s.height, keys: Object.keys(s) }`);
  check('800%: marquee covers exactly the dragged pixels', r && r.x === 40 && r.y === 40 && r.width === 20 && r.height === 15, r);
}

// 3. Eyedropper at 3200% samples the pixel under the cursor (not a neighbour)
{
  await fresh();
  await b.eval(`const { store } = window.__ps; store.newRasterLayer('Dots'); const c = store.activeLayer.canvas.getContext('2d'); c.fillStyle = '#ff0000'; c.fillRect(200, 150, 1, 1); c.fillStyle = '#00ff00'; c.fillRect(201, 150, 1, 1); window.__ps.store.invalidateRender(); return true`);
  await zoomTo(201, 150.5, 32);
  await tool('eyedropper');
  const g = await geo();
  const p1 = S(g, 200.9, 150.5);
  await b.click(p1.x, p1.y);
  await sleep(80);
  const a = await b.eval(`return window.__ps.store.state.fg`);
  const p2 = S(g, 201.1, 150.5);
  await b.click(p2.x, p2.y);
  await sleep(80);
  const c2 = await b.eval(`return window.__ps.store.state.fg`);
  check('3200%: eyedropper picks the exact pixel under the cursor', String(a).toLowerCase() === '#ff0000' && String(c2).toLowerCase() === '#00ff00', { a, c2 });
}

// 4. Crop: drag a box, Enter commits the document to that size
{
  await fresh();
  await zoomTo(200, 150, 1);
  await tool('crop');
  const g = await geo();
  await b.drag([S(g, 50, 40), S(g, 150, 100), S(g, 250, 190)]);
  await sleep(100);
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(200);
  const r = await b.eval(`const d = window.__ps.store.doc; return { w: d.width, h: d.height }`);
  check('crop drag + Enter crops to the dragged box', Math.abs(r.w - 200) <= 1 && Math.abs(r.h - 150) <= 1, r);
}

// 5. Zoom tool zooms about the click; ⌥-click zooms back out
{
  await fresh();
  await zoomTo(200, 150, 1);
  await tool('zoom');
  const g = await geo();
  const p = S(g, 120, 90);
  await b.click(p.x, p.y);
  await sleep(150);
  const g2 = await geo();
  const under = { x: (p.x - g2.left - g2.panX) / g2.zoom, y: (p.y - g2.top - g2.panY) / g2.zoom };
  await b.click(p.x, p.y, { modifiers: ALT });
  await sleep(150);
  const g3 = await geo();
  check('zoom tool keeps the clicked point under the cursor', g2.zoom > 1.1 && Math.abs(under.x - 120) < 1 && Math.abs(under.y - 90) < 1 && g3.zoom < g2.zoom, { z2: g2.zoom, under, z3: g3.zoom });
}

// 6. Type tool: click and type makes a text layer
{
  await fresh();
  await zoomTo(200, 150, 1);
  await tool('text');
  const g = await geo();
  const p = S(g, 100, 100);
  await b.click(p.x, p.y);
  await sleep(150);
  for (const ch of 'Photo') await b.key(ch);
  await b.key('Escape', { code: 'Escape', vk: 27 });
  await sleep(150);
  const r = await b.eval(`const l = window.__ps.store.doc.layers.find((l) => l.kind === 'text'); return l && l.text.text`);
  check('type tool: click + type makes a text layer', r === 'Photo', r);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
process.exit(failed.length ? 1 : 0);
