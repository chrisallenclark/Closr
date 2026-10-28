import { generateOutfits, missingSlots, piecesKey, scoreOutfit } from '@/features/outfits/generator';

import { item } from './fixtures';

const wardrobe = [
  item('top', 'graphic-tee', 'cream', { id: 't1' }),
  item('top', 'basic-tee', 'black', { id: 't2' }),
  item('top', 'button-up', 'olive', { id: 't3' }),
  item('bottom', 'cargo', 'brown', { id: 'b1' }),
  item('bottom', 'jeans', 'denim', { id: 'b2' }),
  item('shoes', 'sneakers', 'grey', { id: 's1' }),
  item('shoes', 'boots', 'brown', { id: 's2' }),
  item('outerwear', 'overshirt', 'khaki', { id: 'o1' }),
  item('accessory', 'hat', 'black', { id: 'a1' }),
];

describe('missingSlots', () => {
  it('reports required categories that are empty', () => {
    expect(missingSlots([item('top', 'basic-tee', 'white')])).toEqual(['bottom', 'shoes']);
    expect(missingSlots(wardrobe)).toEqual([]);
  });
});

describe('generateOutfits', () => {
  it('returns nothing when a required slot is empty', () => {
    expect(generateOutfits(wardrobe.filter((i) => i.category !== 'shoes'))).toEqual([]);
  });

  it('always fills top, bottom and shoes', () => {
    const looks = generateOutfits(wardrobe, { count: 3, seed: 3 });
    expect(looks).toHaveLength(3);
    for (const look of looks) {
      expect(look.pieces.top).toBeDefined();
      expect(look.pieces.bottom).toBeDefined();
      expect(look.pieces.shoes).toBeDefined();
      expect(look.score).toBeGreaterThan(0);
      expect(look.score).toBeLessThanOrEqual(1);
    }
  });

  it('returns distinct outfits', () => {
    const looks = generateOutfits(wardrobe, { count: 3, seed: 11 });
    expect(new Set(looks.map((l) => piecesKey(l.pieces))).size).toBe(3);
  });

  it('respects locked slots', () => {
    const looks = generateOutfits(wardrobe, { locked: { top: 't3', shoes: 's2' }, count: 3 });
    for (const look of looks) {
      expect(look.pieces.top).toBe('t3');
      expect(look.pieces.shoes).toBe('s2');
    }
  });

  it('is reproducible for a seed', () => {
    expect(generateOutfits(wardrobe, { seed: 42 })).toEqual(generateOutfits(wardrobe, { seed: 42 }));
  });

  it('avoids colours the user dislikes', () => {
    const looks = generateOutfits(wardrobe, {
      count: 1,
      seed: 5,
      preferences: { favoriteColors: [], avoidColors: ['olive'] },
    });
    expect(looks[0]?.pieces.top).not.toBe('t3');
  });

  it('can lock a piece that is not in the wardrobe yet', () => {
    const candidate = item('top', 'hoodie', 'rust', { id: 'new' });
    const looks = generateOutfits(wardrobe, { locked: { top: 'new' }, extraItems: [candidate] });
    expect(looks.length).toBeGreaterThan(0);
    expect(looks.every((l) => l.pieces.top === 'new')).toBe(true);
  });
});

describe('one-pieces', () => {
  const dressCloset = [
    item('onepiece', 'dress', 'black', { id: 'd1' }),
    item('onepiece', 'swimsuit', 'navy', { id: 'd2' }),
    item('shoes', 'heels', 'black', { id: 'h1' }),
  ];

  it('count as a complete base without separate tops and bottoms', () => {
    expect(missingSlots(dressCloset)).toEqual([]);
    const looks = generateOutfits(dressCloset, { count: 2 });
    expect(looks.length).toBeGreaterThan(0);
    for (const look of looks) {
      expect(look.pieces.onepiece).toBeDefined();
      expect(look.pieces.top).toBeUndefined();
      expect(look.pieces.bottom).toBeUndefined();
    }
  });

  it('never mix a one-piece with a top or bottom', () => {
    const looks = generateOutfits([...wardrobe, ...dressCloset], { count: 3, seed: 9 });
    for (const look of looks) {
      const separates = !!look.pieces.top || !!look.pieces.bottom;
      expect(separates && !!look.pieces.onepiece).toBe(false);
      if (!look.pieces.onepiece) expect(look.pieces.top && look.pieces.bottom).toBeTruthy();
    }
  });

  it('switch to separates when a top is locked', () => {
    const looks = generateOutfits([...wardrobe, ...dressCloset], { locked: { top: 't1' } });
    expect(looks.every((l) => l.pieces.top === 't1' && !l.pieces.onepiece)).toBe(true);
  });
});

describe('fit preference', () => {
  it('scores matching fits above opposite fits', () => {
    const bottom = item('bottom', 'jeans', 'denim');
    const shoes = item('shoes', 'sneakers', 'white');
    const prefs = { favoriteColors: [], avoidColors: [], fit: 'Oversized' as const };
    const baggy = scoreOutfit([item('top', 'baggy-tee', 'black', { fit: 'Oversized' }), bottom, shoes], prefs);
    const slim = scoreOutfit([item('top', 'basic-tee', 'black', { fit: 'Slim' }), bottom, shoes], prefs);
    expect(baggy).toBeGreaterThan(slim);
  });

  it('ignores fit when the preference is Mixed', () => {
    const bottom = item('bottom', 'jeans', 'denim');
    const shoes = item('shoes', 'sneakers', 'white');
    const prefs = { favoriteColors: [], avoidColors: [], fit: 'Mixed' as const };
    const a = scoreOutfit([item('top', 'baggy-tee', 'black', { fit: 'Oversized' }), bottom, shoes], prefs);
    const b = scoreOutfit([item('top', 'basic-tee', 'black', { fit: 'Slim' }), bottom, shoes], prefs);
    expect(a).toBe(b);
  });
});
