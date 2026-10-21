// Social tab: everything for making a post in one place — brand colours, post layouts previewed on your
// own photo, elements and text styles (click to add, or drag onto the canvas), platform safe zones,
// resize / carousel / grid tools, a phone-legibility check and one-click export for posting.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowUpRight, AtSign, Award, BadgeCheck, BadgePercent, Bookmark, ChevronsRight, Circle, Download, Hexagon, Image, MessageCircle, Minus,
  MousePointerClick, RectangleHorizontal, Smartphone, Star, Tag,
} from 'lucide-react';
import { store, useStore } from '../core/store';
import { POST_ELEMENTS, POST_LAYOUTS, POST_PALETTES, TEXT_STYLES, addElement, addLayout, addTextStyle, buildLayout, paletteById, type PostLayout } from '../core/postKit';
import { legibility } from '../core/socialStudio';
import { DOC_PRESETS } from '../core/social';
import { useDeferredSource } from './useDeferredSource';
import { createCanvas, ctx2d } from '../core/canvas';
import { renderDocument, syncTextBounds } from '../core/render';
import { makeLayer, withLayer } from '../core/types';
import * as io from '../core/io';
import { COMMANDS } from '../core/commands';
import { Section, Toggle } from './widgets';

/** Drag-and-drop type for items dragged from this panel onto the canvas. */
export const POST_DRAG_TYPE = 'application/x-skill-post';

const PALETTE_KEY = 'skillphoto.postPalette';
const loadPalette = () => {
  try {
    return localStorage.getItem(PALETTE_KEY) ?? 'clean';
  } catch {
    return 'clean';
  }
};
let palette = loadPalette();
const setPalette = (id: string) => {
  palette = id;
  try {
    localStorage.setItem(PALETTE_KEY, id);
  } catch {
    /* a convenience */
  }
};

/** Adds an item dragged from the panel at a document point. */
export function dropPostItem(raw: string, at: { x: number; y: number }) {
  const [kind, id] = raw.split(':');
  if (kind === 'element') addElement(id, palette, at);
  else if (kind === 'layout') addLayout(id, palette);
  else if (kind === 'text') {
    const gid = addTextStyle(id, palette);
    // Centre the new text on the drop point
    const d = store.doc;
    const l = gid ? d?.layers.find((x) => x.id === gid) : null;
    if (d && l) store.commit('Move Text', { layers: d.layers.map((x) => (x.id === l.id ? withLayer(x, { x: at.x - l.width / 2, y: at.y - l.height / 2 }) : x)) }, { coalesce: `drop:${l.id}` });
  }
}

const ICONS: Record<string, ReactNode> = {
  cta: <MousePointerClick size={15} />, 'cta-outline': <RectangleHorizontal size={15} />, price: <Tag size={15} />, burst: <BadgePercent size={15} />,
  badge: <BadgeCheck size={15} />, seal: <Award size={15} />, ribbon: <Bookmark size={15} />, bubble: <MessageCircle size={15} />, stars: <Star size={15} />,
  arrow: <ArrowUpRight size={15} />, circle: <Circle size={15} />, divider: <Minus size={15} />, handle: <AtSign size={15} />, swipe: <ChevronsRight size={15} />,
  'photo-frame': <Image size={15} />, 'logo-spot': <Hexagon size={15} />,
};

const TAGS: { id: PostLayout['tags'][number] | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'promo', label: 'Promo' }, { id: 'food', label: 'Food' }, { id: 'quote', label: 'Quote' },
  { id: 'info', label: 'Info' }, { id: 'event', label: 'Event' }, { id: 'video', label: 'Video' }, { id: 'minimal', label: 'Minimal' },
];

const drag = (raw: string) => (e: React.DragEvent) => {
  e.dataTransfer.setData(POST_DRAG_TYPE, raw);
  e.dataTransfer.effectAllowed = 'copy';
};

/** A layout previewed over the open photo (small render, cached per photo + palette). */
function LayoutThumb({ layout, bg, w, h, pal }: { layout: PostLayout; bg: HTMLCanvasElement | null; w: number; h: number; pal: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const d = store.doc;
    if (!c || !d) return;
    const id = setTimeout(() => {
      const base = createCanvas(w, h);
      const bctx = ctx2d(base);
      if (bg) {
        const k = Math.max(w / bg.width, h / bg.height);
        bctx.drawImage(bg, (w - bg.width * k) / 2, (h - bg.height * k) / 2, bg.width * k, bg.height * k);
      } else {
        bctx.fillStyle = '#7a8899';
        bctx.fillRect(0, 0, w, h);
      }
      const layers = [makeLayer({ kind: 'raster', name: 'Photo', canvas: base, width: w, height: h }), ...buildLayout(layout.id, w, h, pal)];
      const out = createCanvas(w, h);
      renderDocument({ ...d, width: w, height: h, layers, selection: null }, out);
      c.width = w;
      c.height = h;
      ctx2d(c).drawImage(out, 0, 0);
    }, 0);
    return () => clearTimeout(id);
  }, [layout.id, bg, w, h, pal]);
  return <canvas ref={ref} className="post-thumb-canvas" style={{ aspectRatio: `${w} / ${h}` }} />;
}

export function SocialPanel() {
  const s = useStore();
  const doc = store.doc;
  const [pal, setPal] = useState(palette);
  const [tag, setTag] = useState<(typeof TAGS)[number]['id']>('all');
  const choose = (id: string) => {
    setPalette(id);
    setPal(id);
  };

  // The photo under the layouts, small; rebuilt when the document's layers change
  const key = doc ? `${doc.id}:${doc.width}x${doc.height}:${doc.layers.filter((l) => !l.name.startsWith('Layout · ')).map((l) => `${l.id}.${l.v}`).join(',')}` : '';
  const bg = useDeferredSource(key, 200);
  if (!doc) return <div className="social-panel"><div className="hint">Open a photo or start a post (File ▸ New, or New from Template) to design for social media.</div></div>;

  const tw = 96;
  const th = Math.round(Math.min(170, Math.max(54, (tw * doc.height) / doc.width)));
  const layouts = POST_LAYOUTS.filter((l) => tag === 'all' || l.tags.includes(tag));
  const preset = DOC_PRESETS.find((p) => p.w === doc.width && p.h === doc.height);
  const small = legibility(doc);
  const p = paletteById(pal);
  const run = (id: string) => {
    const c = COMMANDS.find((x) => x.id === id);
    if (c && (!c.enabled || c.enabled())) c.run();
    else store.toast(id === 'recolor' ? 'Select a layout, shape or text first' : 'Not available right now');
  };

  return (
    <div className="social-panel">
      <div className="social-canvas-row">
        <Smartphone size={13} />
        <span className="social-canvas-name">{preset ? preset.label : `${doc.width} × ${doc.height}`}</span>
        <Toggle label="Safe zones" checked={s.showSafeZones} onChange={(v) => store.set({ showSafeZones: v })} />
      </div>

      <Section title="Brand colours">
        <div className="palette-row" role="radiogroup" aria-label="Brand colours">
          {POST_PALETTES.map((q) => (
            <button key={q.id} role="radio" aria-checked={pal === q.id} className={`palette-chip ${pal === q.id ? 'active' : ''}`} title={`${q.name}: layouts, elements and text use these colours`} onClick={() => choose(q.id)}>
              <span className="palette-dots">
                {[q.bg, q.accent, q.accent2, q.ink].map((c, i) => <span key={i} style={{ background: c }} />)}
              </span>
              <span>{q.name}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Post layouts" right={<span className="mini-count">{POST_LAYOUTS.length}</span>}>
        <div className="looks-chips">
          {TAGS.map((t) => (
            <button key={t.id} className={`looks-chip ${tag === t.id ? 'active' : ''}`} onClick={() => setTag(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="post-grid">
          {layouts.map((l) => (
            <button key={l.id} className="post-thumb" title={`${l.name} — ${l.hint}. Click to add, or drag onto the canvas.`} draggable onDragStart={drag(`layout:${l.id}`)} onClick={() => addLayout(l.id, pal)}>
              <LayoutThumb layout={l} bg={bg} w={tw} h={th} pal={pal} />
              <span className="post-thumb-name">{l.name}</span>
            </button>
          ))}
        </div>
        <div className="hint">Layouts land on top as one group in your brand colours. Everything stays editable — double-click text to type.</div>
      </Section>

      <Section title="Elements">
        <div className="element-grid">
          {POST_ELEMENTS.map((e) => (
            <button key={e.id} className="element-btn" title={`${e.name} — click to add in the middle, or drag onto the canvas`} draggable onDragStart={drag(`element:${e.id}`)} onClick={() => addElement(e.id, pal)}>
              <span className="element-icon" style={{ color: p.accent === '#ffffff' ? undefined : p.accent }}>{ICONS[e.id]}</span>
              <span>{e.name}</span>
            </button>
          ))}
        </div>
        <div className="hint">Buttons, prices and handles grow with their text. Select a Photo Frame, then File ▸ Place to fill it.</div>
      </Section>

      <Section title="Text styles">
        <div className="text-style-list">
          {TEXT_STYLES.map((t) => {
            const props = t.props({ w: doc.width, h: doc.height, u: 1, p });
            return (
              <button
                key={t.id}
                className="text-style-btn"
                draggable
                onDragStart={drag(`text:${t.id}`)}
                onClick={() => addTextStyle(t.id, pal)}
                title={`${t.name} — click to add, or drag onto the canvas`}
                style={{
                  fontFamily: props.font ? `${JSON.stringify(props.font)}, serif` : undefined,
                  fontWeight: props.weight,
                  fontStyle: props.italic ? 'italic' : undefined,
                  textTransform: props.caps ? 'uppercase' : undefined,
                  letterSpacing: props.tracking ? '0.12em' : undefined,
                  fontSize: Math.max(11, Math.min(20, (props.size ?? 40) / 5)),
                  WebkitTextStroke: props.stroke ? '0.6px #000' : undefined,
                  color: props.stroke ? props.color : undefined,
                }}
              >
                <span className={props.box ? 'text-style-box' : ''}>{t.name}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Sizes, carousels & export">
        <div className="social-actions">
          <button className="btn ghost" title="One post → Instagram, Stories, Facebook, X, LinkedIn, Pinterest, YouTube… as new tabs" onClick={() => run('social-studio')}>Resize for platforms…</button>
          <button className="btn ghost" title="Seamless carousel, profile grid splits" onClick={() => run('social-studio')}>Carousel & grid…</button>
          <button className="btn ghost" title="Swap every colour in the selected layout or elements" onClick={() => run('recolor')}>Recolor selection…</button>
          <button className="btn primary" title="High-quality JPEG at full size, ready to post" onClick={() => store.task('Exporting', () => io.exportImage(doc, 'jpeg', 0.92, 1, null))}>
            <Download size={13} /> Export for posting
          </button>
        </div>
      </Section>

      <Section title="Phone check" right={small.length ? <span className="mini-count warn">{small.length}</span> : <span className="mini-count ok">OK</span>}>
        {small.length ? (
          <>
            {small.slice(0, 6).map((x) => (
              <div key={x.layer.id} className="prop-row">
                <button className="btn ghost" onClick={() => store.selectLayer(x.layer.id)}>“{x.layer.name}”</button>
                <span className="hint">{Math.round(x.size)} px — needs {x.min}+</span>
              </div>
            ))}
            <button
              className="btn"
              onClick={() => {
                const ids = new Map(small.map((x) => [x.layer.id, x.min]));
                store.commit('Make Text Readable', {
                  layers: doc.layers.map((l) => {
                    if (!ids.has(l.id) || !l.text) return l;
                    const next = withLayer(l, { text: { ...l.text, size: ids.get(l.id)! } });
                    return withLayer(next, syncTextBounds(next));
                  }),
                });
              }}
            >
              Make all readable
            </button>
          </>
        ) : (
          <div className="hint">All text is large enough to read on a phone.</div>
        )}
      </Section>
    </div>
  );
}
