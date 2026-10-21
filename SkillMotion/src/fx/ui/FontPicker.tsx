import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, Search, Star, Sparkles, Check } from 'lucide-react';
import {
  allFonts,
  favoriteFonts,
  recentFonts,
  toggleFavorite,
  markFontUsed,
  loadGoogleFont,
  PREBUILT_COLLECTIONS,
  type FontCategory,
} from '../fonts';

type FilterType = 'all' | 'favorites' | 'recent' | FontCategory;

const CATEGORY_FILTERS: { id: FilterType; label: string }[] = [
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
];

export function FontPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (family: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCollection, setActiveCollection] = useState<string>('all');
  const [activeCategory, setActiveCategory] = useState<FilterType>('all');
  const [limit, setLimit] = useState(60);
  const [favs, setFavs] = useState<string[]>(favoriteFonts);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Preload selected font
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
    const recent = recentFonts();
    let out = all;

    if (activeCollection !== 'all') {
      const famSet = collectionMap.get(activeCollection);
      if (famSet) {
        out = out.filter((f) => famSet.has(f.family));
      }
    }

    if (activeCategory === 'favorites') {
      out = favs.map((f) => all.find((x) => x.family === f) ?? { family: f, category: 'sans' as const });
    } else if (activeCategory === 'recent') {
      out = recent.map((f) => all.find((x) => x.family === f) ?? { family: f, category: 'sans' as const });
    } else if (activeCategory !== 'all') {
      out = out.filter((f) => f.category === activeCategory);
    }

    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((f) => f.family.toLowerCase().includes(q) || f.category.toLowerCase().includes(q));
    }
    return out;
  }, [activeCollection, activeCategory, query, favs, collectionMap]);

  useEffect(() => {
    if (!open) return;
    setLimit(60);
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.fx-font-popover') && !btnRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  // Preload visible font batch
  useEffect(() => {
    if (!open) return;
    const batch = fonts.slice(0, 20);
    for (const f of batch) {
      void loadGoogleFont(f.family);
    }
  }, [open, fonts]);

  const pick = (family: string) => {
    markFontUsed(family);
    void loadGoogleFont(family);
    onChange(family);
    setOpen(false);
    setQuery('');
  };

  const handleToggleFav = (family: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavs(toggleFavorite(family));
  };

  const favSet = new Set(favs);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <button
        ref={btnRef}
        type="button"
        className="fx-chip-btn"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          fontFamily: `${JSON.stringify(value)}, system-ui`,
          padding: '5px 10px',
          background: '#1f1f1f',
          border: '1px solid var(--fx-border-bright, #333)',
          borderRadius: 6,
          color: '#ffffff',
          fontSize: 12,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || 'Inter'}
        </span>
        <ChevronDown size={13} color="#9d9d9d" />
      </button>

      {open && (
        <div
          className="fx-font-popover"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            width: 320,
            maxHeight: 460,
            background: '#18181b',
            borderRadius: 10,
            boxShadow: '0 16px 40px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.08)',
            border: '1px solid #2e2e34',
            zIndex: 10000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Search Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid #27272a' }}>
            <Search size={14} color="#a1a1aa" />
            <input
              autoFocus
              value={query}
              placeholder="Search 1,800+ motion & title fonts…"
              onChange={(e) => setQuery(e.target.value)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: '#fff',
                fontSize: 12,
                outline: 'none',
              }}
            />
            <span style={{ fontSize: 10, color: '#71717a', padding: '1px 6px', background: '#27272a', borderRadius: 4 }}>
              {fonts.length}
            </span>
          </div>

          {/* Prebuilt Collections Bar */}
          <div style={{ background: '#121214', borderBottom: '1px solid #27272a', padding: '6px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
              <Sparkles size={11} color="#60a5fa" />
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#93c5fd' }}>
                Prebuilt Collections
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
              <button
                type="button"
                onClick={() => { setActiveCollection('all'); setActiveCategory('all'); }}
                style={{
                  background: activeCollection === 'all' && activeCategory === 'all' ? '#2563eb' : '#27272a',
                  color: activeCollection === 'all' && activeCategory === 'all' ? '#fff' : '#d4d4d8',
                  border: 'none',
                  borderRadius: 4,
                  padding: '3px 7px',
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
                  onClick={() => { setActiveCollection(c.id); setActiveCategory('all'); }}
                  style={{
                    background: activeCollection === c.id ? '#2563eb' : '#27272a',
                    color: activeCollection === c.id ? '#fff' : '#d4d4d8',
                    border: 'none',
                    borderRadius: 4,
                    padding: '3px 7px',
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

          {/* Categories Pill Bar */}
          <div style={{ display: 'flex', gap: 3, padding: '6px 8px', overflowX: 'auto', borderBottom: '1px solid #27272a', scrollbarWidth: 'none' }}>
            {CATEGORY_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => { setActiveCategory(f.id); setActiveCollection('all'); }}
                style={{
                  background: activeCategory === f.id && activeCollection === 'all' ? '#3b82f6' : 'transparent',
                  color: activeCategory === f.id && activeCollection === 'all' ? '#fff' : '#a1a1aa',
                  border: 'none',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Font List */}
          <div
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 120 && limit < fonts.length) {
                setLimit((l) => Math.min(fonts.length, l + 50));
              }
            }}
            style={{ flex: 1, overflowY: 'auto', padding: '4px 0', maxHeight: 310 }}
          >
            {fonts.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: '#71717a' }}>
                No fonts match your criteria
              </div>
            )}
            {fonts.slice(0, limit).map((f) => {
              const isSelected = f.family === value;
              return (
                <div
                  key={f.family}
                  onClick={() => pick(f.family)}
                  onMouseEnter={() => void loadGoogleFont(f.family)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '7px 12px',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(59, 130, 246, 0.22)' : 'transparent',
                    borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseOver={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  }}
                  onMouseOut={(e) => {
                    if (!isSelected) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontFamily: `${JSON.stringify(f.family)}, system-ui`,
                          color: '#f4f4f5',
                          fontSize: 13,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {f.family}
                      </span>
                      {isSelected && <Check size={12} color="#3b82f6" />}
                    </div>
                    <span style={{ fontSize: 9, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {f.category}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleToggleFav(f.family, e)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: favSet.has(f.family) ? '#f59e0b' : '#3f3f46',
                      cursor: 'pointer',
                      padding: 4,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    title="Toggle Favorite"
                  >
                    <Star size={13} fill={favSet.has(f.family) ? 'currentColor' : 'none'} />
                  </button>
                </div>
              );
            })}
            {fonts.length > limit && (
              <div style={{ padding: 8, textAlign: 'center', fontSize: 10, color: '#71717a' }}>
                Showing {limit} of {fonts.length} fonts · Scroll for more
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
