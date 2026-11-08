// Layer groups. The document keeps one flat, bottom-to-top layer array; a layer's `parent` names
// the group it belongs to. `normalize` keeps every group's descendants as a contiguous block
// directly below the group record, so the flat array always reads as a depth-first tree.

import type { Layer } from './types';
import { makeLayer, withLayer } from './types';

export const isGroup = (l: Layer | null | undefined): boolean => !!l && l.kind === 'group';

function byId(layers: Layer[]): Map<string, Layer> {
  return new Map(layers.map((l) => [l.id, l]));
}

/** The layer's parent id, or undefined when it is top-level (or its group no longer exists). */
export function parentOf(layers: Layer[] | Map<string, Layer>, l: Layer): string | undefined {
  if (!l.parent) return undefined;
  const map = layers instanceof Map ? layers : byId(layers);
  return isGroup(map.get(l.parent)) ? l.parent : undefined;
}

/** Groups containing `l`, innermost first. */
export function ancestors(layers: Layer[], l: Layer): Layer[] {
  const map = byId(layers);
  const out: Layer[] = [];
  const seen = new Set<string>();
  let p = parentOf(map, l);
  while (p && !seen.has(p)) {
    seen.add(p);
    const g = map.get(p)!;
    out.push(g);
    p = parentOf(map, g);
  }
  return out;
}

export function depthOf(layers: Layer[], l: Layer): number {
  return ancestors(layers, l).length;
}

/** Visible itself and inside visible groups. */
export function shownInDoc(layers: Layer[], l: Layer): boolean {
  return l.visible && ancestors(layers, l).every((g) => g.visible);
}

/** Direct children of `parentId` (undefined = top level), bottom to top. */
export function childrenOf(layers: Layer[], parentId: string | undefined): Layer[] {
  const map = byId(layers);
  return layers.filter((l) => parentOf(map, l) === parentId);
}

/** Every layer inside the group, at any depth, bottom to top. */
export function descendants(layers: Layer[], groupId: string): Layer[] {
  const map = byId(layers);
  return layers.filter((l) => {
    const seen = new Set<string>();
    let p = parentOf(map, l);
    while (p && !seen.has(p)) {
      if (p === groupId) return true;
      seen.add(p);
      p = parentOf(map, map.get(p)!);
    }
    return false;
  });
}

/** The layer plus, for a group, everything inside it. */
export function blockOf(layers: Layer[], l: Layer): Layer[] {
  return isGroup(l) ? [...descendants(layers, l.id), l] : [l];
}

/**
 * Reorders the array depth-first (children directly below their group, keeping their relative
 * order) and clears dangling parent ids. Returns the input array when nothing changes.
 */
export function normalize(layers: Layer[]): Layer[] {
  if (!layers.some((l) => l.parent || l.kind === 'group')) return layers;
  const map = byId(layers);
  const fixed = layers.map((l) => (l.parent && parentOf(map, l) === undefined ? withLayer(l, { parent: undefined }) : l));
  const kids = new Map<string | undefined, Layer[]>();
  const fmap = byId(fixed);
  for (const l of fixed) {
    const p = parentOf(fmap, l);
    const list = kids.get(p) ?? [];
    list.push(l);
    kids.set(p, list);
  }
  const out: Layer[] = [];
  const seen = new Set<string>();
  const emit = (l: Layer) => {
    if (seen.has(l.id)) return;
    seen.add(l.id);
    if (isGroup(l)) for (const c of kids.get(l.id) ?? []) emit(c);
    out.push(l);
  };
  for (const l of kids.get(undefined) ?? []) emit(l);
  // Anything unreachable (a parent cycle) is kept at the top level
  for (const l of fixed) if (!seen.has(l.id)) out.push(withLayer(l, { parent: undefined }));
  const same = out.length === layers.length && out.every((l, i) => l === layers[i]);
  return same ? layers : out;
}

/** Wraps the given layers (and the contents of any groups among them) in a new group. */
export function groupLayers(layers: Layer[], ids: string[], name: string): { layers: Layer[]; group: Layer } | null {
  const map = byId(layers);
  const picked = layers.filter((l) => ids.includes(l.id));
  if (!picked.length) return null;
  // Only the outermost picked layers move: a picked layer inside a picked group stays put
  const pickedIds = new Set(picked.map((l) => l.id));
  const roots = picked.filter((l) => !ancestors(layers, l).some((a) => pickedIds.has(a.id)));
  const top = roots[roots.length - 1];
  // The new group lives where the topmost picked layer was
  const parent = parentOf(map, top);
  const group = makeLayer({ kind: 'group', name, parent, blend: 'pass-through' }); // Photoshop's default
  const rootIds = new Set(roots.map((l) => l.id));
  const out: Layer[] = [];
  for (const l of layers) {
    if (rootIds.has(l.id)) out.push(withLayer(l, { parent: group.id }));
    else out.push(l);
    if (l.id === top.id) out.push(group);
  }
  return { layers: normalize(out), group };
}

/** Removes a group, moving its direct children up one level. */
export function ungroup(layers: Layer[], groupId: string): Layer[] {
  const map = byId(layers);
  const g = map.get(groupId);
  if (!g || !isGroup(g)) return layers;
  const up = parentOf(map, g);
  return normalize(layers.filter((l) => l.id !== groupId).map((l) => (l.parent === groupId ? withLayer(l, { parent: up }) : l)));
}

export type DropWhere = 'above' | 'below' | 'into';

/** Moves a layer (with its contents, for a group) next to or into `targetId`. */
export function moveTo(layers: Layer[], id: string, targetId: string, where: DropWhere): Layer[] {
  const map = byId(layers);
  const l = map.get(id);
  const target = map.get(targetId);
  if (!l || !target || id === targetId) return layers;
  // A group can't move into itself
  if (isGroup(l) && (target.id === l.id || ancestors(layers, target).some((a) => a.id === l.id))) return layers;
  const block = blockOf(layers, l);
  const blockIds = new Set(block.map((b) => b.id));
  const rest = layers.filter((x) => !blockIds.has(x.id));
  const newParent = where === 'into' ? target.id : parentOf(map, target);
  const moved = block.map((b) => (b.id === id ? withLayer(b, { parent: newParent }) : b));
  let at: number;
  if (where === 'above' || where === 'into') {
    // Above a group means above its whole block; into a group means its top child
    at = rest.findIndex((x) => x.id === targetId) + (where === 'above' ? 1 : 0);
  } else {
    const tBlock = blockOf(rest, target);
    at = rest.findIndex((x) => x.id === tBlock[0].id);
  }
  const out = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  return normalize(out);
}

/** Moves a layer one step up (+1) or down (−1) among its siblings. */
export function shiftAmongSiblings(layers: Layer[], id: string, dir: 1 | -1): Layer[] {
  const map = byId(layers);
  const l = map.get(id);
  if (!l) return layers;
  const sibs = childrenOf(layers, parentOf(map, l));
  const i = sibs.findIndex((s) => s.id === id);
  const other = sibs[i + dir];
  if (!other) return layers;
  return moveTo(layers, id, other.id, dir === 1 ? 'above' : 'below');
}

/**
 * A group's x / y is a pending translation of its contents (set while dragging or aligning a
 * group, so the composited group is simply drawn offset). This bakes it into every layer inside
 * — positions and masks — and resets the group to 0, 0.
 */
export function bakeGroupOffsets(layers: Layer[]): Layer[] {
  const moved = layers.filter((l) => isGroup(l) && (l.x || l.y));
  if (!moved.length) return layers;
  const delta = new Map<string, { dx: number; dy: number }>();
  for (const g of moved) {
    for (const d of descendants(layers, g.id)) {
      if (isGroup(d)) continue;
      const cur = delta.get(d.id) ?? { dx: 0, dy: 0 };
      delta.set(d.id, { dx: cur.dx + g.x, dy: cur.dy + g.y });
    }
  }
  return layers.map((l) => {
    if (isGroup(l) && (l.x || l.y)) return withLayer(l, { x: 0, y: 0 });
    const d = delta.get(l.id);
    if (!d) return l;
    return withLayer(l, {
      x: l.x + d.dx,
      y: l.y + d.dy,
      mask: l.mask ? { ...l.mask, x: l.mask.x + d.dx, y: l.mask.y + d.dy } : undefined,
    });
  });
}
