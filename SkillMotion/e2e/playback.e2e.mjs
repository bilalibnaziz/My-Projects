// Media-engine budgets on real decoded video (section 3 of the Motion prompt). Correctness checks fail the
// suite; budgets are measured and printed as BUDGET ok / BUDGET MISS with the numbers (dev server, so
// slower than the shipped app). Run with a quiet machine: load average below ~20.
import { connect, sleep } from './cdp.mjs';
import { loadavg } from 'node:os';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const budgets = [];
const budget = (name, ok, info) => {
  budgets.push({ name, ok, info });
  console.log(`BUDGET ${ok ? 'ok  ' : 'MISS'}  ${name}`, JSON.stringify(info));
};
console.log('load average', loadavg().map((x) => x.toFixed(1)).join(' '));
const fx = (expr) => b.eval(`const s = window.__effectsScale.store; return (${expr})`);
const settle = () => b.eval(`const m = await import('/src/fx/media.ts'); await new Promise(r => requestAnimationFrame(() => r())); await m.mediaSettled(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true`);
const FPS = 30;

await fx(`(() => { s.pause(); s.state = { ...s.state, clips: [], inPoint: null, outPoint: null, showSafeGuides: false, currentTime: 0, selectedClipId: null, fps: ${FPS} }; s.notify(); return true; })()`);

// A 1080p H.264 clip, 5 s, keyframe every second, with real detail (gradients + moving shapes)
const enc = await b.eval(`
  const mb = await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
  const W = 1920, H = 1080, N = 150;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const codec = (await mb.canEncodeVideo('avc', { width: W, height: H })) ? 'avc' : 'vp9';
  const output = new mb.Output({ format: codec === 'avc' ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
  const src = new mb.CanvasSource(c, { codec, bitrate: 12e6, keyFrameInterval: 1 });
  output.addVideoTrack(src, { frameRate: ${FPS} });
  await output.start();
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, 'hsl(' + i * 3 + ',60%,35%)'); grd.addColorStop(1, 'hsl(' + (i * 3 + 160) + ',60%,65%)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 24; k++) { g.fillStyle = 'hsl(' + (k * 15) + ',80%,55%)'; g.beginPath(); g.arc((k * 97 + i * 11) % W, (k * 61 + i * 7) % H, 40 + k, 0, 7); g.fill(); }
    await src.add(i / ${FPS}, 1 / ${FPS});
  }
  await output.finalize();
  const file = new File([output.target.buffer], 'hd.' + (codec === 'avc' ? 'mp4' : 'webm'), { type: codec === 'avc' ? 'video/mp4' : 'video/webm' });
  const m = await import('/src/fx/media.ts');
  const asset = await m.probeFile(file);
  window.__hd = asset;
  return { codec, duration: asset.duration, MB: +(file.size / 1048576).toFixed(1), encodeS: +((performance.now() - t0) / 1000).toFixed(1) };`);
check('1080p test clip encodes and imports', Math.abs(enc.duration - 5) < 0.1, enc);

// 3 video tracks × 30 s (six copies per track, back to back)
const tl = await fx(`(() => { s.importMedia([window.__hd]);
  for (const tr of ['v1', 'v2', 'v3']) for (let i = 0; i < 6; i++) s.addAssetClip(window.__hd, tr, i * 5);
  return s.getState().clips.filter(c => c.mediaKind === 'video').length; })()`);
check('3 video tracks × 30 s on the timeline', tl === 18, { clips: tl });

// 1. Playback 30 s: dropped frames (late or missing draws) from the monitor's own counter
await fx(`(s.setCurrentTime(0), true)`);
await settle();
await b.eval(`const f = await import('/src/fx/frameDecoder.ts'); f.frameStats(true); f.resetPlaybackMetrics(); f.recentMisses(true); return true`);
await fx(`(s.play(), true)`);
const playStart = Date.now();
await sleep(28_000);
await fx(`(s.pause(), true)`);
const playWall = (Date.now() - playStart) / 1000;
const pm = await b.eval(`const f = await import('/src/fx/frameDecoder.ts'); return { ...f.getPlaybackMetrics(), stats: f.frameStats(), misses: f.recentMisses(true) }`);
if (pm.misses.length) console.log('misses', JSON.stringify(pm.misses.map((m) => [m.clipId.slice(-4), m.target, m.head, m.frames, m.iter, m.kind])));
const reached = await fx(`s.getState().currentTime`);
check('playback runs to ~30 s and the monitor drew frames', reached > 24 && pm.renderedFrames > 300, { reached, rendered: pm.renderedFrames });
budget("28 s of 3 × 1080p tracks: 0 dropped frames", pm.droppedFrames === 0, { dropped: pm.droppedFrames, rendered: pm.renderedFrames, exact: pm.exactFrames, late: pm.lateFrames, fallback: pm.fallbackFrames, dropRate: pm.dropRatePercent, avgDecodeMs: pm.averageDecodeTimeMs, playWall });

// 2. Scrub: random seeks across the 3-track timeline, time until every track shows its exact frame
const times = [];
for (let i = 0; i < 20; i++) {
  const t = ((i * 7919) % 870) / 30 + 0.5 / 30;
  const t0 = Date.now();
  await fx(`(s.setCurrentTime(${t}), true)`);
  await settle();
  times.push(Date.now() - t0);
}
times.sort((a, c) => a - c);
const med = times[10], p90 = times[18];
check('scrubbing settles every seek', times.length === 20, {});
budget('scrub: < 50 ms per frame (median)', med < 50, { medianMs: med, p90Ms: p90, maxMs: times[19] });

// 3. Open a 500-clip project
const op = await b.eval(`
  const P = await import('/src/fx/project.ts'); const A = await import('/src/fx/projectActions.ts');
  const s = window.__effectsScale.store; const m = await import('/src/fx/media.ts');
  const c = document.createElement('canvas'); c.width = 320; c.height = 180; c.getContext('2d').fillRect(0, 0, 320, 180);
  const png = await m.probeFile(new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'still.png', { type: 'image/png' }));
  s.state = { ...s.state, clips: [] }; s.notify();
  s.importMedia([png]);
  for (let i = 0; i < 500; i++) s.addAssetClip(png, ['v1', 'v2', 'v3'][i % 3], Math.floor(i / 3) * 2);
  const { data, blobs } = await P.captureProject(s.getSequence(), s.getState().mediaAssets);
  const file = await P.encodeProject(data, blobs);
  s.state = { ...s.state, clips: [] }; s.notify();
  const t0 = performance.now();
  const ok = await A.openProjectFile(Object.assign(file, { name: 'big.skillmotion' }));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { ok, ms: Math.round(performance.now() - t0), clips: s.getState().clips.length };`);
check('a 500-clip project opens with every clip', op.ok && op.clips === 500, op);
budget('open a 500-clip project: < 2 s', op.ms < 2000, op);

// 4. Export 1 minute of 1080p H.264 (12 copies of the clip on V1)
const ex = await b.eval(`
  const s = window.__effectsScale.store; const o = await import('/src/fx/offlineRender.ts');
  s.state = { ...s.state, clips: [] }; s.notify();
  for (let i = 0; i < 12; i++) s.addAssetClip(window.__hd, 'v1', i * 5);
  const st = s.getState();
  const format = await o.pickExportFormat(1920, 1080, ${FPS});
  if (!format) return { skipped: true };
  const t0 = performance.now();
  const blob = await o.renderOffline({ width: 1920, height: 1080, fps: ${FPS}, start: 0, end: 60, tracks: st.tracks, clips: st.clips, format });
  const sec = (performance.now() - t0) / 1000;
  const frames = blob ? await o.countVideoFrames(blob) : 0;
  return { sec: +sec.toFixed(1), frames, MB: blob ? +(blob.size / 1048576).toFixed(1) : 0, codec: format.codec ?? format.label ?? '' };`);
if (ex.skipped) console.log('SKIP  export: no 1080p encoder');
else {
  check('1-minute 1080p export writes all 1800 frames', ex.frames === 1800, ex);
  budget('export 1 min 1080p: < 0.75× real time (45 s)', ex.sec < 45, { ...ex, xRealtime: +(ex.sec / 60).toFixed(2) });
}
const errs = b.logs.filter((l) => /\[exception\]/.test(l));
check('no exceptions in the page', errs.length === 0, errs.slice(0, 3));

console.log('\nbudgets: ' + budgets.map((x) => `${x.ok ? 'ok' : 'MISS'} ${x.name}`).join(' | '));
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
