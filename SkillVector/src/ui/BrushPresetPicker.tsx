import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, ChevronDown, Sparkles, Check, SlidersHorizontal } from 'lucide-react';
import { store } from '../core/store';
import { BRUSH_PRESETS, BRUSH_CATEGORIES, type BrushPreset } from '../core/brushPresets';

interface BrushPresetPickerProps {
  currentSize: number;
  currentHardness: number;
}

export function BrushPresetPicker({ currentSize, currentHardness }: BrushPresetPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [limit, setLimit] = useState(60);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredPresets = useMemo(() => {
    let list = BRUSH_PRESETS;
    if (selectedCategory !== 'all') {
      list = list.filter((b) => b.category === selectedCategory);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((b) => b.name.toLowerCase().includes(q) || b.category.toLowerCase().includes(q));
    }
    return list;
  }, [selectedCategory, query]);

  useEffect(() => {
    if (!open) return;
    setLimit(60);
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.brush-picker-pop') && !btnRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const applyPreset = (preset: BrushPreset) => {
    store.setOpts({
      size: preset.size,
      hardness: preset.hardness,
      opacity: preset.opacity,
      flow: preset.flow,
      smoothing: preset.smoothing,
      pressureSize: preset.pressureSize,
      pressureOpacity: preset.pressureOpacity,
    });
    setActivePresetId(preset.id);
    store.toast(`Loaded brush: ${preset.name}`, 'info');
    setOpen(false);
  };

  const activePreset = useMemo(() => {
    return BRUSH_PRESETS.find((p) => p.id === activePresetId) ?? BRUSH_PRESETS[0];
  }, [activePresetId]);

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        ref={btnRef}
        type="button"
        className="select brush-preset-btn"
        onClick={() => setOpen((o) => !o)}
        title="1,000+ Rich Brush Presets"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 8px',
          background: '#242428',
          border: '1px solid #383842',
          borderRadius: 6,
          color: '#e5e7eb',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <Sparkles size={12} color="#38bdf8" />
        <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activePresetId ? activePreset.name : 'Brushes (1,000+)'}
        </span>
        <ChevronDown size={11} color="#9ca3af" />
      </button>

      {open && (
        <div
          className="brush-picker-pop"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            width: 380,
            maxHeight: 460,
            background: '#18181c',
            borderRadius: 10,
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.85)',
            border: '1px solid #2e2e38',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Header & Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #27272f', display: 'flex', alignItems: 'center', gap: 6, background: '#1c1c22' }}>
            <Search size={13} color="#9ca3af" />
            <input
              autoFocus
              value={query}
              placeholder="Search 1,000+ artistic brushes…"
              onChange={(e) => setQuery(e.target.value)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: '#f3f4f6',
                fontSize: 12,
                outline: 'none',
              }}
            />
            <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>{filteredPresets.length} brushes</span>
          </div>

          {/* Category Filter Pills */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              padding: '6px 8px',
              overflowX: 'auto',
              borderBottom: '1px solid #27272f',
              background: '#16161a',
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              style={{
                background: selectedCategory === 'all' ? '#3b82f6' : '#222228',
                color: selectedCategory === 'all' ? '#fff' : '#9ca3af',
                border: 'none',
                borderRadius: 5,
                padding: '3px 8px',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              All (1,050)
            </button>
            {BRUSH_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                style={{
                  background: selectedCategory === cat.id ? '#3b82f6' : '#222228',
                  color: selectedCategory === cat.id ? '#fff' : '#9ca3af',
                  border: 'none',
                  borderRadius: 5,
                  padding: '3px 8px',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Brush List */}
          <div
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 120 && limit < filteredPresets.length) {
                setLimit((l) => Math.min(filteredPresets.length, l + 50));
              }
            }}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '6px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              maxHeight: 360,
            }}
          >
            {filteredPresets.slice(0, limit).map((p) => {
              const isCurrent = activePresetId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: isCurrent ? 'rgba(59, 130, 246, 0.22)' : '#1e1e24',
                    border: isCurrent ? '1px solid #3b82f6' : '1px solid #282832',
                    cursor: 'pointer',
                    transition: 'background 0.12s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* Simulated Stroke Preview Canvas */}
                    <div
                      style={{
                        width: 44,
                        height: 24,
                        background: '#121215',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        border: '1px solid #2f2f3a',
                      }}
                    >
                      <div
                        style={{
                          width: Math.min(36, Math.max(4, p.size * 0.7)),
                          height: Math.min(16, Math.max(2, p.size * 0.4)),
                          borderRadius: Math.round(p.hardness * 10),
                          background: '#e2e8f0',
                          opacity: p.opacity * p.flow,
                          filter: p.hardness < 0.3 ? 'blur(1.5px)' : 'none',
                        }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#f3f4f6' }}>{p.name}</div>
                      <div style={{ fontSize: 9, color: '#9ca3af' }}>
                        Size: {p.size}px · Hard: {Math.round(p.hardness * 100)}% · Flow: {Math.round(p.flow * 100)}%
                        {p.pressureSize ? ' · ✍ Pen' : ''}
                      </div>
                    </div>
                  </div>

                  {isCurrent && <Check size={13} color="#38bdf8" />}
                </div>
              );
            })}

            {filteredPresets.length > limit && (
              <button
                type="button"
                onClick={() => setLimit((l) => Math.min(filteredPresets.length, l + 100))}
                style={{
                  padding: 8,
                  fontSize: 10,
                  background: '#222228',
                  color: '#9ca3af',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'center',
                  marginTop: 4,
                }}
              >
                Showing {limit} of {filteredPresets.length} presets · Click to load more
              </button>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
