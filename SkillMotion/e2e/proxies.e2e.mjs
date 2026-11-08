// Edit proxies for real: turning Proxy on transcodes the clip's video to a 960 px H.264 copy (progress on the
// button), the monitor then decodes the proxy and still shows the exact frame, and export uses the original.
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
const DECODE = `const n = (p) => Math.round((p[0] - 16) / 32) + 8 * Math.round((p[1] - 16) / 32);`;
const frameOnMonitor = () => b.eval(`${DECODE} const c = document.querySelector('.fx-monitor-canvas'); return n(c.getContext('2d').getImageData(960, 540, 1, 1).data)`);
const settle = () => b.eval(`const m = await import('/src/fx/media.ts'); await new Promise(r => requestAnimationFrame(() => r())); await m.mediaSettled(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true`);
const FPS = 30;
const FRAMES = 60;

await fx(`(() => { s.pause(); s.toggleProxyMode(false); s.state = { ...s.state, clips: [], inPoint: null, outPoint: null, showSafeGuides: false, currentTime: 0, selectedClipId: null, fps: ${FPS} }; s.notify(); return true; })()`);

// A 1920×1080 numbered test video (each frame's number encoded as its colour)
const r0 = await b.eval(`
  const mb = await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
  const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
  const g = c.getContext('2d');
  const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
  const src = new mb.CanvasSource(c, { codec: 'avc', bitrate: 8e6, keyFrameInterval: 1 });
  output.addVideoTrack(src, { frameRate: ${FPS} });
  await output.start();
  for (let i = 0; i < ${FRAMES}; i++) {
    g.fillStyle = 'rgb(' + ((i % 8) * 32 + 16) + ',' + (Math.floor(i / 8) * 32 + 16) + ',128)';
    g.fillRect(0, 0, 1920, 1080);
    // 1 px stripes: sharp in the original, grey once downscaled to the proxy
    for (let x = 100; x < 300; x++) { g.fillStyle = x % 2 ? '#fff' : '#000'; g.fillRect(x, 100, 1, 200); }
    await src.add(i / ${FPS}, 1 / ${FPS});
  }
  await output.finalize();
  const file = new File([output.target.buffer], 'numbered-1080p.mp4', { type: 'video/mp4' });
  const m = await import('/src/fx/media.ts');
  const asset = await m.probeFile(file);
  const s = window.__effectsScale.store;
  s.importMedia([asset]);
  s.addAssetClip(asset, 'v1', 0);
  return { bytes: output.target.buffer.byteLength, w: asset.width, h: asset.height };`);
check('1080p test video imported', r0.w === 1920 && r0.h === 1080, r0);

// 1. Turn Proxy on with the monitor button: it builds the proxy and shows progress
const pt = await b.eval(`const el = document.querySelector('[data-proxy-toggle]'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`);
await b.click(pt.x, pt.y);
let label = '';
let sawBuilding = false;
for (let i = 0; i < 300; i++) {
  label = await b.eval(`return document.querySelector('[data-proxy-toggle]').textContent`);
  if (/building/.test(label)) sawBuilding = true;
  if (/ON$/.test(label) && !(await fx(`!!s.state.proxyJob`))) break;
  await sleep(100);
}
const prox = await fx(`(() => { const c = s.state.clips.find(c => c.mediaKind === 'video'); return { url: c.proxyUrl || null, w: c.proxyWidth, h: c.proxyHeight }; })()`);
check('Proxy ON builds a 960×540 proxy (progress shown on the button)', !!prox.url && prox.w === 960 && prox.h === 540 && sawBuilding && /ON$/.test(label), { prox, label, sawBuilding });

// 2. The proxy is a real, smaller H.264 file with every frame
const info = await b.eval(`
  const mb = await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
  const s = window.__effectsScale.store; const c = s.getState().clips.find(c => c.mediaKind === 'video');
  const blob = await (await fetch(c.proxyUrl)).blob();
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  const t = await input.getPrimaryVideoTrack();
  const stats = await t.computePacketStats();
  return { codec: t.codec, w: t.displayWidth, h: t.displayHeight, packets: stats.packetCount, bytes: blob.size };`);
check('the proxy is H.264 at 960×540 with all 60 frames, smaller than the original', info.codec === 'avc' && info.w === 960 && info.h === 540 && info.packets === FRAMES && info.bytes < r0.bytes, info);

// 3. The monitor decodes the proxy and still shows the exact frame
{
  const bad = [];
  for (const k of [0, 9, 23, 40, 59]) {
    await fx(`(s.setCurrentTime(${(k + 0.5) / FPS}), true)`);
    await settle();
    const n = await frameOnMonitor();
    if (n !== k) bad.push({ want: k, got: n });
  }
  const usesProxy = await b.eval(`const m = await import('/src/fx/media.ts'); const s = window.__effectsScale.store.getState(); const c = s.clips.find(c => c.mediaKind === 'video'); return m.clipEffectiveUrl(c) === c.proxyUrl`);
  check('in proxy mode the monitor plays the proxy, frame-exact', usesProxy && bad.length === 0, { usesProxy, bad });
}

// 4. Export with Proxy ON still renders from the full-res original (the stripes stay sharp), and proxy
//    mode is back on afterwards
{
  const r = await b.eval(`
    const o = await import('/src/fx/offlineRender.ts');
    const P = await import('/src/fx/proxies.ts');
    const st = window.__effectsScale.store.getState();
    const format = await o.pickExportFormat(1920, 1080, ${FPS});
    if (!format) return { skipped: true };
    const blob = await o.renderOffline({ width: 1920, height: 1080, fps: ${FPS}, start: 0, end: 3 / ${FPS}, tracks: st.tracks, clips: st.clips, format });
    const mb = await import('/node_modules/mediabunny/dist/bundles/mediabunny.mjs');
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const sink = new mb.CanvasSink(await input.getPrimaryVideoTrack());
    let contrast = 0;
    for await (const w of sink.canvases()) {
      const d = w.canvas.getContext('2d').getImageData(150, 200, 40, 1).data;
      let sum = 0; for (let i = 4; i < d.length; i += 4) sum += Math.abs(d[i] - d[i - 4]);
      contrast = sum / 39; break;
    }
    // The proxy itself, for comparison
    const c = st.clips.find(c => c.mediaKind === 'video');
    const pin = new mb.Input({ source: new mb.BlobSource(await (await fetch(c.proxyUrl)).blob()), formats: mb.ALL_FORMATS });
    const ps = new mb.CanvasSink(await pin.getPrimaryVideoTrack());
    let proxyContrast = 0;
    for await (const w of ps.canvases()) {
      const d = w.canvas.getContext('2d').getImageData(75, 100, 20, 1).data;
      let sum = 0; for (let i = 4; i < d.length; i += 4) sum += Math.abs(d[i] - d[i - 4]);
      proxyContrast = sum / 19; break;
    }
    return { contrast: Math.round(contrast), proxyContrast: Math.round(proxyContrast), proxyModeAfter: P.isProxyModeActive() };`);
  check('export with Proxy ON uses the full-res original (1 px stripes stay sharp; the proxy has lost them)', r.skipped || (r.contrast > 100 && r.proxyContrast < 40 && r.proxyModeAfter), r);
}

// 5. Proxy OFF goes back to the original; ON again doesn't rebuild
{
  await fx(`(s.toggleProxyMode(false), true)`);
  const off = await b.eval(`const m = await import('/src/fx/media.ts'); const s = window.__effectsScale.store.getState(); const c = s.clips.find(c => c.mediaKind === 'video'); return m.clipEffectiveUrl(c) === c.sourceUrl`);
  await fx(`(s.toggleProxyMode(true), true)`);
  await sleep(200);
  const rebuilt = await fx(`!!s.state.proxyJob`);
  check('OFF uses the original; ON again reuses the built proxy', off && !rebuilt, { off, rebuilt });
  await fx(`(s.toggleProxyMode(false), true)`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
b.close();
process.exit(failed ? 1 : 0);
