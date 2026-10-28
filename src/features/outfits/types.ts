import type { Category } from '../wardrobe/types';

/** Slots map 1:1 to wardrobe categories. */
export type Slot = Category;

export const SLOTS: Slot[] = ['top', 'bottom', 'onepiece', 'outerwear', 'shoes', 'accessory'];
/** Slots a complete outfit needs when built from separates; a one-piece replaces top + bottom. */
export const REQUIRED_SLOTS: Slot[] = ['top', 'bottom', 'shoes'];

/** Item id per slot. */
export type OutfitPieces = Partial<Record<Slot, string>>;

export const OCCASIONS = [
  'Everyday',
  'Work',
  'Weekend',
  'Date Night',
  'Event',
  'Travel',
  'Gym',
] as const;

export type Occasion = (typeof OCCASIONS)[number];

export interface Outfit {
  id: string;
  name: string;
  pieces: OutfitPieces;
  occasion?: Occasion;
  favorite: boolean;
  source: 'manual' | 'shuffle';
  wearCount: number;
  lastWornAt?: string;
  createdAt: string;
  updatedAt: string;
}
