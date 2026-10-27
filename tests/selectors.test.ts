import { findGaps } from '@/features/insights/gaps';
import { filterItems, groupBySubcategory } from '@/features/wardrobe/selectors';

import { item } from './fixtures';

const items = [
  item('top', 'graphic-tee', 'cream', { favorite: true, brand: 'Rhude' }),
  item('top', 'graphic-tee', 'black'),
  item('bottom', 'cargo', 'brown', { seasons: ['fall'] }),
  item('shoes', 'sneakers', 'white'),
];

describe('filterItems', () => {
  it('filters by category, colour, season and favourites', () => {
    expect(filterItems(items, { category: 'top' })).toHaveLength(2);
    expect(filterItems(items, { colors: ['brown'] })).toHaveLength(1);
    expect(filterItems(items, { seasons: ['fall'] })).toHaveLength(1);
    expect(filterItems(items, { favoritesOnly: true })).toHaveLength(1);
  });

  it('searches name and brand', () => {
    expect(filterItems(items, { query: 'rhude' })).toHaveLength(1);
    expect(filterItems(items, { query: 'cargo' })).toHaveLength(1);
  });
});

describe('groupBySubcategory', () => {
  it('counts and orders groups', () => {
    const groups = groupBySubcategory(items);
    expect(groups[0]).toMatchObject({ subcategory: 'graphic-tee', count: 2 });
  });
});

describe('findGaps', () => {
  it('notices missing outerwear and a single pair of shoes', () => {
    const ids = findGaps(items).map((g) => g.id);
    expect(ids).toContain('no-outerwear');
    expect(ids).toContain('one-shoe');
  });

  it('returns nothing for an empty wardrobe', () => {
    expect(findGaps([])).toEqual([]);
  });
});
