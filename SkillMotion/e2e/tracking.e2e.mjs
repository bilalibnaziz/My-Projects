// Motion tracking end to end: a recorded video of a target moving left → right, "Track point" + a click
// on the target in the monitor tracks it through the clip (WebCodecs frames, template matching), the
// marker shows on the monitor, and a title set to "Follow track" moves with it, keeping its offset.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(500);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 500) : '');
};
const fx = (expr) => b.eval(`const s = window.__effectsScale.store; return (${expr})`);
const center = (sel) => b.eval(`const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);

// 1. Record ~3 s of a textured background with a target moving x = 0.25 → 0.75 of the width
const ok = await b.eval(`
  const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d');
  const stream = c.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 4e6 });
  const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
  window.__pos = (t) => ({ u: 0.25 + 0.5 * Math.min(1, t / 3), v: 0.5 + 0.12 * Math.sin(t * 2) });
  const t0 = performance.now(); rec.start(100);
  await new Promise((done) => { const draw = () => { const t = (performance.now() - t0) / 1000;
    for (let y = 0; y < 180; y += 20) for (let x = 0; x < 320; x += 20) { g.fillStyle = ((x + y) / 20) % 2 ? '#3a4a5a' : '#2a3440'; g.fillRect(x, y, 20, 20); }
    const p = window.__pos(t); const px = p.u * 320, py = p.v * 180;
    g.fillStyle = '#ffffff'; g.fillRect(px - 9, py - 9, 18, 18); g.fillStyle = '#ff2200'; g.fillRect(px - 4, py - 4, 8, 8); g.fillStyle = '#000'; g.fillRect(px + 2, py - 9, 2, 18);
    if (t < 3.4) requestAnimationFrame(draw); else done(); }; draw(); });
  const stopped = new Promise((r) => (rec.onstop = r)); rec.stop(); await stopped;
  const m = await import('/src/fx/media.ts');
  const asset = await m.probeFile(new File(chunks, 'target.webm', { type: 'video/webm' }));
  const s = window.__effectsScale.store;
  s.pause(); s.state = { ...s.state, clips: [], captions: [], currentTime: 0, selectedClipId: null }; s.notify();
  s.importMedia([asset]); const id = s.addAssetClip(asset, 'v1', 0); s.updateClipTiming(id, { duration: Math.min(3.2, asset.duration) });
  s.setWorkspace('edit'); s.selectClip(id); s.setCurrentTime(0); window.__vid = id;
  return asset.duration > 3`);
check('recorded test footage imports', ok === true);
await sleep(400);

// 2. Track point → click the target on the monitor
{
  const btn = await center('[data-tracking] .fx-track-btn.primary');
  if (btn) await b.click(btn.x, btn.y);
  await sleep(150);
  const picking = await b.eval(`return document.querySelector('.fx-monitor-canvas').classList.contains('picking')`);
  // The target's frame position at t = 0 → screen position on the monitor canvas
  const at = await b.eval(`const { sourceToFrame } = await import('/src/fx/tracker.ts'); const s = window.__effectsScale.store.getState(); const c = s.clips.find(c => c.id === window.__vid);
    const p = sourceToFrame(c, 0, window.__pos(0).u, window.__pos(0).v, s.resolution); const cv = document.querySelector('.fx-monitor-canvas'); const r = cv.getBoundingClientRect();
    return { x: r.left + p.x * r.width / cv.width, y: r.top + p.y * r.height / cv.height };`);
  await b.click(at.x, at.y);
  const done = await b.waitFor(`(window.__effectsScale.store.getState().clips.find(c => c.id === window.__vid).pointTracks || []).length > 0`, 60000).catch(() => false);
  const tr = await fx(`(() => { const c = s.state.clips.find(c => c.id === window.__vid); const t = c.pointTracks?.[0]; if (!t) return null;
    const errs = t.samples.map(x => { const p = window.__pos(x.t); return Math.hypot((x.x - p.u) * 320, (x.y - p.v) * 180); });
    return { n: t.samples.length, lost: t.lostAt, first: [t.samples[0].x, t.samples[0].y].map(v => Math.round(v * 1000) / 1000), last: [t.samples.at(-1).x, t.samples.at(-1).y].map(v => Math.round(v * 1000) / 1000), lastT: t.samples.at(-1).t,
      medianErr: errs.slice().sort((a, b) => a - b)[Math.floor(errs.length / 2)], span: t.samples.at(-1).x - t.samples[0].x }; })()`);
  const msg = await b.eval(`return document.querySelector('[data-tracking] .fx-track-msg')?.textContent`);
  // The recorder's timestamps drift from performance.now a little, so judge the path loosely (in source pixels of 320×180)
  check('Track point + a click arms the monitor and tracks the target through the clip', picking && done && tr && tr.n > 40 && tr.lost === undefined && tr.span > 0.35 && tr.medianErr < 12 && /Tracked/.test(msg ?? ''), { picking, tr, msg });
  const item = await b.eval(`return document.querySelector('[data-track-item] .fx-track-meta')?.textContent`);
  check('the track is listed under the clip with its frame count', /frames/.test(item ?? ''), item);
}

// 3. The tracked marker shows on the monitor at the playhead
{
  const marker = await b.eval(`const s = window.__effectsScale.store; s.setCurrentTime(1.5); await new Promise(r => setTimeout(r, 300));
    const { sourceToFrame, timelineOf } = await import('/src/fx/tracker.ts'); const st = s.getState(); const c = st.clips.find(c => c.id === window.__vid); const t = c.pointTracks[0];
    const near = t.samples.reduce((b, x) => Math.abs(timelineOf(c, x.t) - 1.5) < Math.abs(timelineOf(c, b.t) - 1.5) ? x : b); const p = sourceToFrame(c, 1.5, near.x, near.y, st.resolution);
    const cv = document.querySelector('.fx-monitor-canvas'); const k = cv.width / cv.getBoundingClientRect().width; const r = Math.round(9 * k);
    const d = cv.getContext('2d').getImageData(Math.round(p.x + r), Math.round(p.y) - 1, 2, 3).data; return Array.from(d.slice(0, 4));`);
  check('an amber marker is drawn on the monitor at the tracked point', marker[0] > 180 && marker[1] > 100 && marker[2] < 80, marker);
}

// 4. A title follows the track, keeping its offset from the point
{
  const title = await fx(`(() => { s.setCurrentTime(0); s.addNewClip('text', 'v3'); const id = s.state.selectedClipId; s.patchClip(id, { duration: 3, transform: { ...s.state.clips.find(c => c.id === id).transform, positionX: -300, positionY: -150 } }, false); s.selectClip(id); return id; })()`);
  await sleep(200);
  const sel = await b.eval(`return !!document.querySelector('[aria-label="Follow a track"]')`);
  await b.eval(`const sel = document.querySelector('[aria-label="Follow a track"]'); const opt = [...sel.options].find(o => o.value); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(sel, opt.value); sel.dispatchEvent(new Event('change', { bubbles: true })); return true;`);
  await sleep(150);
  const r = await b.eval(`const { getEvaluatedTransform } = await import('/src/fx/compositor.ts'); const { sourceToFrame, timelineOf } = await import('/src/fx/tracker.ts');
    const st = window.__effectsScale.store.getState(); const t = st.clips.find(c => c.id === '${title}'); const v = st.clips.find(c => c.id === window.__vid); const tk = v.pointTracks[0];
    const inside = tk.samples.filter(sm => timelineOf(v, sm.t) < t.startTime + t.duration - 0.05); const pts = [inside[0], inside[Math.floor(inside.length / 2)], inside.at(-1)].map(sm => { const tl = timelineOf(v, sm.t); const p = sourceToFrame(v, tl, sm.x, sm.y, st.resolution); const tr = getEvaluatedTransform(t, tl - t.startTime + t.offset);
      return { dx: Math.round(tr.positionX - (p.x - st.resolution.width / 2)), dy: Math.round(tr.positionY - (p.y - st.resolution.height / 2)), x: Math.round(tr.positionX) }; });
    return { keys: (t.keyframes.positionX || []).length, pts, msg: document.querySelector('[data-tracking] .fx-track-msg')?.textContent };`);
  const offsetsSame = r.pts.every((p) => Math.abs(p.dx - r.pts[0].dx) <= 1 && Math.abs(p.dy - r.pts[0].dy) <= 1);
  check('“Follow track” keys the title to the point: it moves with it and keeps its offset', sel && r.keys > 40 && offsetsSame && r.pts[2].x - r.pts[0].x > 300 && /Following/.test(r.msg ?? ''), r);
  const undone = await fx(`(s.undo(), (s.state.clips.find(c => c.id === '${title}').keyframes.positionX || []).length)`);
  check('one undo removes the follow keyframes', undone === 0, { undone });
}

b.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
