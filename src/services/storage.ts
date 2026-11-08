import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

/**
 * Persistence for the local-first stores. Everything lives on the device first; each store keeps
 * a schema version so data can be migrated, and records carry uuid ids + timestamps, which the
 * sync engine (features/sync) uses to back them up to the signed-in account.
 */
export const appStorage = createJSONStorage(() => AsyncStorage);

export const STORAGE_KEYS = {
  wardrobe: 'closr.wardrobe',
  outfits: 'closr.outfits',
  profile: 'closr.profile',
  avatar: 'closr.avatar',
  sync: 'closr.sync',
  account: 'closr.account',
} as const;
