// Framing guides on the Program Monitor: choosing a preset draws it over the preview, Auto picks
// one for the frame size, the choice is remembered, and guides never reach an export frame.
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
await fx(`(() => { s.pause(); s.state = { ...s.state, clips: [], showSafeGuides: false, currentTime: 0, selectedClipId: null }; s.notify(); return true; })()`);
const choose = (v) => b.eval(`const el = document.querySelector('.fx-guides-select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true`);
// Count lit (non-black) pixels along a column of the monitor
const litColumn = (x) => b.eval(`const c = document.querySelector('.fx-monitor-canvas'); const d = c.getContext('2d').getImageData(${x}, 0, 3, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++; return n`);
const size = await b.eval(`const c = document.querySelector('.fx-monitor-canvas'); return { w: c.width, h: c.height }`);

// 1. Title & action safe draws its outline at 5% in from the left
{
  await choose('off');
  const x = Math.round(size.w * 0.05) - 1;
  const before = await litColumn(x);
  await choose('video-broadcast');
  const after = await litColumn(x);
  check('Title & action safe guide is drawn on the monitor', after > before + size.h * 0.5, { before, after });
}

// 2. Auto picks a guide set for the frame size; the choice is remembered across reloads
{
  await choose('auto');
  const lit = await litColumn(Math.round(size.w / 2) - 1);
  await b.nav();
  await sleep(400);
  const kept = await b.eval(`return document.querySelector('.fx-guides-select').value`);
  check('Auto guides draw, and the choice survives a reload', lit > size.h * 0.4 && kept === 'auto', { lit, kept });
}

// 3. Exported frames never contain guides
{
  const clean = await b.eval(`
    const { renderCompositionFrame } = await import('/src/fx/compositor.ts');
    const s = window.__effectsScale.store.state;
    const c = document.createElement('canvas'); c.width = s.resolution.width; c.height = s.resolution.height;
    renderCompositionFrame(c.getContext('2d'), c.width, c.height, s.tracks, [], 0, null, false);
    const d = c.getContext('2d').getImageData(Math.round(c.width * 0.05) - 1, 0, 3, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++; return n;`);
  check('render path for export has no guide lines', clean < 5, { clean });
  await choose('off');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
process.exit(failed.length ? 1 : 0);
