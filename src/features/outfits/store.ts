import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { newId } from '@/lib/id';
import { nowIso } from '@/lib/time';
import { appStorage, STORAGE_KEYS } from '@/services/storage';

import type { Occasion, Outfit, OutfitPieces, Slot } from './types';

export interface DailyPick {
  day: string;
  pieces: OutfitPieces;
}

interface NewOutfit {
  name: string;
  pieces: OutfitPieces;
  occasion?: Occasion;
  source: Outfit['source'];
}

interface OutfitsState {
  outfits: Outfit[];
  daily: DailyPick | null;
  addOutfit: (input: NewOutfit) => Outfit;
  updateOutfit: (id: string, patch: Partial<Pick<Outfit, 'name' | 'pieces' | 'occasion'>>) => void;
  removeOutfit: (id: string) => void;
  toggleFavorite: (id: string) => void;
  markWorn: (id: string, at?: string) => void;
  /** Drops a deleted wardrobe item from every outfit that used it. */
  detachItem: (itemId: string) => void;
  setDaily: (daily: DailyPick | null) => void;
  reset: () => void;
}

export const useOutfits = create<OutfitsState>()(
  persist(
    (set, get) => ({
      outfits: [],
      daily: null,

      addOutfit: (input) => {
        const now = nowIso();
        const outfit: Outfit = {
          ...input,
          id: newId(),
          favorite: false,
          wearCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        set({ outfits: [outfit, ...get().outfits] });
        return outfit;
      },

      updateOutfit: (id, patch) =>
        set({
          outfits: get().outfits.map((o) =>
            o.id === id ? { ...o, ...patch, updatedAt: nowIso() } : o,
          ),
        }),

      removeOutfit: (id) => set({ outfits: get().outfits.filter((o) => o.id !== id) }),

      toggleFavorite: (id) =>
        set({
          outfits: get().outfits.map((o) =>
            o.id === id ? { ...o, favorite: !o.favorite, updatedAt: nowIso() } : o,
          ),
        }),

      markWorn: (id, at = nowIso()) =>
        set({
          outfits: get().outfits.map((o) =>
            o.id === id ? { ...o, wearCount: o.wearCount + 1, lastWornAt: at, updatedAt: at } : o,
          ),
        }),

      detachItem: (itemId) => {
        const strip = (pieces: OutfitPieces) => {
          const next: OutfitPieces = { ...pieces };
          for (const slot of Object.keys(next) as Slot[]) {
            if (next[slot] === itemId) delete next[slot];
          }
          return next;
        };
        const { daily } = get();
        set({
          outfits: get().outfits.map((o) =>
            Object.values(o.pieces).includes(itemId)
              ? { ...o, pieces: strip(o.pieces), updatedAt: nowIso() }
              : o,
          ),
          daily: daily && Object.values(daily.pieces).includes(itemId) ? null : daily,
        });
      },

      setDaily: (daily) => set({ daily }),

      reset: () => set({ outfits: [], daily: null }),
    }),
    {
      name: STORAGE_KEYS.outfits,
      storage: appStorage,
      version: 1,
      partialize: (s) => ({ outfits: s.outfits, daily: s.daily }),
    },
  ),
);
