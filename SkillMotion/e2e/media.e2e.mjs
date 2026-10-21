// Real footage end to end: records a test video (red second, then blue second, with a tone) in the
// page, imports it like a picked file, then checks the monitor's pixels, playback, editing
// shortcuts, undo and the exported file.
import { connect, sleep, META, CTRL } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const MOD = process.platform === 'darwin' ? META : CTRL;
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 300) : '');
};
const fx = (expr) => b.eval(`const s = window.__effectsScale.store; return (${expr})`);
// Pixel of the program monitor at composition coordinates
const px = (x, y) => b.eval(`const c = document.querySelector('.fx-monitor-canvas'); return Array.from(c.getContext('2d').getImageData(${x}, ${y}, 1, 1).data)`);
const near = (p, rgb, tol = 60) => p && rgb.every((v, i) => Math.abs(p[i] - v) <= tol);
const settle = async () => {
  await b.eval(`const m = await import('/src/fx/media.ts'); await m.mediaSettled(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));`);
};

// Empty sequence, no work area, guides off so pixels are clean
await fx(`(() => { s.pause(); s.state = { ...s.state, clips: [], inPoint: null, outPoint: null, showSafeGuides: false, currentTime: 0, selectedClipId: null }; s.notify(); return true; })()`);

// 1. Import a recorded video file
{
  const r = await b.eval(`
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const g = c.getContext('2d');
    const ac = new AudioContext(); const osc = ac.createOscillator(); const dest = ac.createMediaStreamDestination();
    osc.frequency.value = 440; osc.connect(dest); osc.start();
    const stream = c.captureStream(30); dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
    const chunks = []; rec.ondataavailable = e => chunks.push(e.data);
    const t0 = performance.now(); rec.start(100);
    await new Promise(done => { const draw = () => { const t = performance.now() - t0; g.fillStyle = t < 1000 ? '#ff0000' : '#0000ff'; g.fillRect(0, 0, 320, 180); if (t < 2100) requestAnimationFrame(draw); else done(); }; draw(); });
    const stopped = new Promise(r => rec.onstop = r); rec.stop(); await stopped; osc.stop();
    const file = new File(chunks, 'test-footage.webm', { type: 'video/webm' });
    const m = await import('/src/fx/media.ts');
    const asset = await m.probeFile(file);
    window.__testAsset = asset;
    window.__effectsScale.store.importMedia([asset]);
    return { kind: asset.mediaKind, duration: asset.duration, w: asset.width, h: asset.height, thumb: !!asset.thumbnail };`);
  check('probing reads kind, real duration, size and a thumbnail', r.kind === 'video' && r.duration > 1.8 && r.duration < 2.6 && r.w === 320 && r.h === 180 && r.thumb, r);
  await sleep(100);
  const row = await b.eval(`return [...document.querySelectorAll('.fx-asset-row')].some(el => el.textContent.includes('test-footage.webm'))`);
  check('the file shows up in the media bin', row);
}

// 2. Place it and check the monitor shows the right frame at each time
{
  await fx(`s.addAssetClip(window.__testAsset, 'v1', 0)`);
  await fx(`s.setCurrentTime(0.5)`);
  await settle();
  const a = await px(960, 540);
  await fx(`s.setCurrentTime(1.6)`);
  await settle();
  const c = await px(960, 540);
  const corner = await px(20, 20);
  check('monitor shows the first second red and the second blue', near(a, [255, 0, 0]) && near(c, [0, 0, 255]), { a, c });
  check('16:9 footage fills the 16:9 frame edge to edge', near(corner, [0, 0, 255]), corner);
}

// 3. A portrait still on V2 sits above V1 at its own aspect ratio
{
  const r = await b.eval(`
    const c = document.createElement('canvas'); c.width = 100; c.height = 200;
    const g = c.getContext('2d'); g.fillStyle = '#00ff00'; g.fillRect(0, 0, 100, 200);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const m = await import('/src/fx/media.ts');
    const asset = await m.probeFile(new File([blob], 'portrait.png', { type: 'image/png' }));
    window.__effectsScale.store.importMedia([asset]);
    window.__effectsScale.store.addAssetClip(asset, 'v2', 0);
    return { kind: asset.mediaKind, w: asset.width, h: asset.height };`);
  await fx(`s.setCurrentTime(1.6)`);
  await settle();
  await sleep(150);
  const mid = await px(960, 540);
  const side = await px(100, 540);
  check('upper track (V2) draws over the main footage (V1)', near(mid, [0, 255, 0]), { r, mid });
  check('portrait still is pillarboxed, not stretched (V1 visible beside it)', near(side, [0, 0, 255]), side);
}

// 4. Space plays the footage in sync and pauses it again
{
  await fx(`(() => { s.setCurrentTime(0.2); return true; })()`);
  await b.key(' ', { code: 'Space', vk: 32 });
  await sleep(700);
  const playing = await fx(`({ t: s.getState().currentTime, playing: s.getState().isPlaying })`);
  const video = await b.eval(`const m = await import('/src/fx/media.ts'); const c = window.__effectsScale.store.getState().clips.find(c => c.mediaKind === 'video'); const v = m.videoFrameFor(c); return v ? { paused: v.paused, t: v.currentTime } : null`);
  await b.key(' ', { code: 'Space', vk: 32 });
  await sleep(150);
  const after = await fx(`({ playing: s.getState().isPlaying })`);
  const paused = await b.eval(`const m = await import('/src/fx/media.ts'); const c = window.__effectsScale.store.getState().clips.find(c => c.mediaKind === 'video'); return m.videoFrameFor(c)?.paused`);
  check('Space plays: playhead and video element both advance together', playing.playing && video && !video.paused && Math.abs(video.t - playing.t) < 0.35, { playing, video });
  check('Space again pauses the timeline and the video', !after.playing && paused === true, { after, paused });
}

// 5. Editing shortcuts: ⌘K split, ⌘Z undo, Delete, ⌘D duplicate
{
  await fx(`(() => { const c = s.getState().clips.find(c => c.mediaKind === 'video'); s.selectClip(c.id); s.setCurrentTime(1.0); return true; })()`);
  const n0 = await fx(`s.getState().clips.length`);
  await b.key('k', { modifiers: MOD });
  const n1 = await fx(`s.getState().clips.length`);
  await b.key('z', { modifiers: MOD });
  const n2 = await fx(`s.getState().clips.length`);
  check('⌘K splits the selected clip; ⌘Z undoes it', n1 === n0 + 1 && n2 === n0, { n0, n1, n2 });

  const sel = await fx(`s.getState().selectedClipId`);
  check('undo drops a selection whose clip no longer exists', sel === null, sel);
  await fx(`(() => { s.selectClip(s.getState().clips.find(c => c.mediaKind === 'video').id); return true; })()`);
  await b.key('d', { modifiers: MOD });
  const n3 = await fx(`s.getState().clips.length`);
  await b.key('Backspace', { code: 'Backspace', vk: 8 });
  const n4 = await fx(`s.getState().clips.length`);
  check('⌘D duplicates, Backspace deletes the selection', n3 === n0 + 1 && n4 === n0, { n3, n4 });

  await b.key('c');
  const tool = await fx(`s.getState().activeTool`);
  await b.key('v');
  const tool2 = await fx(`s.getState().activeTool`);
  check('C / V switch Razor and Selection tools', tool === 'razor' && tool2 === 'select', { tool, tool2 });
}

// 6. Dragging a clip on the timeline is undone in one step
{
  const box = await b.eval(`const el = [...document.querySelectorAll('.fx-timeline-clip')].find(e => e.textContent.includes('test-footage.webm')); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`);
  const before = await fx(`s.getState().clips.find(c => c.mediaKind === 'video').startTime`);
  await b.drag([{ x: box.x, y: box.y }, { x: box.x + 40, y: box.y }, { x: box.x + 90, y: box.y }]);
  await sleep(100);
  const moved = await fx(`s.getState().clips.find(c => c.mediaKind === 'video').startTime`);
  await b.key('z', { modifiers: MOD });
  const undone = await fx(`s.getState().clips.find(c => c.mediaKind === 'video').startTime`);
  check('dragging moves the clip and ⌘Z puts it back where it was', moved > before + 0.5 && Math.abs(undone - before) < 1e-6, { before, moved, undone });
}

// 7. Trimming can't run past the end of the source
{
  const r = await fx(`(() => { const c = s.getState().clips.find(c => c.mediaKind === 'video'); s.updateClipTiming(c.id, { duration: 60 }); return s.getState().clips.find(x => x.id === c.id).duration; })()`);
  check('trim stops at the end of the source file', r < 2.6, r);
}

// 8. Export: picture and sound end up in the file
{
  await fx(`(() => { s.state = { ...s.state, inPoint: 0, outPoint: 1.2 }; s.notify(); return true; })()`);
  await b.eval(`window.__exported = null; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.href.startsWith('blob:')) window.__exported = { href: this.href, name: this.download }; else orig.call(this); }; return true`);
  await b.key('m', { modifiers: MOD });
  await sleep(200);
  await b.eval(`[...document.querySelectorAll('.fx-modal-window button')].find(e => e.textContent.includes('Work Area')).click(); return true`);
  await sleep(50);
  await b.eval(`[...document.querySelectorAll('.fx-modal-window button')].find(e => e.textContent.includes('Start Render')).click(); return true`);
  await b.waitFor('window.__exported', 20000).catch(() => {});
  const r = await b.eval(`
    const e = window.__exported; if (!e) return null;
    const blob = await (await fetch(e.href)).blob();
    const v = document.createElement('video'); v.muted = true; v.src = e.href;
    await new Promise(r => v.onloadedmetadata = r);
    let dur = v.duration;
    if (!isFinite(dur)) { v.currentTime = 1e9; await new Promise(r => v.onseeked = r); dur = v.duration; }
    const ac = new AudioContext();
    let peak = 0;
    try { const buf = await ac.decodeAudioData(await blob.arrayBuffer()); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); } catch (err) { peak = -1; }
    const { countVideoFrames } = await import('/src/fx/offlineRender.ts');
    const frames = await countVideoFrames(blob);
    return { name: e.name, size: blob.size, w: v.videoWidth, h: v.videoHeight, dur, peak, frames, fps: window.__effectsScale.store.getState().fps };`);
  check('export writes a 1920×1080 file of the work-area length', r && r.size > 1000 && r.w === 1920 && r.h === 1080 && r.dur > 0.9 && r.dur < 2, r);
  check('the exported file carries the footage audio', r && r.peak > 0.05, r && r.peak);
  // 1.2 s of work area → exactly 1.2 × fps frames: rendered offline, none dropped or repeated
  check('export renders offline with every frame exactly once', r && r.frames === Math.round(1.2 * r.fps), r && { frames: r.frames, fps: r.fps });
}

const exceptions = b.logs.filter((l) => /exception/i.test(l));
check('no exceptions in the page', exceptions.length === 0, exceptions.slice(0, 5));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
b.close();
