// Audio end to end: a generated WAV (tone · pause · tone) is imported and then checked through the real UI:
// waveform on the clip, the mixer's per-track meters and Solo, Remove Silence, the EBU R128 meter and
// Normalize (verified by re-measuring the export mix), and speed / reverse in the export mix.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(400);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 300) : '');
};
const fx = (expr) => b.eval(`const s = window.__effectsScale.store; return (${expr})`);
const clickSel = async (sel) => {
  const r = await b.eval(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`);
  if (!r) throw new Error('missing ' + sel);
  await b.click(r.x, r.y);
};
const text = (sel) => b.eval(`return document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const waitText = async (sel, re, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await text(sel);
    if (t && re.test(t)) return t;
    await sleep(100);
  }
  return await text(sel);
};

// Empty sequence with only the test file
await fx(`(() => { s.pause(); s.state = { ...s.state, clips: [], inPoint: null, outPoint: null, currentTime: 0, selectedClipId: null, masterVolume: 1, duration: 8, tracks: s.state.tracks.map(t => ({ ...t, pan: 0 })) }; s.notify(); return true; })()`);

// 1 s of 440 Hz at −12 dBFS, 1.5 s of silence, 1 s of tone: a 48 kHz stereo 16-bit WAV
{
  const r = await b.eval(`
    const rate = 48000, n = Math.round(3.5 * rate), a = Math.pow(10, -12 / 20);
    const data = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, t) => [...t].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); data.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
    data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 2, true); data.setUint32(24, rate, true);
    data.setUint32(28, rate * 4, true); data.setUint16(32, 4, true); data.setUint16(34, 16, true); str(36, 'data'); data.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const v = t < 1 || t >= 2.5 ? a * Math.sin(2 * Math.PI * 440 * t) : 0;
      const q = Math.round(v * 32767);
      data.setInt16(44 + i * 4, q, true); data.setInt16(46 + i * 4, q, true);
    }
    const file = new File([data.buffer], 'voice-test.wav', { type: 'audio/wav' });
    const m = await import('/src/fx/media.ts');
    const asset = await m.probeFile(file);
    window.__effectsScale.store.importMedia([asset]);
    const id = window.__effectsScale.store.addAssetClip(asset, 'a1', 0);
    return { id, kind: asset.mediaKind, dur: asset.duration };`);
  check('WAV imports as an audio clip on A1', r.kind === 'audio' && Math.abs(r.dur - 3.5) < 0.05 && !!r.id, r);
}

// 2. Waveform: drawn on the clip, loud where the tone is and empty in the pause
{
  await b.eval(`for (let i = 0; i < 80; i++) { if (document.querySelector('.fx-clip-waveform[data-ready]')) break; await new Promise(r => setTimeout(r, 100)); } return true`);
  const w = await b.eval(`
    const c = document.querySelector('.fx-clip-waveform[data-ready]'); if (!c) return null;
    const g = c.getContext('2d'); const col = (f) => { const x = Math.floor(c.width * f); const d = g.getImageData(x, 0, 1, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n / c.height; };
    return { tone: col(0.15), pause: col(0.5), tone2: col(0.85), w: c.width };`);
  check('waveform is drawn on the clip: tone tall, pause flat', !!w && w.tone > 0.2 && w.tone2 > 0.2 && w.pause < 0.05, w);
}

// 3. Mixer: the clip's own strip meters it, other strips stay silent; Solo on another track silences it
{
  await fx(`(s.setWorkspace('audio'), true)`);
  await sleep(200);
  await fx(`(s.setCurrentTime(0.1), s.play(), true)`);
  await sleep(500);
  const meters = await b.eval(`return Object.fromEntries([...document.querySelectorAll('[data-meter]')].map(m => [m.dataset.meter, m.dataset.db]))`);
  const a1 = parseFloat(meters.a1);
  check('A1 strip meters the tone at about −15 dBFS RMS, A2 shows nothing', a1 > -18 && a1 < -12 && meters.a2 === '-inf', meters);
  const master = parseFloat(meters['master-l']);
  check('master meter reads the same level', master > -18 && master < -12, meters['master-l']);

  await clickSel('[data-solo="a2"]');
  await sleep(400);
  const soloed = await b.eval(`return document.querySelector('[data-meter="a1"]').dataset.db`);
  const solo = await fx(`s.getState().tracks.find(t => t.id === 'a2').solo`);
  check('Solo button soloes A2 and A1 goes quiet', solo && (soloed === '-inf' || parseFloat(soloed) < -60), { solo, soloed });
  await clickSel('[data-solo="a2"]');
  await fx(`(s.pause(), true)`);
}

// 4. Remove Silence through the panel
{
  await fx(`(s.selectClip(s.getState().clips[0].id), true)`);
  await sleep(100);
  await clickSel('[data-action="find-silence"]');
  const found = await waitText('[data-silence-msg]', /pause/);
  check('Find pauses reports the 1.5 s pause', /^1 pause, 1\.[45] s/.test(found ?? ''), found);
  await clickSel('[data-action="remove-silence"]');
  const msg = await waitText('[data-silence-msg]', /Removed/);
  const clips = await fx(`s.getState().clips.map(c => ({ start: +c.startTime.toFixed(3), dur: +c.duration.toFixed(3), off: +c.offset.toFixed(3) })).sort((a, b) => a.start - b.start)`);
  // Padding 0.1 s: keep 0–1.1, then 2.4–3.5 placed right after
  check('Cut pauses leaves two pieces back to back with 0.1 s padding', clips.length === 2 && Math.abs(clips[0].dur - 1.1) < 0.03 && Math.abs(clips[1].start - clips[0].dur) < 1e-3 && Math.abs(clips[1].off - 2.4) < 0.03, { msg, clips });
  const mix = await b.eval(`
    const o = await import('/src/fx/offlineRender.ts'); const L = await import('/src/fx/loudness.ts');
    const st = window.__effectsScale.store.getState();
    const buf = await o.mixAudio(o.planAudio(st.tracks, st.clips, 0, 2.2), 2.2);
    return L.detectSilence(o.channelsOf(buf), 48000, { thresholdDb: -40, minDuration: 0.1 });`);
  check('the export mix has only the short padded gap left', mix.length === 1 && mix[0][1] - mix[0][0] < 0.25, mix);
  await fx(`(s.undo(), true)`);
  const back = await fx(`s.getState().clips.length`);
  check('⌘Z brings the pause back', back === 1, back);
}

// 5. Loudness meter + Normalize
{
  await clickSel('[data-action="measure"]');
  await waitText('[data-loud-msg]', /Measured/);
  const integ = parseFloat((await text('[data-value="Integrated"]')).replace('−', '-'));
  const tp = parseFloat((await text('[data-value="True peak"]')).replace('−', '-'));
  // Same file measured directly in the page (BS.1770 counts the blocks straddling the pause, so ≈ −13.6 LUFS)
  const ref = await b.eval(`
    const o = await import('/src/fx/offlineRender.ts'); const L = await import('/src/fx/loudness.ts');
    const c = window.__effectsScale.store.getState().clips[0]; const buf = await o.decodeSource(c.sourceUrl);
    const n = Math.round(window.__effectsScale.store.getState().duration * 48000);
    const pad = o.channelsOf(buf).map(ch => { const x = new Float32Array(n); x.set(ch.subarray(0, n)); return x; }); // same 8 s window as the sequence
    return L.measureLoudness(pad, 48000).integrated;`);
  check('Measure reads the tone loudness and true peak (−12 dBTP)', Math.abs(integ - ref) < 0.06 && integ > -14.5 && integ < -12 && Math.abs(tp + 12) < 0.3, { integ, ref, tp });

  await b.eval(`const s = document.querySelector('[aria-label="Loudness target"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'ebu'); s.dispatchEvent(new Event('change', { bubbles: true })); return true`);
  await sleep(100);
  await clickSel('[data-action="normalize"]');
  const nmsg = await waitText('[data-loud-msg]', /Master/);
  const shown = await text('[data-value="Integrated"]');
  const master = await fx(`s.getState().masterVolume`);
  check('Normalize to −23 LUFS turns the master down and shows −23.0 LUFS', /−23\.0 LUFS/.test(shown) && master < 0.5, { nmsg, shown, master });
  const real = await b.eval(`
    const o = await import('/src/fx/offlineRender.ts'); const L = await import('/src/fx/loudness.ts');
    const st = window.__effectsScale.store.getState();
    const buf = await o.mixAudio(o.planAudio(st.tracks, st.clips, 0, st.duration, st.masterVolume), st.duration);
    return L.measureLoudness(o.channelsOf(buf), 48000).integrated;`);
  check('the export mix through the master really measures −23 LUFS', Math.abs(real + 23) < 0.15, real);
  const fader = await text('[data-master-db]');
  check('master strip shows the new fader level', fader === `${(20 * Math.log10(master)).toFixed(1).replace('-', '−')} dB` && master < 0.5, { fader, master });
  await fx(`(s.undo(), true)`);
  check('⌘Z restores the master fader', (await fx(`s.getState().masterVolume`)) === 1);
}

// 6. Speed and reverse in the export mix
{
  const id = await fx(`s.getState().clips[0].id`);
  await fx(`(s.setClipSpeed('${id}', 2), true)`);
  const fast = await b.eval(`
    const o = await import('/src/fx/offlineRender.ts'); const L = await import('/src/fx/loudness.ts');
    const st = window.__effectsScale.store.getState(); const c = st.clips[0];
    const buf = await o.mixAudio(o.planAudio(st.tracks, st.clips, 0, 2), 2);
    return { dur: c.duration, silent: L.detectSilence(o.channelsOf(buf), 48000, { minDuration: 0.2 }) };`);
  // At 2× the pause (source 1–2.5) sits at 0.5–1.25 and the clip lasts 1.75 s
  const [sa, sb] = fast.silent[0] ?? [0, 0];
  check('2× speed: clip is half as long and the pause plays at 0.5–1.25 s', Math.abs(fast.dur - 1.75) < 0.01 && Math.abs(sa - 0.5) < 0.03 && Math.abs(sb - 1.25) < 0.03, fast);

  await fx(`(s.setClipSpeed('${id}', 1, { reversed: true }), true)`);
  await fx(`(() => { const c = s.getState().clips[0]; s.updateClipTiming(c.id, { offset: 0, duration: 3 }); return true; })()`);
  const back = await b.eval(`
    const o = await import('/src/fx/offlineRender.ts'); const L = await import('/src/fx/loudness.ts');
    const st = window.__effectsScale.store.getState();
    const buf = await o.mixAudio(o.planAudio(st.tracks, st.clips, 0, 3), 3);
    return L.detectSilence(o.channelsOf(buf), 48000, { minDuration: 0.2 });`);
  // Reversed 0–3 s of source: plays source 3 → 0, so the pause (1–2.5) sounds at 0.5–2.0
  const [ra, rb] = back[0] ?? [0, 0];
  check('reverse: the export mix plays the source backwards', back.length === 1 && Math.abs(ra - 0.5) < 0.03 && Math.abs(rb - 2) < 0.03, back);
}

const errors = await b.eval(`return (window.__errors ?? []).slice(0, 5)`);
check('no exceptions in the page', !errors || errors.length === 0, errors);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
b.close();
process.exit(passed === results.length ? 0 : 1);
