import { useMemo } from 'react';

import { SLOTS, type OutfitPieces, type Slot } from '../outfits/types';
import { useWardrobe } from './store';
import type { ClothingItem } from './types';

export function useItemMap(): Map<string, ClothingItem> {
  const items = useWardrobe((s) => s.items);
  return useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
}

export function useItem(id: string | undefined): ClothingItem | undefined {
  return useWardrobe((s) => (id ? s.items.find((i) => i.id === id) : undefined));
}

export interface ResolvedPiece {
  slot: Slot;
  item: ClothingItem;
}

/** Turns outfit piece ids into items in canonical slot order, skipping missing ones. */
export function resolvePieces(
  pieces: OutfitPieces,
  map: Map<string, ClothingItem>,
  extra?: ClothingItem,
): ResolvedPiece[] {
  const out: ResolvedPiece[] = [];
  for (const slot of SLOTS) {
    const id = pieces[slot];
    const item = id ? (extra && extra.id === id ? extra : map.get(id)) : undefined;
    if (item) out.push({ slot, item });
  }
  return out;
}
