import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

/**
 * Persistence for the local-first stores. Everything lives on-device for now; each store keeps
 * a schema version so data can be migrated, and records carry uuid ids + timestamps so they can
 * be synced to a backend later without reshaping.
 */
export const appStorage = createJSONStorage(() => AsyncStorage);

export const STORAGE_KEYS = {
  wardrobe: 'closr.wardrobe',
  outfits: 'closr.outfits',
  profile: 'closr.profile',
} as const;
