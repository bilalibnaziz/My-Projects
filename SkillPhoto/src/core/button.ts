// Object ▸ Make Button: a label and a shape that hugs it (hug.ts), grouped as one button.
// - a text layer alone gets a new rounded rectangle under it, with padding that suits its size and a
//   label colour that stays readable on the fill;
// - a text + a shape are linked as they are: the label is centred and the padding is what's there now.
// Typing a longer label grows the button; resizing the shape re-centres the label.

import { store } from './store';
import { makeLayer, withLayer } from './types';
import type { Layer } from './types';
import { groupLayers } from './groups';
import { buttonPadding } from './hug';
import { contrastRatio } from './color';

/** True when the selection can become a button: one text, plus at most one shape. */
export function canMakeButton(sel: Layer[] = store.selectedLayers): boolean {
  const texts = sel.filter((l) => l.kind === 'text' && l.text);
  const shapes = sel.filter((l) => l.kind === 'shape' && l.shape);
  return texts.length === 1 && shapes.length <= 1 && texts.length + shapes.length === sel.length && !texts[0].rotation && !shapes[0]?.rotation;
}

export function makeButton(): boolean {
  const doc = store.doc;
  const sel = store.selectedLayers;
  if (!doc || !canMakeButton(sel)) {
    store.toast('Make Button: select one text layer (and optionally the shape to put behind it)');
    return false;
  }
  const text = sel.find((l) => l.kind === 'text')!;
  let shape = sel.find((l) => l.kind === 'shape');
  let layers = [...doc.layers];
  let label = text;
  if (!shape) {
    const t = text.text!;
    const { padX, padY } = buttonPadding(t.size);
    const h = text.height + padY * 2;
    // The fill: the foreground colour unless the label would vanish on it, then the accent blue
    const fg = store.state.fg;
    const fill = contrastRatio(fg, t.color) >= 3 ? fg : contrastRatio('#0078d4', t.color) >= 3 ? '#0078d4' : '#1f1f1f';
    if (contrastRatio(fill, t.color) < 3) label = withLayer(text, { text: { ...t, color: contrastRatio(fill, '#ffffff') >= 3 ? '#ffffff' : '#111111', runs: t.runs?.map(({ color: _c, ...r }) => r) } });
    shape = makeLayer({
      kind: 'shape',
      name: 'Button',
      x: text.x - padX,
      y: text.y - padY,
      width: text.width + padX * 2,
      height: h,
      parent: text.parent,
      shape: { shape: 'rectangle', fill, fillEnabled: true, stroke: '#000000', strokeWidth: 0, radius: Math.round(Math.min(h / 2, t.size * 0.5)) },
      hug: { target: text.id, padX, padY },
    });
    const i = layers.findIndex((l) => l.id === text.id);
    layers.splice(i, 0, shape);
  } else {
    // Link what is there: the label centred, the current margins as padding, the shape under the label
    const padX = Math.max(0, (shape.width - text.width) / 2), padY = Math.max(0, (shape.height - text.height) / 2);
    const linked = withLayer(shape, { hug: { target: text.id, padX, padY } });
    label = withLayer(text, { x: shape.x + (shape.width - text.width) / 2, y: shape.y + (shape.height - text.height) / 2 });
    layers = layers.filter((l) => l.id !== shape!.id);
    layers.splice(layers.findIndex((l) => l.id === text.id), 0, linked);
    shape = linked;
  }
  layers = layers.map((l) => (l.id === label.id ? label : l));
  const g = groupLayers(layers, [shape.id, label.id], `Button · ${text.text!.text.slice(0, 24) || 'Label'}`);
  if (!g) return false;
  store.commit('Make Button', { layers: g.layers, activeId: g.group.id }, { icon: 'shape' });
  store.setSelectedLayers([g.group.id]);
  store.toast('Button made: edit the label and the button grows with it; resize the shape to change its padding', 'success');
  return true;
}

/** Breaks the hug links of the selected buttons (the shapes stay where they are). */
export function releaseButton(): number {
  const doc = store.doc;
  if (!doc) return 0;
  const sel = new Set(store.selectedLayers.map((l) => l.id));
  const hits = doc.layers.filter((l) => l.hug && (sel.has(l.id) || sel.has(l.hug.target) || (l.parent && sel.has(l.parent))));
  if (!hits.length) return 0;
  const ids = new Set(hits.map((l) => l.id));
  store.commit('Release Button', { layers: doc.layers.map((l) => (ids.has(l.id) ? withLayer(l, { hug: undefined }) : l)) });
  return hits.length;
}

/** True when the selection contains (or is inside) a button. */
export const hasButton = () => {
  const doc = store.doc;
  if (!doc) return false;
  const sel = new Set(store.selectedLayers.map((l) => l.id));
  return doc.layers.some((l) => l.hug && (sel.has(l.id) || sel.has(l.hug.target) || (!!l.parent && sel.has(l.parent))));
};
