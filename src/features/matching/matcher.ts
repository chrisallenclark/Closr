import { generateOutfits, type ScoredOutfit, type StylePreferences } from '../outfits/generator';
import { pairScore } from '../outfits/harmony';
import { getColor } from '../wardrobe/catalog';
import type { ClothingItem } from '../wardrobe/types';

export const CANDIDATE_ID = '__candidate__';

export interface PairMatch {
  item: ClothingItem;
  score: number;
}

export type MatchVerdict = 'strong' | 'good' | 'limited' | 'none';

export interface MatchResult {
  verdict: MatchVerdict;
  /** Closet pieces from other categories that pair well, best first. */
  pairsWith: PairMatch[];
  /** Complete outfits the new piece unlocks. */
  outfits: ScoredOutfit[];
  /** Pieces you already own that are very close to the candidate. */
  similar: ClothingItem[];
}

const PAIR_THRESHOLD = 0.68;

function isSimilar(candidate: ClothingItem, item: ClothingItem): boolean {
  if (item.category !== candidate.category) return false;
  const a = candidate.colors[0] ? getColor(candidate.colors[0]) : undefined;
  const b = item.colors[0] ? getColor(item.colors[0]) : undefined;
  const sameColor = !!a && !!b && a.id === b.id;
  return item.subcategory === candidate.subcategory && sameColor;
}

/**
 * "Will it match?" — scores a not-yet-owned piece against the wardrobe using the same harmony
 * rules as the outfit generator.
 */
export function matchCandidate(
  candidate: ClothingItem,
  wardrobe: ClothingItem[],
  preferences?: StylePreferences,
): MatchResult {
  const probe: ClothingItem = { ...candidate, id: CANDIDATE_ID };

  const pairsWith = wardrobe
    .filter((i) => i.category !== probe.category)
    .map((item) => ({ item, score: pairScore(probe, item) }))
    .filter((m) => m.score >= PAIR_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  const outfits = generateOutfits(wardrobe, {
    locked: { [probe.category]: CANDIDATE_ID },
    extraItems: [probe],
    count: 3,
    seed: 7,
    preferences,
  });

  const similar = wardrobe.filter((i) => isSimilar(probe, i));

  const otherCategoryCount = wardrobe.filter((i) => i.category !== probe.category).length;
  const ratio = otherCategoryCount ? pairsWith.length / otherCategoryCount : 0;
  let verdict: MatchVerdict;
  if (pairsWith.length === 0) verdict = 'none';
  else if (ratio >= 0.6 && pairsWith.length >= 4) verdict = 'strong';
  else if (ratio >= 0.35 || pairsWith.length >= 3) verdict = 'good';
  else verdict = 'limited';

  return { verdict, pairsWith, outfits, similar };
}
