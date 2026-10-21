// Drag-and-drop images with several artboards: a dropped file lands on the artboard under the
// drop point (centred there, kept inside the board), not on the document centre or a new tab;
// pasteboard drops go to the active board, Shift-drop opens a new document, dropping on the
// selected shape fills it as a frame, big images fit the board, and paste follows the selection.
import { connect, sleep, META } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};

await b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(1080, 1080, 'white', 'Boards');
  const vo = await import('/src/core/vectorOps.ts');
  const d = store.doc;
  vo.getActiveArtboard(d);
  vo.addArtboard(d, 'Artboard 2');
  vo.addArtboard(d, 'Artboard 3');
  d.activeArtboardId = d.artboards[0].id;
  const { view } = await import('/src/core/commands.ts');
  view.fitRect({ x: 0, y: 0, width: d.width, height: d.height });
  store.emit();
`);
await sleep(300);

// Drops real File objects through the app's drop handler at a document point
const drop = (pt, files, opts = {}) =>
  b.eval(`
    const { store } = window.__ps;
    const make = (w, h, color, name) => new Promise((res) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h);
      c.toBlob((bl) => res(new File([bl], name, { type: 'image/png' })), 'image/png');
    });
    const dt = new DataTransfer();
    for (const f of ${JSON.stringify(files)}) dt.items.add(await make(f.w, f.h, f.color ?? '#e33', f.name));
    const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
    const v = store.doc.view;
    const p = ${JSON.stringify(pt)};
    const clientX = r.left + v.panX + p.x * v.zoom, clientY = r.top + v.panY + p.y * v.zoom;
    const docsBefore = store.state.docs.length;
    const target = document.elementFromPoint(clientX, clientY);
    for (const type of ['dragenter', 'dragover', 'drop'])
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX, clientY, dataTransfer: dt, shiftKey: ${!!opts.shift} }));
    await new Promise((res) => setTimeout(res, 600));
    const d = store.doc;
    const names = ${JSON.stringify(files.map((f) => f.name.replace(/\.[^.]+$/, '')))};
    const boxes = names.map((n) => d.layers.filter((l) => l.name === n).at(-1)).filter(Boolean).map((l) => ({ name: l.name, x: l.x, y: l.y, w: l.canvas?.width, h: l.canvas?.height, clip: !!l.clip }));
    return { boxes, newDocs: store.state.docs.length - docsBefore, active: d.artboards?.find((a) => a.id === d.activeArtboardId)?.name, boards: d.artboards?.map((a) => ({ x: a.x, y: a.y, w: a.width, h: a.height })), toast: store.state.toasts.at(-1)?.text };
  `);
const inside = (bx, ab) => bx.x >= ab.x && bx.y >= ab.y && bx.x + bx.w <= ab.x + ab.w && bx.y + bx.h <= ab.y + ab.h;

const boards = await b.eval(`return window.__ps.store.doc.artboards.map((a) => ({ x: a.x, y: a.y, w: a.width, h: a.height }))`);
const [ab1, ab2, ab3] = boards;

// 1. Drop on Artboard 2 while Artboard 1 is active: lands centred on the drop point in Artboard 2
{
  const pt = { x: ab2.x + 400, y: ab2.y + 500 };
  const r = await drop(pt, [{ w: 200, h: 100, name: 'red.png' }]);
  const bx = r.boxes[0];
  check('drop on Artboard 2 places there, centred on the drop point', r.newDocs === 0 && inside(bx, ab2) && Math.abs(bx.x - (300 + ab2.x)) <= 3 && Math.abs(bx.y - (450 + ab2.y)) <= 3 && r.active === 'Artboard 2', r);
  check('toast names the board', /on Artboard 2/.test(r.toast ?? ''), r.toast);
}

// 2. Drop near Artboard 1's corner: kept inside the board
{
  const r = await drop({ x: ab1.x + 10, y: ab1.y + 1070 }, [{ w: 300, h: 300, name: 'corner.png' }]);
  const bx = r.boxes[0];
  check('drop near a corner stays inside Artboard 1', inside(bx, ab1) && bx.x === ab1.x && bx.y === ab1.y + 780 && r.active === 'Artboard 1', r);
}

// 3. Drop on the pasteboard between boards: the active (last used) board, centred
{
  const r = await drop({ x: ab1.x + ab1.w + 30, y: 540 }, [{ w: 100, h: 100, name: 'gap.png' }]);
  const bx = r.boxes[0];
  check('pasteboard drop goes to the active board', inside(bx, ab1) && r.active === 'Artboard 1', r);
}

// 4. A big image is scaled down to fit the board it lands on
{
  const r = await drop({ x: ab3.x + 540, y: ab3.y + 540 }, [{ w: 3000, h: 1500, name: 'big.png' }]);
  const bx = r.boxes[0];
  check('big image fits Artboard 3', inside(bx, ab3) && bx.w === 1080 && bx.h === 540, r);
}

// 5. Several files: all on the drop board, stepped so they don't stack
{
  const r = await drop({ x: ab2.x + 540, y: ab2.y + 540 }, [{ w: 100, h: 100, name: 'a.png' }, { w: 100, h: 100, name: 'b.png', color: '#33e' }]);
  const [p, q] = r.boxes;
  check('two files land on Artboard 2, offset', r.newDocs === 0 && inside(p, ab2) && inside(q, ab2) && q.x - p.x === 24 && q.y - p.y === 24, r);
}

// 6. Shift-drop opens a new document
{
  const r = await drop({ x: ab1.x + 540, y: ab1.y + 540 }, [{ w: 64, h: 64, name: 'tab.png' }], { shift: true });
  check('Shift-drop opens as a new document', r.newDocs === 1, r);
  await b.eval(`const { store } = window.__ps; store.closeDoc(store.state.activeDocId); `);
  await sleep(200);
}

// 7. Dropped on the selected shape: fills it as a frame (clipped). The shape is drawn with the real tool.
{
  const g = await b.eval(`
    const { store } = window.__ps;
    store.set({ tool: 'shape-rect' });
    const r = document.querySelector('.viewport-canvas').getBoundingClientRect();
    const v = store.doc.view;
    return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };
  `);
  const S = (x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
  const from = S(ab3.x + 100, ab3.y + 100), to = S(ab3.x + 500, ab3.y + 400);
  await b.drag([from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to], { modifiers: META });
  await sleep(200);
  const r = await drop({ x: ab3.x + 300, y: ab3.y + 250 }, [{ w: 200, h: 200, name: 'fill.png' }]);
  const bx = r.boxes[0];
  check('drop on the selected shape fills it as a frame', bx.clip && bx.w >= 290 && bx.h >= 290, r);
}

// 8. Paste / Place without a drop point follows the selection's board
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const io = await import('/src/core/io.ts');
    const d = store.doc;
    d.activeArtboardId = d.artboards[0].id;
    const c = document.createElement('canvas'); c.width = 50; c.height = 50; c.getContext('2d').fillRect(0, 0, 50, 50);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    // The frame shape on Artboard 3 is selected; place with no frame so it lands as a plain image
    await io.placeImage(blob, 'Pasted', { frame: null });
    const l = store.doc.layers.at(-1);
    return { x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height, active: d.artboards.find((a) => a.id === d.activeArtboardId).name };
  `);
  check('paste goes to the board holding the selection', inside(r, ab3) && r.active === 'Artboard 3', r);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} drop-place checks passed`);
await b.close?.();
process.exit(failed.length ? 1 : 0);
