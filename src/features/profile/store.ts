import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { nowIso } from '@/lib/time';
import { deletePhoto, persistPhoto, type PickedPhoto } from '@/services/photos';
import { appStorage, STORAGE_KEYS } from '@/services/storage';

import type { StyleProfile } from './types';

type ProfileInput = Pick<StyleProfile, 'name' | 'styleTags' | 'favoriteColors' | 'avoidColors'>;

interface ProfileState {
  profile: StyleProfile | null;
  completeOnboarding: (input: ProfileInput) => void;
  updateProfile: (patch: Partial<ProfileInput>) => void;
  setBodyPhoto: (photo: PickedPhoto) => Promise<void>;
  reset: () => void;
}

export const BODY_PHOTO_NAME = 'body-reference';

export const useProfile = create<ProfileState>()(
  persist(
    (set, get) => ({
      profile: null,

      completeOnboarding: (input) => {
        const now = nowIso();
        set({ profile: { ...input, createdAt: now, updatedAt: now } });
      },

      updateProfile: (patch) => {
        const profile = get().profile;
        if (!profile) return;
        set({ profile: { ...profile, ...patch, updatedAt: nowIso() } });
      },

      setBodyPhoto: async (photo) => {
        const ref = await persistPhoto(photo, `${BODY_PHOTO_NAME}-${Date.now()}`);
        const profile = get().profile;
        if (!profile) return;
        set({ profile: { ...profile, bodyPhoto: ref, updatedAt: nowIso() } });
        deletePhoto(profile.bodyPhoto);
      },

      reset: () => set({ profile: null }),
    }),
    {
      name: STORAGE_KEYS.profile,
      storage: appStorage,
      version: 1,
      partialize: (s) => ({ profile: s.profile }),
    },
  ),
);
