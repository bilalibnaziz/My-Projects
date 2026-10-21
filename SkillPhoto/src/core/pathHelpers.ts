// Path helpers shared with Skill Vector's vectorTools.ts (sub-paths in document space).
import type { Layer, PathAnchor, ShapeProps } from './types';
import { withLayer } from './types';
import { convertToEditablePath, type DocAnchor } from './vectorOps';

export const isEditableShape = (l: Layer | null | undefined): l is Layer => !!l && l.kind === 'shape' && !!l.shape && !l.locked && l.visible;

/** Every sub-path of a shape layer in document space (live rotation baked in). */
export function docSubpaths(l: Layer): { layer: Layer; subs: DocAnchor[][]; closed: boolean } {
  const layer = convertToEditablePath(l);
  const s = layer.shape!;
  const lists = s.compoundPoints?.length ? s.compoundPoints : [s.points ?? []];
  const map = (p: PathAnchor): DocAnchor => ({
    x: layer.x + p.x * layer.width,
    y: layer.y + p.y * layer.height,
    ix: layer.x + p.ix * layer.width,
    iy: layer.y + p.iy * layer.height,
    ox: layer.x + p.ox * layer.width,
    oy: layer.y + p.oy * layer.height,
  });
  return { layer, subs: lists.map((ps) => ps.map(map)).filter((ps) => ps.length > 0), closed: !!s.closed };
}

/** `like` with new sub-paths (document space); keeps its id, style and settings. */
export function withDocSubpaths(like: Layer, subs: PathAnchor[][], closed: boolean, extra: Partial<ShapeProps> = {}): Layer {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sub of subs) {
    for (const a of sub) {
      minX = Math.min(minX, a.x, a.ix, a.ox);
      minY = Math.min(minY, a.y, a.iy, a.oy);
      maxX = Math.max(maxX, a.x, a.ix, a.ox);
      maxY = Math.max(maxY, a.y, a.iy, a.oy);
    }
  }
  const W = Math.max(1, maxX - minX);
  const H = Math.max(1, maxY - minY);
  const norm = (a: PathAnchor): PathAnchor => ({
    ...a,
    x: (a.x - minX) / W,
    y: (a.y - minY) / H,
    ix: (a.ix - minX) / W,
    iy: (a.iy - minY) / H,
    ox: (a.ox - minX) / W,
    oy: (a.oy - minY) / H,
  });
  const pts = subs.map((s) => s.map(norm));
  return withLayer(like, {
    x: minX,
    y: minY,
    width: W,
    height: H,
    rotation: 0,
    shape: { ...like.shape!, ...extra, shape: 'path', points: pts[0] ?? [], compoundPoints: pts.length > 1 ? pts : undefined, closed },
  });
}
