// Social Studio: one post → every platform (re-laid out per size), seamless carousels, profile-grid
// splits, legibility check. PlatformPicker and PlatformPreviews are shared with the Export dialog.
import { useEffect, useState } from 'react';
import { store, useStore } from '../core/store';
import { CORE_PLATFORMS, PLATFORM_SIZES, createCarousel, exportCarousel, exportForPlatforms, exportProfileGrid, layoutModeFor, legibility, platformPreview, resizeForPlatforms, slideCount } from '../core/socialStudio';
import type { PlatformFormat } from '../core/socialStudio';
import { safeZoneFor } from '../core/social';
import type { Doc } from '../core/types';
import { Select } from './widgets';

/** Platform families, in the order people post. */
const FAMILIES: { name: string; match: (id: string) => boolean }[] = [
  { name: 'Instagram', match: (id) => id.startsWith('ig-') },
  { name: 'Facebook', match: (id) => id.startsWith('fb-') },
  { name: 'X', match: (id) => id.startsWith('x-') },
  { name: 'LinkedIn', match: (id) => id.startsWith('li-') },
  { name: 'YouTube', match: (id) => id.startsWith('yt-') },
  { name: 'Pinterest · Threads · Reels', match: (id) => id === 'pin' || id === 'threads' || id === 'reel' },
];

const PLATFORM_SETS: { label: string; ids: string[] }[] = [
  { label: 'Core set', ids: CORE_PLATFORMS },
  { label: 'Feed posts', ids: ['ig-portrait', 'ig-square', 'fb-post', 'x-post', 'li-post', 'li-square', 'threads'] },
  { label: 'Covers & banners', ids: ['fb-cover', 'x-header', 'li-banner', 'yt-banner'] },
  { label: 'Stories & reels', ids: ['ig-story', 'reel'] },
];

const MODE_LABEL = { keep: 'Fitted', side: 'Side by side', stack: 'Stacked' } as const;

export function PlatformPicker({ picked, onChange, compact }: { picked: Set<string>; onChange: (s: Set<string>) => void; compact?: boolean }) {
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div className="platform-picker">
      <div className="prop-row platform-sets">
        {PLATFORM_SETS.map((s) => (
          <button key={s.label} className={`btn ghost compact ${s.ids.every((i) => picked.has(i)) ? 'on' : ''}`} onClick={() => onChange(new Set([...picked, ...s.ids]))} title={`Add ${s.ids.length} sizes`}>
            + {s.label}
          </button>
        ))}
        <button className="btn ghost compact" onClick={() => onChange(new Set(PLATFORM_SIZES.map((p) => p.id)))}>All</button>
        <button className="btn ghost compact" onClick={() => onChange(new Set())} disabled={!picked.size}>Clear</button>
      </div>
      <div className={`platform-families ${compact ? 'compact' : ''}`}>
        {FAMILIES.map((f) => {
          const sizes = PLATFORM_SIZES.filter((p) => f.match(p.id));
          if (!sizes.length) return null;
          return (
            <div key={f.name} className="platform-family">
              <div className="platform-family-name">{f.name}</div>
              {sizes.map((p) => (
                <label key={p.id} className={`platform-chip ${picked.has(p.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                  <span>{p.label}</span>
                  <small>{p.w}×{p.h}</small>
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Live thumbnails of the design laid out for each picked size, rendered one at a time. */
export function PlatformPreviews({ doc, ids }: { doc: Doc; ids: string[] }) {
  const [shots, setShots] = useState<Record<string, string>>({});
  const key = ids.join(',');
  useEffect(() => {
    let cancelled = false;
    const wanted = key.split(',');
    const list = PLATFORM_SIZES.filter((p) => wanted.includes(p.id));
    let i = 0;
    let t = 0;
    const next = () => {
      if (cancelled || i >= list.length) return;
      const p = list[i++];
      try {
        const c = platformPreview(doc, p.id, 240);
        if (c) {
          const url = c.toDataURL('image/png');
          setShots((s) => ({ ...s, [p.id]: url }));
        }
      } catch (err) {
        console.warn('Preview failed', p.id, err);
      }
      t = window.setTimeout(next, 0);
    };
    t = window.setTimeout(next, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // Re-render when the picked sizes or the design change
  }, [key, doc, doc.layers, doc.width, doc.height]);
  if (!ids.length) return <div className="hint">Pick platforms to see each size laid out.</div>;
  return (
    <div className="platform-previews">
      {PLATFORM_SIZES.filter((p) => ids.includes(p.id)).map((p) => (
        <figure key={p.id} className="platform-preview" title={`${p.label} · ${p.w}×${p.h}`}>
          <div className="pp-frame">
            {shots[p.id] ? <img src={shots[p.id]} alt={`${p.label} preview`} /> : <span className="pp-wait" style={{ aspectRatio: `${p.w} / ${p.h}` }} />}
          </div>
          <figcaption>
            <span>{p.label}</span>
            <small>
              {p.w}×{p.h} · {MODE_LABEL[layoutModeFor(doc, p.w, p.h, p.safeZone ?? safeZoneFor(p.w, p.h))]}
            </small>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function SocialStudioBody({ onDone }: { onDone: () => void }) {
  useStore();
  const doc = store.doc;
  const [picked, setPicked] = useState<Set<string>>(() => new Set(CORE_PLATFORMS));
  const [format, setFormat] = useState<PlatformFormat>('png');
  const [slides, setSlides] = useState(5);
  const [slidePreset, setSlidePreset] = useState('ig-portrait');
  const [grid, setGrid] = useState({ rows: 3, cols: 3 });
  const isCarousel = !!doc && /^Carousel · /.test(doc.title);
  const n = doc ? slideCount(doc) : 1;
  const small = doc ? legibility(doc, isCarousel ? doc.width / n : undefined) : [];
  const ids = [...picked];
  const num = (v: number, set: (v: number) => void, min: number, max: number, label: string) => (
    <input className="input" type="number" style={{ width: 56 }} min={min} max={max} value={v} aria-label={label} onChange={(e) => set(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))} />
  );
  return (
    <div className="social-studio">
      <section>
        <div className="mini-title">Resize for every platform</div>
        <div className="hint">
          Each size is re-laid out, not just shrunk: backgrounds cover, bars stretch along their edge, logos stay in their corner of the platform's safe zone, and text and pictures sit side by side on banners or stack on stories. Text and shapes stay editable.
        </div>
        <PlatformPicker picked={picked} onChange={setPicked} />
        {doc && <PlatformPreviews doc={doc} ids={ids} />}
        <div className="prop-row">
          <div className="opt-spacer" />
          <Select value={format} onChange={setFormat} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }]} />
          <button className="btn ghost" disabled={!doc || !picked.size} onClick={() => void store.task('Exporting sizes', () => exportForPlatforms(ids, format, 0.92))} title="One zip: this design plus every picked size, each laid out for its platform">
            Export {picked.size + 1} sizes (zip)
          </button>
          <button className="btn primary" disabled={!doc || !picked.size} onClick={() => { if (resizeForPlatforms(ids)) onDone(); }} title="Open each size as its own tab to fine-tune">
            Open {picked.size} size{picked.size === 1 ? '' : 's'} as tabs
          </button>
        </div>
      </section>

      <section>
        <div className="mini-title">Seamless carousel</div>
        <div className="hint">One wide canvas with slide dividers: design across the seams, then export each slide.</div>
        <div className="prop-row">
          {num(slides, setSlides, 2, 20, 'Slides')}
          <span className="hint">slides of</span>
          <Select value={slidePreset} onChange={setSlidePreset} options={PLATFORM_SIZES.filter((p) => p.h >= p.w).map((p) => ({ value: p.id, label: p.label }))} />
          <button className="btn ghost" onClick={() => { createCarousel(slides, slidePreset); onDone(); }}>New carousel</button>
          <button className="btn ghost" disabled={!doc} onClick={() => exportCarousel(isCarousel ? undefined : slides)}>
            Export {isCarousel ? n : slides} slides
          </button>
        </div>
      </section>

      <section>
        <div className="mini-title">Profile grid</div>
        <div className="hint">Splits this canvas into tiles numbered in posting order (bottom-right first).</div>
        <div className="prop-row">
          {num(grid.rows, (rows) => setGrid({ ...grid, rows }), 1, 10, 'Rows')}
          <span className="hint">rows ×</span>
          {num(grid.cols, (cols) => setGrid({ ...grid, cols }), 1, 10, 'Columns')}
          <span className="hint">columns</span>
          <button className="btn ghost" disabled={!doc} onClick={() => exportProfileGrid(grid.rows, grid.cols)}>Export {grid.rows * grid.cols} tiles</button>
        </div>
      </section>

      <section>
        <div className="mini-title">Phone legibility</div>
        {!doc ? null : small.length ? (
          <div className="legibility-list">
            {small.map((s) => (
              <div key={s.layer.id} className="prop-row">
                <button className="btn ghost" onClick={() => { store.selectLayer(s.layer.id); onDone(); }}>“{s.layer.name}”</button>
                <span className="hint">{Math.round(s.size)} px — at least {s.min} px reads well on a phone</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="hint">All text is large enough to read on a phone.</div>
        )}
      </section>
    </div>
  );
}
