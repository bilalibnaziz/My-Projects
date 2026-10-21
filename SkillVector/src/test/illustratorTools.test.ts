import { describe, it, expect } from 'vitest';
import { TOOLS, ADVANCED_GROUPS, BASIC_GROUPS } from '../ui/ToolRail';
import { isShapeTool, getToolShapeType, isLiquifyTool, cursorFor } from '../core/tools';
import {
  addAnchorToLayerPath, deleteAnchorFromLayerPath, smoothLayerPath,
  splitLayerPath, distortVectorLayer, convertToEditablePath
} from '../core/vectorOps';
import { makeLayer, Layer } from '../core/types';
import { store } from '../core/store';

describe('Illustrator 100+ Tools Suite', () => {
  it('defines over 100 comprehensive tools in TOOLS catalog', () => {
    const toolIds = Object.keys(TOOLS);
    expect(toolIds.length).toBeGreaterThanOrEqual(100);
  });

  it('populates all primary Adobe Illustrator categories', () => {
    const list = Object.values(TOOLS);
    const categories = new Set(list.map((t) => t.category));
    expect(categories.has('select')).toBe(true);
    expect(categories.has('draw')).toBe(true);
    expect(categories.has('type')).toBe(true);
    expect(categories.has('paint')).toBe(true);
    expect(categories.has('modify')).toBe(true);
    expect(categories.has('symbols-graphs')).toBe(true);
    expect(categories.has('navigate')).toBe(true);
  });

  it('has non-empty labels, icons, and hints for every single tool', () => {
    for (const [id, def] of Object.entries(TOOLS)) {
      expect(def.id).toBe(id);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.hint.length).toBeGreaterThan(0);
      expect(def.icon).toBeDefined();
    }
  });

  it('properly configures Advanced and Basic toolbar groups', () => {
    expect(ADVANCED_GROUPS.length).toBeGreaterThanOrEqual(20);
    expect(BASIC_GROUPS.length).toBeGreaterThanOrEqual(10);
    expect(ADVANCED_GROUPS.flat().length).toBeGreaterThan(BASIC_GROUPS.flat().length);
  });

  it('accurately identifies shape and liquify tools', () => {
    expect(isShapeTool('shape-rect')).toBe(true);
    expect(isShapeTool('shape-round-rect')).toBe(true);
    expect(isShapeTool('shape-ellipse')).toBe(true);
    expect(isShapeTool('shape-polygon')).toBe(true);
    expect(isShapeTool('shape-star')).toBe(true);
    expect(isShapeTool('line')).toBe(true);
    expect(isShapeTool('arc')).toBe(true);
    expect(isShapeTool('spiral')).toBe(true);
    expect(isShapeTool('rect-grid')).toBe(true);
    expect(isShapeTool('polar-grid')).toBe(true);
    expect(isShapeTool('flare')).toBe(true);
    expect(isShapeTool('graph-column')).toBe(true);
    expect(isShapeTool('pen')).toBe(false);

    expect(isLiquifyTool('warp')).toBe(true);
    expect(isLiquifyTool('twirl')).toBe(true);
    expect(isLiquifyTool('pucker')).toBe(true);
    expect(isLiquifyTool('bloat')).toBe(true);
    expect(isLiquifyTool('scallop')).toBe(true);
    expect(isLiquifyTool('crystallize')).toBe(true);
    expect(isLiquifyTool('wrinkle')).toBe(true);
    expect(isLiquifyTool('move')).toBe(false);
  });

  it('maps tools to correct vector shape geometries', () => {
    expect(getToolShapeType('shape-rect', 'rectangle')).toBe('rectangle');
    expect(getToolShapeType('shape-round-rect', 'rectangle')).toBe('round-rect');
    expect(getToolShapeType('shape-ellipse', 'rectangle')).toBe('ellipse');
    expect(getToolShapeType('shape-polygon', 'rectangle')).toBe('polygon');
    expect(getToolShapeType('shape-star', 'rectangle')).toBe('star');
    expect(getToolShapeType('line', 'rectangle')).toBe('line');
    expect(getToolShapeType('arc', 'rectangle')).toBe('arc');
    expect(getToolShapeType('spiral', 'rectangle')).toBe('spiral');
    expect(getToolShapeType('rect-grid', 'rectangle')).toBe('grid');
    expect(getToolShapeType('polar-grid', 'rectangle')).toBe('polar-grid');
    expect(getToolShapeType('flare', 'rectangle')).toBe('flare');
    expect(getToolShapeType('graph-column', 'rectangle')).toBe('graph');
  });

  it('returns appropriate cursor styles across tools', () => {
    expect(cursorFor('move')).toBe('default'); // Selection tool: arrow; handles set their own cursors
    expect(cursorFor('hand')).toBe('grab');
    expect(cursorFor('zoom')).toBe('zoom-in');
    expect(cursorFor('text')).toBe('text');
    expect(cursorFor('vertical-type')).toBe('text');
    expect(cursorFor('direct-select')).toBe('default');
    expect(cursorFor('pen')).toBe('crosshair');
    expect(cursorFor('shape-rect')).toBe('crosshair');
  });

  it('supports vector anchor insertion and deletion', () => {
    const layer = makeLayer({
      kind: 'shape',
      name: 'Rect',
      shape: { shape: 'rectangle', fill: '#ff9a00', fillEnabled: true, stroke: '#000', strokeWidth: 1, radius: 0 },
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });

    const editable = convertToEditablePath(layer);
    expect(editable.shape?.points?.length).toBe(4);

    const withAnchor = addAnchorToLayerPath(editable, 200, 100);
    expect(withAnchor.shape?.points?.length).toBe(5);

    const afterDelete = deleteAnchorFromLayerPath(withAnchor, withAnchor.x + withAnchor.shape!.points![1].x * withAnchor.width, withAnchor.y + withAnchor.shape!.points![1].y * withAnchor.height, 20);
    expect(afterDelete.shape?.points?.length).toBe(4);
  });

  it('supports path smoothing and cutting', () => {
    const layer = makeLayer({
      kind: 'shape',
      name: 'Polygon',
      shape: { shape: 'polygon', fill: '#ff9a00', fillEnabled: true, stroke: '#000', strokeWidth: 1, radius: 0, sides: 6 },
      x: 50,
      y: 50,
      width: 100,
      height: 100,
    });

    const smoothed = smoothLayerPath(layer);
    expect(smoothed.shape?.points?.every((p) => p.type === 'smooth')).toBe(true);

    const split = splitLayerPath(smoothed, 100, 50);
    expect(split.length).toBe(2);
    expect(split[0].shape?.closed).toBe(false);
    expect(split[1].shape?.closed).toBe(false);
  });

  it('supports liquify deformation on vector coordinates without invalid numbers', () => {
    const layer = makeLayer({
      kind: 'shape',
      name: 'Star',
      shape: { shape: 'star', fill: '#ff9a00', fillEnabled: true, stroke: '#000', strokeWidth: 1, radius: 0, sides: 5 },
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });

    const deformed = distortVectorLayer(layer, 'twirl', 150, 150, 60, 0.7);
    expect(deformed.shape?.points).toBeDefined();
    for (const p of deformed.shape!.points!) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.ix)).toBe(true);
      expect(Number.isFinite(p.iy)).toBe(true);
    }
  });

  it('toggles toolbar preset mode and drawing mode in store', () => {
    store.setToolbarMode('basic');
    expect(store.state.toolbarMode).toBe('basic');
    store.setToolbarMode('advanced');
    expect(store.state.toolbarMode).toBe('advanced');

    store.setDrawMode('behind');
    expect(store.state.drawMode).toBe('behind');
    store.setDrawMode('normal');
    expect(store.state.drawMode).toBe('normal');
  });
});
