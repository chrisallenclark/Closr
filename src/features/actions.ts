import { Platform } from 'react-native';

import { deleteAllPhotos, deletePhoto } from '@/services/photos';
import { nowIso } from '@/lib/time';

import { useAccount } from './account/store';
import { useAvatar } from './avatar/store';
import { useOutfits } from './outfits/store';
import { withoutTracking } from './sync/engine';
import { useSync } from './sync/store';
import { useProfile } from './profile/store';
import { useWardrobe } from './wardrobe/store';

/**
 * Operations that span more than one store. Keeping them here avoids stores importing each other.
 */

export function deleteItem(id: string): void {
  const removed = useWardrobe.getState().removeItem(id);
  useOutfits.getState().detachItem(id);
  deletePhoto(removed?.photo);
  // Also removes the garment's photos and prepared layers from the backend (queued if offline).
  useAvatar.getState().forget(id);
}

export function wearOutfit(outfitId: string): void {
  const outfit = useOutfits.getState().outfits.find((o) => o.id === outfitId);
  if (!outfit) return;
  const at = nowIso();
  useOutfits.getState().markWorn(outfitId, at);
  useWardrobe.getState().markWorn(Object.values(outfit.pieces).filter(Boolean) as string[], at);
}

/**
 * Erases everything on this iPhone. Signed in, the account and its cloud copy are deleted first
 * (see account/store `deleteAccount`); without an account, prepared garments are removed from the
 * server too.
 */
export async function eraseAllData(): Promise<void> {
  if (useAccount.getState().signedIn) {
    await useAccount.getState().deleteAccount();
  } else {
    useAvatar.getState().reset(useWardrobe.getState().items.map((i) => i.id));
    void useAvatar.getState().pump();
  }
  withoutTracking(() => {
    useWardrobe.getState().reset();
    useOutfits.getState().reset();
    useProfile.getState().reset();
  });
  useSync.getState().reset();
  if (Platform.OS !== 'web') deleteAllPhotos();
}
