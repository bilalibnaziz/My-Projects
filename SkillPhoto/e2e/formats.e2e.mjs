// File formats: TIFF (save → open), CMYK TIFF, PDF, SVG (vector shapes and text), BMP, ICO,
// export layers / sizes as ZIP — checked on the files the app actually produces.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 300) : '');
};

// Capture saved files instead of downloading them
await b.eval(`
  window.__saved = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { window.__saved.push(blob); return orig(blob); };
  const { store, ops } = window.__ps;
  store.set({ dialog: null });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(300, 200, 'white', 'Formats', undefined);
  const c = document.createElement('canvas'); c.width = 100; c.height = 80; const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 100, 80);
  store.newRasterLayer('Photo', { canvas: c, x: 10, y: 10 });
  const T = await import('/src/core/types.ts');
  store.insertLayer(T.makeLayer({ kind: 'shape', name: 'Badge', x: 150, y: 20, width: 120, height: 60, shape: { shape: 'rectangle', fill: '#0055ff', fillEnabled: true, stroke: '#000000', strokeWidth: 0, radius: 12, sides: 5 } }));
  const tools = await import('/src/core/tools.ts');
  tools.createTextAt(20, 150); store.set({ textEditId: null });
  tools.updateText(store.activeLayer.id, { text: 'Sale 50%', size: 32, color: '#111111', runs: [{ start: 5, end: 8, color: '#ff0000' }] });
`);
await sleep(150);
const last = (type) => b.eval(`const blobs = window.__saved.filter(x => x.type === ${JSON.stringify(type)}); return blobs.length`);

// 1. TIFF: save, then open it back — same pixels
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const io = await import('/src/core/io.ts');
    await io.exportTiff(store.doc);
    const blob = window.__saved.at(-1);
    const before = io.flatten(store.doc).getContext('2d').getImageData(0, 0, 300, 200).data;
    await io.openFiles([new File([blob], 'Back.tif', { type: 'image/tiff' })]);
    const after = store.doc.layers[0].canvas.getContext('2d').getImageData(0, 0, 300, 200).data;
    let diff = 0; for (let i = 0; i < before.length; i++) diff = Math.max(diff, Math.abs(before[i] - after[i]));
    return { type: blob.type, size: blob.size, title: store.doc.title, diff };
  `);
  check('TIFF saves and opens back with identical pixels', r.type === 'image/tiff' && r.title === 'Back' && r.diff === 0, r);
  await b.eval(`const { store } = window.__ps; store.closeDoc(store.doc.id);`);
}

// 2. CMYK TIFF: separated, 4 channels, 300 dpi
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const io = await import('/src/core/io.ts');
    await io.exportTiff(store.doc, true);
    const buf = await window.__saved.at(-1).arrayBuffer();
    const dv = new DataView(buf);
    const n = dv.getUint16(8, true);
    const tags = {};
    for (let i = 0; i < n; i++) { const e = 10 + i * 12; tags[dv.getUint16(e, true)] = dv.getUint16(e + 8, true); }
    return { photometric: tags[262], spp: tags[277] };
  `);
  check('CMYK TIFF is a 4-channel separated image', r.photometric === 5 && r.spp === 4, r);
}

// 3. PDF
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const io = await import('/src/core/io.ts');
    await io.exportPdf(store.doc);
    const t = new TextDecoder('latin1').decode(await window.__saved.at(-1).arrayBuffer());
    return { head: t.slice(0, 8), box: /MediaBox \\[0 0 300.000 200.000\\]/.test(t), jpeg: t.includes('/DCTDecode'), end: t.trimEnd().endsWith('%%EOF') };
  `);
  check('PDF has the right page size and an embedded image', r.head === '%PDF-1.4' && r.box && r.jpeg && r.end, r);
}

// 4. SVG keeps shapes and text as vectors, and renders like the document
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const io = await import('/src/core/io.ts');
    await io.exportSvg(store.doc);
    const svg = await window.__saved.at(-1).text();
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const c = document.createElement('canvas'); c.width = 300; c.height = 200; c.getContext('2d').drawImage(img, 0, 0);
    const px = (x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);
    return { path: /<path d="M[^"]*A12 12/.test(svg), text: svg.includes('<tspan') && svg.includes('fill="#ff0000"'), images: (svg.match(/<image/g) || []).length, red: px(50, 50), blue: px(210, 50) };
  `);
  check('SVG: rounded shape as a path, rich text as tspans, photo as an image; renders the same', r.path && r.text && r.images === 2 && r.red.join() === '255,0,0,255' && r.blue.join() === '0,85,255,255', r);
}

// 5. BMP and ICO
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const io = await import('/src/core/io.ts');
    await io.exportBmp(store.doc);
    const bmp = new Uint8Array(await window.__saved.at(-1).arrayBuffer());
    await io.exportIco(store.doc);
    const ico = new DataView(await window.__saved.at(-1).arrayBuffer());
    const icoImg = await createImageBitmap(window.__saved.at(-1)).then(b => [b.width, b.height]).catch(() => null);
    return { bm: String.fromCharCode(bmp[0], bmp[1]), icons: ico.getUint16(4, true), icoImg };
  `);
  check('BMP and a 6-size .ico are written', r.bm === 'BM' && r.icons === 6, r);
}

// 6. Export layers / sizes as ZIP
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const io = await import('/src/core/io.ts');
    await io.exportLayers(store.doc, { trim: true });
    const z1 = new TextDecoder('latin1').decode(await window.__saved.at(-1).arrayBuffer());
    await io.exportScales(store.doc);
    const z2 = new TextDecoder('latin1').decode(await window.__saved.at(-1).arrayBuffer());
    const names = (z) => [...z.matchAll(/PK\\x01\\x02[\\s\\S]{42}([^\\x00]*?\\.(?:png|jpg))/g)].map(m => m[1]);
    return { layers: names(z1), sizes: names(z2) };
  `);
  check('Layers to Files and @1x/@2x/@3x come as ZIPs with the right files', r.layers.length === 4 && r.layers[0].startsWith('01 Sale') && r.sizes.join() === 'Formats.png,Formats@2x.png,Formats@3x.png', r);
}

const errors = b.logs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]'));
check('no console errors', errors.length === 0, errors);
b.close();
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
