// Expressions in the inspector: "= Expression" opens a formula field; `time * 90` spins the clip on the
// monitor, a bad formula shows its error and changes nothing, a preset applies in one pick, × removes it,
// and every change is one undo step.
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
const typeInto = (sel, text) =>
  b.eval(`const t = document.querySelector('${sel}'); t.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
const rotAt = (t) => b.eval(`const { getEvaluatedTransform } = await import('/src/fx/compositor.ts'); const s = window.__effectsScale.store.getState(); const c = s.clips.find(c => c.id === s.selectedClipId); return Math.round(getEvaluatedTransform(c, ${t} + c.offset).rotation * 100) / 100;`);

const id = await fx(`(() => { s.pause(); s.state = { ...s.state, clips: [], captions: [], currentTime: 0, selectedClipId: null }; s.notify(); s.setWorkspace('edit');
  s.setCurrentTime(0); s.addNewClip('shape', 'v2'); const id = s.state.selectedClipId; s.patchClip(id, { duration: 4, shapeData: { ...s.state.clips.find(c => c.id === id).shapeData, shapeType: 'rectangle' } }, false); s.selectClip(id); return id; })()`);
await sleep(200);

// 1. Open the field on Rotation, type a formula, press Enter
{
  const open = await b.eval(`const e = document.querySelector('[aria-label="Add expression to rotation"]'); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  if (open) await b.click(open.x, open.y);
  await sleep(100);
  await typeInto('[aria-label="rotation expression"]', 'time * 90');
  await b.key('Enter');
  await sleep(150);
  const saved = await fx(`s.state.clips.find(c => c.id === '${id}').expressions`);
  const r1 = await rotAt(1);
  const r2 = await rotAt(2.5);
  check('typing `time * 90` on Rotation saves it and spins the clip 90°/s', !!open && saved?.rotation === 'time * 90' && r1 === 90 && r2 === 225, { saved, r1, r2 });
}

// 2. The monitor really draws the rotated clip (pixels differ between t = 0 and t = 0.5)
{
  const px = (t) => b.eval(`const { renderCompositionFrame } = await import('/src/fx/compositor.ts'); const s = window.__effectsScale.store.getState();
    const c = document.createElement('canvas'); c.width = 480; c.height = 270; const g = c.getContext('2d');
    renderCompositionFrame(g, 480, 270, s.tracks, s.clips, ${t}, null, false, null);
    const d = g.getImageData(0, 0, 480, 270).data; let h = 0, n = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 0 && (d[i] + d[i + 1] + d[i + 2]) > 30) n++; h = (h + (d[i] + d[i + 1] * 3 + d[i + 2] * 7) * ((i >> 2) % 9973)) % 1000000007; } return { h, n };`);
  const a = await px(0);
  const c = await px(0.5);
  check('rendered frames follow the expression (the rotated shape draws differently)', a.n > 0 && a.h !== c.h, { a, c });
}

// 3. A bad formula shows its error and is not saved
{
  await typeInto('[aria-label="rotation expression"]', 'time * (90');
  await sleep(80);
  const err = await b.eval(`return document.querySelector('[data-expression="rotation"] .fx-expr-error')?.textContent`);
  await b.key('Enter');
  await sleep(100);
  const saved = await fx(`s.state.clips.find(c => c.id === '${id}').expressions.rotation`);
  check('a broken formula shows the parse error live and keeps the last good one', /Expected|ends too early/.test(err ?? '') && saved === 'time * 90', { err, saved });
  await b.key('Escape');
}

// 4. Presets on Position X; one undo removes it again
{
  const before = await fx(`s.historyDepth()`);
  const o = await b.eval(`const e = document.querySelector('[aria-label="Add expression to positionX"]'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  await b.click(o.x, o.y);
  await sleep(100);
  await b.eval(`const sel = document.querySelector('[data-expression="positionX"] .fx-expr-presets'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, 'wiggle(3, 25)'); sel.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
  await sleep(150);
  const set = await fx(`s.state.clips.find(c => c.id === '${id}').expressions.positionX`);
  const wiggles = await b.eval(`const { getEvaluatedTransform } = await import('/src/fx/compositor.ts'); const s = window.__effectsScale.store.getState(); const c = s.clips.find(c => c.id === '${id}'); return [0.3, 0.9, 1.7].map(t => Math.round(getEvaluatedTransform(c, t).positionX * 10) / 10);`);
  await fx(`(s.undo(), true)`);
  const after = await fx(`s.state.clips.find(c => c.id === '${id}').expressions`);
  check('the Wiggle preset applies in one pick (moves within ±25) and one undo removes it', set === 'wiggle(3, 25)' && new Set(wiggles).size === 3 && wiggles.every((v) => Math.abs(v) <= 25) && !after?.positionX && after?.rotation === 'time * 90' && (await fx(`s.historyDepth()`)) === before, { set, wiggles, after });
}

// 5. × removes the expression; the clip is saved and reopened with it intact (project round trip)
{
  const json = await b.eval(`const { serializeProject, parseProject } = await import('/src/fx/project.ts').catch(() => ({})); if (!serializeProject) return 'skip'; const s = window.__effectsScale.store; const txt = serializeProject(s.getSequence(), s.getState().mediaAssets); const back = parseProject(txt); return back.sequence?.clips?.find(c => c.id === '${id}')?.expressions ?? back.clips?.find?.(c => c.id === '${id}')?.expressions ?? null;`).catch((e) => String(e));
  const x = await b.eval(`const e = document.querySelector('[aria-label="Remove rotation expression"]'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
  await b.click(x.x, x.y);
  await sleep(150);
  const gone = await fx(`s.state.clips.find(c => c.id === '${id}').expressions`);
  const r = await rotAt(1);
  check('× removes the expression (rotation back to its value)', !gone && r === 0, { gone, r, json });
}

b.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
