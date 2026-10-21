// Photoshop PSD: export a document with groups, styles, masks, blend modes, hidden layers and fill
// opacity, read it back, and check the structure and the rendered pixels survive the round trip.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};

const r = await b.eval(`
  const { store, ops } = window.__ps;
  const T = await import('/src/core/types.ts');
  const L = await import('/src/core/layerStyle.ts');
  const psd = await import('/src/core/psd.ts');
  const io = await import('/src/core/io.ts');
  store.set({ dialog: null });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(300, 200, 'white', 'Roundtrip', undefined);
  const sq = (name, x, y, color, w = 60) => {
    const c = document.createElement('canvas'); c.width = w; c.height = w;
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, w);
    return store.newRasterLayer(name, { canvas: c, x, y });
  };
  const a = sq('Red', 30, 30, '#ff0000');
  const bl = sq('Blue', 120, 40, '#0000ff');
  // Style on Blue: stroke + drop shadow, fill 50%
  store.selectLayer(bl.id);
  L.applyPreset('sticker');
  L.setFill(0.5);
  // Multiply on Red, plus a mask hiding its left half
  const m = document.createElement('canvas'); m.width = 300; m.height = 200;
  const mg = m.getContext('2d'); mg.fillStyle = '#fff'; mg.fillRect(60, 0, 240, 200);
  store.updateLayer(a.id, { blend: 'multiply', mask: { canvas: m, x: 0, y: 0, enabled: true } }, 'Setup');
  // Group them, hide a third layer
  store.setSelectedLayers([a.id, bl.id]);
  ops.groupSelected();
  const hidden = sq('Hidden', 200, 120, '#00ff00', 30);
  store.updateLayer(hidden.id, { visible: false }, 'Hide');
  // Adjustment layer: left out of the PSD layers
  ops.newAdjustmentLayer({ exposure: 0.2 }, 'Brighten');
  const src = store.doc;
  const before = io.flatten(src).getContext('2d').getImageData(0, 0, 300, 200).data;

  const { bytes, skipped } = await psd.psdBytes(src);
  const magic = String.fromCharCode(...new Uint8Array(bytes.slice(0, 4)));
  const back = await psd.psdToLayers(bytes);
  // Re-render the imported layers (no adjustment) and compare with the source minus its adjustment
  const srcNoAdj = { ...src, layers: src.layers.filter(l => l.kind !== 'adjustment') };
  const want = io.flatten(srcNoAdj).getContext('2d').getImageData(0, 0, 300, 200).data;
  const got = io.flatten({ ...src, layers: back.layers }).getContext('2d').getImageData(0, 0, 300, 200).data;
  let maxDiff = 0, diffPx = 0;
  for (let i = 0; i < want.length; i++) { const d = Math.abs(want[i] - got[i]); if (d > maxDiff) maxDiff = d; if (d > 3) diffPx++; }
  const g = back.layers.find(l => l.kind === 'group');
  const red = back.layers.find(l => l.name === 'Red');
  const blue = back.layers.find(l => l.name === 'Blue');
  return {
    magic, skipped, size: bytes.byteLength,
    names: back.layers.map(l => l.kind + ':' + l.name).join(','),
    parents: back.layers.filter(l => l.parent === g?.id).map(l => l.name).join(','),
    redBlend: red?.blend, redMask: !!red?.mask, blueFill: blue?.fill,
    blueFx: { stroke: blue?.fx?.stroke, shadow: blue?.fx?.dropShadow?.enabled },
    hidden: back.layers.find(l => l.name === 'Hidden')?.visible,
    maxDiff, diffPx, changedByAdj: before.some((v, i) => v !== want[i]),
  };
`);

check('writes a real PSD (8BPS) and leaves the adjustment layer out', r.magic === '8BPS' && r.skipped === 1 && r.size > 1000, { magic: r.magic, skipped: r.skipped, size: r.size });
check('groups, order and names survive', r.names === 'raster:Background,raster:Red,raster:Blue,group:Group 1,raster:Hidden' && r.parents === 'Red,Blue', r);
check('blend mode, mask, fill opacity and visibility survive', r.redBlend === 'multiply' && r.redMask && Math.abs(r.blueFill - 0.5) < 0.01 && r.hidden === false, r);
check('layer styles survive (stroke + shadow)', r.blueFx.shadow === true && r.blueFx.stroke?.enabled && r.blueFx.stroke.size === 16 && r.blueFx.stroke.color === '#ffffff', r.blueFx);
check('the re-imported document renders the same pixels', r.diffPx === 0 && r.changedByAdj, { maxDiff: r.maxDiff, diffPx: r.diffPx });

// Opening a .psd file through the normal Open path
{
  const o = await b.eval(`
    const { store } = window.__ps;
    const psd = await import('/src/core/psd.ts');
    const io = await import('/src/core/io.ts');
    const { bytes } = await psd.psdBytes(store.doc);
    const file = new File([bytes], 'Poster.psd', { type: 'image/vnd.adobe.photoshop' });
    await io.openFiles([file]);
    return { title: store.doc.title, n: store.doc.layers.length, w: store.doc.width, groups: store.doc.layers.filter(l => l.kind === 'group').length };
  `);
  await sleep(150);
  const rows = await b.eval(`return document.querySelectorAll('.layer-row').length`);
  check('File ▸ Open accepts .psd and shows its layers', o.title === 'Poster' && o.n === 5 && o.w === 300 && o.groups === 1 && rows === 5, { o, rows });
}

// Bad input fails gracefully
{
  const e = await b.eval(`
    const io = await import('/src/core/io.ts');
    const { store } = window.__ps;
    const before = store.state.docs.length;
    await io.openPsd(new File([new Uint8Array([56, 66, 80, 83, 0, 1, 0, 0])], 'broken.psd'));
    return { docs: store.state.docs.length - before, toast: store.state.toasts.at(-1)?.text };
  `);
  check('a broken PSD shows an error instead of crashing', e.docs === 0 && /Could not open PSD/.test(e.toast ?? ''), e);
}

const errors = b.logs.filter((l) => l.startsWith('[exception]'));
check('no uncaught exceptions', errors.length === 0, errors);
b.close();
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
