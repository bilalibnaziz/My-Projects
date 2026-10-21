// Workspace studios with real clicks: Trace (image → vectors with holes, placed over the image),
// Print (preflight + fix, print page with bleed and marks), Social (every platform size from one
// design, carousels), Web & UI (components, contrast fix, CSS), Video (graphics in title-safe) and
// Mood Board (masonry, palette). Pixels are checked on the rendered document.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const px = (x, y) => b.eval(`
  const { store } = window.__ps;
  const { renderRect } = await import('/src/core/studio/export.ts');
  const c = renderRect(store.doc, { x: ${x}, y: ${y}, width: 1, height: 1 }, 1, '#ffffff');
  return Array.from(c.getContext('2d').getImageData(0, 0, 1, 1).data);
`);
const isWhite = (p) => p[0] > 235 && p[1] > 235 && p[2] > 235;
const near = (p, c, t = 40) => Math.abs(p[0] - c[0]) < t && Math.abs(p[1] - c[1]) < t && Math.abs(p[2] - c[2]) < t;
const clickEl = async (sel, text) => {
  const r = await b.eval(`
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => (e.textContent + ' ' + (e.title || '')).includes(${JSON.stringify(text ?? '')}) && e.getBoundingClientRect().width > 0);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  `);
  if (!r) throw new Error(`no element ${sel} “${text}”`);
  await b.click(r.x, r.y);
  await sleep(150);
};
const panel = () => b.eval(`return document.querySelector('.studio-panel')?.innerText ?? ''`);
const newDoc = (w, h, title) => b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(${w}, ${h}, 'white', ${JSON.stringify(title)});
`);
const workspace = (id) => b.eval(`const { switchWorkspace } = await import('/src/ui/layout.ts'); switchWorkspace(${JSON.stringify(id)});`);
const add = (code) => b.eval(`
  const { store } = window.__ps;
  const T = await import('/src/core/types.ts');
  const C = await import('/src/core/studio/common.ts');
  const parts = (() => { ${code} })();
  store.commit('Setup', { layers: [...store.doc.layers, ...parts], activeId: parts[parts.length - 1].id });
  return parts.map((l) => l.id);
`);

// ---------------------------------------------------------------- Trace
await newDoc(800, 600, 'Trace');
await workspace('trace');
await sleep(300);
{
  // A black "O" and a red square on a picture layer placed at (200, 100)
  await b.eval(`
    const { store } = window.__ps;
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 300, 200);
    x.fillStyle = '#000000'; x.beginPath(); x.arc(80, 100, 70, 0, Math.PI * 2); x.arc(80, 100, 35, 0, Math.PI * 2, true); x.fill();
    x.fillStyle = '#000000'; x.fillRect(190, 40, 80, 120);
    store.newRasterLayer('Logo scan', { canvas: c, x: 200, y: 100 });
  `);
  await sleep(500);
  const tabs = await b.eval(`return [...document.querySelectorAll('.dock-tabs button[draggable]')].map((e) => e.textContent)`);
  check('Tracing workspace opens on the Trace Studio', tabs[0] === 'Trace Studio' && /preset/i.test(await panel()), tabs);
  const on = await b.eval(`return { on: document.querySelector('.trace-presets .preset-chip.on')?.textContent, sug: document.querySelector('.trace-presets .preset-chip.suggested')?.textContent, why: document.querySelector('.trace-auto')?.textContent }`);
  check('Auto picks the B&W Logo preset for a two-tone scan', on.on === 'Auto' && on.sug === 'B&W Logo' && /B&W Logo/.test(on.why), on);
  await sleep(400);
  const stats = await b.eval(`return document.querySelector('.trace-stats')?.innerText`);
  const drawn = await b.eval(`const c = document.querySelector('.trace-preview'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 60) dark++; return { w: c.width, dark }`);
  check('live preview draws the trace with stats', /1 colour/.test(stats) && drawn.dark > 100, { stats, drawn });
  await clickEl('.studio-panel .btn', 'Trace image');
  await b.waitFor(`!window.__ps.store.state.busy`, 20000);
  await sleep(150);
  const g = await b.eval(`
    const { store } = window.__ps;
    const a = store.activeLayer;
    const kids = store.doc.layers.filter((l) => l.parent === a.id);
    const src = store.doc.layers.find((l) => l.name === 'Logo scan');
    return { name: a.name, kind: a.kind, kids: kids.map((k) => ({ x: k.x, y: k.y, w: k.width, h: k.height, rings: k.shape.compoundPoints?.length ?? 1 })), srcVisible: src.visible };
  `);
  const k = g.kids[0];
  check('trace becomes one group over the image; the image is hidden', g.kind === 'group' && /Traced/.test(g.name) && !g.srcVisible && g.kids.length === 1, g);
  check('traced paths sit where the image is (offset 200,100)', k && Math.abs(k.x - 210) < 2 && Math.abs(k.y - 130) < 2 && k.rings === 3, k);
  const hole = await px(280, 200);
  const ring = await px(225, 200);
  const sq = await px(430, 200);
  check('the O keeps its hole; ring and square are filled', isWhite(hole) && near(ring, [0, 0, 0]) && near(sq, [0, 0, 0]), { hole, ring, sq });
  // Clean-up: recolour from the swatch list, then drop it
  const cleanup = await panel();
  check('clean-up lists the traced colour', /clean up · 1 path/i.test(cleanup) && /Merge by colour/.test(cleanup));
  await b.eval(`const { recolor } = await import('/src/core/studio/trace.ts'); recolor('#000000', '#e11d48');`);
  check('recolour changes every path of that colour', near(await px(430, 200), [225, 29, 72]));
}

// ---------------------------------------------------------------- Print
await newDoc(1050, 600, 'Card');
await workspace('print');
await sleep(300);
{
  const ids = await add(`
    const bg = C.rectLayer('Background', 0, 0, 1050, 600, '#1d4ed8');
    const hair = C.rectLayer('Hairline', 400, 200, 200, 100, 'none', { stroke: '#000000', strokeWidth: 0.4 });
    const edge = C.textLayer('Edge text', 'Name Surname', 8, 280, { size: 40 });
    return [bg, hair, edge];
  `);
  await sleep(300);
  const t = await panel();
  check('Print Studio shows size in mm and preflight issues', /88\.9 × 50\.8 mm/.test(t) && /Artwork stops at the trim\n1\n/.test(t) && /Hairline strokes/.test(t) && /Text too close to the edge/.test(t), t.slice(0, 500));
  // Fix the bleed from the issue row
  const r = await b.eval(`
    const row = [...document.querySelectorAll('.issue')].find((e) => e.textContent.includes('Artwork stops at the trim'));
    const btn = [...row.querySelectorAll('button')].find((x) => x.textContent === 'Fix');
    btn.scrollIntoView({ block: 'center' });
    const r = btn.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  `);
  await b.click(r.x, r.y);
  await sleep(200);
  const bg = await b.eval(`const l = window.__ps.store.doc.layers.find((l) => l.id === ${JSON.stringify(ids[0])}); return { x: l.x, y: l.y, w: l.width, h: l.height }`);
  check('Fix pushes the background 3 mm into the bleed', Math.abs(bg.x + 35.43) < 0.1 && Math.abs(bg.w - (1050 + 70.87)) < 0.2, bg);
  await clickEl('.issue button', 'Fix'); // hairline row is next
  const hw = await b.eval(`return window.__ps.store.doc.layers.find((l) => l.id === ${JSON.stringify(ids[1])}).shape.strokeWidth`);
  check('Fix sets hairlines to 0.25 pt', Math.abs(hw - 0.25 / 72 * 300) < 0.01, hw);
  const page = await b.eval(`
    const { store } = window.__ps;
    const P = await import('/src/core/studio/print.ts');
    const p = P.DEFAULT_PRINT;
    const ab = store.doc.artboards[0];
    const { canvas, trim } = P.renderPrintPage(store.doc, ab, p);
    const d = (x, y) => Array.from(canvas.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data);
    const bleed = P.mmToPx(3, 300), off = P.mmToPx(4, 300);
    return { w: canvas.width, h: canvas.height, trim, inBleed: d(trim.x - bleed / 2, trim.y + 100), pastBleed: d(trim.x - bleed - 4, trim.y + 100), mark: d(trim.x - off - 10, trim.y), noMark: d(trim.x - off - 10, trim.y + 6) };
  `);
  check('print page = trim + slug; artwork runs into the bleed and stops after it', near(page.inBleed, [29, 78, 216]) && isWhite(page.pastBleed), page);
  check('crop marks are drawn on the trim lines outside the bleed', page.mark[0] < 170 && isWhite(page.noMark), { mark: page.mark, noMark: page.noMark });
  const files = await b.eval(`
    const { artboardFiles } = await import('/src/core/studio/export.ts');
    const f = await artboardFiles(window.__ps.store.doc, { format: 'png', scale: 2 });
    return f.map((x) => ({ name: x.name, w: x.width, h: x.height, bytes: x.data.length }));
  `);
  check('artboard export renders at 2× (crisp, real size)', files.length === 1 && files[0].w === 2100 && files[0].h === 1200 && files[0].bytes > 1000, files);
  const gang = await panel();
  check('gang-up sheet: 88.9 × 50.8 mm cards fit 8 on A4 (2 × 4)', /Fits 8 copies \(2 × 4\)/.test(gang), gang.match(/Fits[^\n]*/)?.[0]);
}

// ---------------------------------------------------------------- Social
await newDoc(1080, 1350, 'Post');
await workspace('design');
await sleep(300);
{
  await add(`
    const bg = C.rectLayer('BG', 0, 0, 1080, 1350, '#f97316');
    const card = C.rectLayer('Card', 140, 425, 800, 500, '#111827', { radius: 40 });
    const tiny = C.textLayer('Fine print', 'terms apply', 400, 1250, { size: 14 });
    return [bg, card, tiny];
  `);
  await sleep(300);
  const t = await panel();
  check('Social Studio: legibility flags the 14 px text', /phone legibility · 1 small/i.test(t) && /Fine print/.test(t), t.match(/phone legibility[^\n]*/i)?.[0]);
  await clickEl('.studio-panel .btn', 'Make 8 sizes');
  await sleep(400);
  const boards = await b.eval(`return window.__ps.store.doc.artboards.map((a) => ({ n: a.name, x: a.x, y: a.y, w: a.width, h: a.height }))`);
  check('Make 8 sizes adds 8 artboards at platform sizes', boards.length === 9 && boards.some((a) => a.w === 1080 && a.h === 1920) && boards.some((a) => a.w === 1280 && a.h === 720), boards.map((a) => `${a.w}x${a.h}`));
  const x = boards.find((a) => a.w === 1600 && a.h === 900);
  const corner = await px(x.x + 3, x.y + 3);
  const centre = await px(x.x + x.w / 2, x.y + x.h / 2);
  check('on the 16:9 board the background fills it and the card sits centred', near(corner, [249, 115, 22]) && near(centre, [17, 24, 39]), { corner, centre });
  await clickEl('.studio-panel .btn', 'New carousel');
  const car = await b.eval(`const { store } = window.__ps; const a = store.doc.artboards.find((a) => a.name.startsWith('Carousel')); return a && { w: a.width, h: a.height, grids: a.grids?.map((g) => g.kind + ':' + (g.positions?.length ?? '')) }`);
  check('New carousel: 5 slides wide with slide dividers', car && car.w === 5400 && car.h === 1350 && car.grids.includes('panels:4'), car);
}

// ---------------------------------------------------------------- Web & UI
await newDoc(393, 852, 'App');
await workspace('web');
await sleep(300);
{
  await clickEl('.component-grid .btn', 'Button');
  const btn = await b.eval(`const { store } = window.__ps; const a = store.activeLayer; return { name: a.name, kids: store.doc.layers.filter((l) => l.parent === a.id).map((l) => l.kind) }`);
  check('Button component: a live group of shape + text', btn.name === 'Button · Primary' && btn.kids.join() === 'shape,text', btn);
  await add(`return [C.textLayer('Faint', 'Hard to read', 40, 700, { size: 16, color: '#c0c4cc' })];`);
  await clickEl('.studio-panel .btn', 'Check text contrast');
  const rows = await b.eval(`return [...document.querySelectorAll('.contrast-row')].map((r) => r.innerText.replace(/\\s+/g, ' '))`);
  check('contrast check fails the faint text', rows.some((r) => /Faint .*Fail/.test(r)), rows);
  await clickEl('.studio-panel .btn', 'Fix');
  const fixed = await b.eval(`
    const { contrastRatio } = await import('/src/core/color.ts');
    const l = window.__ps.store.doc.layers.find((l) => l.name === 'Faint');
    return { color: l.text.color, ratio: contrastRatio(l.text.color, '#ffffff') };
  `);
  check('Fix makes it pass WCAG AA with the smallest change', fixed.ratio >= 4.5 && fixed.ratio < 6, fixed);
  await b.eval(`const { store } = window.__ps; store.selectLayer(store.doc.layers.find((l) => l.name === 'Background' && l.parent).id);`);
  await sleep(150);
  const css = await b.eval(`return document.querySelector('.css-out')?.textContent ?? ''`);
  check('CSS hand-off for the selected shape', /border-radius: \d+px;/.test(css) && /background: #/.test(css), css.slice(0, 200));
}

// ---------------------------------------------------------------- Video
await newDoc(1920, 1080, 'Video');
await workspace('video');
await sleep(300);
{
  await clickEl('.component-grid .btn', 'Lower third');
  const lt = await b.eval(`
    const { store } = window.__ps;
    const { layerBounds } = await import('/src/core/align.ts');
    const g = store.activeLayer;
    const kids = store.doc.layers.filter((l) => l.parent === g.id);
    const bs = kids.map((l) => layerBounds(l));
    return { name: g.name, minX: Math.min(...bs.map((b) => b.x)), maxY: Math.max(...bs.map((b) => b.y + b.height)) };
  `);
  check('lower third sits inside title-safe (x ≥ 192, bottom ≤ 972)', lt.name === 'Lower third' && lt.minX >= 191.9 && lt.maxY <= 972.1, lt);
}

// ---------------------------------------------------------------- Mood board
await newDoc(1600, 1000, 'Mood');
await workspace('mood');
await sleep(300);
{
  await b.eval(`
    const { store } = window.__ps;
    const colors = ['#e11d48', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
    const sizes = [[400, 300], [300, 450], [500, 280], [320, 320], [260, 400]];
    sizes.forEach(([w, h], i) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = colors[i]; x.fillRect(0, 0, w, h);
      store.newRasterLayer('Pic ' + (i + 1), { canvas: c, x: 10 * i, y: 10 * i });
    });
    store.setSelectedLayers([]);
  `);
  await clickEl('.studio-panel .btn', 'Masonry');
  const lay = await b.eval(`
    const { store } = window.__ps;
    const pics = store.doc.layers.filter((l) => l.name.startsWith('Pic '));
    return pics.map((l) => ({ x: l.x, y: l.y, w: l.width, h: l.height, cw: l.canvas.width }));
  `);
  const overlap = lay.some((a, i) => lay.some((c, j) => j > i && a.x < c.x + c.w - 1 && a.x + a.w > c.x + 1 && a.y < c.y + c.h - 1 && a.y + a.h > c.y + 1));
  const inside = lay.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1600.5 && r.y + r.h <= 1000.5);
  check('Masonry: no overlaps, everything on the board, pixels resampled', !overlap && inside && lay.every((r) => Math.abs(r.cw - r.w) <= 1), lay);
  await clickEl('.studio-panel .btn', 'Pull palette');
  const sw = await b.eval(`return [...document.querySelectorAll('.studio-panel .swatch-row .swatch-dot')].map((e) => e.title.slice(0, 7))`);
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  check('palette pulls the board colours', sw.length >= 5 && sw.some((c) => near(rgb(c), [225, 29, 72], 30)) && sw.some((c) => near(rgb(c), [59, 130, 246], 30)), sw);
}

if (process.env.SHOT) {
  await workspace('print');
  await sleep(300);
  await b.shot(process.env.SHOT);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
process.exit(failed.length ? 1 : 0);
