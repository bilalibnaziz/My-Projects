// Shape layers: presets from the media bin, Trim Paths "draw on" animating on the monitor, the Shape
// inspector (type, Remove draw-on, SVG path errors), all as undo steps.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(500);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const fx = (expr) => b.eval(`const s = window.__effectsScale.store; return (${expr})`);
const clickSel = async (sel) => {
  const p = await b.eval(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  if (p) await b.click(p.x, p.y);
  await sleep(150);
  return !!p;
};
/** Pixels of the given colour family drawn at time t (960 × 540 frame). */
const count = (t, test) => b.eval(`const { renderCompositionFrame } = await import('/src/fx/compositor.ts'); const s = window.__effectsScale.store.getState();
  const c = document.createElement('canvas'); c.width = 960; c.height = 540; const g = c.getContext('2d');
  renderCompositionFrame(g, 960, 540, s.tracks, s.clips, ${t}, null, false, null);
  const d = g.getImageData(0, 0, 960, 540).data; let n = 0; for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i + 1], bb = d[i + 2]; if (${test}) n++; } return n;`);
const GREEN = 'gg > 150 && r < 120 && bb < 140';
const YELLOW = 'r > 200 && gg > 170 && bb < 90';

await fx(`(() => { s.pause(); s.state = { ...s.state, clips: [], captions: [], currentTime: 0, selectedClipId: null }; s.notify(); s.setWorkspace('edit'); s.setCurrentTime(0); })()`);
await sleep(200);

// 1. The Checkmark Draw-On preset from the media bin
{
  const clicked = await clickSel('[data-shape-preset="check-draw"]');
  await sleep(200);
  const clip = await fx(`(() => { const c = s.state.clips.find(c => c.id === s.state.selectedClipId); return c && { name: c.name, type: c.shapeData?.shapeType, keys: (c.keyframes.trimEnd || []).map(k => [k.time, k.value]) }; })()`);
  check('media bin adds a Checkmark Draw-On shape layer with a Trim End 0 → 100 animation', clicked && clip?.type === 'path' && clip.keys.length === 2 && clip.keys[0][1] === 0 && clip.keys[1][1] === 100, clip);
  const n0 = await count(0, GREEN);
  const n1 = await count(0.6, GREEN);
  const n2 = await count(2, GREEN);
  check('on the monitor the tick draws itself on (nothing → part → all)', n0 === 0 && n1 > 50 && n2 > n1 * 1.3, { n0, n1, n2 });
}

// 2. Inspector: the Shape section, Remove draw-on shows the whole tick at once (one undo step)
{
  const section = await b.eval(`return !!document.querySelector('[data-shape-section]')`);
  const undoBefore = await fx(`s.undoStack?.length ?? s.history?.length ?? 0`);
  const clicked = await clickSel('.fx-shape-drawon');
  const n0 = await count(0, GREEN);
  check('Shape inspector is shown; "Remove draw-on" draws the whole tick from the first frame', section && clicked && n0 > 200, { section, n0 });
  await fx(`s.undo()`);
  await sleep(100);
  check('undo brings the draw-on back', (await count(0, GREEN)) === 0, undoBefore);
}

// 3. Star preset: a real 5-point star fills, and changing Points in the store redraws it
{
  await fx(`s.setCurrentTime(0)`);
  await clickSel('[data-shape-preset="star"]');
  await sleep(150);
  const id = await fx(`s.state.selectedClipId`);
  const star5 = await count(0.1, YELLOW);
  await fx(`s.updateShapeData('${id}', { innerRatio: 0.9 })`);
  const fat = await count(0.1, YELLOW);
  check('Star preset draws a star; a larger inner radius fills more', star5 > 2000 && fat > star5 * 1.5, { star5, fat });
}

// 4. SVG path type: broken path data shows an error and keeps the old path
{
  await b.eval(`const sel = document.querySelector('[aria-label="Shape type"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, 'path'); sel.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(150);
  const type = await fx(`s.state.clips.find(c => c.id === s.state.selectedClipId).shapeData`);
  await b.eval(`const t = document.querySelector('[aria-label="SVG path data"]'); t.focus(); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'M 0 0 L 10'); t.dispatchEvent(new Event('input', { bubbles: true })); t.blur();`);
  await sleep(150);
  const err = await b.eval(`return document.querySelector('.fx-shape-error')?.textContent ?? ''`);
  const kept = await fx(`s.state.clips.find(c => c.id === s.state.selectedClipId).shapeData.pathData`);
  check('switching to SVG path gives a default curve; bad data shows an error and is not saved', type.shapeType === 'path' && !!type.pathData && /Bad path/.test(err) && kept === type.pathData, { type: type.shapeType, err, kept });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
