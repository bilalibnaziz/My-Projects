// Workspaces and dock layout. A workspace tunes the app for one kind of job — which panels the
// dock shows and in what order, which guides the canvas draws, which sizes New Document offers
// first. The dock's width, the split between the panels and the Layers list, and the tab order
// are the user's own and are remembered per workspace.

import { useSyncExternalStore } from 'react';
import { store } from '../core/store';
import type { State, ToolId } from '../core/store';
import type { PresetCategory } from '../core/social';

export type DockTab = State['dockTab'];

export type GuideKind = 'print' | 'video' | 'web' | 'social';

export interface Workspace {
  id: string;
  label: string;
  blurb: string;
  /** Dock tabs, in order. */
  tabs: DockTab[];
  /** Guides drawn over every artboard. */
  guides: GuideKind[];
  /** Category New Document opens on. */
  newCategory: PresetCategory;
  /** Tool picked when switching to the workspace. */
  tool?: ToolId;
  /** Shows platform safe zones (social presets). */
  safeZones?: boolean;
  /** CMYK soft-proof while working. */
  proof?: boolean;
}

export const WORKSPACES: Workspace[] = [
  {
    id: 'essentials',
    label: 'Essentials',
    blurb: 'Everything within reach: properties, stroke, color, artboards',
    tabs: ['properties', 'stroke', 'color', 'artboards', 'symbols', 'grids', 'studio', 'history', 'info', 'actions', 'adjust'],
    guides: [],
    newCategory: 'Social',
  },
  {
    id: 'design',
    label: 'Graphic & Social Design',
    blurb: 'Posts, ads, carousels — every platform size from one design, safe zones, legibility check',
    tabs: ['studio', 'properties', 'color', 'stroke', 'artboards', 'symbols', 'grids', 'history'],
    guides: ['social'],
    newCategory: 'Social',
    safeZones: true,
    tool: 'move',
  },
  {
    id: 'packaging',
    label: 'Packaging & Print',
    blurb: 'Box dieline studio, bleed, fold nets, print standards, and CMYK proof',
    tabs: ['packaging', 'studio', 'properties', 'stroke', 'color', 'artboards', 'grids', 'info', 'history'],
    guides: ['print'],
    newCategory: 'Packaging',
    proof: true,
    tool: 'packaging',
  },
  {
    id: 'print',
    label: 'Print & Prepress',
    blurb: 'Bleed, crop marks, preflight with fixes, ink check, gang-up sheets, print-ready PDF',
    tabs: ['studio', 'properties', 'color', 'stroke', 'artboards', 'grids', 'info', 'history'],
    guides: ['print'],
    newCategory: 'Print',
    proof: true,
    tool: 'move',
  },
  {
    id: 'trace',
    label: 'Tracing & Vectorize',
    blurb: 'Image to vector with live preview, 11 presets, templates for hand tracing, colour clean-up',
    tabs: ['studio', 'properties', 'color', 'artboards', 'history'],
    guides: [],
    newCategory: 'Screen',
    tool: 'move',
  },
  {
    id: 'mood',
    label: 'Mood Board',
    blurb: 'Drop pictures, auto-arrange, pull a palette, sticky notes and labels',
    tabs: ['studio', 'properties', 'color', 'artboards', 'history'],
    guides: [],
    newCategory: 'Screen',
    tool: 'move',
  },
  {
    id: 'layout',
    label: 'Layout & Grids',
    blurb: 'Column, baseline, golden and print grids on every artboard, with snapping',
    tabs: ['grids', 'properties', 'artboards', 'color', 'history'],
    guides: [],
    newCategory: 'Print',
    tool: 'move',
  },
  {
    id: 'logo',
    label: 'Logo & Brand Identity',
    blurb: '10 construction grids, golden ratio circles, Shape Builder fusion',
    tabs: ['logo', 'properties', 'stroke', 'color', 'artboards', 'grids', 'history'],
    guides: [],
    newCategory: 'Screen',
    tool: 'shape-builder',
  },
  {
    id: 'video',
    label: 'Video & Motion Graphics',
    blurb: 'Frame sizes, lower thirds, titles, end screens and transparent overlays inside the safe areas',
    tabs: ['studio', 'properties', 'color', 'artboards', 'grids', 'history'],
    guides: ['video'],
    newCategory: 'Video',
    tool: 'move',
  },
  {
    id: 'web',
    label: 'Web & UI',
    blurb: 'Device screens, live UI components, contrast check, CSS hand-off, @2x assets',
    tabs: ['studio', 'properties', 'artboards', 'grids', 'color', 'stroke', 'history', 'info'],
    guides: ['web'],
    newCategory: 'Screen',
    tool: 'move',
  },
  {
    id: 'type',
    label: 'Typography',
    blurb: 'Type first: the Type tool, text properties and fonts up front',
    tabs: ['properties', 'color', 'history', 'artboards', 'grids'],
    guides: [],
    newCategory: 'Print',
    tool: 'text',
  },
];

export interface Layout {
  workspace: string;
  /** Dock width in px. */
  dockWidth: number;
  /** Share of the dock's height the panels take (the rest is Layers). */
  split: number;
  /** Layers list above the panels instead of below. */
  layersOnTop: boolean;
  layersCollapsed: boolean;
  panelsCollapsed: boolean;
  /** Tab order per workspace (the user can drag tabs). */
  order: Record<string, DockTab[]>;
  /** Print guides: bleed and safe margin in document pixels. */
  bleed: number;
  safe: number;
  /** Whether workspace guides are drawn. */
  guides: boolean;
  /** Panels hidden (wide windows) / drawer open (narrow windows). */
  dockHidden: boolean;
  dockOpen: boolean;
}

const KEY = 'skillvector.layout';
const DEFAULT: Layout = {
  workspace: 'essentials',
  dockWidth: 300,
  split: 0.46,
  layersOnTop: false,
  layersCollapsed: false,
  panelsCollapsed: false,
  order: {},
  bleed: 36, // 3 mm at 300 ppi
  safe: 36,
  guides: true,
  dockHidden: false,
  dockOpen: false,
};

function load(): Layout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT };
}

let layout = load();
let version = 0;
const listeners = new Set<() => void>();

export function getLayout(): Layout {
  return layout;
}

export function setLayout(patch: Partial<Layout>) {
  layout = { ...layout, ...patch };
  version++;
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
  store.requestRender();
}

export function useLayout(): Layout {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version
  );
  return layout;
}

export function currentWorkspace(): Workspace {
  return WORKSPACES.find((w) => w.id === layout.workspace) ?? WORKSPACES[0];
}

/** Dock tabs of the current workspace, in the user's order. */
export function workspaceTabs(): DockTab[] {
  const ws = currentWorkspace();
  const saved = layout.order[ws.id];
  if (!saved) return ws.tabs;
  // Keep the user's order, drop tabs the workspace no longer has, append new ones
  return [...saved.filter((t) => ws.tabs.includes(t)), ...ws.tabs.filter((t) => !saved.includes(t))];
}

export function switchWorkspace(id: string) {
  const ws = WORKSPACES.find((w) => w.id === id);
  if (!ws) return;
  setLayout({ workspace: id });
  const patch: Partial<State> = { dockTab: workspaceTabs()[0], showSafeZones: !!ws.safeZones || store.state.showSafeZones };
  if (ws.proof !== undefined) patch.proof = ws.proof ? 'cmyk' : 'off';
  else if (store.state.proof === 'cmyk') patch.proof = 'off';
  store.set(patch);
  if (ws.tool) store.setTool(ws.tool);
  store.toast(`${ws.label} workspace`, 'success');
}

/** Moves a dock tab in front of another (drag and drop in the tab strip). */
export function moveTab(tab: DockTab, before: DockTab | null) {
  const list = workspaceTabs().filter((t) => t !== tab);
  const i = before ? list.indexOf(before) : -1;
  if (i < 0) list.push(tab);
  else list.splice(i, 0, tab);
  setLayout({ order: { ...layout.order, [currentWorkspace().id]: list } });
}

export function resetLayout() {
  setLayout({ dockWidth: DEFAULT.dockWidth, split: DEFAULT.split, layersOnTop: false, layersCollapsed: false, panelsCollapsed: false, order: {} });
}

/** Shows or hides the panels: a drawer on narrow windows, the docked column otherwise. */
export function toggleDock(compact: boolean) {
  if (compact) setLayout({ dockOpen: !layout.dockOpen });
  else setLayout({ dockHidden: !layout.dockHidden });
}
