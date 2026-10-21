import { describe, expect, it } from 'vitest';
import { faceFromFileName, familyFromFileName } from '../core/fonts';

describe('added font files', () => {
  it('reads the family from the file name', () => {
    expect(familyFromFileName('Montserrat-BoldItalic.ttf')).toBe('Montserrat');
    expect(familyFromFileName('Playfair_Display-Regular.otf')).toBe('Playfair Display');
    expect(familyFromFileName('Brand.woff2')).toBe('Brand');
  });

  it('reads weight and style so several files form one family', () => {
    expect(faceFromFileName('Montserrat-BoldItalic.ttf')).toEqual({ weight: '700', style: 'italic' });
    expect(faceFromFileName('Montserrat-SemiBold.ttf')).toEqual({ weight: '600', style: 'normal' });
    expect(faceFromFileName('Montserrat-ExtraLight.ttf')).toEqual({ weight: '200', style: 'normal' });
    expect(faceFromFileName('Montserrat-Black.ttf')).toEqual({ weight: '900', style: 'normal' });
    expect(faceFromFileName('Inter-Variable.ttf').weight).toBe('100 900');
    expect(faceFromFileName('Brand.woff2')).toEqual({ weight: '400', style: 'normal' });
  });
});
