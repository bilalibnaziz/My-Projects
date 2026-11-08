// Back-step cache: stepping backwards 30 frames through a long GOP shows exactly the same pixels as the
// uncached exact path (cache cleared before every step), is faster once frames are cached, stays within its
// memory budget and empties on clear. framesync guards frame accuracy everywhere else.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};
const fx = (expr) => b.eval(`const s = window.__effectsScale.store; return (${expr})`);
const FPS = 30, FRAMES = 96;
// frame number in the centre pixel (R ones, G eights, B 64s), plus a moving gradient so hashes differ in detail
const DECODE = `const n = (p) => Math.round((p[0] - 16) / 32) + 8 * Math.round((p[1] - 16) / 32) + 64 * Math.round((p[2] - 16) / 32);`;
const sample = () => b.eval(`${DECODE}
  const c = document.querySelector('.fx-monitor-canvas'); const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data; let h = 2166136261;
  for (let i = 0; i < d.length; i += 4 * 97) h = Math.imul(h ^ (d[i] + 3 * d[i + 1] + 7 * d[i + 2]), 16777619) >>> 0;
  return { n: n(g.getImageData(c.width / 2, c.height / 2, 1, 1).data), h }`);
const settle = () => b.eval(`const m = await import('/src/fx/media.ts'); await new Promise(r => requestAnimationFrame(() => r())); await m.mediaSettled(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true`);
const fd = (expr) => b.eval(`const f = await import('/src/fx/frameDecoder.ts'); return (${expr})`);

await fx(`(() => { s.pause(); s.state = { ...s.state, clips: [], inPoint: null, outPoint: null, showSafeGuides: false, currentTime: 0, selectedClipId: null, fps: ${FPS} }; s.notify(); return true; })()`);
const r = await b.eval(`
  const mb = await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
  const W = 1280, H = 720;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const codec = (await mb.canEncodeVideo('avc', { width: W, height: H })) ? 'avc' : 'vp9';
  const output = new mb.Output({ format: codec === 'avc' ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
  // one keyframe every 3 s: stepping back inside a GOP must decode from its start
  const src = new mb.CanvasSource(c, { codec, bitrate: 6e6, keyFrameInterval: 3 });
  output.addVideoTrack(src, { frameRate: ${FPS} });
  await output.start();
  for (let i = 0; i < ${FRAMES}; i++) {
    const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, 'hsl(' + (i * 7) + ',70%,40%)'); grd.addColorStop(1, 'hsl(' + (i * 7 + 120) + ',70%,60%)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgb(' + ((i % 8) * 32 + 16) + ',' + (Math.floor(i / 8) % 8 * 32 + 16) + ',' + (Math.floor(i / 64) * 32 + 16) + ')';
    g.fillRect(W / 2 - 60, H / 2 - 60, 120, 120);
    await src.add(i / ${FPS}, 1 / ${FPS});
  }
  await output.finalize();
  const file = new File([output.target.buffer], 'gop.' + (codec === 'avc' ? 'mp4' : 'webm'), { type: codec === 'avc' ? 'video/mp4' : 'video/webm' });
  const m = await import('/src/fx/media.ts');
  const asset = await m.probeFile(file);
  const s = window.__effectsScale.store;
  s.importMedia([asset]);
  s.addAssetClip(asset, 'v1', 0);
  return { codec, duration: asset.duration };`);
check('720p test video with a 3 s GOP imports', Math.abs(r.duration - FRAMES / FPS) < 0.1, r);

const from = 88, steps = 30;
const go = async (k) => { await fx(`(s.setCurrentTime(${(k + 0.5) / FPS}), true)`); await settle(); return sample(); };

// Reference: the exact path, cache cleared before every step
const ref = [];
let t0 = Date.now();
for (let k = from; k > from - steps; k--) {
  await fd(`(f.clearFrameCache(), true)`);
  ref.push({ k, ...(await go(k)) });
}
const refMs = Date.now() - t0;
check('reference (no cache): every back-step shows its own frame number', ref.every((x) => x.n === x.k), ref.filter((x) => x.n !== x.k).slice(0, 4));

// Pass 1: cache on, cold
await fd(`(f.clearFrameCache(), true)`);
await go(from + 2);
const s0 = await fd(`f.frameCacheStats()`);
t0 = Date.now();
const p1 = [];
for (let k = from; k > from - steps; k--) p1.push({ k, ...(await go(k)) });
const p1Ms = Date.now() - t0;
const s1 = await fd(`f.frameCacheStats()`);
// Pass 2: warm
t0 = Date.now();
const p2 = [];
for (let k = from; k > from - steps; k--) p2.push({ k, ...(await go(k)) });
const p2Ms = Date.now() - t0;
const s2 = await fd(`f.frameCacheStats()`);
const same = (a) => a.every((x, i) => x.n === ref[i].n && x.h === ref[i].h);
check('cached back-steps show identical pixels to the exact path (30 frames, two passes)', same(p1) && same(p2), { p1bad: p1.filter((x, i) => x.h !== ref[i].h).length, p2bad: p2.filter((x, i) => x.h !== ref[i].h).length });
check('back-steps hit the cache and get faster than decoding each one', s2.hits - s0.hits >= 2 * steps - 4 && p2Ms < refMs * 0.7, { refMs, p1Ms, p2Ms, hits: s2.hits - s0.hits, misses: s2.misses - s0.misses });
check('the cache stays within its 256 MB budget', s2.bytes <= 256 * 1024 * 1024 && s2.frames > 0, { frames: s2.frames, MB: +(s2.bytes / 1048576).toFixed(1), evicted: s2.evicted, s1frames: s1.frames });

// Playing forward after cached back-steps resumes exact decoding
await fx(`(s.setCurrentTime(${(from - steps + 0.5) / FPS}), true)`);
await settle();
await fx(`(s.play(), true)`);
await sleep(700);
await fx(`(s.pause(), true)`);
await settle();
const now = await fx(`s.getState().currentTime`);
const after = await sample();
check('playing on from a cached frame, pausing lands on the exact frame', after.n === Math.floor(now * FPS + 1e-6), { now, frame: after.n, want: Math.floor(now * FPS + 1e-6) });
const cleared = await fd(`(f.clearFrameCache(), f.frameCacheStats())`);
check('clearing the cache frees it', cleared.frames === 0 && cleared.bytes === 0, cleared);

const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
