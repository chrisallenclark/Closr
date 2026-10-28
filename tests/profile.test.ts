import { migrateV1 } from '@/features/profile/migrations';
import { preferredColors } from '@/features/profile/types';

describe('migrateV1', () => {
  it('moves colour moods from style tags to palettes and drops unknown tags', () => {
    const migrated = migrateV1({
      name: 'Alex',
      styleTags: ['Streetwear', 'Earth Tones', 'Monochrome', 'Retired Tag'],
      favoriteColors: [],
      avoidColors: [],
      createdAt: '',
      updatedAt: '',
    });
    expect(migrated.styleTags).toEqual(['Streetwear']);
    expect(migrated.palettes).toEqual(['earth', 'monochrome']);
  });
});

describe('preferredColors', () => {
  it('combines palette colours with individual favourites without duplicates', () => {
    const colors = preferredColors({ palettes: ['monochrome'], favoriteColors: ['rust', 'black'] });
    expect(colors).toEqual(expect.arrayContaining(['rust', 'black', 'white', 'grey']));
    expect(new Set(colors).size).toBe(colors.length);
  });
});
