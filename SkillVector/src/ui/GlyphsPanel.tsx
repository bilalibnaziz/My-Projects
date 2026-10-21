import { useState } from 'react';
import { Copy, Search, Type, Check } from 'lucide-react';
import { store, useStore } from '../core/store';
import * as tools from '../core/tools';

export interface GlyphItem {
  char: string;
  name: string;
  category: 'punct' | 'currency' | 'math' | 'arrows' | 'shapes' | 'accents';
}

export const GLYPH_CATALOG: GlyphItem[] = [
  // Punctuation & Typography
  { char: '©', name: 'Copyright', category: 'punct' },
  { char: '®', name: 'Registered Trademark', category: 'punct' },
  { char: '™', name: 'Trademark', category: 'punct' },
  { char: '§', name: 'Section Sign', category: 'punct' },
  { char: '¶', name: 'Pilcrow / Paragraph', category: 'punct' },
  { char: '•', name: 'Bullet Point', category: 'punct' },
  { char: '—', name: 'Em Dash', category: 'punct' },
  { char: '–', name: 'En Dash', category: 'punct' },
  { char: '…', name: 'Horizontal Ellipsis', category: 'punct' },
  { char: '“', name: 'Left Double Quote', category: 'punct' },
  { char: '”', name: 'Right Double Quote', category: 'punct' },
  { char: '‘', name: 'Left Single Quote', category: 'punct' },
  { char: '’', name: 'Right Single Quote / Apostrophe', category: 'punct' },
  { char: '«', name: 'Left Guillemet', category: 'punct' },
  { char: '»', name: 'Right Guillemet', category: 'punct' },
  { char: '†', name: 'Dagger', category: 'punct' },
  { char: '‡', name: 'Double Dagger', category: 'punct' },
  { char: '№', name: 'Numero Sign', category: 'punct' },

  // Currency
  { char: '$', name: 'Dollar Sign', category: 'currency' },
  { char: '€', name: 'Euro Sign', category: 'currency' },
  { char: '£', name: 'Pound Sterling', category: 'currency' },
  { char: '¥', name: 'Yen / Yuan Sign', category: 'currency' },
  { char: '₹', name: 'Indian Rupee', category: 'currency' },
  { char: '₿', name: 'Bitcoin Symbol', category: 'currency' },
  { char: '¢', name: 'Cent Sign', category: 'currency' },
  { char: '₽', name: 'Russian Ruble', category: 'currency' },
  { char: '₩', name: 'South Korean Won', category: 'currency' },
  { char: '₺', name: 'Turkish Lira', category: 'currency' },
  { char: '₫', name: 'Vietnamese Dong', category: 'currency' },
  { char: '₣', name: 'French Franc', category: 'currency' },

  // Math & Technical
  { char: '±', name: 'Plus-Minus', category: 'math' },
  { char: '×', name: 'Multiplication Sign', category: 'math' },
  { char: '÷', name: 'Division Sign', category: 'math' },
  { char: '≠', name: 'Not Equal', category: 'math' },
  { char: '≈', name: 'Almost Equal / Approx', category: 'math' },
  { char: '≤', name: 'Less-than or Equal', category: 'math' },
  { char: '≥', name: 'Greater-than or Equal', category: 'math' },
  { char: '∞', name: 'Infinity', category: 'math' },
  { char: '√', name: 'Square Root', category: 'math' },
  { char: '∑', name: 'Summation', category: 'math' },
  { char: '∏', name: 'Product', category: 'math' },
  { char: 'π', name: 'Pi', category: 'math' },
  { char: 'µ', name: 'Micro Sign', category: 'math' },
  { char: 'Δ', name: 'Delta / Increment', category: 'math' },
  { char: 'Ω', name: 'Omega / Ohm', category: 'math' },
  { char: '∫', name: 'Integral', category: 'math' },
  { char: '°', name: 'Degree Sign', category: 'math' },
  { char: '‰', name: 'Per Mille Sign', category: 'math' },

  // Arrows & Flow
  { char: '←', name: 'Left Arrow', category: 'arrows' },
  { char: '→', name: 'Right Arrow', category: 'arrows' },
  { char: '↑', name: 'Up Arrow', category: 'arrows' },
  { char: '↓', name: 'Down Arrow', category: 'arrows' },
  { char: '↔', name: 'Left-Right Arrow', category: 'arrows' },
  { char: '↕', name: 'Up-Down Arrow', category: 'arrows' },
  { char: '↖', name: 'North West Arrow', category: 'arrows' },
  { char: '↗', name: 'North East Arrow', category: 'arrows' },
  { char: '↘', name: 'South East Arrow', category: 'arrows' },
  { char: '↙', name: 'South West Arrow', category: 'arrows' },
  { char: '➔', name: 'Heavy Right Arrow', category: 'arrows' },
  { char: '➜', name: 'Round Right Arrow', category: 'arrows' },
  { char: '⇄', name: 'Exchange Arrows', category: 'arrows' },
  { char: '↺', name: 'Anticlockwise Arrow', category: 'arrows' },
  { char: '↻', name: 'Clockwise Arrow', category: 'arrows' },

  // Shapes & Symbols
  { char: '★', name: 'Black Star', category: 'shapes' },
  { char: '☆', name: 'White Star', category: 'shapes' },
  { char: '✦', name: 'Black Four Pointed Star', category: 'shapes' },
  { char: '✧', name: 'White Four Pointed Star', category: 'shapes' },
  { char: '◆', name: 'Black Diamond', category: 'shapes' },
  { char: '◇', name: 'White Diamond', category: 'shapes' },
  { char: '●', name: 'Black Circle', category: 'shapes' },
  { char: '○', name: 'White Circle', category: 'shapes' },
  { char: '■', name: 'Black Square', category: 'shapes' },
  { char: '□', name: 'White Square', category: 'shapes' },
  { char: '▲', name: 'Black Up-Pointing Triangle', category: 'shapes' },
  { char: '▼', name: 'Black Down-Pointing Triangle', category: 'shapes' },
  { char: '◄', name: 'Black Left-Pointing Pointer', category: 'shapes' },
  { char: '►', name: 'Black Right-Pointing Pointer', category: 'shapes' },
  { char: '✓', name: 'Checkmark', category: 'shapes' },
  { char: '✔', name: 'Heavy Checkmark', category: 'shapes' },
  { char: '✕', name: 'Multiplication X', category: 'shapes' },
  { char: '♥', name: 'Black Heart Suit', category: 'shapes' },
  { char: '♦', name: 'Black Diamond Suit', category: 'shapes' },
  { char: '♠', name: 'Black Spade Suit', category: 'shapes' },
  { char: '♣', name: 'Black Club Suit', category: 'shapes' },

  // Accents & International
  { char: 'á', name: 'a acute', category: 'accents' },
  { char: 'é', name: 'e acute', category: 'accents' },
  { char: 'í', name: 'i acute', category: 'accents' },
  { char: 'ó', name: 'o acute', category: 'accents' },
  { char: 'ú', name: 'u acute', category: 'accents' },
  { char: 'ñ', name: 'n tilde', category: 'accents' },
  { char: 'ü', name: 'u diaeresis', category: 'accents' },
  { char: 'ç', name: 'c cedilla', category: 'accents' },
  { char: 'à', name: 'a grave', category: 'accents' },
  { char: 'è', name: 'e grave', category: 'accents' },
  { char: 'ì', name: 'i grave', category: 'accents' },
  { char: 'ò', name: 'o grave', category: 'accents' },
  { char: 'ù', name: 'u grave', category: 'accents' },
  { char: 'â', name: 'a circumflex', category: 'accents' },
  { char: 'ê', name: 'e circumflex', category: 'accents' },
  { char: 'î', name: 'i circumflex', category: 'accents' },
  { char: 'ô', name: 'o circumflex', category: 'accents' },
  { char: 'û', name: 'u circumflex', category: 'accents' },
  { char: 'ä', name: 'a umlaut', category: 'accents' },
  { char: 'ë', name: 'e umlaut', category: 'accents' },
  { char: 'ï', name: 'i umlaut', category: 'accents' },
  { char: 'ö', name: 'o umlaut', category: 'accents' },
  { char: 'ÿ', name: 'y umlaut', category: 'accents' },
  { char: 'ß', name: 'sharp s / eszett', category: 'accents' },
  { char: 'æ', name: 'ae ligature', category: 'accents' },
  { char: 'œ', name: 'oe ligature', category: 'accents' },
  { char: 'ø', name: 'o with stroke', category: 'accents' },
  { char: 'å', name: 'a with ring', category: 'accents' },
];

export function GlyphsPanel() {
  useStore();
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState<'all' | GlyphItem['category']>('all');
  const [copiedChar, setCopiedChar] = useState<string | null>(null);

  const filtered = GLYPH_CATALOG.filter((g) => {
    if (category !== 'all' && g.category !== category) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return g.char.includes(q) || g.name.toLowerCase().includes(q);
  });

  const handleSelectGlyph = (g: GlyphItem) => {
    // 1. Copy to clipboard
    try {
      navigator.clipboard.writeText(g.char);
      setCopiedChar(g.char);
      setTimeout(() => setCopiedChar(null), 1500);
    } catch {}

    // 2. If a text layer is currently active in textEdit mode, insert it
    const activeLayer = store.activeLayer;
    if (activeLayer?.text) {
      const curText = activeLayer.text.text || '';
      const start = tools.textSelection.start ?? curText.length;
      const end = tools.textSelection.end ?? curText.length;
      const nextText = curText.slice(0, start) + g.char + curText.slice(end);
      store.updateLayer(activeLayer.id, {
        text: { ...activeLayer.text, text: nextText },
      }, 'Insert Glyph');
      store.toast(`Inserted "${g.char}" into text layer`, 'success');
    } else {
      store.toast(`Copied "${g.char}" (${g.name}) to clipboard`, 'info');
    }
  };

  return (
    <div className="glyphs-panel" style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Type size={14} style={{ color: '#fb923c' }} />
          <span className="mini-title" style={{ margin: 0 }}>Glyphs &amp; Special Characters</span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-sub)' }}>{filtered.length} glyphs</span>
      </div>

      {/* Search Input */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Search size={12} style={{ position: 'absolute', left: 8, color: 'var(--text-sub)', pointerEvents: 'none' }} />
        <input
          type="text"
          className="input compact"
          placeholder="Search glyph name (e.g. euro, copyright, star)..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: '100%', paddingLeft: 24, fontSize: 11 }}
        />
      </div>

      {/* Category Pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {(
          [
            ['all', 'All'],
            ['punct', 'Typography'],
            ['currency', 'Currency'],
            ['math', 'Math'],
            ['arrows', 'Arrows'],
            ['shapes', 'Symbols'],
            ['accents', 'Accents'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={`btn ghost compact ${category === k ? 'active' : ''}`}
            style={{
              fontSize: 10,
              padding: '2px 7px',
              borderRadius: 4,
              background: category === k ? 'rgba(251, 146, 60, 0.2)' : 'var(--surface)',
              borderColor: category === k ? '#fb923c' : 'var(--border)',
              color: category === k ? '#fb923c' : 'var(--text-sub)',
            }}
            onClick={() => setCategory(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Glyphs Grid */}
      <div
        className="glyphs-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(36px, 1fr))',
          gap: 4,
          overflowY: 'auto',
          maxHeight: 340,
          padding: 4,
          background: 'var(--surface-dark, rgba(0,0,0,0.2))',
          borderRadius: 6,
          border: '1px solid var(--border)',
        }}
      >
        {filtered.map((g) => {
          const isCopied = copiedChar === g.char;
          return (
            <button
              key={g.char}
              className="glyph-cell"
              title={`${g.name} (${g.char})\nClick to insert into text or copy`}
              onClick={() => handleSelectGlyph(g)}
              style={{
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                background: isCopied ? 'rgba(34, 197, 94, 0.2)' : 'var(--surface)',
                border: isCopied ? '1px solid #22c55e' : '1px solid var(--border)',
                borderRadius: 4,
                cursor: 'pointer',
                color: isCopied ? '#22c55e' : 'var(--text)',
                transition: 'all 0.15s ease',
              }}
            >
              {isCopied ? <Check size={14} /> : g.char}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 10, color: 'var(--text-sub)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Copy size={10} />
        <span>Click any glyph to insert into active text or copy to clipboard</span>
      </div>
    </div>
  );
}
