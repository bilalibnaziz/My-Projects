import { describe, it, expect } from 'vitest';
import { decodeLut, encodeLut, parseCube, writeCube } from '../core/lut';

const INVERT = `TITLE "invert"
# comment
LUT_3D_SIZE 2
1 1 1
0 1 1
1 0 1
0 0 1
1 1 0
0 1 0
1 0 0
0 0 0
`;

describe('3D LUTs', () => {
  it('parses .cube files in red-fastest order', () => {
    const l = parseCube(INVERT);
    expect(l.size).toBe(2);
    expect(Array.from(l.data.slice(0, 6))).toEqual([1, 1, 1, 0, 1, 1]);
  });
  it('honours DOMAIN_MIN / DOMAIN_MAX', () => {
    const l = parseCube('LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n' + '2 2 2\n'.repeat(8));
    expect(l.data[0]).toBe(1);
  });
  it('rejects broken files', () => {
    expect(() => parseCube('LUT_1D_SIZE 4')).toThrow(/1D/);
    expect(() => parseCube('LUT_3D_SIZE 2\n1 1 1')).toThrow(/Expected 8/);
    expect(() => parseCube('0 0 0')).toThrow(/LUT_3D_SIZE/);
  });
  it('round-trips through the 16-bit storage format and .cube text', () => {
    const l = parseCube(INVERT);
    const back = decodeLut(encodeLut(l), 2);
    back.forEach((v, i) => expect(v).toBeCloseTo(l.data[i], 4));
    expect(parseCube(writeCube(l)).data).toEqual(l.data);
  });
});
