import type { Category, ClothingItem, Formality } from '@/features/wardrobe/types';

let n = 0;

export function item(
  category: Category,
  subcategory: string,
  color: string,
  overrides: Partial<ClothingItem> = {},
): ClothingItem {
  n++;
  return {
    id: overrides.id ?? `${category}-${n}`,
    name: `${color} ${subcategory}`,
    category,
    subcategory,
    colors: [color],
    seasons: [],
    formality: 2 as Formality,
    favorite: false,
    wearCount: 0,
    photo: {},
    createdAt: new Date(2026, 0, n).toISOString(),
    updatedAt: new Date(2026, 0, n).toISOString(),
    ...overrides,
  };
}
