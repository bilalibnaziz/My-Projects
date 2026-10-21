// Type: rich text (select characters while editing → color / ⌘B from the options bar),
// paragraph boxes that wrap (drag with the Type tool), runs following edits, and mixed sizes.
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
const st = (expr) => b.eval(`const { store, ops } = window.__ps; return (${expr})`);
const geo = () => b.eval(`const { store } = window.__ps; const r = document.querySelector('.viewport-canvas').getBoundingClientRect(); const v = store.doc.view; return { left: r.left, top: r.top, zoom: v.zoom, panX: v.panX, panY: v.panY };`);
const S = (g, x, y) => ({ x: g.left + g.panX + x * g.zoom, y: g.top + g.panY + y * g.zoom });
/** Red pixels of the render inside a box. */
const redIn = (x, y, w, h) => st(`(() => { const d = store.renderer.render(store.doc, store.overrides).getContext('2d').getImageData(${x}, ${y}, ${w}, ${h}).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 80 && d[i + 2] < 80) n++; return n; })()`);

await b.eval(`const { store, ops } = window.__ps; store.set({ dialog: null }); while (store.state.docs.length) store.closeDoc(store.state.docs[0].id); ops.newDocument(900, 500, 'white', 'Type', undefined); store.set({ fg: '#000000' }); store.state.opts.fontSize = 60;`);
await sleep(150);

// 1. Drag a paragraph box with the Type tool; long text wraps inside it
{
  await b.key('t');
  const g = await geo();
  await b.drag([S(g, 50, 50), S(g, 200, 120), S(g, 400, 200)]);
  await sleep(150);
  await b.send('Input.insertText', { text: 'Design is not just what it looks like and feels like' });
  await sleep(150);
  const r = await st(`({ box: store.activeLayer.text.boxWidth, w: store.activeLayer.width, h: store.activeLayer.height, size: store.activeLayer.text.size })`);
  check('dragging with the Type tool makes a paragraph box that wraps', r.box === 350 && r.w === 350 && r.h > r.size * 1.2 * 3, r);
}

// 2. Select a word while editing and color it red from the options bar
{
  const range = await b.eval(`const el = document.querySelector('.text-editor'); const i = el.value.indexOf('looks'); el.setSelectionRange(i, i + 5); el.dispatchEvent(new Event('select')); return [i, i + 5];`);
  await sleep(80);
  const badge = await b.eval(`return document.querySelector('.sel-badge')?.textContent`);
  // The options-bar color input: set its value like the picker does
  await b.eval(`const inp = document.querySelector('.options-bar .color-input input'); inp.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(inp, '#ff0000'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));`);
  await sleep(200);
  const r = await st(`({ runs: store.activeLayer.text.runs, color: store.activeLayer.text.color, editing: store.state.textEditId === store.activeLayer.id })`);
  const red = await redIn(0, 0, 900, 500);
  check('selected characters take a color from the options bar; the rest keep theirs', badge === '5 characters' && r.runs?.length === 1 && r.runs[0].start === range[0] && r.runs[0].color === '#ff0000' && r.color === '#000000' && red > 200 && r.editing, { badge, r, red });
}

// 3. ⌘B bolds the selection; typing before it moves the styles along
{
  await b.eval(`const el = document.querySelector('.text-editor'); el.focus(); const i = el.value.indexOf('Design'); el.setSelectionRange(i, i + 6); el.dispatchEvent(new Event('select'));`);
  // ⌘B toggles: bold base text becomes regular, regular becomes bold
  const baseW = await st(`store.activeLayer.text.weight`);
  const want = baseW >= 600 ? 400 : 700;
  await b.key('b', { modifiers: MOD });
  await sleep(150);
  const bold = await st(`store.activeLayer.text.runs.find(r => r.weight === ${want})`);
  await b.eval(`const el = document.querySelector('.text-editor'); el.focus(); el.setSelectionRange(0, 0);`);
  await b.send('Input.insertText', { text: 'Good ' });
  await sleep(150);
  const after = await st(`store.activeLayer.text.runs.map(r => [r.start, r.end, r.weight ?? r.color]).join('|')`);
  const text = await st(`store.activeLayer.text.text`);
  const lo = text.indexOf('looks');
  check('⌘B toggles bold on the selection, and styles move with the text as you type', bold?.start === 0 && bold.end === 6 && after.includes(`5,11,${want}`) && after.includes(`${lo},${lo + 5},#ff0000`), { bold, after });
  await b.key('Escape', { code: 'Escape', vk: 27 });
  await sleep(100);
}

// 4. Mixed sizes in one line share a baseline; paragraph width is editable; save / load keeps it all
{
  const r = await b.eval(`
    const { store } = window.__ps;
    const tools = await import('/src/core/tools.ts');
    const io = await import('/src/core/io.ts');
    const id = store.activeLayer.id;
    const h0 = store.activeLayer.height;
    tools.styleTextRange(id, 0, 4, { size: 120 });
    const h1 = store.activeLayer.height;
    tools.updateText(id, { boxWidth: 800 });
    const h2 = store.activeLayer.height;
    const doc = await io.loadProject(io.serializeProject(store.doc), 'Reloaded');
    const t = doc.layers.find(l => l.kind === 'text').text;
    return { h0, h1, h2, runs: t.runs.length, box: t.boxWidth };
  `);
  check('a bigger word grows its line; a wider box needs fewer lines; projects keep rich text', r.h1 > r.h0 && r.h2 < r.h1 && r.runs === 3 && r.box === 800, r);
}

if (process.env.SHOT) {
  await sleep(200);
  await b.shot(process.env.SHOT);
}

const errors = b.logs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]'));
check('no console errors', errors.length === 0, errors);
b.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
