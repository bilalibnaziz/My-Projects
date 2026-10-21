import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../core/store';
import { makeLayer } from '../core/types';
import type { PathAnchor } from '../core/types';
import * as vectorOps from '../core/vectorOps';

describe('vectorOps - Artboard System', () => {
  beforeEach(() => {
    store.state.docs = [];
    store.state.activeDocId = null;
    const l1 = makeLayer({ kind: 'raster', name: 'Background', width: 1920, height: 1080 });
    store.addDoc({
      title: 'Vector Project',
      width: 1920,
      height: 1080,
      layers: [l1],
    });
  });

  it('initializes document with default artboard if none present', () => {
    const doc = store.doc!;
    const active = vectorOps.getActiveArtboard(doc);
    expect(active).toBeDefined();
    expect(active?.width).toBe(1920);
    expect(active?.height).toBe(1080);
    expect(doc.artboards?.length).toBe(1);
  });

  it('adds artboard with specified preset and updates active artboard', () => {
    const doc = store.doc!;
    const a2 = vectorOps.addArtboard(doc, 'A4', { x: 0, y: 0, width: 595, height: 842 });
    expect(a2).toBeDefined();
    expect(a2.width).toBe(595);
    expect(a2.height).toBe(842);
    expect(doc.artboards?.length).toBe(2);
    expect(doc.activeArtboardId).toBe(a2.id);
  });

  it('updates artboard geometry and syncs canvas bounds', () => {
    const doc = store.doc!;
    const active = vectorOps.getActiveArtboard(doc);
    vectorOps.updateArtboard(doc, active.id, { width: 2560, height: 1440, name: 'Main Canvas' });
    expect(doc.artboards?.find((a) => a.id === active.id)?.name).toBe('Main Canvas');
    expect(doc.width).toBeGreaterThanOrEqual(2560);
    expect(doc.height).toBeGreaterThanOrEqual(1440);
  });

  it('removes artboards safely without deleting the final artboard', () => {
    const doc = store.doc!;
    const a2 = vectorOps.addArtboard(doc, 'Letter', { x: 0, y: 0, width: 612, height: 792 });
    expect(doc.artboards?.length).toBe(2);

    const removed = vectorOps.removeArtboard(doc, a2.id);
    expect(removed).toBe(true);
    expect(doc.artboards?.length).toBe(1);

    // Deleting the last remaining artboard should return false
    const remainingId = doc.artboards![0].id;
    const removeLast = vectorOps.removeArtboard(doc, remainingId);
    expect(removeLast).toBe(false);
    expect(doc.artboards?.length).toBe(1);
  });
});

describe('vectorOps - Bézier Math & Curvature', () => {
  it('converts rectangle primitive to editable Bézier path anchors', () => {
    const layer = makeLayer({
      kind: 'shape',
      name: 'Rect 1',
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      shape: {
        shape: 'rectangle',
        fill: '#ff9a00',
        stroke: '#000000',
        strokeWidth: 2,
        radius: 0,
        fillEnabled: true,
      },
    });

    const editable = vectorOps.convertToEditablePath(layer);
    expect(editable.shape?.shape).toBe('path');
    expect(editable.shape?.closed).toBe(true);
    expect(editable.shape?.points?.length).toBe(4);
    // Rectangle points corner coords
    expect(editable.shape?.points?.[0].x).toBe(0);
    expect(editable.shape?.points?.[0].y).toBe(0);
  });

  it('toggles anchor points between corner and smooth curves', () => {
    const anchor: PathAnchor = {
      x: 0.5,
      y: 0.5,
      ix: 0.5,
      iy: 0.5,
      ox: 0.5,
      oy: 0.5,
      type: 'corner',
    };

    // Toggle to smooth
    const smooth = vectorOps.toggleAnchorSmooth(anchor);
    expect(smooth.type).toBe('smooth');
    expect(smooth.ix).not.toBe(smooth.x);
    expect(smooth.ox).not.toBe(smooth.x);

    // Toggle back to corner
    const corner = vectorOps.toggleAnchorSmooth(smooth);
    expect(corner.type).toBe('corner');
    expect(corner.ix).toBe(corner.x);
    expect(corner.ox).toBe(corner.x);
  });

  it('solves harmonic curvature tangents for smooth curve interpolation', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 100, y: 0 },
    ];
    const solved = vectorOps.solveHarmonicCurvature(pts, false);
    expect(solved.length).toBe(3);
    // Middle point should have symmetric handles
    expect(solved[1].type).toBe('smooth');
    expect(solved[1].ix).toBeDefined();
    expect(solved[1].ox).toBeDefined();
    expect(solved[1].ix).not.toBe(solved[1].x);
  });

  it('reverses path anchor order accurately', () => {
    const pts: PathAnchor[] = [
      { x: 0, y: 0, ix: 0, iy: 0, ox: 10, oy: 0 },
      { x: 100, y: 50, ix: 90, iy: 50, ox: 100, oy: 50 },
    ];
    const rev = vectorOps.reversePoints(pts);
    expect(rev.length).toBe(2);
    expect(rev[0].x).toBe(100);
    expect(rev[1].x).toBe(0);
  });
});

describe('vectorOps - Pathfinder & Compound Paths', () => {
  beforeEach(() => {
    store.state.docs = [];
    store.state.activeDocId = null;
  });

  it('creates and releases compound paths across multiple shapes', () => {
    const s1 = makeLayer({
      kind: 'shape',
      name: 'Outer Box',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      shape: {
        shape: 'rectangle',
        fill: '#ff9a00',
        stroke: '#000000',
        strokeWidth: 2,
        fillEnabled: true,
        radius: 0,
      },
    });

    const s2 = makeLayer({
      kind: 'shape',
      name: 'Inner Hole',
      x: 140,
      y: 140,
      width: 120,
      height: 120,
      shape: {
        shape: 'ellipse',
        fill: '#000000',
        stroke: '#000000',
        strokeWidth: 0,
        fillEnabled: true,
        radius: 0,
      },
    });

    store.addDoc({
      title: 'Compound Test',
      width: 1000,
      height: 1000,
      layers: [s1, s2],
    });

    store.setSelectedLayers([s1.id, s2.id]);
    const makeRes = vectorOps.makeCompoundPath();
    expect(makeRes.created).toBe(true);

    const doc = store.doc!;
    expect(doc.layers.length).toBe(1);
    const compound = doc.layers[0];
    expect(compound.shape?.compoundPoints).toBeDefined();
    expect(compound.shape?.compoundPoints?.length).toBe(2);

    // Now release compound path back to individual layers
    doc.activeId = compound.id;
    store.setSelectedLayers([compound.id]);
    const releaseRes = vectorOps.releaseCompoundPath();
    expect(releaseRes.released).toBe(true);
    expect(doc.layers.length).toBe(2);
  });

  it('joins open path endpoints', () => {
    const s1 = makeLayer({
      kind: 'shape',
      name: 'Line 1',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      shape: {
        shape: 'path',
        closed: false,
        points: [
          { x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 },
          { x: 1, y: 1, ix: 1, iy: 1, ox: 1, oy: 1 },
        ],
        fill: '#000',
        stroke: '#000',
        strokeWidth: 2,
        fillEnabled: false,
        radius: 0,
      },
    });

    const s2 = makeLayer({
      kind: 'shape',
      name: 'Line 2',
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      shape: {
        shape: 'path',
        closed: false,
        points: [
          { x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 },
          { x: 1, y: 1, ix: 1, iy: 1, ox: 1, oy: 1 },
        ],
        fill: '#000',
        stroke: '#000',
        strokeWidth: 2,
        fillEnabled: false,
        radius: 0,
      },
    });

    store.addDoc({
      title: 'Join Test',
      width: 1000,
      height: 1000,
      layers: [s1, s2],
    });

    store.setSelectedLayers([s1.id, s2.id]);
    const joinRes = vectorOps.joinPaths();
    expect(joinRes.joined).toBe(true);
    expect(store.doc!.layers.length).toBe(1);
    expect(store.doc!.layers[0].shape?.points?.length).toBe(4);
  });

  it('applies Pathfinder unite boolean operation', () => {
    const s1 = makeLayer({
      kind: 'shape',
      name: 'A',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      shape: { shape: 'rectangle', fill: '#f00', stroke: '#000', strokeWidth: 1, fillEnabled: true, radius: 0 },
    });
    const s2 = makeLayer({
      kind: 'shape',
      name: 'B',
      x: 60,
      y: 60,
      width: 100,
      height: 100,
      shape: { shape: 'rectangle', fill: '#0f0', stroke: '#000', strokeWidth: 1, fillEnabled: true, radius: 0 },
    });

    store.addDoc({
      title: 'Unite Test',
      width: 500,
      height: 500,
      layers: [s1, s2],
    });

    store.setSelectedLayers([s1.id, s2.id]);
    const res = vectorOps.applyPathfinder('unite');
    expect(res.applied).toBe(true);
    expect(store.doc!.layers.length).toBe(1);
    expect(store.doc!.layers[0].width).toBe(150);
    expect(store.doc!.layers[0].height).toBe(150);
  });

  it('applies Pathfinder minus-front, intersect and exclude with distinct geometric results', () => {
    const createShapes = () => [
      makeLayer({
        kind: 'shape',
        name: 'A',
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        shape: { shape: 'rectangle', fill: '#f00', stroke: '#000', strokeWidth: 1, fillEnabled: true, radius: 0 },
      }),
      makeLayer({
        kind: 'shape',
        name: 'B',
        x: 60,
        y: 60,
        width: 100,
        height: 100,
        shape: { shape: 'rectangle', fill: '#0f0', stroke: '#000', strokeWidth: 1, fillEnabled: true, radius: 0 },
      }),
    ];

    // Intersect: overlapping region is 50x50 from (60,60) to (110,110)
    let [s1, s2] = createShapes();
    store.addDoc({ title: 'Intersect Test', width: 500, height: 500, layers: [s1, s2] });
    store.setSelectedLayers([s1.id, s2.id]);
    const resIntersect = vectorOps.applyPathfinder('intersect');
    expect(resIntersect.applied).toBe(true);
    const intLayer = store.doc!.layers[0];
    expect(intLayer.width).toBe(50);
    expect(intLayer.height).toBe(50);

    // Minus front: A minus B
    [s1, s2] = createShapes();
    store.addDoc({ title: 'Minus Front Test', width: 500, height: 500, layers: [s1, s2] });
    store.setSelectedLayers([s1.id, s2.id]);
    const resMinus = vectorOps.applyPathfinder('minus-front');
    expect(resMinus.applied).toBe(true);
    const minusLayer = store.doc!.layers[0];
    expect(minusLayer.name).toBe('Minus Front');

    // Exclude != Intersect
    [s1, s2] = createShapes();
    store.addDoc({ title: 'Exclude Test', width: 500, height: 500, layers: [s1, s2] });
    store.setSelectedLayers([s1.id, s2.id]);
    const resExclude = vectorOps.applyPathfinder('exclude');
    expect(resExclude.applied).toBe(true);
    const exclLayer = store.doc!.layers[0];
    expect(exclLayer.width).not.toBe(intLayer.width);
  });

  it('simplifies collinear or dense path points', () => {
    const densePts: PathAnchor[] = [
      { x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 },
      { x: 0.25, y: 0.001, ix: 0.25, iy: 0.001, ox: 0.25, oy: 0.001 },
      { x: 0.5, y: 0.002, ix: 0.5, iy: 0.002, ox: 0.5, oy: 0.002 },
      { x: 1, y: 0, ix: 1, iy: 0, ox: 1, oy: 0 },
    ];
    const simplified = vectorOps.simplifyPathPoints(densePts, 0.05);
    expect(simplified.length).toBeLessThan(densePts.length);
    expect(simplified.length).toBe(2);
  });

  it('converts stroked path to filled outline shape', () => {
    const lineLayer = makeLayer({
      kind: 'shape',
      name: 'Line',
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      shape: {
        shape: 'path',
        points: [
          { x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 },
          { x: 1, y: 1, ix: 1, iy: 1, ox: 1, oy: 1 },
        ],
        closed: false,
        fill: '',
        fillEnabled: false,
        stroke: '#000000',
        strokeWidth: 4,
        radius: 0,
      },
    });

    const outlined = vectorOps.outlineStroke(lineLayer);
    expect(outlined.shape?.closed).toBe(true);
    expect(outlined.shape?.fillEnabled).toBe(true);
    expect(outlined.shape?.strokeWidth).toBe(0);
    expect(outlined.name).toContain('Outlined');
  });
});
