/**
 * Contracts for the AI features planned for Phase 2. Nothing implements these yet — the app
 * uses the rule-based engine in `features/outfits` and labels it as such. When a backend exists
 * (an edge function that holds the model API key; keys never ship in the app), implementations
 * plug in here without the screens changing shape.
 */
import type { OutfitPieces } from '@/features/outfits/types';
import type { ClothingDraft, PhotoRef } from '@/features/wardrobe/types';

export interface AutoTagger {
  /** Suggests category, colours, formality etc. from a clothing photo. */
  tagPhoto(photo: PhotoRef): Promise<Partial<ClothingDraft>>;
}

export interface BackgroundRemover {
  /** Returns a transparent PNG cutout stored alongside the original photo. */
  removeBackground(photo: PhotoRef): Promise<PhotoRef>;
}

export interface Stylist {
  /** Free-form requests such as "dinner downtown, 55°F, a bit dressed up". */
  suggestOutfits(request: string, context: { itemIds: string[] }): Promise<OutfitPieces[]>;
}
