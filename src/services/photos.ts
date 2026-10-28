import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking, Platform } from 'react-native';

import type { PhotoRef } from '@/features/wardrobe/types';

/**
 * Photo pipeline: pick → downscale/compress → move into the app's document directory.
 *
 * Stored paths are *relative* (e.g. "photos/<id>.jpg"); the absolute container path on iOS can
 * change between app updates, so it's resolved at render time. Files live under
 * Documents/closr/, which iOS backs up with the device.
 */

const ROOT = 'closr';
const PHOTO_DIR = 'photos';
const MAX_EDGE = 1400;
const ABSOLUTE = /^(https?:|file:|data:|blob:)/;

export type PhotoSource = 'camera' | 'library';

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

let rootUri: string | null = null;

function rootDirectory(): Directory {
  return new Directory(Paths.document, ROOT);
}

function rootDirUri(): string {
  if (!rootUri) {
    const uri = rootDirectory().uri;
    rootUri = uri.endsWith('/') ? uri : `${uri}/`;
  }
  return rootUri;
}

/** Absolute URI to render for a photo reference. Prefers a background-removed cutout. */
export function resolvePhotoUri(ref?: PhotoRef, opts: { preferCutout?: boolean } = {}): string | undefined {
  if (!ref) return undefined;
  const path = (opts.preferCutout !== false && ref.cutoutPath) || ref.localPath;
  if (path) return ABSOLUTE.test(path) || Platform.OS === 'web' ? path : rootDirUri() + path;
  return ref.remoteUrl;
}

function settingsAlert(what: string) {
  Alert.alert(
    `Allow ${what} access`,
    `Closr needs ${what} access to add photos of your clothes. You can turn it on in Settings.`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ],
  );
}

/** Opens the camera or photo library. Returns null if the user cancels or denies access. */
export async function pickPhoto(source: PhotoSource): Promise<PickedPhoto | null> {
  // No forced crop: the whole photo is kept and shown fitted on the studio backdrop.
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
  };

  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) settingsAlert('camera');
      return null;
    }
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }

  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/**
 * Downscales the picked image and stores it as `<name>.jpg` in the photo directory.
 * `name` should be the owning record's id so files are easy to reconcile with data.
 */
export async function persistPhoto(photo: PickedPhoto, name: string): Promise<PhotoRef> {
  const longEdge = Math.max(photo.width, photo.height);
  const context = ImageManipulator.manipulate(photo.uri);
  if (longEdge > MAX_EDGE) {
    context.resize(photo.width >= photo.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });

  if (Platform.OS === 'web') {
    // Web is only used for development previews; keep the in-memory URI.
    return { localPath: saved.uri, width: saved.width, height: saved.height };
  }

  const dir = new Directory(rootDirectory(), PHOTO_DIR);
  dir.create({ intermediates: true, idempotent: true });
  const fileName = `${name}.jpg`;
  const dest = new File(dir, fileName);
  if (dest.exists) dest.delete();
  await new File(saved.uri).move(dest);

  return { localPath: `${PHOTO_DIR}/${fileName}`, width: saved.width, height: saved.height };
}

/** Removes a photo's files from disk. Safe to call with missing files. */
export function deletePhoto(ref?: PhotoRef): void {
  if (!ref || Platform.OS === 'web') return;
  for (const path of [ref.localPath, ref.cutoutPath]) {
    if (!path || ABSOLUTE.test(path)) continue;
    try {
      const file = new File(rootDirectory(), path);
      if (file.exists) file.delete();
    } catch (error) {
      console.warn('Failed to delete photo', path, error);
    }
  }
}

/** Deletes every stored photo (used by "Erase all data"). */
export function deleteAllPhotos(): void {
  if (Platform.OS === 'web') return;
  try {
    const dir = new Directory(rootDirectory(), PHOTO_DIR);
    if (dir.exists) dir.delete();
  } catch (error) {
    console.warn('Failed to clear photos', error);
  }
}
