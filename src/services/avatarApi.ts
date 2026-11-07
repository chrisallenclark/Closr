import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type {
  Analysis,
  Corrections,
  Job,
  MannequinCategory,
  Usage,
  Variant,
  WardrobeAssets,
} from '@/features/avatar/types';

/**
 * Client for the Closr garment-preparation backend (server/closr_server).
 *
 * The app never holds a model API key: it uploads photos and asks the backend to prepare them,
 * and the backend enforces credits, rate limits and spending caps. The device signs in with an
 * anonymous token kept in the iOS Keychain (Secure Store). Image files come back as short-lived
 * signed URLs, cached on the device by expo-image under their immutable storage key.
 */

const BASE = (process.env.EXPO_PUBLIC_CLOSR_API_URL ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'closr.device-token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }

  /** No connection or the server is down: worth retrying later, unchanged. */
  get offline() {
    return this.status === 0 || this.status >= 500;
  }
}

/** True when this build has a backend to talk to. Without one the feature stays hidden. */
export function avatarBackendConfigured(): boolean {
  return BASE.length > 0;
}

const tokenStore = {
  get: () => (Platform.OS === 'web' ? AsyncStorage.getItem(TOKEN_KEY) : SecureStore.getItemAsync(TOKEN_KEY)),
  set: (v: string) => (Platform.OS === 'web' ? AsyncStorage.setItem(TOKEN_KEY, v) : SecureStore.setItemAsync(TOKEN_KEY, v)),
  clear: () => (Platform.OS === 'web' ? AsyncStorage.removeItem(TOKEN_KEY) : SecureStore.deleteItemAsync(TOKEN_KEY)),
};

let token: string | null = null;
let signingIn: Promise<string> | null = null;

async function deviceToken(): Promise<string> {
  if (token) return token;
  token = await tokenStore.get();
  if (token) return token;
  signingIn ??= (async () => {
    const res = await raw('/v1/session', { method: 'POST' });
    const body = (await res.json()) as { token: string };
    await tokenStore.set(body.token);
    token = body.token;
    return body.token;
  })().finally(() => {
    signingIn = null;
  });
  return signingIn;
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new ApiError(0, 'No connection');
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? detail;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, detail);
  }
  return res;
}

async function call<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const auth = await deviceToken();
  try {
    const res = await raw(path, { ...init, headers: { ...(init.headers as object), Authorization: `Bearer ${auth}` } });
    return (await res.json()) as T;
  } catch (error) {
    // The server forgot this device (e.g. a reset dev database): sign in again once.
    if (error instanceof ApiError && error.status === 401 && !retried) {
      token = null;
      await tokenStore.clear();
      return call<T>(path, init, true);
    }
    throw error;
  }
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Signed URLs for storage keys, returned alongside responses that mention files. */
export type SignedUrls = Record<string, string>;

/** Absolute URL for a signed path from the server. */
export function absoluteUrl(path: string): string {
  return /^https?:/.test(path) ? path : BASE + path;
}

export const avatarApi = {
  async uploadPhoto(itemId: string, uri: string, kind: 'garment' | 'worn' = 'garment') {
    const form = new FormData();
    form.append('kind', kind);
    if (Platform.OS === 'web') {
      form.append('file', await (await fetch(uri)).blob(), 'photo.jpg');
    } else {
      // React Native's FormData streams the file from disk.
      form.append('file', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
    }
    return call<{ id: string; sha256: string }>(`/v1/items/${itemId}/photos`, { method: 'POST', body: form });
  },

  analyze: (itemId: string, category: MannequinCategory) => call<Analysis>(`/v1/items/${itemId}/analyze`, json({ category })),

  requestJob: (
    itemId: string,
    body: { category: MannequinCategory; corrections?: Corrections; correctionNote?: string; attempt?: string },
  ) => call<Job & { urls: SignedUrls }>(`/v1/items/${itemId}/jobs`, json(body)),

  jobs: (since: number) => call<{ jobs: Job[]; serverTime: number; urls: SignedUrls }>(`/v1/jobs?since=${since}`),

  review: (variantId: string, approve: boolean) =>
    call<Variant & { urls: SignedUrls }>(`/v1/variants/${variantId}/review`, json({ approve })),

  assets: () => call<WardrobeAssets & { urls: SignedUrls }>('/v1/wardrobe/assets'),

  me: () => call<{ userId: string; usage: Usage }>('/v1/me'),

  deleteItem: (itemId: string) => call<{ ok: true }>(`/v1/items/${itemId}`, { method: 'DELETE' }),
};
