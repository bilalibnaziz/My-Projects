// Workspaces and dock layout. A workspace tunes the app for one kind of job — which panels the
// dock shows and in what order, which guides the canvas draws, which sizes New Document offers
// first. The dock's width, the split between the panels and the Layers list, and the tab order
// are the user's own and are remembered per workspace.

import { useSyncExternalStore } from 'react';
import { store } from '../core/store';
import { panelHooks } from '../core/commands';
import type { State, ToolId } from '../core/store';
import type { PresetCategory } from '../core/social';

export type DockTab = 'properties' | 'social' | 'photo' | 'adjust' | 'looks' | 'grids' | 'color' | 'info' | 'history' | 'actions' | 'navigator';

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
  /** Histogram at the top of the dock. */
  histogram?: boolean;
}

export const WORKSPACES: Workspace[] = [
  {
    id: 'essentials',
    label: 'Essentials',
    blurb: 'Every panel: properties, social media kit, photo editing, adjustments, looks, color, info, history, actions, navigator',
    tabs: ['properties', 'social', 'photo', 'looks', 'adjust', 'color', 'info', 'grids', 'history', 'actions', 'navigator'],
    guides: [],
    newCategory: 'Social',
    histogram: true,
  },
  {
    id: 'photo',
    label: 'Photography',
    blurb: 'Looks and adjustments up front with the histogram, Info for exact values',
    tabs: ['properties', 'photo', 'looks', 'adjust', 'info', 'grids', 'history', 'navigator', 'color'],
    guides: [],
    newCategory: 'Screen',
    histogram: true,
  },
  {
    id: 'retouch',
    label: 'Retouching',
    blurb: 'Healing tools, history to step back, navigator for detail work',
    tabs: ['properties', 'photo', 'grids', 'history', 'navigator', 'adjust', 'info', 'color'],
    guides: [],
    newCategory: 'Screen',
    tool: 'heal',
    histogram: true,
  },
  {
    id: 'paint',
    label: 'Painting',
    blurb: 'Brushes and color first, a clean dock',
    tabs: ['properties', 'color', 'grids', 'history', 'navigator', 'adjust'],
    guides: [],
    newCategory: 'Screen',
    tool: 'brush',
  },
  {
    id: 'design',
    label: 'Social & Design',
    blurb: 'Posts, ads and thumbnails with platform safe zones',
    tabs: ['properties', 'social', 'color', 'looks', 'adjust', 'grids', 'history', 'actions'],
    guides: ['social'],
    newCategory: 'Social',
    safeZones: true,
    tool: 'move',
  },
  {
    id: 'print',
    label: 'Print & Packaging',
    blurb: 'Bleed, trim and safe-area guides, print sizes, CMYK proof',
    tabs: ['properties', 'info', 'color', 'adjust', 'grids', 'history'],
    guides: ['print'],
    newCategory: 'Packaging',
    proof: true,
    tool: 'move',
  },
  {
    id: 'video',
    label: 'Video Frames',
    blurb: 'Thumbnails and frames with title- and action-safe areas',
    tabs: ['properties', 'adjust', 'looks', 'color', 'grids', 'history'],
    guides: ['video'],
    newCategory: 'Video',
    tool: 'move',
  },
  {
    id: 'web',
    label: 'Web & UI',
    blurb: 'Screens and graphics on a 12-column layout grid',
    tabs: ['properties', 'color', 'info', 'grids', 'history', 'adjust'],
    guides: ['web'],
    newCategory: 'Screen',
    tool: 'move',
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
  /** Open dock tab. */
  tab: DockTab;
}

const KEY = 'skillphoto.layout';
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
  tab: 'properties',
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
  // Keep the user's order and drop tabs the workspace no longer has; a tab the user has never seen goes
  // where the workspace puts it (so new panels show up near the front, not hidden at the end)
  const out = saved.filter((t) => ws.tabs.includes(t));
  ws.tabs.forEach((t, i) => {
    if (!saved.includes(t)) out.splice(Math.min(i, out.length), 0, t);
  });
  return out;
}

export function switchWorkspace(id: string) {
  const ws = WORKSPACES.find((w) => w.id === id);
  if (!ws) return;
  setLayout({ workspace: id });
  setLayout({ tab: workspaceTabs()[0] });
  const patch: Partial<State> = { showSafeZones: !!ws.safeZones || store.state.showSafeZones };
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

// Menu commands open dock panels through this hook (shown even when the dock was hidden)
panelHooks.open = (tab) => setLayout({ tab: tab as DockTab, dockHidden: false, dockOpen: true, panelsCollapsed: false });
