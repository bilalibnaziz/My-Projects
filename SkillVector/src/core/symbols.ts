/**
 * Symbols (Window ▸ Symbols): reusable artwork kept in the document. A symbol instance is a shape layer
 * whose `symbol` names a definition; Redefine updates every instance, keeping what was done to each one
 * (position, size, rotation, opacity, styles, and a colour changed by the Symbol Stainer).
 */
import type { Doc, Layer, ShapeProps, SymbolDef } from './types';
import { makeLayer, uid, withLayer } from './types';
import { store } from './store';
import { convertToEditablePath } from './vectorOps';

/** Built-in symbol, used by the Symbol Sprayer until the document has its own. */
export const BUILTIN_SYMBOLS: SymbolDef[] = [
  { id: 'star', name: 'Star', width: 28, height: 28, shape: { shape: 'star', fill: '#f5b301', fillEnabled: true, stroke: '#000000', strokeWidth: 1, radius: 0, sides: 5 } },
];

/** The document's symbols, then the built-ins. */
export const allSymbols = (doc: Doc | null | undefined): SymbolDef[] => [...(doc?.symbols ?? []), ...BUILTIN_SYMBOLS];

export const symbolById = (doc: Doc | null | undefined, id: string | undefined): SymbolDef | undefined => allSymbols(doc).find((s) => s.id === id);

/** The symbol the Symbol Sprayer uses: the chosen one, else the newest document symbol, else the star. */
export function currentSymbol(): SymbolDef {
  const doc = store.doc;
  return symbolById(doc, store.state.opts.symbolId) ?? doc?.symbols?.[doc.symbols.length - 1] ?? BUILTIN_SYMBOLS[0];
}

/** A new instance of `def` with its centre at (cx, cy), `scale` × its natural size. */
export function instanceOf(def: SymbolDef, cx: number, cy: number, scale = 1, extra: Partial<Layer> = {}): Layer {
  const w = def.width * scale;
  const h = def.height * scale;
  return makeLayer({ kind: 'shape', name: def.name, symbol: def.id, shape: { ...def.shape }, x: cx - w / 2, y: cy - h / 2, width: w, height: h, ...extra });
}

const uniqueName = (doc: Doc, base: string) => {
  const names = new Set(allSymbols(doc).map((s) => s.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
};

/** Symbol definition from a shape layer (live rotation baked into the outline), with that flattened layer. */
function defFrom(l: Layer, id: string, name: string): { def: SymbolDef; flat: Layer } {
  const flat = l.rotation ? convertToEditablePath(l) : l;
  return { def: { id, name, shape: { ...flat.shape! }, width: Math.max(1, flat.width), height: Math.max(1, flat.height) }, flat };
}

/** The layer as an instance of `def`, in the flattened layer's box. */
const asInstance = (l: Layer, def: SymbolDef, flat: Layer, shape: ShapeProps = { ...def.shape }) =>
  withLayer(l, { symbol: def.id, name: def.name, shape, rotation: undefined, x: flat.x, y: flat.y, width: def.width, height: def.height });

/** New Symbol: turns the selected shape into a symbol, and the shape into its first instance. */
export function newSymbolFromSelection(): SymbolDef | null {
  const doc = store.doc;
  const l = store.activeLayer;
  if (!doc || !l || l.kind !== 'shape' || !l.shape) {
    store.toast('New Symbol: select a shape first');
    return null;
  }
  const { def, flat } = defFrom(l, uid('sym'), uniqueName(doc, l.symbol ? `${l.name} copy` : l.name || 'Symbol'));
  doc.symbols = [...(doc.symbols ?? []), def];
  const inst = asInstance(l, def, flat);
  store.setOpts({ symbolId: def.id });
  store.commit('New Symbol', { layers: doc.layers.map((x) => (x.id === l.id ? inst : x)) });
  return def;
}

/** Places an instance of the symbol in the middle of the view (or at a point). */
export function placeSymbol(id: string, at?: { x: number; y: number }): Layer | null {
  const doc = store.doc;
  const def = symbolById(doc, id);
  if (!doc || !def) return null;
  const v = doc.view;
  const view = document.querySelector('.viewport-canvas')?.getBoundingClientRect();
  const c = at ?? (view ? { x: (view.width / 2 - v.panX) / v.zoom, y: (view.height / 2 - v.panY) / v.zoom } : { x: doc.width / 2, y: doc.height / 2 });
  const inst = instanceOf(def, c.x, c.y);
  store.insertLayer(inst, undefined, `Place ${def.name}`);
  return inst;
}

/**
 * Redefine Symbol: the selected instance's current artwork becomes the definition and every instance
 * follows. Instances keep their box, rotation, opacity and styles; a fill the Stainer changed stays.
 */
export function redefineSymbol(): boolean {
  const doc = store.doc;
  const l = store.activeLayer;
  const old = doc?.symbols?.find((s) => s.id === l?.symbol);
  if (!doc || !l?.shape || !old) {
    store.toast('Redefine Symbol: select an instance of a document symbol');
    return false;
  }
  const { def, flat } = defFrom(l, old.id, old.name);
  doc.symbols = doc.symbols!.map((s) => (s.id === def.id ? def : s));
  const layers = doc.layers.map((x) => {
    if (x.symbol !== def.id || !x.shape) return x;
    const stained = x.id !== l.id && x.shape.fill !== old.shape.fill;
    const shape: ShapeProps = { ...def.shape, fill: stained ? x.shape.fill : def.shape.fill };
    // The edited instance keeps its place; the others keep their size relative to the old artwork
    if (x.id === l.id) return asInstance(x, def, flat, shape);
    const k = Math.min(x.width / old.width, x.height / old.height);
    const w = def.width * k;
    const h = def.height * k;
    return withLayer(x, { shape, x: x.x + (x.width - w) / 2, y: x.y + (x.height - h) / 2, width: w, height: h });
  });
  store.commit('Redefine Symbol', { layers });
  return true;
}

/** Break Link to Symbol: the selected instances become ordinary shapes. */
export function breakSymbolLink(): number {
  const doc = store.doc;
  if (!doc) return 0;
  const ids = new Set(store.selectedLayers.filter((l) => l.symbol).map((l) => l.id));
  if (!ids.size) return 0;
  store.commit('Break Link to Symbol', { layers: doc.layers.map((l) => (ids.has(l.id) ? withLayer(l, { symbol: undefined }) : l)) });
  return ids.size;
}

/** Deletes a document symbol; its instances stay as ordinary shapes. */
export function deleteSymbol(id: string): boolean {
  const doc = store.doc;
  if (!doc?.symbols?.some((s) => s.id === id)) return false;
  doc.symbols = doc.symbols.filter((s) => s.id !== id);
  if (store.state.opts.symbolId === id) store.setOpts({ symbolId: undefined });
  store.commit('Delete Symbol', { layers: doc.layers.map((l) => (l.symbol === id ? withLayer(l, { symbol: undefined }) : l)) });
  return true;
}

export function renameSymbol(id: string, name: string): boolean {
  const doc = store.doc;
  const def = doc?.symbols?.find((s) => s.id === id);
  if (!doc || !def || !name.trim()) return false;
  doc.symbols = doc.symbols!.map((s) => (s.id === id ? { ...s, name: name.trim() } : s));
  store.commit('Rename Symbol', { layers: doc.layers.map((l) => (l.symbol === id ? withLayer(l, { name: name.trim() }) : l)) });
  return true;
}

/** Select All Instances of a symbol. */
export function selectInstances(id: string): number {
  const doc = store.doc;
  const ids = doc?.layers.filter((l) => l.symbol === id && l.visible && !l.locked).map((l) => l.id) ?? [];
  if (ids.length) store.setSelectedLayers(ids);
  return ids.length;
}

export const instanceCount = (doc: Doc | null | undefined, id: string) => doc?.layers.filter((l) => l.symbol === id).length ?? 0;
