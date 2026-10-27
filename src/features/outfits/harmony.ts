import { getColor } from '../wardrobe/catalog';
import type { ClothingItem, ColorId } from '../wardrobe/types';

/**
 * Rule-based colour + formality harmony. Deliberately simple and explainable — it is the
 * deterministic baseline that AI styling (Phase 2) will build on, not a stand-in for it.
 */

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** 0..1 score for how well two colours sit together. */
export function colorPairScore(a: ColorId, b: ColorId): number {
  const ca = getColor(a);
  const cb = getColor(b);
  if (!ca || !cb) return 0.6;
  if (ca.id === cb.id) return ca.family === 'chroma' ? 0.62 : 0.85;
  if (ca.family === 'neutral' || cb.family === 'neutral') return 0.92;
  if (ca.family === 'earth' && cb.family === 'earth') return 0.88;

  const d = hueDistance(ca.hue, cb.hue);
  const earthy = ca.family === 'earth' || cb.family === 'earth';
  if (d <= 30) return earthy ? 0.82 : 0.74; // tonal / analogous
  if (d >= 130) return earthy ? 0.66 : 0.6; // complementary contrast
  if (d <= 60) return earthy ? 0.7 : 0.62;
  return earthy ? 0.5 : 0.3; // awkward middle distances clash
}

export function primaryColor(item: ClothingItem): ColorId | undefined {
  return item.colors[0];
}

/** How many distinct non-neutral colours an outfit uses. More than two reads as busy. */
export function statementColorCount(items: ClothingItem[]): number {
  const ids = new Set<string>();
  for (const item of items) {
    const c = item.colors[0] ? getColor(item.colors[0]) : undefined;
    if (c && c.family === 'chroma') ids.add(c.id);
  }
  return ids.size;
}

export function pairScore(a: ClothingItem, b: ClothingItem): number {
  const ca = primaryColor(a);
  const cb = primaryColor(b);
  const color = ca && cb ? colorPairScore(ca, cb) : 0.6;
  const formalityGap = Math.abs(a.formality - b.formality);
  const formality = Math.max(0, 1 - formalityGap * 0.25);
  return color * 0.75 + formality * 0.25;
}

/** Average pairwise harmony across all pieces, with a penalty for colour overload. */
export function outfitHarmony(items: ClothingItem[]): number {
  if (items.length < 2) return 1;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      total += pairScore(items[i]!, items[j]!);
      pairs++;
    }
  }
  const statements = statementColorCount(items);
  const overload = statements > 2 ? (statements - 2) * 0.12 : 0;
  return Math.max(0, total / pairs - overload);
}

export type PaletteMood = 'earth' | 'tonal' | 'mono' | 'contrast' | 'color';

export function paletteMood(items: ClothingItem[]): PaletteMood {
  const defs = items.map((i) => (i.colors[0] ? getColor(i.colors[0]) : undefined)).filter(Boolean);
  const families = new Set(defs.map((d) => d!.family));
  const ids = new Set(defs.map((d) => d!.id));
  if (families.has('earth') && !families.has('chroma')) return 'earth';
  if (!families.has('chroma') && !families.has('earth')) {
    return ids.size <= 2 ? 'mono' : 'contrast';
  }
  if (ids.size <= 2) return 'tonal';
  return 'color';
}

export const MOOD_LINES: Record<PaletteMood, string> = {
  earth: 'Earth tones hit different.',
  tonal: 'Tonal, quiet, intentional.',
  mono: 'Clean lines. Nothing extra.',
  contrast: 'Sharp contrast, easy confidence.',
  color: 'A little colour, well placed.',
};
