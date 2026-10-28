import type { ColorId, PhotoRef } from '../wardrobe/types';

export const STYLE_TAGS = [
  'Streetwear',
  'Casual',
  'Minimal',
  'Classic',
  'Smart Casual',
  'Business / Tailored',
  'Old Money',
  'Quiet Luxury',
  'Preppy',
  'Vintage',
  'Y2K',
  'Bohemian',
  'Grunge',
  'Skater',
  'Punk',
  'Edgy / Alternative',
  'Gothic',
  'Dark Academia',
  'Western',
  'Coastal',
  'Outdoor',
  'Workwear',
  'Rugged',
  'Techwear',
  'Athleisure',
  'Layered',
  'Maximalist',
  'Artsy',
  'Romantic',
  'Coquette',
  'Glam',
  'Modest',
  'Clubwear / Nightlife',
  'Festival / Rave',
  'Sexy / Sultry',
  'Bold & Revealing',
  'Baddie',
] as const;

export type StyleTag = (typeof STYLE_TAGS)[number];

export type PaletteId =
  | 'earth'
  | 'neutrals'
  | 'monochrome'
  | 'dark'
  | 'pastels'
  | 'vibrant'
  | 'jewel'
  | 'muted';

export interface PaletteDef {
  id: PaletteId;
  label: string;
  /** Wardrobe colours this palette favours; drives outfit suggestions. */
  colors: ColorId[];
}

export const PALETTES: PaletteDef[] = [
  { id: 'earth', label: 'Earth Tones', colors: ['brown', 'tan', 'khaki', 'olive', 'rust', 'sage', 'cream', 'beige'] },
  { id: 'neutrals', label: 'Neutrals', colors: ['cream', 'beige', 'white', 'grey', 'navy', 'charcoal', 'black'] },
  { id: 'monochrome', label: 'Monochrome', colors: ['black', 'white', 'grey', 'charcoal', 'silver'] },
  { id: 'dark', label: 'Dark & Moody', colors: ['black', 'charcoal', 'navy', 'burgundy', 'olive', 'brown'] },
  { id: 'pastels', label: 'Pastels', colors: ['pink', 'lavender', 'sage', 'cream', 'yellow'] },
  { id: 'vibrant', label: 'Vibrant', colors: ['red', 'orange', 'yellow', 'blue', 'green', 'teal', 'purple'] },
  { id: 'jewel', label: 'Jewel Tones', colors: ['burgundy', 'teal', 'purple', 'green', 'navy', 'gold'] },
  { id: 'muted', label: 'Muted', colors: ['sage', 'khaki', 'grey', 'beige', 'denim', 'tan'] },
];

export const FITS = ['Slim', 'Fitted', 'Regular', 'Relaxed', 'Oversized', 'Mixed'] as const;

export type Fit = (typeof FITS)[number];

export interface StyleProfile {
  name: string;
  styleTags: StyleTag[];
  palettes: PaletteId[];
  /** Individual swatches the user loves, on top of their palettes. */
  favoriteColors: ColorId[];
  avoidColors: ColorId[];
  fit?: Fit;
  /** Full-body reference photo saved for virtual try-on (feature in development). */
  bodyPhoto?: PhotoRef;
  createdAt: string;
  updatedAt: string;
}

/** Every colour the user leans toward: their palettes plus individually picked swatches. */
export function preferredColors(profile: Pick<StyleProfile, 'palettes' | 'favoriteColors'>): ColorId[] {
  const set = new Set<ColorId>(profile.favoriteColors);
  for (const id of profile.palettes) {
    for (const c of PALETTES.find((p) => p.id === id)?.colors ?? []) set.add(c);
  }
  return [...set];
}
