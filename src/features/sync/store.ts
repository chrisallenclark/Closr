import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { SyncChange } from '@/services/avatarApi';
import { appStorage, STORAGE_KEYS } from '@/services/storage';

/**
 * Bookkeeping for wardrobe sync. Kept apart from the records themselves so the wardrobe, outfit
 * and profile stores stay exactly as they were: sync only reads them and writes merged results.
 */
interface SyncState {
  /** Server cursor: every change after it has not been seen on this device yet. */
  cursor: number;
  /** Per record (`kind:id`), the version last sent, so unchanged records are never sent again. */
  pushed: Record<string, string>;
  /** Deletions waiting to reach the server. */
  tombstones: SyncChange[];
  lastSyncAt: number | null;
  error: string | null;
  reset: () => void;
}

export const useSync = create<SyncState>()(
  persist(
    (set) => ({
      cursor: 0,
      pushed: {},
      tombstones: [],
      lastSyncAt: null,
      error: null,
      reset: () => set({ cursor: 0, pushed: {}, tombstones: [], lastSyncAt: null, error: null }),
    }),
    {
      name: STORAGE_KEYS.sync,
      storage: appStorage,
      version: 1,
      partialize: (s) => ({ cursor: s.cursor, pushed: s.pushed, tombstones: s.tombstones, lastSyncAt: s.lastSyncAt }),
    },
  ),
);
