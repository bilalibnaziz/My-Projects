// Workspaces, the resizable dock, the font picker, artboard undo and the packaging dieline,
// driven with real pointer and keyboard input.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const rect = (sel) => b.eval(`const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };`);

await b.eval(`
  localStorage.removeItem('skillvector.layout');
  const { store, ops } = window.__ps;
  const { makeLayer, withLayer } = await import('/src/core/types.ts');
  const { syncTextBounds } = await import('/src/core/render.ts');
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1200, 800, 'white', 'Workspace');
  const t0 = makeLayer({ kind: 'text', name: 'Hello', x: 100, y: 100, text: { text: 'Hello', font: 'Inter', size: 60, weight: 700, italic: false, color: '#111111', align: 'left', lineHeight: 1.2, tracking: 0, shadow: false, stroke: 0, strokeColor: '#000' } });
  const t = withLayer(t0, syncTextBounds(t0));
  store.commit('Setup', { layers: [...store.doc.layers, t], activeId: t.id });
  store.setTool('move');
  (await import('/src/ui/layout.ts')).resetLayout();
`);
await sleep(300);

// 1. Workspace switcher: Video shows its own tabs and guides
{
  const btn = await rect('.ws-btn');
  await b.click(btn.cx, btn.cy);
  await sleep(150);
  const item = await b.eval(`const el = [...document.querySelectorAll('.ws-item')].find((e) => e.textContent.includes('Video')); const r = el.getBoundingClientRect(); return { x: r.x + 20, y: r.y + 10 };`);
  await b.click(item.x, item.y);
  await sleep(200);
  const tabs = await b.eval(`return [...document.querySelectorAll('.dock-tabs button[draggable]')].map((e) => e.textContent)`);
  const ws = await b.eval(`return (await import('/src/ui/layout.ts')).getLayout().workspace`);
  check('choosing Video switches the workspace and its panels', ws === 'video' && tabs.join() === 'Video Studio,Properties,Color,Artboards,Grids,History', { ws, tabs });
}

// 2. Dragging the dock's left edge widens it
{
  const dock = await rect('.dock');
  const edge = await rect('.dock-edge');
  await b.drag([{ x: edge.cx, y: edge.cy }, { x: edge.cx - 40, y: edge.cy }, { x: edge.cx - 100, y: edge.cy }]);
  await sleep(150);
  const after = await rect('.dock');
  check('dragging the dock edge resizes it', Math.abs(after.w - (dock.w + 100)) <= 2, { before: dock.w, after: after.w });
}

// 3. Dragging the splitter moves the panels / Layers boundary
{
  const sp = await rect('.dock-splitter');
  const split0 = await b.eval(`return (await import('/src/ui/layout.ts')).getLayout().split`);
  await b.drag([{ x: sp.cx, y: sp.cy }, { x: sp.cx, y: sp.cy + 40 }, { x: sp.cx, y: sp.cy + 90 }]);
  await sleep(150);
  const split1 = await b.eval(`return (await import('/src/ui/layout.ts')).getLayout().split`);
  check('dragging the splitter gives the panels more room', split1 > split0 + 0.05, { split0, split1 });
}

// 4. Collapse Layers, move Layers above the panels
{
  const btns = await b.eval(`return [...document.querySelectorAll('.dock-layers .dock-mini')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, t: e.title }; })`);
  const collapse = btns.find((x) => x.t.includes('Collapse'));
  await b.click(collapse.x, collapse.y);
  await sleep(120);
  const collapsed = await b.eval(`return !!document.querySelector('.dock-layers.collapsed') && !document.querySelector('.dock-bottom')`);
  const btns2 = await b.eval(`return [...document.querySelectorAll('.dock-layers .dock-mini')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, t: e.title }; })`);
  const expand = btns2.find((x) => x.t.includes('Expand'));
  await b.click(expand.x, expand.y);
  await sleep(120);
  const up = (await b.eval(`return [...document.querySelectorAll('.dock-layers .dock-mini')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, t: e.title }; })`)).find((x) => x.t.includes('above'));
  await b.click(up.x, up.y);
  await sleep(120);
  const order = await b.eval(`return [...document.querySelector('.dock').children].map((e) => e.className.split(' ').find((c) => c === 'dock-layers' || c === 'dock-panels')).filter(Boolean)`);
  check('Layers collapse, expand and move above the panels', collapsed && order[0] === 'dock-layers', { collapsed, order });
}

// 5. Dragging a tab reorders the tab strip (remembered per workspace)
{
  const tabs = await b.eval(`return [...document.querySelectorAll('.dock-tabs button[draggable]')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, t: e.textContent }; })`);
  // HTML5 drag and drop through CDP: dispatch the drag events the browser would fire
  await b.eval(`
    const btns = [...document.querySelectorAll('.dock-tabs button[draggable]')];
    const src = btns.find((e) => e.textContent === 'History');
    const dst = btns.find((e) => e.textContent === 'Properties');
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise((r) => setTimeout(r, 50));
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  `);
  await sleep(150);
  const after = await b.eval(`return [...document.querySelectorAll('.dock-tabs button[draggable]')].map((e) => e.textContent)`);
  check('dragging a tab onto another moves it there', after.indexOf('History') === after.indexOf('Properties') - 1 && after.indexOf('History') < tabs.findIndex((t) => t.t === 'History') && tabs.length === after.length, after);
}

// 6. Font picker: search and Enter set the font of the selected text
{
  await b.eval(`const { store } = window.__ps; store.setTool('text'); store.selectLayer(store.doc.layers.find((l) => l.name === 'Hello').id);`);
  await sleep(200);
  const fb = await rect('.options-bar .font-btn');
  await b.click(fb.cx, fb.cy);
  await sleep(200);
  for (const ch of 'geor') await b.key(ch);
  await sleep(100);
  const listed = await b.eval(`return [...document.querySelectorAll('.font-row-name')].map((e) => e.textContent)`);
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(150);
  const font = await b.eval(`return window.__ps.store.doc.layers.find((l) => l.name === 'Hello').text.font`);
  const open = await b.eval(`return !!document.querySelector('.font-pop')`);
  check('font search + Enter applies the font and closes the menu', listed[0] === 'Georgia' && font === 'Georgia' && !open, { listed, font, open });
  const recent = await b.eval(`return (await import('/src/core/fonts.ts')).recentFonts()[0]`);
  check('the font is remembered as recent', recent === 'Georgia', recent);
}

// 7. Artboard size typed in the panel is one undoable step, and redraws
{
  await b.eval(`const { store } = window.__ps; store.setTool('move'); store.setDockTab('artboards');`);
  await sleep(150);
  const w0 = await b.eval(`return (await import('/src/core/vectorOps.ts')).getActiveArtboard(window.__ps.store.doc).width`);
  const input = await b.eval(`const f = [...document.querySelectorAll('.properties-panel .numfield')].find((e) => e.querySelector('.numfield-label')?.textContent === 'W'); const r = f.querySelector('input').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  await b.click(input.x, input.y);
  await b.eval(`document.activeElement.select()`);
  for (const ch of '1500') await b.key(ch);
  await b.key('Enter', { code: 'Enter', vk: 13 });
  await sleep(150);
  const w1 = await b.eval(`return (await import('/src/core/vectorOps.ts')).getActiveArtboard(window.__ps.store.doc).width`);
  await b.eval(`document.activeElement?.blur()`);
  await b.key('z', { modifiers: 4 });
  await sleep(150);
  const w2 = await b.eval(`return (await import('/src/core/vectorOps.ts')).getActiveArtboard(window.__ps.store.doc).width`);
  check('artboard width edit applies and undoes', w1 === 1500 && w2 === w0, { w0, w1, w2 });
}

// 8. Packaging dieline: Artboards panel ▸ Open Packaging Studio ▸ Insert Box Dieline
{
  const at = (text) => b.eval(`const el = [...document.querySelectorAll('.dock button')].find((e) => e.textContent.includes(${JSON.stringify(text)})); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  await b.eval(`window.__ps.store.setDockTab('artboards')`);
  await sleep(150);
  const open = await at('Open Packaging Studio');
  await b.click(open.x, open.y);
  await sleep(200);
  const ins = await at('Insert Box Dieline');
  await b.click(ins.x, ins.y);
  await sleep(200);
  const info = await b.eval(`
    const ls = window.__ps.store.doc.layers;
    const cut = ls.find((l) => l.name.startsWith('Dieline · Cut'));
    const group = ls.find((l) => l.kind === 'group' && l.name.startsWith('Dieline'));
    return { cut: !!cut, closed: cut?.shape?.closed, folds: ls.filter((l) => l.name.startsWith('Dieline · Crease')).length, grouped: !!group && cut?.parent === group.id };
  `);
  check('Insert Box Dieline makes a grouped cut path and crease lines', info.cut && info.closed && info.folds >= 6 && info.grouped, info);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
