// Looks: the library previewed on the photo, one-click apply as a look layer, intensity, compare,
// favourites, categories, GPU result matching the look's own maths, and the create tools
// (Save Adjustments as Look, Match Look, Apply to all photos).
import { connect, sleep, META, SHIFT } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const st = (expr) => b.eval(`const { store, ops } = window.__ps; return (${expr})`);
const px = (x, y) => b.eval(`
  const { store } = window.__ps; const out = store.renderer.render(store.doc, store.overrides);
  return Array.from(out.getContext('2d').getImageData(${x}, ${y}, 1, 1).data);`);
const center = (sel) => b.eval(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
const clickSel = async (sel) => {
  const p = await center(sel);
  if (!p) throw new Error('missing ' + sel);
  await b.click(p.x, p.y);
  await sleep(150);
};
const buttonWith = (text) => b.eval(`const el = [...document.querySelectorAll('.looks-panel button')].find((e) => e.textContent.includes(${JSON.stringify(text)})); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);

// A photo-like test image: colour bands and a grey ramp
await b.eval(`
  const { store, ops } = window.__ps;
  store.set({ dialog: null, paletteOpen: false });
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  ops.newDocument(600, 400, 'white', 'Looks');
  const c = store.activeLayer.canvas.getContext('2d');
  const cols = ['#d9472b', '#e8a33d', '#4f9a3a', '#2f7fc0', '#c9a27e', '#808080'];
  cols.forEach((col, i) => { c.fillStyle = col; c.fillRect(i * 100, 0, 100, 200); });
  for (let x = 0; x < 600; x++) { const v = Math.round((x / 599) * 255); c.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; c.fillRect(x, 200, 1, 200); }
  store.renderer.invalidate(); store.emit();
`);
await sleep(200);
const base = await px(450, 100);

// 1. ⌘⇧K opens the Looks panel with live thumbnails of this photo
await b.key('k', { modifiers: META | SHIFT });
await sleep(300);
await b.waitFor(`document.querySelectorAll('.look-tile canvas').length >= 60`, 20000).catch(() => {});
const tiles = await b.eval(`return { tiles: document.querySelectorAll('.look-tile').length, drawn: document.querySelectorAll('.look-tile canvas').length }`);
check('⌘⇧K opens Looks with a preview of every look on this photo', tiles.tiles >= 60 && tiles.drawn >= 60, tiles);

// 2. A click applies the look as a non-destructive look layer; the panel stays open
await clickSel('.look-tile[data-look="cine-teal-orange"] .look-thumb');
const l1 = await st(`store.doc.layers.filter((l) => l.name.startsWith('Look · ')).map((l) => l.name)`);
const after1 = await px(450, 100);
const stillLooks = await b.eval(`return !!document.querySelector('.looks-panel')`);
check('clicking a look adds one look layer and recolours the photo', l1.length === 1 && l1[0] === 'Look · Teal & Orange' && after1.join() !== base.join() && stillLooks, { l1, base, after1 });

// 3. The GPU result matches the look's own colour maths (LUT orientation and interpolation)
{
  const expect = await b.eval(`
    const { gradeFunction, lookById } = await import('/src/core/looks.ts');
    const f = gradeFunction(lookById('cine-teal-orange').recipe);
    return [[0x2f, 0x7f, 0xc0], [0xd9, 0x47, 0x2b], [128, 128, 128]].map(([r, g, b]) => f(r / 255, g / 255, b / 255).map((v) => Math.round(v * 255)));`);
  const got = [await px(350, 100), await px(50, 100), await px(550, 100)].map((p) => p.slice(0, 3));
  const err = Math.max(...got.flatMap((p, i) => p.map((v, c) => Math.abs(v - expect[i][c]))));
  check('rendered look matches the look maths within 4/255', err <= 4, { got, expect, err });
}

// 4. Another look replaces it (still one layer), and undo goes back
await clickSel('.look-tile[data-look="food-golden-bakery"] .look-thumb');
const l2 = await st(`store.doc.layers.filter((l) => l.name.startsWith('Look · ')).map((l) => l.name)`);
check('choosing another look changes the same look layer', l2.length === 1 && l2[0] === 'Look · Golden Bakery', l2);
await b.key('z', { modifiers: META });
await sleep(150);
check('undo returns to the previous look', (await st(`store.doc.layers.find((l) => l.name.startsWith('Look · '))?.name`)) === 'Look · Teal & Orange');

// 5. Intensity 0 shows the original; hold Before to compare
await b.eval(`(await import('/src/core/lookOps.ts')).setLookAmount(0)`);
await sleep(150);
check('intensity 0 shows the original photo', (await px(450, 100)).join() === base.join(), await px(450, 100));
await b.eval(`(await import('/src/core/lookOps.ts')).setLookAmount(100)`);
await sleep(150);
{
  const p = await buttonWith('Before');
  await b.mouse('mouseMoved', p.x, p.y);
  await b.mouse('mousePressed', p.x, p.y);
  await sleep(150);
  const during = await px(450, 100);
  await b.mouse('mouseReleased', p.x, p.y, { buttons: 0 });
  await sleep(150);
  const back = await px(450, 100);
  check('holding Before shows the photo without the look', during.join() === base.join() && back.join() !== base.join(), { during, back });
}

// 6. Favourites and categories
await clickSel('.look-tile[data-look="portrait-soft-skin"] .look-fav');
{
  const chip = await b.eval(`const el = [...document.querySelectorAll('.looks-chip')].find((e) => e.textContent.trim() === 'Favorites'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  await b.click(chip.x, chip.y);
  await sleep(200);
  const favs = await b.eval(`return [...document.querySelectorAll('.look-tile')].map((e) => e.dataset.look)`);
  check('a hearted look shows under Favorites', favs.length === 1 && favs[0] === 'portrait-soft-skin', favs);
  const food = await b.eval(`const el = [...document.querySelectorAll('.looks-chip')].find((e) => e.textContent.trim() === 'Food'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  await b.click(food.x, food.y);
  await sleep(200);
  const foodTiles = await b.eval(`return [...document.querySelectorAll('.look-tile')].map((e) => e.dataset.look)`);
  check('the Food category lists only food looks', foodTiles.length >= 8 && foodTiles.every((id) => id.startsWith('food-')), foodTiles.length);
}

// 7. Save Adjustments as Look: a desaturating adjustment becomes a reusable look
await b.eval(`
  const { store, ops } = window.__ps;
  ops.newAdjustmentLayer({ saturation: -100 }, 'Mono Grade');
`);
await sleep(200);
// Making an adjustment opens the Adjust panel; come back to Looks
await b.key('k', { modifiers: META | SHIFT });
await sleep(300);
{
  const p = await buttonWith('Save Adjustments as Look');
  await b.click(p.x, p.y);
  await sleep(300);
  const mine = await b.eval(`return (await import('/src/core/lookOps.ts')).loadMyLooks().map((l) => l.name)`);
  check('Save Adjustments as Look adds it to My Looks', mine.includes('Mono Grade'), mine);
  // Use it on a fresh photo: colours turn grey
  await b.eval(`
    const { store } = window.__ps;
    const keep = store.doc.layers.filter((l) => l.kind !== 'adjustment').map((l) => l.id);
    store.commit('Clean', { layers: store.doc.layers.filter((l) => keep.includes(l.id)), activeId: keep[0] });
    const lo = await import('/src/core/lookOps.ts');
    lo.applyLook(lo.loadMyLooks().find((l) => l.name === 'Mono Grade'));`);
  await sleep(200);
  const g = await px(50, 100);
  check('the saved look reproduces the adjustment (red turns grey)', Math.abs(g[0] - g[1]) <= 6 && Math.abs(g[1] - g[2]) <= 6, g);
}

// 8. Match Look: a warm reference photo warms a cool photo
await b.eval(`
  const { store } = window.__ps;
  store.commit('Clean', { layers: store.doc.layers.filter((l) => l.kind !== 'adjustment'), activeId: store.doc.layers[0].id });`);
await sleep(100);
{
  const before = await px(350, 100);
  const r = await b.eval(`
    const ref = document.createElement('canvas'); ref.width = 200; ref.height = 100;
    const c = ref.getContext('2d'); c.fillStyle = '#e0a060'; c.fillRect(0, 0, 200, 100); c.fillStyle = '#a05020'; c.fillRect(0, 50, 200, 50);
    const blob = await new Promise((res) => ref.toBlob(res, 'image/png'));
    const file = new File([blob], 'sunset.png', { type: 'image/png' });
    const lo = await import('/src/core/lookOps.ts');
    const look = await lo.matchLookFromFile(file, 1);
    return { name: look?.name, layer: window.__ps.store.doc.layers.find((l) => l.name.startsWith('Look · '))?.name };`);
  await sleep(200);
  const after = await px(350, 100);
  check('Match Look warms a blue patch toward the warm reference', r.layer === 'Look · Match · sunset' && after[0] > before[0] + 30 && after[2] < before[2] - 30, { r, before, after });
}

// 9. Apply to all photos
await b.eval(`
  const { store, ops } = window.__ps;
  const first = store.state.activeDocId;
  ops.newDocument(200, 200, 'white', 'Second');
  store.set({ activeDocId: first });`);
await sleep(150);
{
  const p = await buttonWith('All photos');
  await b.click(p.x, p.y);
  await sleep(200);
  const second = await st(`store.state.docs.find((d) => d.title === 'Second').layers.map((l) => l.name)`);
  check('“All photos” adds the look to the other open photos', second.some((n) => n.startsWith('Look · Match')), second);
}

const errors = b.logs.filter((l) => l.startsWith('[exception]'));
check('no exceptions in the page', errors.length === 0, errors.slice(0, 3));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
