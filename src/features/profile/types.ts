import type { ColorId, PhotoRef } from '../wardrobe/types';

export const STYLE_TAGS = [
  'Streetwear',
  'Minimal',
  'Vintage',
  'Layered',
  'Smart Casual',
  'Workwear',
  'Classic',
  'Athleisure',
  'Earth Tones',
  'Monochrome',
  'Rugged',
  'Preppy',
] as const;

export type StyleTag = (typeof STYLE_TAGS)[number];

export interface StyleProfile {
  name: string;
  styleTags: StyleTag[];
  favoriteColors: ColorId[];
  avoidColors: ColorId[];
  /** Full-body reference photo saved for virtual try-on (feature in development). */
  bodyPhoto?: PhotoRef;
  createdAt: string;
  updatedAt: string;
}
