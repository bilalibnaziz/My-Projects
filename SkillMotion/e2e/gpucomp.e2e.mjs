// GPU compositor (WebGL2) against the canvas-2D reference: 20 random compositions of image clips (with
// transparency) and text clips, random position / scale / rotation / opacity and normal / multiply / screen /
// add, rendered both ways: mean pixel difference < 2. Frames the GPU can't draw (adjustment layer) fall back
// and say why; the monitor toggle works; the export uses the same path.
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
await fx(`(() => { s.pause(); s.state = { ...s.state, clips: [], currentTime: 0.5, fps: 30 }; s.notify(); return true; })()`);

// Four image assets: gradients, shapes and transparent areas
await b.eval(`
  const m = await import('/src/fx/media.ts');
  const assets = [];
  for (let k = 0; k < 4; k++) {
    const c = document.createElement('canvas'); c.width = 480 + k * 40; c.height = 270 + k * 30; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, c.width, c.height); gr.addColorStop(0, 'hsl(' + k * 80 + ',80%,50%)'); gr.addColorStop(1, 'hsla(' + (k * 80 + 140) + ',70%,60%,' + (k % 2 ? 0.6 : 1) + ')');
    g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    g.clearRect(c.width * 0.6, c.height * 0.1, c.width * 0.3, c.height * 0.3);
    for (let i = 0; i < 12; i++) { g.fillStyle = 'hsla(' + i * 30 + ',90%,50%,0.7)'; g.beginPath(); g.arc((i * 53) % c.width, (i * 31) % c.height, 18 + i * 2, 0, 7); g.fill(); }
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    assets.push(await m.probeFile(new File([blob], 'img' + k + '.png', { type: 'image/png' })));
  }
  window.__imgs = assets;
  window.__effectsScale.store.importMedia(assets);
  // let images decode
  for (const a of assets) await new Promise((r) => { const i = new Image(); i.onload = r; i.onerror = r; i.src = a.url; });
  return true`);

let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const comps = [];
for (let n = 0; n < 20; n++) {
  const layers = [];
  const count = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i++) {
    const text = rnd() < 0.2;
    layers.push({
      text, img: Math.floor(rnd() * 4), track: ['v1', 'v2', 'v3'][i % 3],
      t: { positionX: Math.round((rnd() - 0.5) * 300), positionY: Math.round((rnd() - 0.5) * 160), scaleX: Math.round(40 + rnd() * 110), scaleY: Math.round(40 + rnd() * 110), uniformScale: rnd() < 0.5, rotation: Math.round((rnd() - 0.5) * 90), opacity: Math.round(30 + rnd() * 70), anchorX: 0.5, anchorY: 0.5 },
      blend: text ? 'source-over' : ['source-over', 'multiply', 'screen', 'lighter'][Math.floor(rnd() * 4)],
    });
  }
  comps.push(layers);
}

const diffs = [];
let gpuDrawn = 0, layers2d = 0, fallbacks = [];
for (const comp of comps) {
  const r = await b.eval(`
    const s = window.__effectsScale.store; const C = await import('/src/fx/compositor.ts'); const G = await import('/src/fx/gpuCompositor.ts');
    s.state = { ...s.state, clips: [] }; s.notify();
    for (const L of ${JSON.stringify(comp)}) {
      let id;
      if (L.text) { s.addNewClip('text', L.track); id = s.getState().clips[s.getState().clips.length - 1].id; }
      else id = s.addAssetClip(window.__imgs[L.img], L.track, 0);
      s.state = { ...s.state, clips: s.getState().clips.map((c) => c.id === id ? { ...c, startTime: 0, duration: 5, transform: { ...c.transform, ...L.t }, blendMode: L.blend } : c) };
    }
    s.notify();
    const st = s.getState();
    const draw = (gpu) => { G.setGpuCompositing(gpu); const c = document.createElement('canvas'); c.width = 640; c.height = 360; C.renderCompositionFrame(c.getContext('2d'), 640, 360, st.tracks, st.clips, 0.5, null, false, null); return c.getContext('2d').getImageData(0, 0, 640, 360).data; };
    const a = draw(false); const g = draw(true); const info = { ...G.lastGpuFrame }; G.setGpuCompositing(false);
    let sum = 0, max = 0; for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) { const d = Math.abs(a[i + k] - g[i + k]); sum += d; if (d > max) max = d; }
    return { mean: sum / (a.length / 4 * 3), max, info };`);
  diffs.push(+r.mean.toFixed(3));
  gpuDrawn += r.info.gpu;
  layers2d += r.info.layers2d;
  if (r.info.fallback) fallbacks.push(r.info.fallback);
}
check('20 random compositions: GPU vs canvas 2D mean pixel difference < 2 each', diffs.every((d) => d < 2), { diffs, worst: Math.max(...diffs) });
check('the GPU drew the media clips, text went through 2D layers, no frame fell back', gpuDrawn > 30 && layers2d > 0 && fallbacks.length === 0, { gpuDrawn, layers2d, fallbacks });

// A frame with an adjustment clip falls back to canvas 2D, with the reason
const fb = await b.eval(`
  const s = window.__effectsScale.store; const C = await import('/src/fx/compositor.ts'); const G = await import('/src/fx/gpuCompositor.ts');
  s.addNewClip('adjustment', 'v3');
  const st = s.getState();
  const id = st.clips[st.clips.length - 1].id;
  s.state = { ...st, clips: st.clips.map((c) => c.id === id ? { ...c, startTime: 0, duration: 5 } : c) }; s.notify();
  G.setGpuCompositing(true);
  const c = document.createElement('canvas'); c.width = 320; c.height = 180;
  C.renderCompositionFrame(c.getContext('2d'), 320, 180, s.getState().tracks, s.getState().clips, 0.5, null, false, null);
  const why = G.lastGpuFrame.fallback; G.setGpuCompositing(false); return why;`);
check('a frame with an adjustment layer is drawn by canvas 2D and says why', fb === 'adjustment layer', fb);

// The monitor toggle
await fx(`(() => { s.state = { ...s.state, clips: s.getState().clips.filter((c) => c.type !== 'adjustment') }; s.notify(); return true; })()`);
const tog = await b.eval(`const el = document.querySelector('[data-gpu-toggle]'); if (!el) return null; el.scrollIntoView(); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`);
let toggled = null;
if (tog) {
  await b.click(tog.x, tog.y);
  await sleep(400);
  toggled = await b.eval(`const G = await import('/src/fx/gpuCompositor.ts'); return { on: G.gpuCompositingEnabled(), pressed: document.querySelector('[data-gpu-toggle]').getAttribute('aria-pressed'), stored: localStorage.getItem('skillmotion.gpuCompositing'), drew: G.lastGpuFrame.gpu }`);
  await b.click(tog.x, tog.y);
}
check('the monitor GPU toggle turns it on (remembered) and the monitor draws through it', toggled?.on === true && toggled.pressed === 'true' && toggled.stored === '1' && toggled.drew > 0, toggled);

// Export: the same path; first frame of a GPU export matches a canvas-2D export
const ex = await b.eval(`
  const s = window.__effectsScale.store; const o = await import('/src/fx/offlineRender.ts'); const G = await import('/src/fx/gpuCompositor.ts');
  const format = await o.pickExportFormat(640, 360, 30); if (!format) return { skipped: true };
  const st = s.getState();
  const first = async (gpu) => {
    G.setGpuCompositing(gpu);
    const blob = await o.renderOffline({ width: 640, height: 360, fps: 30, start: 0.5, end: 0.5 + 2 / 30, tracks: st.tracks, clips: st.clips, format });
    const mb = await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
    const sink = new mb.CanvasSink(await new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS }).getPrimaryVideoTrack());
    for await (const w of sink.canvases()) return w.canvas.getContext('2d').getImageData(0, 0, 640, 360).data;
  };
  const a = await first(false); const g = await first(true); G.setGpuCompositing(false);
  let sum = 0; for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) sum += Math.abs(a[i + k] - g[i + k]);
  return { mean: +(sum / (a.length / 4 * 3)).toFixed(3) };`);
if (ex.skipped) console.log('SKIP  export: no encoder');
else check('export with GPU compositing matches the canvas-2D export (mean diff < 2)', ex.mean < 2, ex);

const errs = b.logs.filter((l) => /\[exception\]/.test(l));
check('no exceptions', errs.length === 0, errs.slice(0, 3));
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
