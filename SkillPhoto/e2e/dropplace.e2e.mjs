// Drag-and-drop images onto an open document: they're placed as layers where they're dropped
// (kept inside the canvas, fitted when big) instead of opening new tabs; Shift-drop opens a new document.
import { connect, sleep } from './cdp.mjs';
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
  ops.newDocument(1080, 1350, 'white', 'Post');
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

const ab = { x: 0, y: 0, w: 1080, h: 1350 };

// 1. Drop on the open document: a layer centred on the drop point, no new tab
{
  const r = await drop({ x: 300, y: 900 }, [{ w: 200, h: 100, name: 'red.png' }]);
  const bx = r.boxes[0];
  check('drop places on the open document at the drop point', r.newDocs === 0 && inside(bx, ab) && Math.abs(bx.x - 200) <= 3 && Math.abs(bx.y - 850) <= 3, r);
}

// 2. Near the edge: kept inside the canvas
{
  const r = await drop({ x: 1075, y: 10 }, [{ w: 300, h: 300, name: 'edge.png' }]);
  const bx = r.boxes[0];
  check('drop near the edge stays inside', inside(bx, ab) && bx.x === 780 && bx.y === 0, r);
}

// 3. Big image fits the canvas
{
  const r = await drop({ x: 540, y: 675 }, [{ w: 4000, h: 2000, name: 'big.png' }]);
  const bx = r.boxes[0];
  check('big image fits the canvas', inside(bx, ab) && bx.w === 1080 && bx.h === 540, r);
}

// 4. Shift-drop opens a new document
{
  const r = await drop({ x: 540, y: 675 }, [{ w: 64, h: 64, name: 'tab.png' }], { shift: true });
  check('Shift-drop opens as a new document', r.newDocs === 1, r);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} drop-place checks passed`);
await b.close?.();
process.exit(failed.length ? 1 : 0);
