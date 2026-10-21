import { describe, it, expect } from 'vitest';
import { charStyles, remapRuns, styleRange } from '../core/text';
import type { TextProps } from '../core/types';

const T = (text: string, extra: Partial<TextProps> = {}): TextProps => ({
  text, font: 'Inter', size: 40, weight: 400, italic: false, color: '#000000', align: 'left', lineHeight: 1.2, tracking: 0, shadow: false, stroke: 0, strokeColor: '#000', ...extra,
});

describe('rich text runs', () => {
  it('styles a range and merges equal neighbours', () => {
    let t = T('Hello brave world');
    t = { ...t, runs: styleRange(t, 6, 11, { color: '#ff0000' }) };
    expect(t.runs).toEqual([{ start: 6, end: 11, color: '#ff0000' }]);
    t = { ...t, runs: styleRange(t, 11, 17, { color: '#ff0000' }) };
    expect(t.runs).toEqual([{ start: 6, end: 17, color: '#ff0000' }]);
    const cs = charStyles(t);
    expect(cs[5].color).toBe('#000000');
    expect(cs[6].color).toBe('#ff0000');
  });

  it('overlapping styles combine, and setting the base value clears the override', () => {
    let t = T('abcdef');
    t = { ...t, runs: styleRange(t, 0, 4, { weight: 700 }) };
    t = { ...t, runs: styleRange(t, 2, 6, { italic: true }) };
    expect(t.runs).toEqual([
      { start: 0, end: 2, weight: 700 },
      { start: 2, end: 4, weight: 700, italic: true },
      { start: 4, end: 6, italic: true },
    ]);
    t = { ...t, runs: styleRange(t, 0, 6, { weight: 400 }) };
    expect(t.runs).toEqual([{ start: 2, end: 6, italic: true }]);
  });

  it('runs follow their characters when text is typed or deleted', () => {
    const runs = [{ start: 6, end: 11, color: '#f00' }];
    expect(remapRuns(runs, 'Hello brave world', 'Oh, Hello brave world')).toEqual([{ start: 10, end: 15, color: '#f00' }]);
    expect(remapRuns(runs, 'Hello brave world', 'Hello braveeee world')).toEqual([{ start: 6, end: 14, color: '#f00' }]);
    expect(remapRuns(runs, 'Hello brave world', 'Hello world')).toEqual([]);
    expect(remapRuns(runs, 'Hello brave world', 'Hello brave world!')).toEqual(runs);
  });
});

describe('typing at run edges', () => {
  it('text typed right before a run stays outside it; right after joins it', () => {
    const runs = [{ start: 0, end: 6, weight: 700 }];
    expect(remapRuns(runs, 'Design is', 'Good Design is')).toEqual([{ start: 5, end: 11, weight: 700 }]);
    expect(remapRuns(runs, 'Design is', 'Designer is')).toEqual([{ start: 0, end: 8, weight: 700 }]);
  });
});
