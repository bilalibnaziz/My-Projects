import { describe, it, expect } from 'vitest';
import { batchExportFormats } from '../core/io';
import type { Doc } from '../core/types';
import { makeLayer, uid } from '../core/types';

function createDoc(width = 200, height = 200, title = 'Test Doc'): Doc {
  return {
    id: uid('doc'),
    title,
    width,
    height,
    layers: [],
    activeId: '',
    selection: null,
    lastSelection: null,
    editMask: false,
    history: [],
    hIndex: -1,
    dirty: false,
    view: { zoom: 1, panX: 0, panY: 0, fitted: true },
  };
}

describe('batchExportFormats', () => {
  it('handles empty formats gracefully with 0 files', async () => {
    const doc = createDoc(200, 200, 'Test Doc');
    const count = await batchExportFormats(doc, { formats: [] });
    expect(count).toBe(0);
  });

  it('generates multi-format files including SVG without throwing', async () => {
    const doc = createDoc(200, 200, 'Test Doc');
    const layer = makeLayer({
      kind: 'shape',
      name: 'Rect 1',
      shape: {
        shape: 'rectangle',
        fill: '#ff6600',
        fillEnabled: true,
        stroke: '#000000',
        strokeWidth: 2,
        radius: 0,
      },
    });
    doc.layers.push(layer);

    const count = await batchExportFormats(doc, {
      formats: ['svg'],
      asZip: true,
    });
    expect(count).toBe(1);
  });
});
