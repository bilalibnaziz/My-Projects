// Looks panel: every look previewed on your own photo, one click to apply (as a non-destructive look
// layer), intensity, hold-to-compare, favourites, and premium tools to make looks: Match Look from a
// reference photo, save your adjustments as a look, import / export .cube, apply to all open photos.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, Heart, Images, Palette, Save, Search, SlidersHorizontal, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import { store, useStore } from '../core/store';
import { LOOKS, LOOK_CATEGORIES, applyLutToPixels, bakeLook, type LookCategory } from '../core/looks';
import { decodeLut, type Lut3D } from '../core/lut';
import {
  applyBuiltinLook, applyLook, applyLookToAllDocs, currentLookLayer, deleteMyLook, exportLookCube, importCubeLooks, isLookLayer,
  loadFavorites, loadMyLooks, matchLookFromFile, resampleLut, saveAdjustmentsAsLook, setLookAmount, toggleFavorite, type MyLook,
} from '../core/lookOps';
import { pickFiles } from '../core/io';
import { withLayer } from '../core/types';
import { ctx2d } from '../core/canvas';
import { Slider } from './widgets';
import { LookEditor } from './LookEditor';
import { useDeferredSource } from './useDeferredSource';
import { editLook, photoProfile, pickLooks } from '../core/lookStudio';

type Filter = 'For this photo' | 'All' | 'Favorites' | 'My Looks' | LookCategory;

interface Tile {
  id: string;
  name: string;
  category: string;
  description: string;
  lut: () => Lut3D;
  apply: () => void;
  mine?: MyLook;
}

// LUTs for thumbnails are small (17³) and kept for the session
const thumbLuts = new Map<string, Lut3D>();
const thumbLut = (id: string, make: () => Lut3D) => {
  let l = thumbLuts.get(id);
  if (!l) {
    l = make();
    thumbLuts.set(id, l);
  }
  return l;
};

export function LooksPanel() {
  const s = useStore();
  const doc = s.docs.find((d) => d.id === s.activeDocId) ?? null;
  const [filter, setFilter] = useState<Filter>('All');
  const [query, setQuery] = useState('');
  const [fav, setFav] = useState(loadFavorites);
  const [mine, setMine] = useState(loadMyLooks);
  const [thumbs, setThumbs] = useState<Map<string, ImageData>>(new Map());
  const [matchStrength, setMatchStrength] = useState(100);
  const look = currentLookLayer(doc);

  const tiles: Tile[] = useMemo(() => {
    const mineTiles: Tile[] = mine.map((m) => ({
      id: m.id,
      name: m.name,
      category: 'My Looks',
      description: m.source === 'match' ? 'Matched to a reference photo' : m.source === 'cube' ? 'Imported .cube' : m.source === 'custom' ? 'Your edited look' : 'Saved from your adjustments',
      lut: () => thumbLut(m.id, () => resampleLut({ size: m.size, data: decodeLut(m.data, m.size) }, 17)),
      apply: () => applyLook(m),
      mine: m,
    }));
    const lib: Tile[] = LOOKS.map((l) => ({
      id: l.id,
      name: l.name,
      category: l.category,
      description: l.description,
      lut: () => thumbLut(l.id, () => bakeLook(l.recipe, 17)),
      apply: () => applyBuiltinLook(l.id),
    }));
    return [...mineTiles, ...lib];
  }, [mine]);

  const shownBase = (pickIds: Set<string>) => tiles.filter((t) => {
    if (filter === 'For this photo' && !pickIds.has(t.id)) return false;
    if (filter === 'Favorites' && !fav.has(t.id)) return false;
    if (filter === 'My Looks' && !t.mine) return false;
    if (filter !== 'All' && filter !== 'For this photo' && filter !== 'Favorites' && filter !== 'My Looks' && t.category !== filter) return false;
    const q = query.trim().toLowerCase();
    return !q || `${t.name} ${t.category} ${t.description}`.toLowerCase().includes(q);
  });

  // The photo under the looks, small, rebuilt only when something other than a look layer changes
  const sourceKey = doc ? `${doc.id}:${doc.width}x${doc.height}:${doc.layers.filter((l) => !isLookLayer(l)).map((l) => `${l.id}.${l.v}.${l.visible ? 1 : 0}`).join(',')}` : '';
  // Made once editing pauses, so painting or dragging with this panel open stays smooth
  const sourceCanvas = useDeferredSource(sourceKey, 132);
  const source = useMemo(() => (sourceCanvas ? ctx2d(sourceCanvas).getImageData(0, 0, sourceCanvas.width, sourceCanvas.height) : null), [sourceCanvas]);

  // Looks that fit this photo's colours (food, skin, greenery and sky, low light…)
  const picks = useMemo(() => (source ? pickLooks(photoProfile(source.data, 1), 10) : []), [source]);
  const pickWhy = new Map(picks.map((p) => [p.look.id, p.why]));
  const [editing, setEditing] = useState(false);
  const shown =
    filter === 'For this photo'
      ? picks.map((p) => tiles.find((t) => t.id === p.look.id)).filter((t): t is Tile => !!t).map((t) => ({ ...t, description: `Fits this photo: ${pickWhy.get(t.id)} — ${t.description}` }))
      : shownBase(new Set());

  // Thumbnails are made a few at a time so the panel opens instantly
  const shownIds = shown.map((t) => t.id).join('|');
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    const done = new Map<string, ImageData>();
    const queue = shown.slice();
    setThumbs(new Map());
    const step = () => {
      if (cancelled) return;
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 12) {
        const t = queue.shift()!;
        const img = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height, { colorSpace: source.colorSpace });
        applyLutToPixels(img.data, t.lut());
        done.set(t.id, img);
      }
      setThumbs(new Map(done));
      if (queue.length) setTimeout(step, 0);
    };
    const id = setTimeout(step, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [source, shownIds]);

  if (!doc) return <div className="looks-panel"><div className="hint">Open a photo to try looks on it.</div></div>;

  const activeName = look?.adjust?.lut?.name;
  const compare = (on: boolean) => {
    const d = store.doc;
    const cur = currentLookLayer(d);
    if (!d || !cur) return;
    // withLayer bumps the layer version so the renderer redraws it
    store.live({ layers: d.layers.map((l) => (l.id === cur.id ? withLayer(l, { visible: !on }) : l)) });
  };

  return (
    <div className="looks-panel">
      {look && (
        <div className="looks-current">
          <div className="looks-current-row">
            <span className="looks-current-name" title={activeName}>{activeName}</span>
            <button
              className="btn ghost looks-compare"
              title="Hold to see the photo without the look"
              onPointerDown={() => compare(true)}
              onPointerUp={() => compare(false)}
              onPointerLeave={() => compare(false)}
            >
              <Eye size={13} /> Before
            </button>
          </div>
          <Slider label="Intensity" value={look.adjust!.lut!.amount} min={0} max={100} def={100} unit="%" onChange={setLookAmount} />
          <div className="looks-current-row">
            <button className="btn ghost" title="Export as a .cube LUT for video and other apps" onClick={() => exportLookCube(look.adjust!.lut!)}>
              <Download size={13} /> .cube
            </button>
            <button className="btn ghost" title="Add this look to every other open photo" onClick={() => applyLookToAllDocs()}>
              <Images size={13} /> All photos
            </button>
            <button className={`btn ghost ${editing ? 'active' : ''}`} title="Fine-tune this look: brightness, warmth, fade, split toning, per-colour…" onClick={() => setEditing(!editing)}>
              <SlidersHorizontal size={13} /> Edit
            </button>
            <button className="btn ghost" title="Start a second look on top of this one" onClick={() => store.selectLayer(doc.layers.find((l) => !isLookLayer(l))?.id ?? doc.activeId)}>
              + Stack
            </button>
          </div>
        </div>
      )}

      {editing && <LookEditor onSaved={() => setMine(loadMyLooks())} />}

      <div className="looks-search">
        <Search size={13} />
        <input placeholder={`Search ${tiles.length} looks…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="looks-chips">
        {(['For this photo', 'All', 'Favorites', 'My Looks', ...LOOK_CATEGORIES] as Filter[]).map((c) => (
          <button key={c} className={`looks-chip ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>
            {c === 'Favorites' ? <Heart size={10} /> : c === 'For this photo' ? <Sparkles size={10} /> : null}
            {c}
          </button>
        ))}
      </div>

      <div className="looks-grid">
        {shown.map((t) => (
          <LookTile
            key={t.id}
            tile={t}
            img={thumbs.get(t.id)}
            active={activeName === t.name}
            favorite={fav.has(t.id)}
            onFavorite={() => setFav(new Set(toggleFavorite(t.id)))}
            onDelete={t.mine ? () => { deleteMyLook(t.mine!.id); setMine(loadMyLooks()); } : undefined}
          />
        ))}
        {!shown.length && <div className="hint looks-empty">{filter === 'Favorites' ? 'Tap the heart on a look to keep it here.' : filter === 'My Looks' ? 'Make your own looks below.' : 'No looks match.'}</div>}
      </div>

      <div className="mini-title">Create looks</div>
      <div className="looks-create">
        <button
          className="btn"
          title="Build a look from scratch with sliders, then save it to My Looks"
          onClick={() => {
            if (!look) editLook({});
            setEditing(true);
          }}
        >
          <SlidersHorizontal size={13} /> New Custom Look
        </button>
        <button
          className="btn"
          title="Pick a photo whose colours you love: this photo gets its tone, cast and contrast"
          onClick={async () => {
            const [f] = await pickFiles(undefined, false);
            if (!f) return;
            await store.task('Matching look', () => matchLookFromFile(f, matchStrength / 100));
            setMine(loadMyLooks());
          }}
        >
          <Wand2 size={13} /> Match Look…
        </button>
        <Slider label="Match strength" value={matchStrength} min={10} max={100} def={100} unit="%" onChange={setMatchStrength} />
        <button
          className="btn"
          title="Select an adjustment layer (curves, HSL, colour grading…) and keep its colour as a reusable look"
          onClick={() => {
            if (saveAdjustmentsAsLook()) setMine(loadMyLooks());
          }}
        >
          <Save size={13} /> Save Adjustments as Look
        </button>
        <button
          className="btn"
          title="Add .cube LUTs from other apps to My Looks"
          onClick={async () => {
            const files = await pickFiles('.cube', true);
            if (files.length && (await importCubeLooks(files))) setMine(loadMyLooks());
          }}
        >
          <Upload size={13} /> Import .cube…
        </button>
      </div>
    </div>
  );
}

function LookTile({ tile, img, active, favorite, onFavorite, onDelete }: { tile: Tile; img?: ImageData; active: boolean; favorite: boolean; onFavorite: () => void; onDelete?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !img) return;
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [img]);
  return (
    <div className={`look-tile ${active ? 'active' : ''}`} title={`${tile.name} — ${tile.description}`} data-look={tile.id}>
      <button className="look-thumb" onClick={tile.apply}>
        {img ? <canvas ref={ref} /> : <span className="look-placeholder"><Palette size={14} /></span>}
      </button>
      <div className="look-meta">
        <span className="look-name">{tile.name}</span>
        <button className={`look-fav ${favorite ? 'on' : ''}`} title={favorite ? 'Remove from favourites' : 'Add to favourites'} onClick={onFavorite}>
          <Heart size={11} />
        </button>
        {onDelete && (
          <button className="look-fav" title="Delete this look" onClick={onDelete}>
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
