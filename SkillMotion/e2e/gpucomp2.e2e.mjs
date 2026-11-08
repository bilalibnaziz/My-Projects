// GPU compositor steps 2–3 against the canvas-2D reference: a red and a blue video meet at a cut, and
// the GPU draws the cross-dissolve, the dips and the wipe itself (plus fade-through-white at a free edge)
// instead of falling back to canvas 2D. A GPU export of a dissolve frame matches the canvas-2D export.
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
const settle = () => b.eval(`const m = await import('/src/fx/media.ts'); await new Promise(r => requestAnimationFrame(() => r())); await m.mediaSettled(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true`);
const near = (p, rgb, tol = 30) => p && rgb.every((v, i) => Math.abs(p[i] - v) <= tol);

await fx(`(() => { s.pause(); s.state = { ...s.state, clips: [], captions: [], inPoint: null, outPoint: null, showSafeGuides: false, currentTime: 0, selectedClipId: null, fps: 30 }; s.notify(); return true; })()`);

// Two flat-colour videos, 2 s each: red A and blue B
const mkVideo = (r, g, bl, name) => b.eval(`
  const mb = await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
  const c = document.createElement('canvas'); c.width = 320; c.height = 180;
  const g2 = c.getContext('2d');
  const codec = (await mb.canEncodeVideo('avc', { width: 320, height: 180 })) ? 'avc' : 'vp9';
  const output = new mb.Output({ format: codec === 'avc' ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
  const src = new mb.CanvasSource(c, { codec, bitrate: 4e6, keyFrameInterval: 1 });
  output.addVideoTrack(src, { frameRate: 30 });
  await output.start();
  for (let i = 0; i < 60; i++) { g2.fillStyle = 'rgb(${r},${g},${bl})'; g2.fillRect(0, 0, 320, 180); await src.add(i / 30, 1 / 30); }
  await output.finalize();
  const type = codec === 'avc' ? 'video/mp4' : 'video/webm';
  const m = await import('/src/fx/media.ts');
  const asset = await m.probeFile(new File([output.target.buffer], '${name}.' + (codec === 'avc' ? 'mp4' : 'webm'), { type }));
  window.__effectsScale.store.importMedia([asset]);
  return asset;`);
const vidA = await mkVideo(220, 30, 30, 'red');
const vidB = await mkVideo(30, 60, 220, 'blue');
await b.eval(`window.__vidA = ${JSON.stringify(vidA)}; window.__vidB = ${JSON.stringify(vidB)}; return true`);
const A = await b.eval(`const s = window.__effectsScale.store; const id = s.addAssetClip(window.__vidA, 'v1', 0); s.updateClipTiming(id, { duration: 2 }); return id;`);
const B = await b.eval(`const s = window.__effectsScale.store; const id = s.addAssetClip(window.__vidB, 'v1', 2); s.updateClipTiming(id, { duration: 2 }); return id;`);
check('red and blue test videos import and land touching on V1', !!A && !!B, { A, B });

const setTransIn = (id, type) => fx(`(s.state = { ...s.state, clips: s.getState().clips.map((c) => c.id === '${id}' ? { ...c, transitionIn: { type: '${type}', duration: 0.5 } } : c) }, s.notify(), true)`);
// Renders one frame both ways (canvas 2D, then GPU) and compares the pixels
const renderBoth = async (t) => {
  await fx(`(s.setCurrentTime(${t}), true)`);
  await settle();
  return b.eval(`
    const s = window.__effectsScale.store; const C = await import('/src/fx/compositor.ts'); const G = await import('/src/fx/gpuCompositor.ts');
    const st = s.getState();
    const draw = (gpu) => { G.setGpuCompositing(gpu); const c = document.createElement('canvas'); c.width = 320; c.height = 180; C.renderCompositionFrame(c.getContext('2d'), 320, 180, st.tracks, st.clips, ${t}, null, false, null); return c.getContext('2d').getImageData(0, 0, 320, 180).data; };
    const a = draw(false); const g = draw(true); const info = { ...G.lastGpuFrame }; G.setGpuCompositing(false);
    let sum = 0, max = 0; for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k] - g[i + k]); sum += d; if (d > max) max = d; }
    const o = ((90 * 320) + 160) * 4;
    const l = ((90 * 320) + 40) * 4, r = ((90 * 320) + 280) * 4;
    return { mean: +(sum / (a.length / 4 * 3)).toFixed(3), max, info, centre: [g[o], g[o + 1], g[o + 2]], left: [g[l], g[l + 1], g[l + 2]], right: [g[r], g[r + 1], g[r + 2]] };`);
};

// 1. Cross Dissolve at the cut: half-and-half, drawn on the GPU (both pictures), no fallback
await setTransIn(B, 'cross-dissolve');
{
  const r = await renderBoth(2.0);
  check('Cross Dissolve at the cut: GPU matches canvas 2D (mean diff < 2), both clips on the GPU', r.mean < 2 && r.info.gpu === 2 && r.info.fallback === null && near(r.centre, [125, 45, 125]), r);
}

// 2. Dip to Black a quarter in: the outgoing red sunk halfway to black, one GPU picture + overlay
await setTransIn(B, 'dip-black');
{
  const r = await renderBoth(1.875);
  check('Dip to Black at p=0.25: GPU matches canvas 2D, red half-dark', r.mean < 2 && r.info.gpu === 1 && r.info.fallback === null && near(r.centre, [110, 15, 15]), r);
}

// 3. Dip to White at the cut: fully white
await setTransIn(B, 'dip-white');
{
  const r = await renderBoth(2.0);
  check('Dip to White at the cut: GPU matches canvas 2D, white', r.mean < 2 && r.info.fallback === null && near(r.centre, [255, 255, 255], 12), r);
}

// 4. Fade through white at a free edge: B away, A fades out through white over its last 0.5 s
await fx(`(s.state = { ...s.state, clips: s.getState().clips.filter((c) => c.id === '${A}').map((c) => ({ ...c, transitionOut: { type: 'dip-white', duration: 0.5 } })) }, s.notify(), true)`);
{
  const r = await renderBoth(1.8);
  check('Fade through white at a free edge: GPU matches canvas 2D (60% white), no fallback', r.mean < 2 && r.info.fallback === null && near(r.centre, [241, 165, 165]), r);
}

// 5. Wipe at the cut: the edge is mid-frame, red on the left of it and blue on the right, drawn on the GPU
await b.eval(`const s = window.__effectsScale.store; const id = s.addAssetClip(window.__vidB, 'v1', 2); s.updateClipTiming(id, { duration: 2 }); window.__B2 = id; return id;`);
await setTransIn(await b.eval(`return window.__B2`), 'wipe-left');
{
  const r = await renderBoth(2.0);
  check('Wipe at the cut: GPU matches canvas 2D, red left of the edge, blue right of it', r.mean < 2 && r.info.gpu === 2 && r.info.fallback === null && near(r.centre, [125, 45, 125]) && near(r.left, [220, 30, 30]) && near(r.right, [30, 60, 220]), r);
}

// 6. Export: a GPU export of a dissolve frame matches the canvas-2D export
await setTransIn(await b.eval(`return window.__B2`), 'cross-dissolve');
{
  const ex = await b.eval(`
    const s = window.__effectsScale.store; const o = await import('/src/fx/offlineRender.ts'); const G = await import('/src/fx/gpuCompositor.ts');
    const format = await o.pickExportFormat(320, 180, 30); if (!format) return { skipped: true };
    const st = s.getState();
    const first = async (gpu) => {
      G.setGpuCompositing(gpu);
      const blob = await o.renderOffline({ width: 320, height: 180, fps: 30, start: 1.9, end: 1.9 + 2 / 30, tracks: st.tracks, clips: st.clips, format });
      const mb = await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
      const sink = new mb.CanvasSink(await new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS }).getPrimaryVideoTrack());
      for await (const w of sink.canvases()) return w.canvas.getContext('2d').getImageData(0, 0, 320, 180).data;
    };
    const a = await first(false); const g = await first(true); G.setGpuCompositing(false);
    let sum = 0; for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) sum += Math.abs(a[i + k] - g[i + k]);
    return { mean: +(sum / (a.length / 4 * 3)).toFixed(3) };`);
  check('export with GPU compositing matches the canvas-2D export on a dissolve frame (mean diff < 2)', ex.skipped || ex.mean < 2, ex);
}

const errs = b.logs.filter((l) => /\[exception\]/.test(l));
check('no exceptions', errs.length === 0, errs.slice(0, 3));
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
