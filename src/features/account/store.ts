import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { ApiError, avatarApi, avatarBackendConfigured, SignInRequired } from '@/services/avatarApi';
import { deleteAllPhotos } from '@/services/photos';
import { appStorage, STORAGE_KEYS } from '@/services/storage';

import { useAvatar } from '../avatar/store';
import { useOutfits } from '../outfits/store';
import { syncNow, withoutTracking } from '../sync/engine';
import { useSync } from '../sync/store';
import { useWardrobe } from '../wardrobe/store';

/**
 * The person's Closr account. The wardrobe works without one (it lives on the iPhone); signing in
 * with Apple backs it up, restores it on a new iPhone, and unlocks mannequin preparation.
 */
interface AccountState {
  signedIn: boolean;
  email: string | null;
  /** The server only accepts Apple accounts (production): prompt before cloud features. */
  signInRequired: boolean;
  signIn: () => Promise<'ok' | 'cancelled'>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  refresh: () => Promise<void>;
  markSignInRequired: () => void;
}

/** Clears this iPhone's copy of the wardrobe (not the cloud copy) without recording deletions. */
function clearLocalWardrobe() {
  withoutTracking(() => {
    useWardrobe.getState().reset();
    useOutfits.getState().reset();
  });
  useAvatar.setState({ byItem: {}, assets: null, urls: {}, jobsSince: 0, assetsStale: true, pendingDeletes: [] });
  useSync.getState().reset();
  deleteAllPhotos();
}

export const useAccount = create<AccountState>()(
  persist(
    (set) => ({
      signedIn: false,
      email: null,
      signInRequired: false,

      signIn: async () => {
        try {
          const me = await avatarApi.signInWithApple();
          set({ signedIn: true, email: me.email, signInRequired: false });
        } catch (error) {
          if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') return 'cancelled';
          throw error;
        }
        // Back up this iPhone's wardrobe and bring in anything already in the account.
        useSync.getState().reset();
        await syncNow();
        useAvatar.setState({ assetsStale: true });
        void useAvatar.getState().pump();
        return 'ok';
      },

      signOut: async () => {
        await syncNow(); // nothing is lost: everything reaches the account first
        await avatarApi.signOut();
        clearLocalWardrobe();
        set({ signedIn: false, email: null });
      },

      deleteAccount: async () => {
        await avatarApi.deleteAccount();
        clearLocalWardrobe();
        set({ signedIn: false, email: null });
      },

      refresh: async () => {
        if (!avatarBackendConfigured()) return;
        try {
          const me = await avatarApi.me();
          set({ signedIn: me.signedIn, email: me.email });
        } catch (error) {
          if (error instanceof SignInRequired) set({ signedIn: false, signInRequired: true });
          else if (error instanceof ApiError && error.status === 401) set({ signedIn: false });
        }
      },

      markSignInRequired: () => set({ signInRequired: true }),
    }),
    {
      name: STORAGE_KEYS.account,
      storage: appStorage,
      version: 1,
      partialize: (s) => ({ signedIn: s.signedIn, email: s.email, signInRequired: s.signInRequired }),
    },
  ),
);
