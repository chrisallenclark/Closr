import { colorPairScore, outfitHarmony, paletteMood } from '@/features/outfits/harmony';

import { item } from './fixtures';

describe('colorPairScore', () => {
  it('treats neutrals as pairing with anything', () => {
    expect(colorPairScore('black', 'red')).toBeGreaterThan(0.9);
    expect(colorPairScore('white', 'purple')).toBeGreaterThan(0.9);
  });

  it('pairs earth tones together', () => {
    expect(colorPairScore('brown', 'olive')).toBeGreaterThanOrEqual(0.85);
  });

  it('penalises awkward hue distances', () => {
    expect(colorPairScore('red', 'green')).toBeGreaterThan(colorPairScore('orange', 'green'));
    expect(colorPairScore('orange', 'green')).toBeLessThan(0.5);
  });

  it('is symmetric', () => {
    expect(colorPairScore('blue', 'mustard')).toBe(colorPairScore('mustard', 'blue'));
  });
});

describe('outfitHarmony', () => {
  it('scores a neutral/earth outfit above a clashing one', () => {
    const calm = [item('top', 'basic-tee', 'cream'), item('bottom', 'cargo', 'brown'), item('shoes', 'sneakers', 'grey')];
    const loud = [item('top', 'basic-tee', 'orange'), item('bottom', 'chinos', 'green'), item('shoes', 'sneakers', 'purple')];
    expect(outfitHarmony(calm)).toBeGreaterThan(outfitHarmony(loud));
  });

  it('penalises formality mismatches', () => {
    const matched = [item('top', 'dress-shirt', 'white', { formality: 4 }), item('bottom', 'trousers', 'navy', { formality: 4 })];
    const mismatched = [item('top', 'dress-shirt', 'white', { formality: 4 }), item('bottom', 'joggers', 'navy', { formality: 1 })];
    expect(outfitHarmony(matched)).toBeGreaterThan(outfitHarmony(mismatched));
  });
});

describe('paletteMood', () => {
  it('detects earth palettes', () => {
    expect(paletteMood([item('top', 'basic-tee', 'cream'), item('bottom', 'cargo', 'brown')])).toBe('earth');
  });
});
