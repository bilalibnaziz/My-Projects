import { describe, it, expect } from 'vitest';
import { makeLayer } from '../core/types';
import type { Layer } from '../core/types';
import { ancestors, bakeGroupOffsets, childrenOf, descendants, groupLayers, moveTo, normalize, shiftAmongSiblings, shownInDoc, ungroup } from '../core/groups';

const L = (name: string, extra: Partial<Layer> = {}) => makeLayer({ kind: 'raster', name, ...extra });
const G = (name: string, extra: Partial<Layer> = {}) => makeLayer({ kind: 'group', name, ...extra });
const names = (ls: Layer[]) => ls.map((l) => l.name).join(',');

describe('layer groups', () => {
  it('groups layers in place and keeps their order', () => {
    const a = L('a'), b = L('b'), c = L('c'), d = L('d');
    const r = groupLayers([a, b, c, d], [b.id, c.id], 'G')!;
    expect(names(r.layers)).toBe('a,b,c,G,d');
    expect(childrenOf(r.layers, r.group.id).map((l) => l.name)).toEqual(['b', 'c']);
    expect(childrenOf(r.layers, undefined).map((l) => l.name)).toEqual(['a', 'G', 'd']);
  });

  it('gathers non-adjacent layers under the group at the topmost one', () => {
    const a = L('a'), b = L('b'), c = L('c');
    const r = groupLayers([a, b, c], [a.id, c.id], 'G')!;
    expect(names(r.layers)).toBe('b,a,c,G');
  });

  it('nests: grouping a group and a layer', () => {
    const a = L('a'), b = L('b'), c = L('c');
    const r1 = groupLayers([a, b, c], [a.id, b.id], 'Inner')!;
    const r2 = groupLayers(r1.layers, [r1.group.id, c.id], 'Outer')!;
    expect(names(r2.layers)).toBe('a,b,Inner,c,Outer');
    expect(descendants(r2.layers, r2.group.id).map((l) => l.name)).toEqual(['a', 'b', 'Inner', 'c']);
    const aa = r2.layers.find((l) => l.name === 'a')!;
    expect(ancestors(r2.layers, aa).map((g) => g.name)).toEqual(['Inner', 'Outer']);
  });

  it('ungroup moves children up a level', () => {
    const a = L('a'), b = L('b');
    const r = groupLayers([a, b], [a.id, b.id], 'G')!;
    const u = ungroup(r.layers, r.group.id);
    expect(names(u)).toBe('a,b');
    expect(u.every((l) => !l.parent)).toBe(true);
  });

  it('normalize pulls stray children under their group and clears dangling parents', () => {
    const g = G('G');
    const a = L('a', { parent: g.id });
    const x = L('x');
    const orphan = L('o', { parent: 'missing' });
    const out = normalize([a, x, g, orphan]);
    expect(names(out)).toBe('x,a,G,o');
    expect(out.find((l) => l.name === 'o')!.parent).toBeUndefined();
    // Already normal: same array back
    expect(normalize(out)).toBe(out);
  });

  it('moves layers into, above and below groups; a group moves with its contents', () => {
    const a = L('a'), b = L('b'), c = L('c');
    const r = groupLayers([a, b, c], [a.id, b.id], 'G')!;
    const g = r.group;
    const into = moveTo(r.layers, c.id, g.id, 'into');
    expect(names(into)).toBe('a,b,c,G');
    expect(childrenOf(into, g.id).map((l) => l.name)).toEqual(['a', 'b', 'c']);
    const out = moveTo(into, a.id, g.id, 'above');
    expect(names(out)).toBe('b,c,G,a');
    expect(out.find((l) => l.name === 'a')!.parent).toBeUndefined();
    const groupDown = moveTo(out, g.id, a.id, 'above');
    expect(names(groupDown)).toBe('a,b,c,G');
    // A group can't be dropped into itself
    const bb = groupDown.find((l) => l.name === 'b')!;
    expect(moveTo(groupDown, g.id, bb.id, 'above')).toBe(groupDown);
  });

  it('bring forward / send backward step among siblings', () => {
    const a = L('a'), b = L('b'), c = L('c');
    const r = groupLayers([a, b, c], [a.id, b.id], 'G')!;
    expect(names(shiftAmongSiblings(r.layers, c.id, -1))).toBe('c,a,b,G');
    expect(names(shiftAmongSiblings(r.layers, a.id, 1))).toBe('b,a,G,c');
    expect(shiftAmongSiblings(r.layers, b.id, 1)).toBe(r.layers); // already top of its group
  });

  it('bakes a dragged group offset into its contents (positions and masks)', () => {
    const g = G('G', { x: 10, y: -5 });
    const mask = { canvas: {} as HTMLCanvasElement, x: 1, y: 2, enabled: true };
    const a = L('a', { parent: g.id, x: 3, y: 4, mask });
    const out = bakeGroupOffsets([a, g]);
    const a2 = out.find((l) => l.name === 'a')!;
    expect([a2.x, a2.y, a2.mask!.x, a2.mask!.y]).toEqual([13, -1, 11, -3]);
    expect(out.find((l) => l.name === 'G')!.x).toBe(0);
  });

  it('a hidden group hides its contents', () => {
    const g = G('G', { visible: false });
    const a = L('a', { parent: g.id });
    expect(shownInDoc([a, g], a)).toBe(false);
  });
});
