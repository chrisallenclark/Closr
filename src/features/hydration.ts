import { useSyncExternalStore } from 'react';

import { useOutfits } from './outfits/store';
import { useProfile } from './profile/store';
import { useWardrobe } from './wardrobe/store';

const stores = [useWardrobe, useOutfits, useProfile];

function allHydrated(): boolean {
  return stores.every((s) => s.persist.hasHydrated());
}

function subscribe(onChange: () => void): () => void {
  const unsubs = stores.map((s) => s.persist.onFinishHydration(onChange));
  return () => unsubs.forEach((u) => u());
}

/** True once every persisted store has loaded from disk. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, allHydrated, () => false);
}
