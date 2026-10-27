import type { Category, ClothingItem, ColorId, Season } from './types';

export interface WardrobeFilter {
  category?: Category;
  subcategory?: string;
  colors?: ColorId[];
  seasons?: Season[];
  favoritesOnly?: boolean;
  query?: string;
}

export function filterItems(items: ClothingItem[], f: WardrobeFilter): ClothingItem[] {
  const q = f.query?.trim().toLowerCase();
  return items.filter((i) => {
    if (f.category && i.category !== f.category) return false;
    if (f.subcategory && i.subcategory !== f.subcategory) return false;
    if (f.favoritesOnly && !i.favorite) return false;
    if (f.colors?.length && !i.colors.some((c) => f.colors!.includes(c))) return false;
    if (f.seasons?.length && !i.seasons.some((s) => f.seasons!.includes(s))) return false;
    if (q) {
      const hay = [i.name, i.brand, i.subcategory, i.notes].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export interface SubcategoryGroup {
  category: Category;
  subcategory: string;
  count: number;
  /** Most recently added item, used as the tile's cover image. */
  cover: ClothingItem;
}

/** Groups items by subcategory for the "Graphic Tee · 4 items" tiles, largest groups first. */
export function groupBySubcategory(items: ClothingItem[]): SubcategoryGroup[] {
  const map = new Map<string, SubcategoryGroup>();
  for (const item of items) {
    const key = `${item.category}:${item.subcategory}`;
    const g = map.get(key);
    if (g) {
      g.count++;
      if (item.createdAt > g.cover.createdAt) g.cover = item;
    } else {
      map.set(key, { category: item.category, subcategory: item.subcategory, count: 1, cover: item });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function countByCategory(items: ClothingItem[]): Record<Category, number> {
  const counts: Record<Category, number> = { top: 0, bottom: 0, outerwear: 0, shoes: 0, accessory: 0 };
  for (const i of items) counts[i.category]++;
  return counts;
}

export function activeFilterCount(f: WardrobeFilter): number {
  return (f.colors?.length ?? 0) + (f.seasons?.length ?? 0) + (f.favoritesOnly ? 1 : 0);
}
