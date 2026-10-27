import { CANDIDATE_ID, matchCandidate } from '@/features/matching/matcher';

import { item } from './fixtures';

const wardrobe = [
  item('top', 'graphic-tee', 'cream', { id: 't1' }),
  item('top', 'basic-tee', 'black', { id: 't2' }),
  item('bottom', 'cargo', 'brown', { id: 'b1' }),
  item('bottom', 'jeans', 'denim', { id: 'b2' }),
  item('shoes', 'sneakers', 'grey', { id: 's1' }),
  item('shoes', 'boots', 'brown', { id: 's2' }),
];

describe('matchCandidate', () => {
  it('finds pairings and outfits for a versatile piece', () => {
    const result = matchCandidate(item('top', 'hoodie', 'olive'), wardrobe);
    expect(result.pairsWith.length).toBeGreaterThanOrEqual(3);
    expect(result.pairsWith.every((p) => p.item.category !== 'top')).toBe(true);
    expect(result.outfits.length).toBeGreaterThan(0);
    expect(result.outfits.every((o) => o.pieces.top === CANDIDATE_ID)).toBe(true);
    expect(['strong', 'good']).toContain(result.verdict);
  });

  it('flags pieces you already own', () => {
    const result = matchCandidate(item('top', 'graphic-tee', 'cream'), wardrobe);
    expect(result.similar.map((s) => s.id)).toEqual(['t1']);
  });

  it('handles an empty wardrobe', () => {
    const result = matchCandidate(item('shoes', 'sneakers', 'white'), []);
    expect(result.verdict).toBe('none');
    expect(result.outfits).toEqual([]);
  });
});
