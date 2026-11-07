/**
 * The device side of garment preparation: a resumable flow that tolerates lost connections and
 * never creates duplicate work. Runs against a fake backend.
 */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('@/services/photos', () => ({ resolvePhotoUri: (ref?: { localPath?: string }) => ref?.localPath }));

import type { Analysis, Job, WardrobeAssets } from '@/features/avatar/types';
import type { ClothingItem } from '@/features/wardrobe/types';

process.env.EXPO_PUBLIC_CLOSR_API_URL = 'http://test.local';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ApiError } = require('@/services/avatarApi') as typeof import('@/services/avatarApi');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setAvatarApi, useAvatar, isActive } = require('@/features/avatar/store') as typeof import('@/features/avatar/store');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prepStatus } = require('@/features/avatar/status') as typeof import('@/features/avatar/status');

const item = (over: Partial<ClothingItem> = {}): ClothingItem => ({
  id: 'tee',
  name: 'Stone tee',
  category: 'top',
  subcategory: 'tshirt',
  colors: ['stone'],
  seasons: [],
  formality: 2,
  favorite: false,
  wearCount: 0,
  photo: { localPath: 'photos/tee.jpg' },
  createdAt: '',
  updatedAt: '',
  ...over,
});

const analysis = (over: Partial<Analysis> = {}): Analysis => ({
  category: 'top',
  categoryNote: null,
  fit: { width: { value: 'oversized', confidence: 0.6, source: 'vision' } },
  ask: ['width'],
  defaultDrape: 'natural',
  needsAnotherPhoto: null,
  ...over,
});

const job = (state: Job['state'], over: Partial<Job> = {}): Job => ({
  id: 'job1',
  itemId: 'tee',
  category: 'top',
  variantKey: 'drape=natural',
  state,
  attempts: 0,
  message: null,
  variantId: null,
  updatedAt: 1,
  ...over,
});

const manifest: WardrobeAssets = {
  mannequin: { id: 'closr-v3', canvas: [1080, 1920], displayScale: 0.5, plate: 'shared/plate.webp', landmarks: {} },
  variants: [],
  derived: [],
};

function fakeApi() {
  const calls: string[] = [];
  let online = true;
  const net = <T>(name: string, value: () => T) =>
    jest.fn(async (..._args: unknown[]) => {
      if (!online) throw new ApiError(0, 'No connection');
      calls.push(name);
      return value();
    });
  let serverJob = job('waiting');
  const api = {
    uploadPhoto: net('upload', () => ({ id: 'p1', sha256: 'abc' })),
    analyze: net('analyze', () => analysis()),
    requestJob: net('request', () => ({ ...serverJob, urls: {} })),
    jobs: net('jobs', () => ({ jobs: [serverJob], serverTime: 100, urls: { 'users/u/display.webp': '/v1/files/x?sig=1' } as Record<string, string> })),
    review: net('review', () => ({ ...serverJob.variant!, status: 'approved' as const, urls: {} })),
    assets: net('assets', () => ({ ...manifest, urls: {} })),
    me: net('me', () => ({ userId: 'u', usage: { credits: 1, spent_total_usd: 0, usable_assets: 0 } })),
    deleteItem: net('delete', () => ({ ok: true as const })),
  };
  return {
    api,
    calls,
    setOnline: (v: boolean) => (online = v),
    setJob: (j: Job) => (serverJob = j),
  };
}

beforeEach(() => {
  useAvatar.setState({ byItem: {}, assets: null, urls: {}, jobsSince: 0, assetsStale: false, pendingDeletes: [] });
});

describe('garment preparation flow', () => {
  it('uploads, reads the photo and stops to confirm an uncertain fit', async () => {
    const fake = fakeApi();
    setAvatarApi(fake.api as never);
    useAvatar.getState().start(item());
    await useAvatar.getState().pump();
    const prep = useAvatar.getState().byItem.tee!;
    expect(prep.stage).toBe('confirm');
    expect(fake.calls).toEqual(['upload', 'analyze']);
    expect(prepStatus(prep).tone).toBe('action');
  });

  it('requests the job with the confirmed fit, then follows it to review and approval', async () => {
    const fake = fakeApi();
    setAvatarApi(fake.api as never);
    useAvatar.getState().start(item());
    await useAvatar.getState().pump();
    useAvatar.getState().confirmFit('tee', { width: 'boxy' });
    await useAvatar.getState().pump();
    expect(fake.api.requestJob).toHaveBeenCalledWith('tee', expect.objectContaining({ corrections: { width: 'boxy' } }));
    expect(useAvatar.getState().byItem.tee!.stage).toBe('waiting');

    const variant = { id: 'v1', itemId: 'tee', category: 'top', display: 'users/u/display.webp' } as never;
    fake.setJob(job('ready_for_review', { variantId: 'v1', variant }));
    await useAvatar.getState().pump();
    expect(useAvatar.getState().byItem.tee!.stage).toBe('ready_for_review');
    expect(useAvatar.getState().urls['users/u/display.webp']).toBeDefined();

    await useAvatar.getState().approve('tee');
    expect(fake.api.review).toHaveBeenCalledWith('v1', true);
    expect(useAvatar.getState().byItem.tee!.stage).toBe('approved');
    expect(fake.api.assets).toHaveBeenCalled(); // Build Outfit's manifest refreshes once, after approval
  });

  it('survives losing the connection and resumes where it stopped', async () => {
    const fake = fakeApi();
    setAvatarApi(fake.api as never);
    fake.setOnline(false);
    useAvatar.getState().start(item());
    await useAvatar.getState().pump();
    expect(useAvatar.getState().byItem.tee!.stage).toBe('upload'); // kept, not failed
    expect(isActive(useAvatar.getState().byItem.tee)).toBe(true);
    fake.setOnline(true);
    await useAvatar.getState().pump();
    expect(useAvatar.getState().byItem.tee!.stage).toBe('confirm');
  });

  it('does not restart work that is already under way for the same photo', async () => {
    const fake = fakeApi();
    setAvatarApi(fake.api as never);
    useAvatar.getState().start(item());
    await useAvatar.getState().pump();
    useAvatar.getState().start(item());
    await useAvatar.getState().pump();
    expect(fake.api.uploadPhoto).toHaveBeenCalledTimes(1);
  });

  it('starts over when the photo is replaced', async () => {
    const fake = fakeApi();
    setAvatarApi(fake.api as never);
    useAvatar.getState().start(item());
    await useAvatar.getState().pump();
    useAvatar.getState().start(item({ photo: { localPath: 'photos/tee-2.jpg' } }));
    await useAvatar.getState().pump();
    expect(fake.api.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(fake.api.uploadPhoto).toHaveBeenLastCalledWith('tee', 'photos/tee-2.jpg');
  });

  it('asks for a better photo instead of preparing an unreliable one', async () => {
    const fake = fakeApi();
    fake.api.analyze.mockImplementation(async () => analysis({ needsAnotherPhoto: 'text is hidden by a fold', ask: [] }));
    setAvatarApi(fake.api as never);
    useAvatar.getState().start(item());
    await useAvatar.getState().pump();
    const prep = useAvatar.getState().byItem.tee!;
    expect(prep.stage).toBe('error');
    expect(prep.needsPhoto).toBe(true);
    expect(fake.api.requestJob).not.toHaveBeenCalled();
  });

  it('shows out-of-credits as a clear message, not a retry loop', async () => {
    const fake = fakeApi();
    fake.api.analyze.mockImplementation(async () => analysis({ ask: [] }));
    fake.api.requestJob.mockImplementation(async () => {
      throw new ApiError(402, 'out of credits');
    });
    setAvatarApi(fake.api as never);
    useAvatar.getState().start(item());
    await useAvatar.getState().pump();
    await useAvatar.getState().pump();
    expect(fake.api.requestJob).toHaveBeenCalledTimes(1);
    expect(useAvatar.getState().byItem.tee!.message).toMatch(/used this month/);
  });

  it('removes a deleted garment from the server, even after being offline', async () => {
    const fake = fakeApi();
    setAvatarApi(fake.api as never);
    useAvatar.getState().start(item());
    await useAvatar.getState().pump();
    fake.setOnline(false);
    useAvatar.getState().forget('tee');
    await useAvatar.getState().pump();
    expect(useAvatar.getState().pendingDeletes).toEqual(['tee']);
    fake.setOnline(true);
    await useAvatar.getState().pump();
    expect(fake.api.deleteItem).toHaveBeenCalledWith('tee');
    expect(useAvatar.getState().pendingDeletes).toEqual([]);
  });

  it('never prepares categories the mannequin cannot wear', () => {
    const fake = fakeApi();
    setAvatarApi(fake.api as never);
    useAvatar.getState().start(item({ category: 'accessory' }));
    expect(useAvatar.getState().byItem.tee).toBeUndefined();
  });
});

describe('job polling', () => {
  it('ignores repeated updates for a job it already applied', async () => {
    const fake = fakeApi();
    setAvatarApi(fake.api as never);
    const done = job('approved', { updatedAt: 5 });
    const pending = job('preparing', { id: 'job2', itemId: 'pants', category: 'bottom' });
    fake.api.jobs.mockImplementation(async () => ({ jobs: [done, pending], serverTime: 100, urls: {} }));
    const base = { photoPath: 'p.jpg', updatedAt: 0 };
    useAvatar.setState({
      byItem: {
        tee: { ...base, itemId: 'tee', category: 'top', stage: 'approved', job: done },
        pants: { ...base, itemId: 'pants', category: 'bottom', stage: 'preparing', job: pending },
      },
      assetsStale: false,
    });
    await useAvatar.getState().pump();
    expect(fake.api.jobs).toHaveBeenCalled();
    expect(fake.api.assets).not.toHaveBeenCalled(); // the old approval doesn't refetch the manifest

    fake.api.jobs.mockImplementation(async () => ({ jobs: [{ ...pending, state: 'approved', updatedAt: 9 }], serverTime: 110, urls: {} }));
    await useAvatar.getState().pump();
    expect(useAvatar.getState().byItem.pants!.stage).toBe('approved');
    expect(fake.api.assets).toHaveBeenCalledTimes(1); // a new approval does
  });
});
