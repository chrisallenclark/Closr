import { getColor, getSubcategoryLabel } from '../wardrobe/catalog';
import type { Category, ClothingItem } from '../wardrobe/types';

export interface WardrobeGap {
  id: string;
  title: string;
  detail: string;
  category?: Category;
  priority: number;
}

function share<T>(items: T[], key: (t: T) => string | undefined): { key: string; ratio: number } | null {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: { key: string; ratio: number } | null = null;
  for (const [k, n] of counts) {
    const ratio = n / items.length;
    if (!best || ratio > best.ratio) best = { key: k, ratio };
  }
  return best;
}

/**
 * Local, rule-based observations about what the wardrobe is missing. These feed the Shop tab now
 * and will filter real product recommendations later.
 */
export function findGaps(items: ClothingItem[]): WardrobeGap[] {
  const gaps: WardrobeGap[] = [];
  const by = (c: Category) => items.filter((i) => i.category === c);
  const tops = by('top');
  const bottoms = by('bottom');
  const shoes = by('shoes');
  const outer = by('outerwear');
  const accessories = by('accessory');

  if (items.length === 0) return gaps;

  if (outer.length === 0) {
    gaps.push({
      id: 'no-outerwear',
      title: 'No outerwear yet',
      detail: 'A neutral overshirt or jacket instantly upgrades every outfit you already have.',
      category: 'outerwear',
      priority: 3,
    });
  }
  if (shoes.length === 1) {
    gaps.push({
      id: 'one-shoe',
      title: 'Only one pair of shoes',
      detail: 'A second pair in a contrasting tone doubles your outfit combinations.',
      category: 'shoes',
      priority: 2,
    });
  }
  if (shoes.length >= 2) {
    const dominant = share(shoes, (s) => s.colors[0]);
    if (dominant && dominant.ratio >= 0.75) {
      const label = getColor(dominant.key)?.label.toLowerCase() ?? dominant.key;
      gaps.push({
        id: 'shoe-color',
        title: `Your shoes are mostly ${label}`,
        detail: 'Adding a different colourway gives darker or lighter outfits a better anchor.',
        category: 'shoes',
        priority: 1,
      });
    }
  }
  if (tops.length >= 3) {
    const dominant = share(tops, (t) => t.subcategory);
    if (dominant && dominant.ratio >= 0.7) {
      gaps.push({
        id: 'top-variety',
        title: `Lots of ${getSubcategoryLabel('top', dominant.key).toLowerCase()}s`,
        detail: 'A button up or knit would let you dress the same bottoms up a notch.',
        category: 'top',
        priority: 1,
      });
    }
  }
  if (bottoms.length >= 2 && bottoms.every((b) => b.formality <= 2)) {
    gaps.push({
      id: 'smart-bottom',
      title: 'No smarter bottoms',
      detail: 'A pair of chinos or trousers covers dinners, work and events.',
      category: 'bottom',
      priority: 2,
    });
  }
  if (accessories.length === 0 && items.length >= 6) {
    gaps.push({
      id: 'no-accessories',
      title: 'No accessories',
      detail: 'A belt, cap or simple chain is the cheapest way to make a look feel finished.',
      category: 'accessory',
      priority: 1,
    });
  }
  return gaps.sort((a, b) => b.priority - a.priority);
}
