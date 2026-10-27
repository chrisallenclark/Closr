import { Platform } from 'react-native';

import { deleteAllPhotos, deletePhoto } from '@/services/photos';
import { nowIso } from '@/lib/time';

import { useOutfits } from './outfits/store';
import { useProfile } from './profile/store';
import { useWardrobe } from './wardrobe/store';

/**
 * Operations that span more than one store. Keeping them here avoids stores importing each other.
 */

export function deleteItem(id: string): void {
  const removed = useWardrobe.getState().removeItem(id);
  useOutfits.getState().detachItem(id);
  deletePhoto(removed?.photo);
}

export function wearOutfit(outfitId: string): void {
  const outfit = useOutfits.getState().outfits.find((o) => o.id === outfitId);
  if (!outfit) return;
  const at = nowIso();
  useOutfits.getState().markWorn(outfitId, at);
  useWardrobe.getState().markWorn(Object.values(outfit.pieces).filter(Boolean) as string[], at);
}

export async function eraseAllData(): Promise<void> {
  useWardrobe.getState().reset();
  useOutfits.getState().reset();
  useProfile.getState().reset();
  if (Platform.OS !== 'web') deleteAllPhotos();
}
