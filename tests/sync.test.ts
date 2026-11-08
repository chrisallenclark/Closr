/**
 * Wardrobe sync and accounts, against an in-memory fake of the server's /v1/sync (last write wins).
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/services/photos', () => ({
  resolvePhotoUri: (ref?: { localPath?: string }) => ref?.localPath,
  downloadPhoto: jest.fn(async (_url: string, name: string) => `photos/${name}.jpg`),
  deletePhoto: jest.fn(),
  deleteAllPhotos: jest.fn(),
  persistPhoto: jest.fn(),
}));

type MockChange = { kind: string; id: string; data?: unknown; updatedAt: number; deleted?: boolean };

const mockServer = {
  records: new Map<string, MockChange & { seq: number }>(),
  seq: 0,
  online: true,
  session: true,
  uploads: 0,
  calls: 0,
};

jest.mock('@/services/avatarApi', () => {
  class ApiError extends Error {
    status: number;
    constructor(code: number, message: string) {
      super(message);
      this.status = code;
    }
    get offline() {
      return this.status === 0;
    }
  }
  return {
    ApiError,
    SignInRequired: class extends ApiError {},
    avatarBackendConfigured: () => true,
    hasSession: async () => mockServer.session,
    absoluteUrl: (p: string) => `https://files.test${p}`,
    avatarApi: {
      uploadPhoto: async (itemId: string) => {
        mockServer.uploads++;
        return { id: 'p', sha256: 's', storageKey: `users/u/items/${itemId}/source/abc.jpg` };
      },
      sync: async (since: number, changes: MockChange[]) => {
        if (!mockServer.online) throw new ApiError(0, 'No connection');
        mockServer.calls++;
        for (const c of changes) {
          const k = `${c.kind}:${c.id}`;
          const cur = mockServer.records.get(k);
          if (cur && cur.updatedAt >= c.updatedAt) continue;
          mockServer.records.set(k, { ...c, seq: ++mockServer.seq });
        }
        const out = [...mockServer.records.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
        const urls: Record<string, string> = {};
        for (const r of out) {
          const key = (r.data as { photo?: { remoteKey?: string } } | undefined)?.photo?.remoteKey;
          if (key) urls[key] = `/signed/${key}`;
        }
        return { changes: out.map(({ seq: _s, ...c }) => c), cursor: out.length ? out[out.length - 1]!.seq : since, urls };
      },
      signOut: async () => {
        mockServer.session = false;
      },
    },
  };
});

import type { ClothingItem } from '@/features/wardrobe/types';

/* eslint-disable @typescript-eslint/no-require-imports */
const { syncNow } = require('@/features/sync/engine') as typeof import('@/features/sync/engine');
const { useSync } = require('@/features/sync/store') as typeof import('@/features/sync/store');
const { useWardrobe } = require('@/features/wardrobe/store') as typeof import('@/features/wardrobe/store');
const { useOutfits } = require('@/features/outfits/store') as typeof import('@/features/outfits/store');
const { useAccount } = require('@/features/account/store') as typeof import('@/features/account/store');
const photos = require('@/services/photos') as { downloadPhoto: jest.Mock };
/* eslint-enable @typescript-eslint/no-require-imports */

const item = (id: string, updatedAt: string, over: Partial<ClothingItem> = {}): ClothingItem => ({
  id,
  name: id,
  category: 'top',
  subcategory: 'basic-tee',
  colors: ['black'],
  seasons: [],
  formality: 2,
  favorite: false,
  wearCount: 0,
  photo: { localPath: `photos/${id}.jpg` },
  createdAt: updatedAt,
  updatedAt,
  ...over,
});

/** A second iPhone: same account, empty stores. */
function newDevice() {
  useWardrobe.setState({ items: [] });
  useOutfits.setState({ outfits: [] });
  useSync.getState().reset();
}

beforeEach(() => {
  mockServer.records.clear();
  mockServer.seq = 0;
  mockServer.online = true;
  mockServer.session = true;
  mockServer.uploads = 0;
  mockServer.calls = 0;
  newDevice();
  photos.downloadPhoto.mockClear();
});

describe('wardrobe sync', () => {
  it('backs up items with their photos once, then sends nothing that has not changed', async () => {
    useWardrobe.setState({ items: [item('tee', '2026-11-01T10:00:00Z')] });
    await syncNow();
    expect(mockServer.uploads).toBe(1);
    const saved = mockServer.records.get('item:tee')!;
    expect((saved.data as ClothingItem).photo).toEqual({ remoteKey: 'users/u/items/tee/source/abc.jpg' }); // no device paths
    const before = mockServer.seq;
    await syncNow();
    expect(mockServer.seq).toBe(before);
    expect(mockServer.uploads).toBe(1);
  });

  it('restores the wardrobe on a new iPhone, photos included, without echoing it back', async () => {
    useWardrobe.setState({ items: [item('tee', '2026-11-01T10:00:00Z')] });
    await syncNow();
    newDevice();
    await syncNow();
    const restored = useWardrobe.getState().items;
    expect(restored.map((i) => i.id)).toEqual(['tee']);
    expect(photos.downloadPhoto).toHaveBeenCalledWith('https://files.test/signed/users/u/items/tee/source/abc.jpg', expect.any(String));
    expect(restored[0]!.photo.localPath).toMatch(/^photos\//);
    const before = mockServer.seq;
    await syncNow();
    expect(mockServer.seq).toBe(before);
  });

  it('keeps the newer edit when two iPhones change the same item', async () => {
    useWardrobe.setState({ items: [item('tee', '2026-11-01T10:00:00Z', { name: 'old' })] });
    await syncNow();
    mockServer.records.set('item:tee', { ...mockServer.records.get('item:tee')!, data: { ...item('tee', '2026-11-03T10:00:00Z', { name: 'from other phone' }), photo: { remoteKey: 'users/u/items/tee/source/abc.jpg' } }, updatedAt: Date.parse('2026-11-03T10:00:00Z'), seq: ++mockServer.seq });
    await syncNow();
    expect(useWardrobe.getState().items[0]!.name).toBe('from other phone');
    expect(photos.downloadPhoto).not.toHaveBeenCalled(); // same photo: the local file is kept
  });

  it('sends deletions, including ones made offline', async () => {
    useWardrobe.setState({ items: [item('tee', '2026-11-01T10:00:00Z')] });
    await syncNow();
    mockServer.online = false;
    // The tracker hook records deletions; here we record one the same way.
    useSync.setState({ tombstones: [{ kind: 'item', id: 'tee', deleted: true, updatedAt: Date.now() }] });
    useWardrobe.setState({ items: [] });
    await syncNow();
    expect(useSync.getState().error).toMatch(/Offline/);
    expect(mockServer.records.get('item:tee')!.deleted).toBeFalsy();
    mockServer.online = true;
    await syncNow();
    expect(mockServer.records.get('item:tee')!.deleted).toBe(true);
    expect(useSync.getState().tombstones).toEqual([]);
  });

  it('does nothing without an account', async () => {
    mockServer.session = false;
    useWardrobe.setState({ items: [item('tee', '2026-11-01T10:00:00Z')] });
    await syncNow();
    expect(mockServer.calls).toBe(0);
  });
});

describe('signing out', () => {
  it('backs everything up, then clears this iPhone without deleting anything in the account', async () => {
    useAccount.setState({ signedIn: true });
    useWardrobe.setState({ items: [item('tee', '2026-11-01T10:00:00Z')] });
    await useAccount.getState().signOut();
    expect(useWardrobe.getState().items).toEqual([]);
    expect(mockServer.records.get('item:tee')!.deleted).toBeFalsy();
    expect(useSync.getState().tombstones).toEqual([]);
    expect(useAccount.getState().signedIn).toBe(false);
  });
});
