import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { newId } from '@/lib/id';
import { nowIso } from '@/lib/time';
import { deletePhoto, persistPhoto, type PickedPhoto } from '@/services/photos';
import { appStorage, STORAGE_KEYS } from '@/services/storage';

import type { ClothingDraft, ClothingItem } from './types';

interface WardrobeState {
  items: ClothingItem[];
  addItem: (draft: ClothingDraft, photo: PickedPhoto) => Promise<ClothingItem>;
  updateItem: (id: string, patch: Partial<ClothingDraft>) => void;
  replacePhoto: (id: string, photo: PickedPhoto) => Promise<void>;
  /** Removes the record only — use `deleteItem` in features/actions to also clean up files/outfits. */
  removeItem: (id: string) => ClothingItem | undefined;
  toggleFavorite: (id: string) => void;
  markWorn: (ids: string[], at?: string) => void;
  reset: () => void;
}

function patchItem(items: ClothingItem[], id: string, fn: (i: ClothingItem) => ClothingItem) {
  return items.map((i) => (i.id === id ? fn(i) : i));
}

export const useWardrobe = create<WardrobeState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: async (draft, photo) => {
        const id = newId();
        const ref = await persistPhoto(photo, id);
        const now = nowIso();
        const item: ClothingItem = {
          ...draft,
          id,
          favorite: false,
          wearCount: 0,
          photo: ref,
          createdAt: now,
          updatedAt: now,
        };
        set({ items: [item, ...get().items] });
        return item;
      },

      updateItem: (id, patch) =>
        set({
          items: patchItem(get().items, id, (i) => ({ ...i, ...patch, updatedAt: nowIso() })),
        }),

      replacePhoto: async (id, photo) => {
        // A fresh file name avoids stale image caches keyed by URI.
        const previous = get().items.find((i) => i.id === id)?.photo;
        const ref = await persistPhoto(photo, `${id}-${Date.now()}`);
        set({
          items: patchItem(get().items, id, (i) => ({
            ...i,
            // A new photo invalidates any cutout derived from the old one.
            photo: { ...ref, remoteUrl: undefined, cutoutPath: undefined },
            updatedAt: nowIso(),
          })),
        });
        deletePhoto(previous);
      },

      removeItem: (id) => {
        const item = get().items.find((i) => i.id === id);
        set({ items: get().items.filter((i) => i.id !== id) });
        return item;
      },

      toggleFavorite: (id) =>
        set({
          items: patchItem(get().items, id, (i) => ({
            ...i,
            favorite: !i.favorite,
            updatedAt: nowIso(),
          })),
        }),

      markWorn: (ids, at = nowIso()) => {
        const wanted = new Set(ids);
        set({
          items: get().items.map((i) =>
            wanted.has(i.id)
              ? { ...i, wearCount: i.wearCount + 1, lastWornAt: at, updatedAt: at }
              : i,
          ),
        });
      },

      reset: () => set({ items: [] }),
    }),
    {
      name: STORAGE_KEYS.wardrobe,
      storage: appStorage,
      version: 1,
      partialize: (s) => ({ items: s.items }),
    },
  ),
);
