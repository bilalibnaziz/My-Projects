// Responsive multi-size: one post re-laid out per platform (Social Studio tabs + Export dialog zip and
// previews), checked against each platform's safe zone; and picking a tool brings Properties forward.
import { connect, sleep } from './cdp.mjs';
const b = await connect();
await b.nav();
await sleep(500);
const results = [];
const check = (name, ok, info) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, info !== undefined ? JSON.stringify(info).slice(0, 400) : '');
};

// A 1000×1000 product post: background, bottom bar, logo, headline, button (shape + label), product, URL on the bar
await b.eval(`
  const { store } = window.__ps;
  while (store.state.docs.length) store.closeDoc(store.state.docs[0].id);
  const social = await import('/src/core/social.ts');
  const { makeLayer } = await import('/src/core/types.ts');
  const { createCanvas, ctx2d } = await import('/src/core/canvas.ts');
  const W = 1000, H = 1000;
  const bg = createCanvas(W, H); const g = ctx2d(bg); g.fillStyle = '#ffe6a8'; g.fillRect(0, 0, W, H);
  const pc = createCanvas(420, 300); const p = ctx2d(pc); p.fillStyle = '#c0392b'; p.fillRect(0, 0, 420, 300);
  store.addDoc({ title: 'Post', width: W, height: H, layers: [
    makeLayer({ kind: 'raster', name: 'Background', canvas: bg, width: W, height: H }),
    social.shapeLayer('Bottom bar', { fill: '#7a1f1f' }, 0, 900, 1000, 100),
    social.textLayer('Logo', { text: 'Brand', size: 44, color: '#7a1f1f' }, 60, 60),
    social.textLayer('Headline', { text: 'Fresh\\nCake Rusk', size: 86, color: '#3b1d0b' }, 70, 300),
    social.shapeLayer('Button', { fill: '#7a1f1f', radius: 30 }, 70, 560, 240, 64),
    social.textLayer('Button label', { text: 'Order now', size: 30 }, 105, 574),
    makeLayer({ kind: 'raster', name: 'Product', canvas: pc, x: 530, y: 350, width: 420, height: 300 }),
    social.textLayer('URL', { text: 'brand.pk', size: 26, align: 'center' }, 500, 935),
  ] });
  store.set({ dialog: null });
  return true;
`);

// 1. Social Studio ▸ Open as tabs: each size inside its safe zone, nothing on the profile photo
const made = await b.eval(`
  const m = await import('/src/core/socialStudio.ts');
  const { SAFE_ZONES } = await import('/src/core/social.ts');
  const { layerBounds } = await import('/src/core/align.ts');
  const { store } = window.__ps;
  const src = store.doc.id;
  const n = m.resizeForPlatforms(['li-banner', 'ig-story', 'x-post', 'yt-banner']);
  const out = {};
  for (const d of store.state.docs.filter((d) => d.id !== src)) {
    store.switchDoc(d.id);
    const z = SAFE_ZONES[d.safeZone];
    const safe = { x: d.width * z.left - 1, y: d.height * z.top - 1, r: d.width * (1 - z.right) + 1, b: d.height * (1 - z.bottom) + 1 };
    const by = (name) => layerBounds(d.layers.find((l) => l.name === name));
    const inSafe = ['Logo', 'Headline', 'Button', 'Product'].every((nm) => { const r = by(nm); return r.x >= safe.x && r.y >= safe.y && r.x + r.width <= safe.r && r.y + r.height <= safe.b; });
    const avoid = (z.extra ?? []).map((e) => ({ x: e.x * d.width, y: e.y * d.height, w: e.w * d.width, h: e.h * d.height }));
    const clear = ['Logo', 'Headline', 'Button', 'Product'].every((nm) => { const r = by(nm); return avoid.every((a) => r.x >= a.x + a.w || r.x + r.width <= a.x || r.y >= a.y + a.h || r.y + r.height <= a.y); });
    const bar = by('Bottom bar'), head = by('Headline'), prod = by('Product');
    out[d.title] = { inSafe, clear, barFull: Math.abs(bar.width - d.width) < 2 && Math.abs(bar.y + bar.height - d.height) < 2, editable: d.layers.find((l) => l.name === 'Headline').kind === 'text', headAbove: head.y + head.height <= prod.y + 1, headLeft: head.x + head.width <= prod.x + 1 };
  }
  store.switchDoc(src);
  return { n, out };
`);
const o = made.out;
const get = (k) => Object.entries(o).find(([t]) => t.includes(k))?.[1] ?? {};
check('Open 4 sizes as tabs', made.n === 4, made.n);
check('Every size keeps logo, headline, button and product in its safe zone', Object.values(o).every((v) => v.inSafe), o);
check('LinkedIn banner keeps content off the profile photo', get('LinkedIn').clear, get('LinkedIn'));
check('Bottom bar stretches along the bottom of every size', Object.values(o).every((v) => v.barFull));
check('Story stacks the headline above the product', get('Story').headAbove, get('Story'));
check('Banner keeps text beside the product', get('LinkedIn').headLeft, get('LinkedIn'));
check('Text stays live text after resizing', Object.values(o).every((v) => v.editable));

// 2. Export dialog: "Also export for other platforms" shows a preview per size and exports one zip
await b.eval(`window.__ps.store.set({ dialog: { type: 'export' } }); return true`);
await sleep(400);
await b.eval(`document.querySelector('.export-platforms input[type=checkbox]').click(); return true`);
await sleep(200);
await b.eval(`[...document.querySelectorAll('.platform-sets button')].find((x) => x.textContent.includes('Covers')).click(); return true`);
await b.waitFor(`document.querySelectorAll('.platform-preview img').length >= 4`, 15000).catch(() => {});
const prev = await b.eval(`return { missing: [...document.querySelectorAll('.platform-preview')].filter((f) => !f.querySelector('img')).map((f) => f.title), logs: 0, imgs: document.querySelectorAll('.platform-preview img').length, label: [...document.querySelectorAll('.modal .btn.primary')].map((x) => x.textContent).join('|') }`);
check('Export dialog previews each picked platform', prev.imgs >= 4, prev);
if (prev.imgs < 4) console.log(b.logs.slice(-6).join('\n'));
check('Export button exports all sizes as one zip', /Export 5 sizes \(zip\)/.test(prev.label), prev);
await b.eval(`window.__ps.store.set({ dialog: null }); return true`);

// 3. Picking a tool brings its settings forward in Properties
await b.eval(`const L = await import('/src/ui/layout.ts'); L.setLayout({ tab: 'looks' }); window.__ps.store.setTool('move'); return true`);
await sleep(200);
await b.eval(`const L = await import('/src/ui/layout.ts'); L.setLayout({ tab: 'looks' }); return true`);
await sleep(200);
await b.eval(`window.__ps.store.setTool('shape'); return true`);
await sleep(300);
const tab = await b.eval(`return { tab: document.querySelector('.dock-tabs button.active')?.textContent, card: document.querySelector('.tool-card, .tc-head')?.textContent?.slice(0, 40) ?? null }`);
check('Picking a tool shows its settings in Properties', tab.tab === 'Properties', tab);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
b.close();
process.exit(failed.length ? 1 : 0);
