/**
 * Graph tools in the document: builds a graph group of editable shapes and text from a GraphSpec
 * (graphs.ts), and rebuilds it when its data changes (Object ▸ Graph ▸ Data…).
 */
import type { Layer, PathAnchor, TextProps } from './types';
import { makeLayer, withLayer } from './types';
import { descendants, groupLayers } from './groups';
import { syncTextBounds } from './render';
import { store } from './store';
import { buildGraph, GRAPH_TYPES, SAMPLE_GRAPH_DATA } from './graphs';
import type { GraphAnchor, GraphPrim, GraphSpec, GraphType } from './graphs';

export type GraphBox = { x: number; y: number; w: number; h: number };

/** Graph type of a rail tool id ('graph-stacked-bar' → 'stacked-bar'). */
export const graphTypeOfTool = (tool: string): GraphType => (tool.replace(/^graph-/, '') as GraphType) || 'column';

const label = (t: GraphType) => GRAPH_TYPES.find((g) => g.id === t)?.label ?? 'Column';

// The data and options of the last graph made, offered for the next one
let last: GraphSpec = { type: 'column', data: SAMPLE_GRAPH_DATA, legend: true, axis: true };
export const lastGraphSpec = (): GraphSpec => ({ ...last });

function pathLayer(p: Extract<GraphPrim, { kind: 'path' }>): Layer {
  const xs = p.pts.flatMap((a) => [a.x, a.ix ?? a.x, a.ox ?? a.x]);
  const ys = p.pts.flatMap((a) => [a.y, a.iy ?? a.y, a.oy ?? a.y]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const W = Math.max(1, Math.max(...xs) - minX);
  const H = Math.max(1, Math.max(...ys) - minY);
  const nx = (v: number) => (v - minX) / W;
  const ny = (v: number) => (v - minY) / H;
  const anchor = (a: GraphAnchor): PathAnchor => {
    const curved = a.ix !== undefined || a.ox !== undefined;
    return { x: nx(a.x), y: ny(a.y), ix: nx(a.ix ?? a.x), iy: ny(a.iy ?? a.y), ox: nx(a.ox ?? a.x), oy: ny(a.oy ?? a.y), type: curved ? 'smooth' : 'corner' };
  };
  return makeLayer({
    kind: 'shape',
    name: p.name,
    x: minX,
    y: minY,
    width: W,
    height: H,
    opacity: p.opacity ?? 1,
    shape: {
      shape: 'path',
      points: p.pts.map(anchor),
      closed: p.closed,
      fill: p.fill ?? '#000000',
      fillEnabled: !!p.fill && p.closed,
      stroke: p.stroke ?? '#000000',
      strokeWidth: p.stroke ? (p.strokeWidth ?? 1) : 0,
      radius: 0,
      strokeJoin: 'round',
      strokeCap: p.closed ? undefined : 'butt',
    },
  });
}

function textLayer(p: Extract<GraphPrim, { kind: 'text' }>): Layer {
  const text: TextProps = {
    text: p.text,
    font: store.state.opts.font,
    size: p.size,
    weight: 400,
    italic: false,
    color: p.color,
    align: p.align,
    lineHeight: 1.2,
    tracking: 0,
    shadow: false,
    stroke: 0,
    strokeColor: '#000000',
  };
  const l = makeLayer({ kind: 'text', name: p.name, text, x: p.x, y: p.y });
  const { width, height } = syncTextBounds(l);
  // (x, y) is the anchor point: left/centre/right edge, vertically centred
  const x = p.align === 'center' ? p.x - width / 2 : p.align === 'right' ? p.x - width : p.x;
  return withLayer(l, { width, height, x, y: p.y - height / 2 });
}

/** Turns graph primitives into layers, bottom first (grid and axes under the data, labels on top). */
export function graphLayers(prims: GraphPrim[]): Layer[] {
  const order: Record<string, number> = { grid: 0, axis: 1, data: 2, legend: 3, label: 4 };
  return [...prims]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => order[a.p.role] - order[b.p.role] || (a.p.kind === 'text' ? 1 : 0) - (b.p.kind === 'text' ? 1 : 0) || a.i - b.i)
    .map(({ p }) => {
      if (p.kind === 'rect') {
        return makeLayer({
          kind: 'shape',
          name: p.name,
          x: p.x,
          y: p.y,
          width: p.w,
          height: p.h,
          shape: { shape: 'rectangle', fill: p.fill, fillEnabled: true, stroke: '#000000', strokeWidth: 0, radius: 0 },
        });
      }
      return p.kind === 'path' ? pathLayer(p) : textLayer(p);
    });
}

/** Builds the graph as a new group. Returns the group, or null when the data has nothing to plot. */
export function insertGraph(spec: GraphSpec, box: GraphBox): Layer | null {
  const doc = store.doc;
  if (!doc) return null;
  last = { ...spec };
  const parts = graphLayers(buildGraph(spec, box));
  if (!parts.some((l) => l.kind === 'shape')) {
    store.toast('Graph: the data has no numbers to plot');
    return null;
  }
  // New graphs go above the active layer
  const at = doc.layers.findIndex((l) => l.id === doc.activeId);
  const layers = [...doc.layers];
  layers.splice(at < 0 ? layers.length : at + 1, 0, ...parts);
  const grouped = groupLayers(layers, parts.map((l) => l.id), `${label(spec.type)} Graph`);
  if (!grouped) return null;
  const group = withLayer(grouped.group, { graph: { ...spec, box } });
  store.commit(`New ${label(spec.type)} Graph`, { layers: grouped.layers.map((l) => (l.id === group.id ? group : l)), activeId: group.id }, { icon: 'shape' });
  return group;
}

/** The graph group the layer belongs to (itself, or its nearest graph ancestor). */
export function graphGroupOf(layer: Layer | null | undefined): Layer | null {
  const doc = store.doc;
  let l = layer;
  const seen = new Set<string>();
  while (doc && l && !seen.has(l.id)) {
    if (l.graph) return l;
    seen.add(l.id);
    const parent = l.parent;
    l = parent ? doc.layers.find((q) => q.id === parent) : undefined;
  }
  return null;
}

/** Rebuilds a graph group with new settings, in place (same group, same position in the stack). */
export function updateGraph(groupId: string, spec: GraphSpec): boolean {
  const doc = store.doc;
  const group = doc?.layers.find((l) => l.id === groupId);
  if (!doc || !group?.graph) return false;
  const box = group.graph.box;
  const parts = graphLayers(buildGraph(spec, box)).map((l) => withLayer(l, { parent: group.id }));
  if (!parts.some((l) => l.kind === 'shape')) {
    store.toast('Graph: the data has no numbers to plot');
    return false;
  }
  const old = new Set(descendants(doc.layers, group.id).map((l) => l.id));
  const out: Layer[] = [];
  for (const l of doc.layers) {
    if (old.has(l.id)) continue;
    // Children sit below their group in the stack
    if (l.id === group.id) out.push(...parts, withLayer(group, { graph: { ...spec, box }, name: `${label(spec.type)} Graph` }));
    else out.push(l);
  }
  store.commit('Graph Data', { layers: out, activeId: group.id }, { icon: 'shape' });
  return true;
}

/** Object ▸ Graph ▸ Data…: opens the data dialog for the selected graph. */
export function editSelectedGraph(): boolean {
  const g = graphGroupOf(store.activeLayer);
  if (!g?.graph) {
    store.toast('Select a graph made with the Graph tools');
    return false;
  }
  const { box: _box, ...spec } = g.graph;
  store.set({ dialog: { type: 'graph', spec, groupId: g.id } });
  return true;
}
