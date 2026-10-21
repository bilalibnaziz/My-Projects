import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { uiZoom } from './theme';
import { ChevronDown, Search, Star, Plus, HardDrive, X, Sparkles } from 'lucide-react';
import {
  addFontFiles, allFonts, canListSystemFonts, favoriteFonts, fontsVersion, loadSystemFonts, onFontsChanged, recentFonts,
  removeCustomFont, toggleFavorite, markFontUsed, loadGoogleFont, PREBUILT_COLLECTIONS,
} from '../core/fonts';
import type { FontCategory } from '../core/fonts';
import { store } from '../core/store';

type Filter = 'all' | 'favorites' | 'recent' | FontCategory;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: '★ Starred' },
  { id: 'recent', label: 'Recent' },
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' },
  { id: 'script', label: 'Script' },
  { id: 'mono', label: 'Mono' },
  { id: 'tech', label: 'Tech' },
  { id: 'luxury', label: 'Luxury' },
  { id: 'vintage', label: 'Retro' },
  { id: 'world', label: 'World' },
  { id: 'custom', label: 'Added' },
  { id: 'system', label: 'System' },
];

/**
 * Font menu: 1,800+ World Best Google Fonts + installed fonts, curated collections, search, styles, favourites, and file imports.
 */
export function FontPicker({ value, onChange, title = 'Font', sample }: { value: string; onChange: (family: string) => void; title?: string; sample?: string }) {
  useSyncExternalStore(onFontsChanged, fontsVersion);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState<string>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState({ left: 0, top: 0, maxH: 460 });
  const [limit, setLimit] = useState(80);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const v = fontsVersion();

  // Preload current font
  useEffect(() => {
    if (value) void loadGoogleFont(value);
  }, [value]);

  const collectionMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const c of PREBUILT_COLLECTIONS) {
      map.set(c.id, new Set(c.families));
    }
    return map;
  }, []);

  const fonts = useMemo(() => {
    const all = allFonts();
    const favs = favoriteFonts();
    const recent = recentFonts();
    let out = all;

    if (collection !== 'all') {
      const set = collectionMap.get(collection);
      if (set) out = out.filter((f) => set.has(f.family));
    }

    if (filter === 'favorites') out = favs.map((f) => all.find((x) => x.family === f) ?? { family: f, category: 'custom' as const });
    else if (filter === 'recent') out = recent.map((f) => all.find((x) => x.family === f) ?? { family: f, category: 'custom' as const });
    else if (filter !== 'all') out = all.filter((f) => f.category === filter);
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((f) => f.family.toLowerCase().includes(q) || f.category.toLowerCase().includes(q));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, filter, query, v, open, collectionMap]);

  useEffect(() => {
    if (!open) return;
    setLimit(80);
    const k = uiZoom();
    const b = btn.current!.getBoundingClientRect();
    const r = { left: b.left / k, bottom: b.bottom / k };
    const vw = window.innerWidth / k;
    const vh = window.innerHeight / k;
    const width = 340;
    const left = Math.min(r.left, vw - width - 8);
    const below = vh - r.bottom - 12;
    const up = below < 260 && r.bottom > vh / 2;
    const maxH = Math.max(240, Math.min(540, up ? r.bottom - 48 : below));
    setPos({ left: Math.max(8, left), top: up ? Math.max(8, r.bottom - 28 - maxH) : r.bottom + 4, maxH });
    setHi(Math.max(0, fonts.findIndex((f) => f.family === value)));
    const close = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.font-pop') && !btn.current?.contains(t)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Preload visible font batch
  useEffect(() => {
    if (!open) return;
    const batch = fonts.slice(0, 25);
    for (const f of batch) {
      void loadGoogleFont(f.family);
    }
  }, [open, fonts]);

  useEffect(() => {
    list.current?.querySelector('.font-row.hi')?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const pick = (family: string) => {
    markFontUsed(family);
    void loadGoogleFont(family);
    onChange(family);
    setOpen(false);
    setQuery('');
  };

  const favs = new Set(favoriteFonts());
  return (
    <span className="font-picker">
      <button ref={btn} type="button" className="select font-btn" title={title} onClick={() => setOpen((o) => !o)} style={{ fontFamily: `${JSON.stringify(value)}, system-ui` }}>
        <span className="font-btn-name">{value}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="font-pop" style={{ left: pos.left, top: pos.top, maxHeight: pos.maxH, width: 340 }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="font-search">
            <Search size={13} />
            <input
              autoFocus
              value={query}
              placeholder="Search 1,800+ world best fonts…"
              onChange={(e) => {
                setQuery(e.target.value);
                setHi(0);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHi((h) => Math.min(fonts.length - 1, h + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHi((h) => Math.max(0, h - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (fonts[hi]) pick(fonts[hi].family);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setOpen(false);
                }
              }}
            />
            <span style={{ fontSize: 10, color: '#9ca3af', padding: '1px 6px', background: '#252528', borderRadius: 4 }}>
              {fonts.length}
            </span>
          </div>

          {/* Prebuilt Curated Collections Bar */}
          <div style={{ background: '#161619', borderBottom: '1px solid #2a2a2e', padding: '6px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <Sparkles size={11} color="#60a5fa" />
              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#93c5fd' }}>
                Prebuilt Collections
              </span>
            </div>
            <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
              <button
                type="button"
                onClick={() => { setCollection('all'); setFilter('all'); }}
                style={{
                  background: collection === 'all' && filter === 'all' ? '#2563eb' : '#27272a',
                  color: collection === 'all' && filter === 'all' ? '#fff' : '#d4d4d8',
                  border: 'none',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                🌟 All (1,800+)
              </button>
              {PREBUILT_COLLECTIONS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.description}
                  onClick={() => { setCollection(c.id); setFilter('all'); }}
                  style={{
                    background: collection === c.id ? '#2563eb' : '#27272a',
                    color: collection === c.id ? '#fff' : '#d4d4d8',
                    border: 'none',
                    borderRadius: 4,
                    padding: '2px 6px',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.badge} {c.name.replace("World's Top 50 ", '')}
                </button>
              ))}
            </div>
          </div>

          <div className="font-filters" style={{ overflowX: 'auto', scrollbarWidth: 'none', display: 'flex', gap: 2, padding: '4px 6px' }}>
            {FILTERS.filter((f) => f.id !== 'system' || allFonts().some((x) => x.category === 'system')).map((f) => (
              <button
                key={f.id}
                className={filter === f.id && collection === 'all' ? 'active' : ''}
                onClick={() => { setFilter(f.id); setCollection('all'); }}
                title={f.id === 'favorites' ? 'Favourites' : undefined}
                style={{ flexShrink: 0 }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div
            className="font-list"
            ref={list}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 120 && limit < fonts.length) {
                setLimit((l) => Math.min(fonts.length, l + 80));
              }
            }}
          >
            {fonts.length === 0 && (
              <div className="font-empty">
                {filter === 'favorites' ? 'Star fonts to keep them here' : filter === 'recent' ? 'Fonts you use appear here' : 'No fonts match'}
              </div>
            )}
            {fonts.slice(0, limit).map((f, i) => (
              <div
                key={f.family}
                className={`font-row ${i === hi ? 'hi' : ''} ${f.family === value ? 'current' : ''}`}
                onMouseEnter={() => {
                  setHi(i);
                  void loadGoogleFont(f.family);
                }}
                onClick={() => pick(f.family)}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                  <span className="font-row-name" style={{ fontFamily: `${JSON.stringify(f.family)}, system-ui` }}>
                    {f.family}
                  </span>
                  <span style={{ fontSize: '9px', color: '#6e7681', textTransform: 'uppercase' }}>
                    {f.category}
                  </span>
                </div>
                <span className="font-row-sample" style={{ fontFamily: `${JSON.stringify(f.family)}, system-ui` }}>
                  {sample?.slice(0, 12) || 'Ag'}
                </span>
                {f.category === 'custom' && (
                  <button
                    className="font-row-btn"
                    title="Remove this added font"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeCustomFont(f.family);
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
                <button
                  className={`font-row-btn ${favs.has(f.family) ? 'on' : ''}`}
                  title={favs.has(f.family) ? 'Remove from favourites' : 'Add to favourites'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(f.family);
                  }}
                >
                  <Star size={12} fill={favs.has(f.family) ? 'currentColor' : 'none'} />
                </button>
              </div>
            ))}
            {fonts.length > limit && (
              <button
                type="button"
                className="font-load-more"
                onClick={() => setLimit((l) => Math.min(fonts.length, l + 120))}
                style={{ width: '100%', padding: '6px', fontSize: 11, background: '#252528', color: '#9ca3af', border: 'none', cursor: 'pointer', textAlign: 'center' }}
              >
                Showing {limit} of {fonts.length} fonts · Click to load more…
              </button>
            )}
          </div>
          <div className="font-foot">
            <button className="btn ghost" onClick={() => file.current?.click()} title="Add TTF, OTF, WOFF or WOFF2 files — they are kept for next time">
              <Plus size={13} /> Add fonts…
            </button>
            {canListSystemFonts() && !allFonts().some((x) => x.category === 'system') && (
              <button
                className="btn ghost"
                title="List every font installed on this computer (the browser asks once)"
                onClick={async () => {
                  try {
                    const n = await loadSystemFonts();
                    store.toast(n ? `${n} more installed fonts listed` : 'All installed fonts are already listed', 'success');
                    setFilter('all');
                  } catch {
                    store.toast('Font access was not allowed', 'error');
                  }
                }}
              >
                <HardDrive size={13} /> All installed
              </button>
            )}
            <input
              ref={file}
              type="file"
              multiple
              accept=".ttf,.otf,.woff,.woff2,.ttc,font/ttf,font/otf,font/woff,font/woff2"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                const added = await addFontFiles(files);
                if (added.length) {
                  store.toast(`Added ${added.join(', ')}`, 'success');
                  pick(added[0]);
                }
              }}
            />
          </div>
        </div>
      )}
    </span>
  );
}
