import type { Category, ColorId, Formality, ItemFit, Season } from './types';

export interface SubcategoryDef {
  id: string;
  label: string;
  formality: Formality;
  /** Fit implied by the type itself (e.g. Baggy Tee), pre-selected in the form. */
  fit?: ItemFit;
}

export interface CategoryDef {
  id: Category;
  label: string;
  plural: string;
  subcategories: SubcategoryDef[];
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'top',
    label: 'Top',
    plural: 'Tops',
    subcategories: [
      { id: 'graphic-tee', label: 'Graphic Tee', formality: 1 },
      { id: 'basic-tee', label: 'Basic Tee', formality: 2 },
      { id: 'baggy-tee', label: 'Baggy Tee', formality: 1, fit: 'Oversized' },
      { id: 'cutoff-tee', label: 'Cutoff Tee', formality: 1 },
      { id: 'crop-top', label: 'Crop Top', formality: 2 },
      { id: 'tank', label: 'Tank', formality: 1 },
      { id: 'long-sleeve', label: 'Long Sleeve', formality: 2 },
      { id: 'henley', label: 'Henley', formality: 2 },
      { id: 'polo', label: 'Polo', formality: 3 },
      { id: 'button-up', label: 'Button Up', formality: 3 },
      { id: 'flannel', label: 'Flannel', formality: 2 },
      { id: 'dress-shirt', label: 'Dress Shirt', formality: 4 },
      { id: 'blouse', label: 'Blouse', formality: 3 },
      { id: 'sweater', label: 'Sweater', formality: 3 },
      { id: 'cardigan', label: 'Cardigan', formality: 3 },
      { id: 'hoodie', label: 'Hoodie', formality: 1 },
      { id: 'sweatshirt', label: 'Sweatshirt', formality: 1 },
      { id: 'jersey', label: 'Jersey', formality: 1 },
      { id: 'corset', label: 'Corset', formality: 3 },
      { id: 'bodysuit', label: 'Bodysuit', formality: 2 },
      { id: 'bikini-top', label: 'Bikini Top', formality: 1 },
    ],
  },
  {
    id: 'bottom',
    label: 'Bottom',
    plural: 'Bottoms',
    subcategories: [
      { id: 'jeans', label: 'Jeans', formality: 2 },
      { id: 'baggy-jeans', label: 'Baggy Jeans', formality: 2, fit: 'Oversized' },
      { id: 'cargo', label: 'Cargo Pants', formality: 2 },
      { id: 'carpenter', label: 'Carpenter Pants', formality: 2 },
      { id: 'chinos', label: 'Chinos', formality: 3 },
      { id: 'trousers', label: 'Trousers', formality: 4 },
      { id: 'joggers', label: 'Joggers', formality: 1 },
      { id: 'sweatpants', label: 'Sweatpants', formality: 1 },
      { id: 'shorts', label: 'Shorts', formality: 1 },
      { id: 'cutoff-shorts', label: 'Cutoff Shorts', formality: 1 },
      { id: 'jorts', label: 'Jorts', formality: 1 },
      { id: 'skirt', label: 'Skirt', formality: 3 },
      { id: 'leggings', label: 'Leggings', formality: 1 },
      { id: 'swim-trunks', label: 'Swim Trunks', formality: 1 },
      { id: 'bikini-bottom', label: 'Bikini Bottom', formality: 1 },
    ],
  },
  {
    id: 'onepiece',
    label: 'One-Piece',
    plural: 'One-Pieces',
    subcategories: [
      { id: 'dress', label: 'Dress', formality: 3 },
      { id: 'jumpsuit', label: 'Jumpsuit', formality: 3 },
      { id: 'romper', label: 'Romper', formality: 2 },
      { id: 'overalls', label: 'Overalls', formality: 2 },
      { id: 'swimsuit', label: 'Swimsuit', formality: 1 },
      { id: 'tracksuit', label: 'Tracksuit', formality: 1 },
    ],
  },
  {
    id: 'outerwear',
    label: 'Outerwear',
    plural: 'Outerwear',
    subcategories: [
      { id: 'jacket', label: 'Jacket', formality: 3 },
      { id: 'overshirt', label: 'Overshirt', formality: 2 },
      { id: 'denim-jacket', label: 'Denim Jacket', formality: 2 },
      { id: 'leather-jacket', label: 'Leather Jacket', formality: 3 },
      { id: 'bomber', label: 'Bomber', formality: 2 },
      { id: 'varsity', label: 'Varsity Jacket', formality: 2 },
      { id: 'windbreaker', label: 'Windbreaker', formality: 1 },
      { id: 'fleece', label: 'Fleece', formality: 1 },
      { id: 'vest', label: 'Vest', formality: 2 },
      { id: 'puffer', label: 'Puffer', formality: 2 },
      { id: 'coat', label: 'Coat', formality: 4 },
      { id: 'trench', label: 'Trench Coat', formality: 4 },
      { id: 'blazer', label: 'Blazer', formality: 4 },
    ],
  },
  {
    id: 'shoes',
    label: 'Shoes',
    plural: 'Shoes',
    subcategories: [
      { id: 'sneakers', label: 'Sneakers', formality: 2 },
      { id: 'running', label: 'Running Shoes', formality: 1 },
      { id: 'skate', label: 'Skate Shoes', formality: 1 },
      { id: 'boots', label: 'Boots', formality: 3 },
      { id: 'cowboy-boots', label: 'Cowboy Boots', formality: 3 },
      { id: 'loafers', label: 'Loafers', formality: 4 },
      { id: 'dress-shoes', label: 'Dress Shoes', formality: 5 },
      { id: 'heels', label: 'Heels', formality: 4 },
      { id: 'flats', label: 'Flats', formality: 3 },
      { id: 'sandals', label: 'Sandals', formality: 1 },
      { id: 'slides', label: 'Slides', formality: 1 },
    ],
  },
  {
    id: 'accessory',
    label: 'Accessory',
    plural: 'Accessories',
    subcategories: [
      { id: 'hat', label: 'Hat', formality: 2 },
      { id: 'beanie', label: 'Beanie', formality: 1 },
      { id: 'belt', label: 'Belt', formality: 3 },
      { id: 'watch', label: 'Watch', formality: 3 },
      { id: 'jewelry', label: 'Jewelry', formality: 3 },
      { id: 'chain', label: 'Chain', formality: 2 },
      { id: 'sunglasses', label: 'Sunglasses', formality: 2 },
      { id: 'bag', label: 'Bag', formality: 3 },
      { id: 'scarf', label: 'Bandana / Scarf', formality: 2 },
    ],
  },
];

export const CATEGORY_IDS: Category[] = CATEGORIES.map((c) => c.id);

export function getCategory(id: Category): CategoryDef {
  const def = CATEGORIES.find((c) => c.id === id);
  if (!def) throw new Error(`Unknown category: ${id}`);
  return def;
}

export function getSubcategoryLabel(category: Category, sub: string): string {
  return getCategory(category).subcategories.find((s) => s.id === sub)?.label ?? sub;
}

export function defaultFormality(category: Category, sub: string): Formality {
  return getCategory(category).subcategories.find((s) => s.id === sub)?.formality ?? 2;
}

/**
 * Colour families drive the harmony engine:
 * - neutral: pairs with anything
 * - earth:   warm neutrals that pair with neutrals, earth tones and most muted colours
 * - chroma:  a real hue; harmony is judged by hue distance
 */
export type ColorFamily = 'neutral' | 'earth' | 'chroma';

export interface ColorDef {
  id: ColorId;
  label: string;
  hex: string;
  family: ColorFamily;
  /** Hue in degrees, used for chroma/earth harmony. */
  hue: number;
}

export const COLORS: ColorDef[] = [
  { id: 'black', label: 'Black', hex: '#1C1C1C', family: 'neutral', hue: 0 },
  { id: 'charcoal', label: 'Charcoal', hex: '#3E3E3E', family: 'neutral', hue: 0 },
  { id: 'grey', label: 'Grey', hex: '#8E8E8E', family: 'neutral', hue: 0 },
  { id: 'white', label: 'White', hex: '#F7F5F0', family: 'neutral', hue: 0 },
  { id: 'cream', label: 'Cream', hex: '#EDE3CF', family: 'neutral', hue: 40 },
  { id: 'beige', label: 'Beige', hex: '#D6C3A3', family: 'neutral', hue: 38 },
  { id: 'denim', label: 'Denim', hex: '#4F6A8F', family: 'neutral', hue: 215 },
  { id: 'navy', label: 'Navy', hex: '#22304A', family: 'neutral', hue: 220 },
  { id: 'brown', label: 'Brown', hex: '#5C3F2A', family: 'earth', hue: 25 },
  { id: 'tan', label: 'Tan', hex: '#A57E57', family: 'earth', hue: 30 },
  { id: 'khaki', label: 'Khaki', hex: '#A89A72', family: 'earth', hue: 48 },
  { id: 'olive', label: 'Olive', hex: '#5D5F3A', family: 'earth', hue: 62 },
  { id: 'rust', label: 'Rust', hex: '#9A4A2B', family: 'earth', hue: 18 },
  { id: 'burgundy', label: 'Burgundy', hex: '#5E1F2A', family: 'chroma', hue: 350 },
  { id: 'red', label: 'Red', hex: '#B3322E', family: 'chroma', hue: 2 },
  { id: 'orange', label: 'Orange', hex: '#D9772E', family: 'chroma', hue: 26 },
  { id: 'mustard', label: 'Mustard', hex: '#C9A13A', family: 'chroma', hue: 44 },
  { id: 'yellow', label: 'Yellow', hex: '#E6CF4A', family: 'chroma', hue: 54 },
  { id: 'green', label: 'Green', hex: '#3E7A4F', family: 'chroma', hue: 140 },
  { id: 'sage', label: 'Sage', hex: '#9AA88A', family: 'earth', hue: 95 },
  { id: 'teal', label: 'Teal', hex: '#2E6E72', family: 'chroma', hue: 184 },
  { id: 'blue', label: 'Blue', hex: '#3263A8', family: 'chroma', hue: 214 },
  { id: 'lavender', label: 'Lavender', hex: '#A99BC8', family: 'chroma', hue: 262 },
  { id: 'purple', label: 'Purple', hex: '#5B3A7A', family: 'chroma', hue: 275 },
  { id: 'pink', label: 'Pink', hex: '#E0A3AE', family: 'chroma', hue: 350 },
  { id: 'silver', label: 'Silver', hex: '#C4C6C8', family: 'neutral', hue: 0 },
  { id: 'gold', label: 'Gold', hex: '#C6A15B', family: 'earth', hue: 40 },
];

const COLOR_MAP = new Map(COLORS.map((c) => [c.id, c]));

export function getColor(id: ColorId): ColorDef | undefined {
  return COLOR_MAP.get(id);
}

export const SEASONS: { id: Season; label: string }[] = [
  { id: 'spring', label: 'Spring' },
  { id: 'summer', label: 'Summer' },
  { id: 'fall', label: 'Fall' },
  { id: 'winter', label: 'Winter' },
];

export const ITEM_FITS: ItemFit[] = ['Slim', 'Fitted', 'Regular', 'Relaxed', 'Oversized'];

/** Categories where fit is meaningful (not shoes or accessories). */
export function hasFit(category: Category): boolean {
  return category !== 'shoes' && category !== 'accessory';
}

export function defaultFit(category: Category, sub: string): ItemFit | undefined {
  return getCategory(category).subcategories.find((s) => s.id === sub)?.fit;
}

export const FORMALITY_LABELS: Record<Formality, string> = {
  1: 'Lounge',
  2: 'Casual',
  3: 'Smart',
  4: 'Sharp',
  5: 'Formal',
};

/** Suggests a name like "Brown Cargo Pants" from the selected tags. */
export function suggestName(category: Category, sub: string, colors: ColorId[]): string {
  const color = colors[0] ? getColor(colors[0])?.label : undefined;
  const label = getSubcategoryLabel(category, sub);
  return [color, label].filter(Boolean).join(' ');
}
