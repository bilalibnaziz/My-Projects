// Precision audit with real input: the core tools at normal and extreme zoom — pen anchors, direct
// selection, resize, rotate, the zoom and hand tools, type, eyedropper, SVG export. Every check is
// about the geometry ending up exactly where the pointer put it.
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
  return { left: r.left, top: r.top, w: r.width, h: r.height, zoom: v.zoom, panX: v.panX, panY: v.panY };
`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
const fresh = () => b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false, transform: null });
  const g = await import('/src/core/grids.ts');
  store.set({ docGrid: { ...g.DEFAULT_DOC_GRID, snapLayout: false }, showGrid: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1000, 700, 'white', 'Audit');
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
const addRect = (x, y, w, h, extra = '') => b.eval(`
  const { store } = window.__ps;
  const { makeLayer } = await import('/src/core/types.ts');
  const l = makeLayer({ kind: 'shape', name: 'R', x: ${x}, y: ${y}, width: ${w}, height: ${h}, ${extra} shape: { shape: 'rectangle', fill: '#3366cc', stroke: '#000000', strokeWidth: 0, fillEnabled: true, radius: 0 } });
  store.insertLayer(l, undefined, 'Add');
  store.selectLayer(l.id);
  return l.id;
`);

// 1. Pen at 3200%: anchors land on sub-pixel positions, exactly under the clicks
{
  await fresh();
  await zoomTo(200, 200, 32);
  await tool('pen');
  const g = await geo();
  const pts = [[200.25, 200.5], [201.75, 200.5], [201, 201.8]];
  for (const [x, y] of pts) {
    const p = S(g, x, y);
    await b.click(p.x, p.y);
  }
  const first = S(g, pts[0][0], pts[0][1]);
  await b.click(first.x, first.y);
  await sleep(120);
  const r = await b.eval(`const l = window.__ps.store.activeLayer; return l && { kind: l.kind, x: l.x, y: l.y, w: l.width, h: l.height }`);
  const ok = r && r.kind === 'shape' && Math.abs(r.x - 200.25) < 0.05 && Math.abs(r.y - 200.5) < 0.05 && Math.abs(r.w - 1.5) < 0.05 && Math.abs(r.h - 1.3) < 0.05;
  check('3200%: pen anchors land exactly where clicked (sub-pixel)', ok, r);
}

// 2. Direct selection at 3200%: dragging an anchor moves it by the sub-pixel pointer distance
{
  await fresh();
  const id = await addRect(200, 200, 2, 2);
  await zoomTo(201, 201, 32);
  await b.eval(`const vo = await import('/src/core/vectorOps.ts'); if (vo.convertToEditablePath) { const { store } = window.__ps; const l = store.activeLayer; const p = vo.convertToEditablePath(l); if (p && p !== l) store.commit('Path', { layers: store.doc.layers.map((x) => (x.id === l.id ? p : x)) }); } return true`);
  await tool('direct-select');
  const g = await geo();
  const a = S(g, 202, 202); // bottom-right corner
  await b.drag([a, { x: a.x + 8, y: a.y + 8 }, { x: a.x + 16, y: a.y + 8 }]);
  await sleep(120);
  const r = await b.eval(`const l = window.__ps.store.doc.layers.find((l) => l.id === ${JSON.stringify(id)}); return { x: l.x, y: l.y, w: l.width, h: l.height, kind: l.shape?.shape }`);
  // 16 screen px = 0.5 doc px right, 8 = 0.25 down
  const ok = Math.abs(r.x + r.w - 202.5) < 0.06 && Math.abs(r.y + r.h - 202.25) < 0.06;
  check('3200%: direct-select drags an anchor by sub-pixel amounts', ok, r);
}

// 2b. Dragging an anchor far outside the box: the shape follows (box refits, nothing is clipped)
{
  await fresh();
  const id = await addRect(200, 200, 100, 100);
  await zoomTo(300, 300, 1);
  await b.eval(`const vo = await import('/src/core/vectorOps.ts'); const { store } = window.__ps; const l = store.activeLayer; const p = vo.convertToEditablePath(l); store.commit('Path', { layers: store.doc.layers.map((x) => (x.id === l.id ? p : x)) }); return true`);
  await tool('direct-select');
  const g = await geo();
  const a = S(g, 300, 300);
  await b.drag([a, S(g, 350, 330), S(g, 420, 380)]);
  await sleep(120);
  const r = await b.eval(`
    const { store } = window.__ps;
    const l = store.doc.layers.find((l) => l.id === ${JSON.stringify(id)});
    const { renderDocument } = await import('/src/core/render.ts');
    const c = document.createElement('canvas'); renderDocument(store.doc, c);
    // A point inside the stretched corner, far outside the old box
    const d = c.getContext('2d').getImageData(395, 360, 1, 1).data;
    return { x: l.x, y: l.y, w: l.width, h: l.height, px: Array.from(d) };`);
  check('anchor dragged 120 px out: box refits and the shape renders there', Math.abs(r.x + r.w - 420) < 0.5 && Math.abs(r.y + r.h - 380) < 0.5 && r.px[2] > 150 && r.px[0] < 120, r);
}

// 3. Resize handle at 1600%: the edge lands under the pointer (sub-pixel)
{
  await fresh();
  const id = await addRect(300, 300, 4, 4);
  await zoomTo(302, 302, 16);
  await tool('move');
  const g = await geo();
  const c = S(g, 302, 302);
  await b.click(c.x, c.y);
  const se = S(g, 304, 304);
  await b.drag([se, { x: se.x + 4, y: se.y + 4 }, { x: se.x + 8, y: se.y + 20 }], { modifiers: 0 });
  await sleep(120);
  const r = await b.eval(`const l = window.__ps.store.doc.layers.find((l) => l.id === ${JSON.stringify(id)}); return { w: l.width, h: l.height }`);
  check('1600%: corner handle resizes to the pointer', Math.abs(r.w - 4.5) < 0.1 || Math.abs(r.h - 5.25) < 0.1, r);
}

// 4. Zoom tool: click zooms in about the click point, ⌥-click zooms out
{
  await fresh();
  await zoomTo(500, 350, 1);
  await tool('zoom');
  const g = await geo();
  const p = S(g, 400, 300);
  await b.click(p.x, p.y);
  await sleep(150);
  const g2 = await geo();
  const under = { x: (p.x - g2.left - g2.panX) / g2.zoom, y: (p.y - g2.top - g2.panY) / g2.zoom };
  await b.click(p.x, p.y, { modifiers: ALT });
  await sleep(150);
  const g3 = await geo();
  check('zoom tool zooms in at the click (point stays under the cursor) and ⌥ zooms out', g2.zoom > 1.1 && Math.abs(under.x - 400) < 1 && Math.abs(under.y - 300) < 1 && g3.zoom < g2.zoom, { z2: g2.zoom, z3: g3.zoom, under });
}

// 5. Hand tool drags the view by the pointer distance
{
  await tool('hand');
  const g = await geo();
  const a = { x: g.left + 300, y: g.top + 300 };
  await b.drag([a, { x: a.x + 50, y: a.y + 20 }, { x: a.x + 120, y: a.y + 40 }]);
  await sleep(100);
  const g2 = await geo();
  check('hand tool pans by the drag distance', Math.abs(g2.panX - g.panX - 120) < 1.5 && Math.abs(g2.panY - g.panY - 40) < 1.5, { dx: g2.panX - g.panX, dy: g2.panY - g.panY });
}

// 6. Type tool: click, type, Escape commits a text layer with that text
{
  await fresh();
  await zoomTo(500, 350, 1);
  await tool('text');
  const g = await geo();
  const p = S(g, 300, 300);
  await b.click(p.x, p.y);
  await sleep(150);
  for (const ch of 'Skill') await b.key(ch);
  await b.key('Escape', { code: 'Escape', vk: 27 });
  await sleep(150);
  const r = await b.eval(`const l = window.__ps.store.doc.layers.find((l) => l.kind === 'text'); return l && { text: l.text.text, x: l.x, y: l.y }`);
  check('type tool: click + type makes a text layer', r && r.text === 'Skill', r);
}

// 7. Rotate tool on a shape keeps it a live shape (not pixels) with the angle typed in
{
  await fresh();
  await addRect(400, 300, 200, 100);
  await b.eval(`const ot = await import('/src/core/objectTransform.ts'); ot.rotateSelectionTo(30); return true`);
  const r = await b.eval(`const l = window.__ps.store.activeLayer; return { kind: l.kind, rot: l.rotation }`);
  check('rotating a shape keeps it a live vector shape', r.kind === 'shape' && Math.abs(r.rot - 30) < 1e-6, r);
}

// 8. SVG export keeps sub-pixel geometry (no rounding to whole pixels)
{
  await fresh();
  await addRect(100.25, 50.5, 10.75, 20.125);
  const svg = await b.eval(`const m = await import('/src/core/formats/svg.ts'); const fn = m.exportSvg ?? m.documentToSvg ?? m.toSvg ?? Object.values(m).find((f) => typeof f === 'function'); const out = await fn(window.__ps.store.doc); return typeof out === 'string' ? out : (out && out.text ? await out.text() : String(out))`);
  const ok = /100\.25/.test(svg) && /50\.5/.test(svg) && /10\.75/.test(svg);
  check('SVG export keeps sub-pixel positions and sizes', ok, svg.slice(0, 300));
}

// 9. Eyedropper picks the fill of a shape at 6400% near its edge
{
  await fresh();
  await addRect(300, 300, 3, 3);
  await zoomTo(301, 301, 64);
  await tool('eyedropper');
  const g = await geo();
  const p = S(g, 302.8, 301.5); // inside, near the right edge
  await b.click(p.x, p.y);
  await sleep(100);
  const fg = await b.eval(`return window.__ps.store.state.fg`);
  check('6400%: eyedropper samples the shape near its edge', String(fg).toLowerCase() === '#3366cc', { fg });
}

// 10. PDF export is vector: shapes are paths, one page per artboard, blend modes and gradients native
{
  await fresh();
  const r = await b.eval(`
    const { store } = window.__ps;
    const { makeLayer } = await import('/src/core/types.ts');
    const sh = (shape, x, extra = {}, layer = {}) => makeLayer({ kind: 'shape', name: shape, x, y: 100, width: 150, height: 100, ...layer, shape: { shape, fill: '#3366cc', stroke: '#000', strokeWidth: 2, fillEnabled: true, radius: 0, ...extra } });
    store.commit('S', { layers: [...store.doc.layers, sh('rectangle', 50), sh('ellipse', 300, { gradient: { type: 'radial', x0: 0.5, y0: 0.5, x1: 1, y1: 0.5, stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#f00' }] } }), sh('star', 600, {}, { opacity: 0.5, blend: 'multiply', rotation: 15 })] });
    store.doc.artboards = [{ id: 'a', name: 'A', x: 0, y: 0, width: 500, height: 700 }, { id: 'b', name: 'B', x: 500, y: 0, width: 500, height: 700 }];
    const { buildVectorPdf } = await import('/src/core/formats/vectorPdf.ts');
    const { bytes, stats } = await buildVectorPdf(store.doc, { dpi: 72 });
    const head = new TextDecoder().decode(bytes.slice(0, 8));
    const txt = new TextDecoder('latin1').decode(bytes);
    return { head, pages: txt.split('<< /Type /Page /Parent').length - 1, multiply: txt.includes('/BM /Multiply'), radial: txt.includes('/ShadingType 3'), stats, eof: txt.trimEnd().endsWith('%%EOF') };
  `);
  check('PDF export: vector shapes, a page per artboard, native gradients and blend modes', r.head.startsWith('%PDF-1.4') && r.pages === 2 && r.multiply && r.radial && r.stats.vectorLayers === 3 && r.eof, r);
}

// 11. Type ▸ Create Outlines turns text into vector paths that match it; undo brings the text back
{
  await fresh();
  const r = await b.eval(`
    const { store } = window.__ps;
    const { makeLayer, withLayer } = await import('/src/core/types.ts');
    const { syncTextBounds, DocRenderer } = await import('/src/core/render.ts');
    const t0 = makeLayer({ kind: 'text', name: 'Hello', x: 100, y: 100, text: { text: 'Outline Me', font: 'Arial', size: 80, weight: 700, italic: false, color: '#123456', align: 'left', lineHeight: 1.2, tracking: 0, shadow: false, stroke: 0, strokeColor: '#000' } });
    const t = withLayer(t0, syncTextBounds(t0));
    store.commit('T', { layers: [...store.doc.layers, t], activeId: t.id });
    const ink = (d) => { const c = new DocRenderer().render(d, undefined, { s: 4, ox: 0, oy: 0, w: 4000, h: 2800 }); const px = c.getContext('2d').getImageData(0, 0, 4000, 2800).data; let a = 0; for (let i = 3; i < px.length; i += 4) a += px[i]; return a; };
    const before = ink({ ...store.doc, layers: [t] });
    const c = await import('/src/core/commands.ts');
    c.COMMANDS.find((x) => x.id === 'create-outlines').run();
    const out = store.doc.layers.filter((l) => l.kind === 'shape');
    const after = ink({ ...store.doc, layers: out });
    const noText = !store.doc.layers.some((l) => l.kind === 'text');
    store.undo();
    const back = store.doc.layers.some((l) => l.kind === 'text') && !store.doc.layers.some((l) => l.kind === 'shape');
    return { shapes: out.length, fill: out[0]?.shape?.fill, paths: out[0]?.shape?.compoundPoints?.length, area: +(after / before).toFixed(4), noText, back };
  `);
  check('Create Outlines: text becomes matching vector paths (area within 2%), one undo restores it', r.shapes === 1 && r.fill === '#123456' && r.paths >= 9 && Math.abs(r.area - 1) < 0.02 && r.noText && r.back, r);
}

// 12. Create Outlines on a live shape really converts it (it used to be a no-op)
{
  await fresh();
  const r = await b.eval(`
    const { store } = window.__ps;
    const { makeLayer } = await import('/src/core/types.ts');
    const l = makeLayer({ kind: 'shape', name: 'S', x: 100, y: 100, width: 200, height: 100, shape: { shape: 'ellipse', fill: '#ff0000', stroke: '#000', strokeWidth: 0, fillEnabled: true, radius: 0 } });
    store.commit('S', { layers: [...store.doc.layers, l], activeId: l.id });
    (await import('/src/core/commands.ts')).COMMANDS.find((x) => x.id === 'create-outlines').run();
    const a = store.activeLayer;
    return { shape: a.shape.shape, pts: a.shape.points?.length };
  `);
  check('Create Outlines on a shape gives an editable Bézier path', r.shape === 'path' && r.pts >= 4, r);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
process.exit(failed.length ? 1 : 0);
