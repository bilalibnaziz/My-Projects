// Tools that used to be stand-ins, with real pointer input: Graph tools (data dialog → editable group,
// Graph ▸ Data rebuild), Live Paint Bucket on overlapping shapes, Live Paint Selection, Print Tiling,
// Width tool, Align Stroke / width profiles, Symbols (new, spray, redefine, undo, save),
// Pathfinder Minus Back / Trim / Merge / Crop / Outline, SVG import (open + place),
// Transform Again / Each, Offset Path, Round Corners, Recolor Artwork, Smooth brush.
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
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => S(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n));
const click = async (x, y, opts) => { const p = S(x, y); await b.click(p.x, p.y, opts); await sleep(60); };
const tool = (t) => b.eval(`window.__ps.store.setTool(${JSON.stringify(t)})`);
const st = (expr) => b.eval(`const { store } = window.__ps; return (${expr})`);
const px = (x, y) => b.eval(`
  const { store } = window.__ps;
  const { renderDocument } = await import('/src/core/render.ts');
  const t = document.createElement('canvas'); t.width = store.doc.width; t.height = store.doc.height;
  renderDocument(store.doc, t);
  return Array.from(t.getContext('2d').getImageData(${x}, ${y}, 1, 1).data);
`);
const shapes = () => st(`store.doc.layers.filter((l) => l.kind === 'shape').map((l) => ({ id: l.id, name: l.name, fill: l.shape.fill }))`);
const near = (a, c, tol = 24) => a && c.every((v, i) => Math.abs(a[i] - v) <= tol);
// Clicks a dialog button by its label, with a real mouse click
const button = async (label) => {
  const r = await b.eval(`
    const el = [...document.querySelectorAll('.modal button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
    if (!el) return null;
    const q = el.getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
  `);
  if (r) await b.click(r.x, r.y);
  await sleep(150);
  return !!r;
};
const setup = async (extra = '') => {
  await b.eval(`
    const { store, ops } = window.__ps;
    const { makeLayer } = await import('/src/core/types.ts');
    store.set({ dialog: null, paletteOpen: false, transform: null, textEditId: null });
    while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
    ops.newDocument(1000, 700, 'white', 'Vector');
    const sq = (name, x, y, w, h, fill) => makeLayer({ kind: 'shape', name, x, y, width: w, height: h, shape: { shape: 'rectangle', fill, stroke: '#000000', strokeWidth: 0, fillEnabled: true, radius: 0 } });
    ${extra}
    store.set({ fg: '#2255ee', bg: '#ffffff' });
  `);
  await sleep(150);
  g = await geo();
};

// 1. Column Graph: drag a box → data dialog → editable group with one bar per value
await setup();
await tool('graph-column');
await b.drag(line(100, 100, 700, 500));
await sleep(150);
check('Graph tool opens the Graph Data dialog with the dragged box', (await st(`store.state.dialog?.type`)) === 'graph' && (await st(`Math.round(store.state.dialog.box.w)`)) === 600);
const preview = await b.eval(`return document.querySelectorAll('.graph-preview rect').length`);
check('Graph dialog shows a live preview', preview > 8, preview);
await button('Create');
{
  const info = await st(`(() => {
    const gr = store.activeLayer;
    const kids = store.doc.layers.filter((l) => l.parent === gr.id);
    return { kind: gr.kind, name: gr.name, type: gr.graph?.type, bars: kids.filter((l) => l.kind === 'shape' && l.name.includes(' · ')).length, texts: kids.filter((l) => l.kind === 'text').length, hist: store.doc.history[store.doc.hIndex].label };
  })()`);
  check('Create makes a group of editable bars and labels in one undo step', info.kind === 'group' && info.type === 'column' && info.bars === 8 && info.texts >= 8 && info.hist === 'New Column Graph', info);
  // Q4 sales (95) is the tallest bar: its colour sits high in the plot
  const bar = await st(`(() => { const l = store.doc.layers.find((l) => l.name === 'Sales · Q4'); return { x: l.x + l.width / 2, y: l.y + 5, h: l.height, fill: l.shape.fill }; })()`);
  const q1 = await st(`store.doc.layers.find((l) => l.name === 'Sales · Q1').height`);
  check('Bar heights follow the data (95 vs 40)', Math.abs(bar.h / q1 - 95 / 40) < 0.02, { h: bar.h, q1 });
  check('Bars render in their series colour', near(await px(Math.round(bar.x), Math.round(bar.y)), [59, 130, 246]), await px(Math.round(bar.x), Math.round(bar.y)));
}

// 2. Graph ▸ Data: switch the selected graph to a pie and new numbers, rebuilt in place
{
  const before = await st(`store.state.docs[0].layers.length`);
  await b.eval(`const { COMMANDS } = await import('/src/core/commands.ts'); COMMANDS.find((c) => c.id === 'graph-data').run();`);
  await sleep(150);
  check('Object ▸ Graph ▸ Data reopens the dialog for the selected graph', (await st(`store.state.dialog?.type === 'graph' && !!store.state.dialog.groupId`)) === true);
  await b.eval(`
    const sel = document.querySelector('.modal select');
    sel.value = 'pie';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const ta = document.querySelector('textarea.graph-data');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Fruit,Share\\nApples,1\\nPears,1\\nPlums,2');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await sleep(150);
  await button('Update');
  const info = await st(`(() => {
    const gr = store.activeLayer;
    const kids = store.doc.layers.filter((l) => l.parent === gr.id);
    return { type: gr.graph?.type, groups: store.doc.layers.filter((l) => l.graph).length, wedges: kids.filter((l) => l.kind === 'shape' && l.shape.shape === 'path' && l.name.startsWith('Share')).length, n: store.doc.layers.length };
  })()`);
  check('Graph Data rebuilds the same group as a 3-wedge pie', info.type === 'pie' && info.groups === 1 && info.wedges === 3, { info, before });
  await b.key('z', { modifiers: 4 });
  await sleep(150);
  check('Undo brings the column graph back', (await st(`store.doc.layers.find((l) => l.graph)?.graph.type`)) === 'column');
}

// 3. Every graph tool builds its graph
for (const t of ['stacked-column', 'bar', 'stacked-bar', 'line', 'area', 'scatter', 'radar']) {
  await setup();
  await tool(`graph-${t}`);
  await b.drag(line(150, 120, 650, 520));
  await sleep(120);
  // Line: confirmed from the data box with ⌘+Enter (plain Enter there adds a row)
  if (t === 'line') {
    await b.eval(`document.querySelector('textarea.graph-data').focus()`);
    await b.key('Enter', { modifiers: 4, vk: 13 });
    await sleep(150);
  } else await button('Create');
  const ok = await st(`store.activeLayer?.graph?.type === ${JSON.stringify(t)} && store.doc.layers.filter((l) => l.parent === store.activeLayer.id && l.kind === 'shape').length > 2`);
  check(`${t} graph tool builds an editable graph`, ok);
}

// 4. Live Paint Bucket on two overlapping shapes paints only the overlap region
await setup(`
  const a = sq('A', 200, 200, 300, 250, '#e33333');
  const c = sq('B', 400, 300, 300, 250, '#33aa33');
  store.insertLayer(a, undefined, 'A');
  store.insertLayer(c, undefined, 'B');
  store.setSelectedLayers([a.id, c.id]);
`);
await tool('bucket');
{
  const hover = S(450, 350);
  await b.mouse('mouseMoved', hover.x, hover.y);
  await sleep(80);
  check('Bucket highlights the region under the pointer', (await b.eval(`const { interaction } = await import('/src/core/tools.ts'); return interaction.shapeBuilder?.hover ?? -1`)) >= 0);
  await click(450, 350);
  check('Live Paint fills only the overlap', near(await px(450, 350), [34, 85, 238]) && near(await px(250, 250), [227, 51, 51]) && near(await px(650, 500), [51, 170, 51]), [await px(450, 350), await px(250, 250), await px(650, 500)]);
  const info = await st(`(() => { const gr = store.doc.layers.find((l) => l.name === 'Live Paint Group'); return { gr: !!gr, regions: store.doc.layers.filter((l) => l.parent === gr?.id).length, label: store.doc.history[store.doc.hIndex].label }; })()`);
  check('Regions are kept in a Live Paint Group, one undo step', info.gr && info.regions === 3 && info.label === 'Live Paint Fill', info);
}

// 5. Live Paint Selection picks single regions; ⇧ adds; double-click selects the same colour
await tool('live-paint-select');
await click(250, 250);
check('Live Paint Selection picks the clicked region', (await st(`store.selectedLayers.map((l) => l.shape.fill)`)).join() === '#e33333');
await click(450, 350, { modifiers: SHIFT });
check('⇧-click adds a region', (await st(`store.selectedLayers.length`)) === 2);
await click(650, 500);
await click(650, 500, { clickCount: 2 });
check('Double-click selects every region of that colour', (await st(`store.selectedLayers.every((l) => l.shape.fill === '#33aa33') && store.selectedLayers.length >= 1`)) === true);

// 6. Print Tiling: pages over the artboard; dragging moves them; dialog exports a tiled PDF
await setup(`store.insertLayer(sq('Art', 100, 100, 800, 500, '#e33333'), undefined, 'Art');`);
await tool('print-tiling');
{
  const count = () => b.eval(`
    const { store } = window.__ps;
    const t = await import('/src/core/printTiling.ts');
    const area = t.tilingArea(store.doc);
    return t.printTiles(area, t.tileSettings(), t.tileOrigin(store.doc.id, area)).length;
  `);
  const n0 = await count();
  check('A 1000 × 700 artboard takes 2 Letter pages', n0 === 2, n0);
  await b.drag(line(300, 300, 400, 340));
  const origin = await b.eval(`const { store } = window.__ps; const t = await import('/src/core/printTiling.ts'); return t.tileOrigin(store.doc.id, t.tilingArea(store.doc));`);
  check('Dragging moves the page origin', origin.x === 100 && origin.y === 40, origin);
  check('Moving the pages changes the page count (3 × 2)', (await count()) === 6, await count());
  await click(500, 350);
  await click(500, 350, { clickCount: 2 });
  await sleep(150);
  check('Double-click opens the Print Tiling dialog', (await st(`store.state.dialog?.type`)) === 'printTiling');
  // Capture the saved file instead of downloading it
  await b.eval(`
    window.__savedPdf = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (blob) => { if (blob.type === 'application/pdf') window.__savedPdf = blob; return orig(blob); };
  `);
  await button('Reset Origin');
  await button('Export Tiled PDF');
  await sleep(1500);
  const pdf = await b.eval(`
    const blob = window.__savedPdf;
    if (!blob) return null;
    const text = new TextDecoder('latin1').decode(await blob.arrayBuffer());
    return { count: (text.match(/\\/Count (\\d+)/) || [])[1], box: (text.match(/\\/MediaBox \\[([^\\]]+)\\]/) || [])[1] };
  `);
  check('Export Tiled PDF writes one Letter page per tile', pdf && pdf.count === '2' && pdf.box === '0 0 612.000 792.000', pdf);
}

// 7. Width tool: drag out from the middle of a stroke → a width point; the ends keep the weight; ⌥-click deletes
const pathSetup = `
  const pl = makeLayer({ kind: 'shape', name: 'Line', x: 200, y: 300, width: 600, height: 1, shape: { shape: 'path', closed: false, points: [{ x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0, type: 'corner' }, { x: 1, y: 0, ix: 1, iy: 0, ox: 1, oy: 0, type: 'corner' }], fill: '#000000', fillEnabled: false, stroke: '#2255ee', strokeWidth: 10, strokeCap: 'butt', radius: 0 } });
  store.insertLayer(pl, undefined, 'Line');
  store.selectLayer(pl.id);
`;
await setup(pathSetup);
await tool('width');
await b.drag(line(500, 300, 500, 340));
{
  const wp = await st(`store.activeLayer.shape.widthPoints`);
  check('Width tool adds a width point where the drag starts', wp?.length === 1 && Math.abs(wp[0].t - 0.5) < 0.02 && Math.abs(wp[0].w - 8) < 0.3, wp);
  check('The stroke is 80 px wide at the point and tapers to 10 px at the ends', near(await px(500, 335), [34, 85, 238]) && near(await px(500, 265), [34, 85, 238]) && near(await px(205, 300), [34, 85, 238]) && near(await px(205, 312), [255, 255, 255]), [await px(500, 335), await px(205, 312)]);
  check('One undo step: Add Width Point', (await st(`store.doc.history[store.doc.hIndex].label`)) === 'Add Width Point');
  // Grab the existing point and narrow it
  await b.drag(line(500, 300, 500, 310));
  const wp2 = await st(`store.activeLayer.shape.widthPoints`);
  check('Dragging an existing point changes its width (no new point)', wp2.length === 1 && Math.abs(wp2[0].w - 2) < 0.3, wp2);
  await click(500, 300, { modifiers: 1 });
  check('⌥-click deletes the width point', !(await st(`store.activeLayer.shape.widthPoints`)));
}

// 8. Stroke panel: Align Stroke inside / outside, and a width profile preset
await setup(`
  const r = sq('R', 300, 200, 300, 200, '#e33333');
  r.shape.stroke = '#111111'; r.shape.strokeWidth = 20;
  store.insertLayer(r, undefined, 'R');
  store.selectLayer(r.id);
  store.setDockTab('stroke');
`);
const pick = (title, value) => b.eval(`
  const sel = [...document.querySelectorAll('select')].find((x) => (x.title || '').startsWith(${JSON.stringify(title)}));
  if (!sel) return false;
  sel.value = ${JSON.stringify(value)};
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
`);
await sleep(150);
check('Stroke panel shows Align and Profile', (await pick('Align stroke', 'inside')) === true);
await sleep(120);
check('Align Inside: the stroke sits inside the edge', near(await px(305, 300), [17, 17, 17]) && near(await px(295, 300), [255, 255, 255]) && near(await px(325, 300), [227, 51, 51]), [await px(305, 300), await px(295, 300), await px(325, 300)]);
await pick('Align stroke', 'outside');
await sleep(120);
check('Align Outside: the stroke sits outside the edge', near(await px(295, 300), [17, 17, 17]) && near(await px(305, 300), [227, 51, 51]) && near(await px(278, 300), [255, 255, 255]), [await px(295, 300), await px(305, 300)]);
await pick('Align stroke', 'center');
await pick('Width profile', 'lens');
await sleep(120);
check('Width profile Lens converts to a path with 3 width points', (await st(`store.activeLayer.shape.shape === 'path' && store.activeLayer.shape.widthPoints.length === 3`)) === true);
{
  const svg = await b.eval(`const { docToSvg } = await import('/src/core/formats/svg.ts'); return docToSvg(window.__ps.store.doc);`);
  check('SVG export writes the variable stroke as a filled outline', /fill="#111111" fill-rule="evenodd"/.test(svg), svg.length);
}

// 9. Symbols: New Symbol from a shape, spray it, Redefine updates every instance (keeping stained ones), undo, save/load
await setup(`
  const r = sq('Leaf', 100, 100, 60, 40, '#33aa33');
  store.insertLayer(r, undefined, 'Leaf');
  store.selectLayer(r.id);
  store.setDockTab('symbols');
`);
await sleep(150);
{
  const clicked = await b.eval(`
    const el = [...document.querySelectorAll('.symbols-panel button')].find((x) => x.textContent.includes('New Symbol'));
    if (!el) return null;
    const q = el.getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
  `);
  if (clicked) await b.click(clicked.x, clicked.y);
  await sleep(150);
  const info = await st(`({ defs: (store.doc.symbols ?? []).length, inst: store.activeLayer.symbol, id: store.doc.symbols?.[0]?.id, cur: store.state.opts.symbolId })`);
  check('New Symbol makes a definition and links the shape to it', info.defs === 1 && info.inst === info.id && info.cur === info.id, info);
  await tool('symbol-sprayer');
  await b.drag(line(300, 500, 700, 520, 30));
  const n = await st(`store.doc.layers.filter((l) => l.symbol === store.doc.symbols[0].id).length`);
  check('Symbol Sprayer sprays instances of the chosen symbol', n >= 5, n);
  await b.drag(line(300, 500, 700, 520, 30), { modifiers: 1 });
  const n2 = await st(`store.doc.layers.filter((l) => l.symbol === store.doc.symbols[0].id).length`);
  check('⌥-drag with the Sprayer removes instances in one step', n2 < n && (await st(`store.doc.history[store.doc.hIndex].label`)) === 'Remove Symbols', { n, n2 });
  await b.key('z', { modifiers: 4 });
  await sleep(100);
  check('Symbols panel counts the instances', (await b.eval(`return document.querySelector('.symbol-cell.on .symbol-count')?.textContent`)) === String(n));
  // Stain one sprayed instance, then recolour the master and Redefine
  await b.eval(`
    const { store } = window.__ps;
    const id = store.doc.symbols[0].id;
    const insts = store.doc.layers.filter((l) => l.symbol === id);
    const stained = insts[insts.length - 1];
    store.updateLayer(stained.id, { shape: { ...stained.shape, fill: '#ff00ff' } }, 'Stain');
    const master = insts[0];
    store.updateLayer(master.id, { shape: { ...master.shape, fill: '#2255ee', shape: 'ellipse' } }, 'Edit master');
    store.selectLayer(master.id);
  `);
  await tool('move');
  await sleep(100);
  const rb = await b.eval(`
    const el = [...document.querySelectorAll('.symbols-panel button')].find((x) => x.textContent.includes('Redefine'));
    const q = el.getBoundingClientRect();
    return { x: q.left + q.width / 2, y: q.top + q.height / 2, disabled: el.disabled };
  `);
  await b.click(rb.x, rb.y);
  await sleep(150);
  const after = await st(`(() => { const id = store.doc.symbols[0].id; const insts = store.doc.layers.filter((l) => l.symbol === id); return { fills: [...new Set(insts.map((l) => l.shape.fill))], kinds: [...new Set(insts.map((l) => l.shape.shape))], def: store.doc.symbols[0].shape.fill }; })()`);
  check('Redefine updates every instance; a stained one keeps its colour', !rb.disabled && after.def === '#2255ee' && after.kinds.join() === 'ellipse' && after.fills.includes('#2255ee') && after.fills.includes('#ff00ff') && after.fills.length === 2, after);
  await b.key('z', { modifiers: 4 });
  await sleep(120);
  check('Undo restores the old definition', (await st(`store.doc.symbols[0].shape.fill`)) === '#33aa33');
  await b.key('z', { modifiers: 4 | 8 });
  await sleep(120);
  const round = await b.eval(`
    const { store } = window.__ps;
    const io = await import('/src/core/io.ts');
    const doc = await io.loadProject(io.serializeProject(store.doc), 'Round trip');
    return { defs: doc.symbols?.length, linked: doc.layers.filter((l) => l.symbol === doc.symbols?.[0]?.id).length };
  `);
  check('Symbols survive save and reopen', round.defs === 1 && round.linked >= 6, round);
}

// 10. Pathfinder Minus Back / Trim / Merge / Crop / Outline (A red at the back, B green in front, C red touching A)
const pfSetup = (withC = false) => setup(`
  const A = sq('A', 300, 200, 300, 250, '#e33333'); A.shape.stroke = '#000000'; A.shape.strokeWidth = 6;
  const B = sq('B', 450, 300, 300, 250, '#33aa33');
  store.insertLayer(A, undefined, 'A');
  store.insertLayer(B, undefined, 'B');
  const ids = [A.id, B.id];
  if (${withC}) { const C = sq('C', 150, 150, 200, 150, '#e33333'); store.insertLayer(C, undefined, 'C'); ids.push(C.id); }
  store.setSelectedLayers(ids);
`);
const runCmd = (id) => b.eval(`const { COMMANDS } = await import('/src/core/commands.ts'); COMMANDS.find((c) => c.id === ${JSON.stringify(id)}).run();`);
const RED = [227, 51, 51], GREEN = [51, 170, 51], WHITE = [255, 255, 255];
{
  await pfSetup();
  await runCmd('pathfinder-minus-back');
  await sleep(100);
  check('Minus Back: the front shape minus the back one', near(await px(700, 500), GREEN) && near(await px(500, 350), WHITE) && near(await px(350, 250), WHITE) && (await shapes()).length === 1, [await px(500, 350), await px(700, 500)]);

  await pfSetup();
  await tool('shape-builder');
  await sleep(100);
  const tb = await b.eval(`const el = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Trim'); if (!el) return null; const q = el.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 };`);
  if (tb) await b.click(tb.x, tb.y);
  await sleep(120);
  const tr = await shapes();
  check('Trim (options bar button): two shapes, hidden part removed, strokes removed', !!tb && tr.length === 2 && near(await px(500, 350), GREEN) && near(await px(350, 250), RED) && near(await px(300, 300), RED) && (await st(`store.doc.layers.filter((l) => l.kind === 'shape').every((l) => l.shape.strokeWidth === 0)`)), { tb: !!tb, n: tr.length, edge: await px(300, 300) });

  await pfSetup(true);
  await runCmd('pathfinder-merge');
  await sleep(100);
  const mg = await shapes();
  check('Merge: same-colour shapes join (red A + C → one shape)', mg.length === 2 && mg.filter((x) => x.fill === '#e33333').length === 1 && near(await px(200, 200), RED) && near(await px(500, 350), GREEN), mg.map((x) => x.fill));

  await pfSetup();
  await runCmd('pathfinder-crop');
  await sleep(100);
  check('Crop: only what lies inside the front shape stays', (await shapes()).length === 1 && near(await px(500, 350), RED) && near(await px(700, 500), WHITE) && near(await px(350, 250), WHITE), [await px(500, 350), await px(700, 500)]);

  await pfSetup();
  await runCmd('pathfinder-outline');
  await sleep(100);
  const ol = await st(`store.doc.layers.filter((l) => l.kind === 'shape').map((l) => ({ f: l.shape.fillEnabled, s: l.shape.stroke, w: l.shape.strokeWidth }))`);
  check('Outline: every region becomes an unfilled outline in its fill colour', ol.length === 3 && ol.every((o) => !o.f && o.w === 1) && ol.some((o) => o.s === '#e33333') && ol.some((o) => o.s === '#33aa33') && near(await px(500, 350), WHITE), ol);
  await b.key('z', { modifiers: 4 });
  await sleep(100);
  check('Undo brings both shapes back', (await shapes()).length === 2);
}

// 11. SVG import: opening an .svg gives editable vectors; placing one adds an editable group
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 200 150">
    <style>.st0{fill:#e33333}</style>
    <rect class="st0" x="10" y="10" width="80" height="60"/>
    <g id="Badge" transform="translate(100 20)"><circle cx="40" cy="40" r="30" fill="#2255ee"/><path d="M20 90 Q40 70 60 90 T100 90" fill="none" stroke="#111111" stroke-width="3"/></g>
    <text x="10" y="130" font-size="16" fill="#333333">Hello</text>
  </svg>`;
  const info = await b.eval(`
    const { store } = window.__ps;
    const io = await import('/src/core/io.ts');
    while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
    await io.openFiles([new File([${JSON.stringify(svg)}], 'badge.svg', { type: 'image/svg+xml' })]);
    const d = store.doc;
    return { title: d.title, w: d.width, h: d.height, kinds: d.layers.map((l) => l.kind + ':' + (l.shape?.shape ?? '')), group: d.layers.find((l) => l.kind === 'group')?.name };
  `);
  check('Opening an SVG makes a document of editable layers at its size', info.title === 'badge' && info.w === 400 && info.h === 300 && info.kinds.includes('shape:rectangle') && info.kinds.includes('shape:ellipse') && info.kinds.includes('shape:path') && info.kinds.includes('text:') && info.group === 'Badge', info);
  // viewBox scales 2×: the rect covers (20..180, 20..140), the circle is centred at (280, 120)
  check('SVG geometry and colours land where the file puts them', near(await px(100, 80), [227, 51, 51]) && near(await px(280, 120), [34, 85, 238]) && near(await px(10, 10), [255, 255, 255]), [await px(100, 80), await px(280, 120)]);
  const placed = await b.eval(`
    const { store, ops } = window.__ps;
    const io = await import('/src/core/io.ts');
    ops.newDocument(1000, 700, 'white', 'Place');
    await io.placeImage(new File([${JSON.stringify(svg)}], 'badge.svg', { type: 'image/svg+xml' }), 'badge');
    const a = store.activeLayer;
    return { kind: a.kind, name: a.name, kids: store.doc.layers.filter((l) => l.parent === a.id).length, raster: store.doc.layers.filter((l) => l.kind === 'raster').length, label: store.doc.history[store.doc.hIndex].label };
  `);
  check('Placing an SVG adds one editable group (no flattened image)', placed.kind === 'group' && placed.name === 'badge' && placed.kids >= 3 && placed.raster === 1 && placed.label === 'Place SVG', placed);
}

// 12. Transform Again (step-and-repeat), Transform Each, Offset Path, Round Corners, Recolor, Smooth brush
{
  await setup(`
    const a = sq('A', 100, 100, 80, 60, '#e33333');
    store.insertLayer(a, undefined, 'A');
    store.selectLayer(a.id);
  `);
  await tool('move');
  await b.drag(line(140, 130, 240, 130), { modifiers: 1 });
  await sleep(100);
  await b.key('d', { modifiers: 4 });
  await sleep(100);
  await b.key('d', { modifiers: 4 });
  await sleep(120);
  const xs = (await st(`store.doc.layers.filter((l) => l.kind === 'shape').map((l) => Math.round(l.x)).sort((p, q) => p - q)`));
  check('⌥-drag copy then ⌘D ⌘D: step-and-repeat makes evenly spaced copies', xs.length === 4 && xs[1] - xs[0] === 100 && xs[2] - xs[1] === 100 && xs[3] - xs[2] === 100, xs);
  check('⌘D is one undo step called Transform Again', (await st(`store.doc.history[store.doc.hIndex].label`)) === 'Transform Again');

  // ⌘D still deselects when there is a pixel selection
  await tool('marquee-rect');
  await b.drag(line(500, 400, 600, 500));
  const hadSel = await st(`!!store.doc.selection`);
  await b.key('d', { modifiers: 4 });
  await sleep(80);
  check('⌘D with a pixel selection still deselects (no Transform Again)', hadSel && !(await st(`store.doc.selection`)) && (await st(`store.doc.layers.filter((l) => l.kind === 'shape').length`)) === 4);
  await tool('move');

  // Transform Each: rotate every copy 45° about its own centre
  await b.eval(`const { store } = window.__ps; store.setSelectedLayers(store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.id)); store.set({ dialog: { type: 'transformEach' } });`);
  await sleep(150);
  await b.eval(`
    const inp = document.querySelector('.modal input[aria-label="Rotate"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '45');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await sleep(150);
  const previewRot = await st(`store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.rotation ?? 0)`);
  await button('OK');
  const te = await st(`({ rot: store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.rotation ?? 0), xs: store.doc.layers.filter((l) => l.kind === 'shape').map((l) => Math.round(l.x)).sort((p, q) => p - q), label: store.doc.history[store.doc.hIndex].label, redo: store.doc.history.length - 1 - store.doc.hIndex })`);
  check('Transform Each previews live, then rotates each about its own centre (one step, no stray redo)', previewRot.every((r) => r === 45) && te.rot.every((r) => r === 45) && te.xs.join() === xs.join() && te.label === 'Transform Each' && te.redo === 0, te);

  // Offset Path through its dialog
  await setup(`
    const a = sq('A', 300, 200, 200, 100, '#e33333');
    store.insertLayer(a, undefined, 'A');
    store.selectLayer(a.id);
  `);
  await b.eval(`const { COMMANDS } = await import('/src/core/commands.ts'); COMMANDS.find((c) => c.id === 'offset-path').run();`);
  await sleep(120);
  await button('OK');
  const off = await st(`store.doc.layers.filter((l) => l.kind === 'shape').map((l) => ({ n: l.name, x: Math.round(l.x), w: Math.round(l.width) }))`);
  check('Offset Path adds a 10 px larger copy behind the shape', off.length === 2 && off[0].n === 'A Offset' && off[0].x === 290 && off[0].w === 220, off);

  // Round Corners on the rectangle
  await b.eval(`
    const { store } = window.__ps;
    store.setSelectedLayers([store.doc.layers.find((l) => l.name === 'A').id]);
    const { COMMANDS } = await import('/src/core/commands.ts'); COMMANDS.find((c) => c.id === 'round-corners').run();
  `);
  await sleep(120);
  await button('OK');
  check('Round Corners on a rectangle sets a live corner radius', (await st(`(() => { const s = store.doc.layers.find((l) => l.name === 'A').shape; return s.shape === 'round-rect' && s.radius === 12; })()`)) === true);

  // Recolor Artwork: pick a palette, OK
  await b.eval(`const { store } = window.__ps; store.setSelectedLayers(store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.id)); const { COMMANDS } = await import('/src/core/commands.ts'); COMMANDS.find((c) => c.id === 'recolor').run();`);
  await sleep(150);
  const rows = await b.eval(`return document.querySelectorAll('.recolor-row').length`);
  await b.eval(`
    const sel = [...document.querySelectorAll('.modal select')].pop();
    sel.value = 'h:complementary';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  `);
  await sleep(150);
  const live = await px(400, 250);
  await button('OK');
  const rc = await st(`({ fills: [...new Set(store.doc.layers.filter((l) => l.kind === 'shape').map((l) => l.shape.fill))], label: store.doc.history[store.doc.hIndex].label })`);
  check('Recolor Artwork lists the colours, previews live and applies a palette in one step', rows >= 1 && !near(live, [227, 51, 51]) && !rc.fills.includes('#e33333') && rc.label === 'Recolor Artwork', { rows, live, rc });

  // Smooth brush: a zigzag gets flatter only where brushed
  await setup(`
    const pts = []; for (let i = 0; i <= 20; i++) pts.push({ x: i / 20, y: i % 2 ? 1 : 0, ix: i / 20, iy: i % 2 ? 1 : 0, ox: i / 20, oy: i % 2 ? 1 : 0, type: 'corner' });
    const z = makeLayer({ kind: 'shape', name: 'Zig', x: 100, y: 300, width: 800, height: 40, shape: { shape: 'path', closed: false, points: pts, fill: '#000', fillEnabled: false, stroke: '#111111', strokeWidth: 3, radius: 0 } });
    store.insertLayer(z, undefined, 'Zig');
    store.selectLayer(z.id);
    store.setOpts({ size: 120 });
  `);
  await tool('smooth');
  const amp = (from, to) => st(`(() => { const l = store.doc.layers.find((q) => q.name === 'Zig'); const ys = l.shape.points.filter((p) => p.x >= ${from} && p.x <= ${to}).map((p) => l.y + p.y * l.height); return Math.max(...ys) - Math.min(...ys); })()`);
  const before = [await amp(0.05, 0.25), await amp(0.75, 0.95)];
  for (let k = 0; k < 3; k++) await b.drag(line(150, 320, 300, 320, 20));
  const after = [await amp(0.05, 0.25), await amp(0.75, 0.95)];
  check('Smooth brush flattens the zigzag where brushed and leaves the rest', after[0] < before[0] * 0.7 && Math.abs(after[1] - before[1]) < 1 && (await st(`store.doc.history[store.doc.hIndex].label`)) === 'Smooth', { before, after });
}

const errors = b.logs.filter((l) => l.startsWith('[exception]'));
check('no exceptions in the page', errors.length === 0, errors.slice(0, 3));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
