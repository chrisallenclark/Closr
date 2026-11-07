import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { ApiError, avatarApi, avatarBackendConfigured, type SignedUrls } from '@/services/avatarApi';
import { resolvePhotoUri } from '@/services/photos';
import { appStorage, STORAGE_KEYS } from '@/services/storage';

import type { ClothingItem } from '../wardrobe/types';
import {
  MANNEQUIN_CATEGORIES,
  type Corrections,
  type ItemPrep,
  type Job,
  type MannequinCategory,
  type PrepStage,
  type WardrobeAssets,
} from './types';

/**
 * Garment preparation on this device: one resumable flow per wardrobe item.
 *
 * Every step is persisted before and after it reaches the server, and every server call is
 * idempotent (photos dedupe by content, jobs by an idempotency key), so the flow survives app
 * restarts and lost connections: `pump()` simply resumes each item where it stopped. Nothing here
 * runs a model; the backend does, inside its own credit and spending limits. Build Outfit reads
 * `assets`, the cached manifest of approved layers, and never triggers preparation.
 */

/** Stages the device drives (retried until they reach the server). */
const CLIENT_STEPS: PrepStage[] = ['upload', 'analyze', 'request'];
/** Stages the server is working on (polled). */
const SERVER_STEPS: PrepStage[] = ['waiting', 'preparing'];

export type Api = typeof avatarApi;

interface AvatarState {
  byItem: Record<string, ItemPrep>;
  assets: WardrobeAssets | null;
  /** Storage key → signed URL path. Keys are immutable, so cached images stay valid. */
  urls: SignedUrls;
  jobsSince: number;
  assetsStale: boolean;
  /** Items deleted on the device whose server copy still needs removing. */
  pendingDeletes: string[];

  start: (item: ClothingItem) => void;
  confirmFit: (itemId: string, corrections: Corrections) => void;
  /** Accept a photo the check flagged (the user knows the garment; the result is still reviewed). */
  acceptPhoto: (itemId: string) => void;
  approve: (itemId: string) => Promise<void>;
  requestCorrection: (itemId: string, corrections: Corrections, note?: string) => Promise<void>;
  retry: (itemId: string) => void;
  forget: (itemId: string) => void;
  pump: () => Promise<void>;
  refreshAssets: () => Promise<void>;
  reset: (itemIds: string[]) => void;
}

export function canPrepare(category: string): category is MannequinCategory {
  return (MANNEQUIN_CATEGORIES as readonly string[]).includes(category);
}

export function isActive(prep?: ItemPrep): boolean {
  return !!prep && (CLIENT_STEPS.includes(prep.stage) || SERVER_STEPS.includes(prep.stage));
}

function friendly(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  if (error.status === 402) return "You've used this month's garment preparations.";
  if (error.status === 429) return 'Too many requests at once. Try again in a few minutes.';
  if (error.status === 503) return 'Garment preparation is paused right now. Try again later.';
  return error.message;
}

let api: Api = avatarApi;
let running: Promise<void> | null = null;

/** Tests swap in a fake backend. */
export function setAvatarApi(next: Api): void {
  api = next;
}

export const useAvatar = create<AvatarState>()(
  persist(
    (set, get) => {
      const patch = (itemId: string, p: Partial<ItemPrep>) => {
        const cur = get().byItem[itemId];
        if (!cur) return;
        set({ byItem: { ...get().byItem, [itemId]: { ...cur, ...p, updatedAt: Date.now() } } });
      };
      const addUrls = (urls?: SignedUrls) => urls && set({ urls: { ...get().urls, ...urls } });

      const applyJob = (job: Job) => {
        const prep = get().byItem[job.itemId];
        // Only the job this item is waiting on moves it; older jobs for the item are history.
        if (!prep || prep.job?.id !== job.id) return;
        // The poll window overlaps, so the same update can arrive twice: only act on changes.
        if (prep.job.state === job.state && prep.job.updatedAt === job.updatedAt && prep.stage === job.state) return;
        patch(job.itemId, {
          job,
          stage: job.state,
          message: job.state === 'failed' ? job.message ?? 'This garment could not be prepared.' : undefined,
          needsPhoto: job.state === 'failed' && /photo/i.test(job.message ?? ''),
        });
        if (job.state === 'approved') set({ assetsStale: true });
      };

      /** One client step for one item. Network failures leave the stage as is, to retry later. */
      const step = async (prep: ItemPrep) => {
        const id = prep.itemId;
        try {
          if (prep.stage === 'upload') {
            const uri = resolvePhotoUri({ localPath: prep.photoPath }, { preferCutout: false });
            if (!uri) throw new ApiError(400, 'This item has no photo.');
            await api.uploadPhoto(id, uri);
            patch(id, { stage: 'analyze' });
          } else if (prep.stage === 'analyze') {
            const analysis = await api.analyze(id, prep.category);
            if (analysis.needsAnotherPhoto && !prep.corrections?.acceptPhoto) {
              patch(id, { analysis, stage: 'error', needsPhoto: true, message: analysis.needsAnotherPhoto });
            } else {
              patch(id, { analysis, stage: analysis.ask.length && !prep.corrections ? 'confirm' : 'request' });
            }
          } else if (prep.stage === 'request') {
            const { urls, ...job } = await api.requestJob(id, {
              category: prep.category,
              corrections: prep.corrections,
              correctionNote: prep.correctionNote,
              attempt: prep.attempt ? String(prep.attempt) : undefined,
            });
            addUrls(urls);
            patch(id, { job, stage: job.state, message: job.message ?? undefined });
          }
        } catch (error) {
          if (error instanceof ApiError && error.offline) return; // try again on the next pump
          if (error instanceof ApiError && error.status === 400 && /analy[sz]e/.test(error.message)) {
            patch(id, { stage: 'analyze' });
          } else if (error instanceof ApiError && error.status === 404) {
            patch(id, { stage: 'upload' }); // the server lost the photo: send it again
          } else {
            patch(id, { stage: 'error', message: friendly(error) });
          }
        }
      };

      const work = async () => {
        if (!avatarBackendConfigured()) return;
        for (const itemId of get().pendingDeletes) {
          try {
            await api.deleteItem(itemId);
            set({ pendingDeletes: get().pendingDeletes.filter((d) => d !== itemId) });
          } catch (error) {
            if (error instanceof ApiError && error.offline) break;
            set({ pendingDeletes: get().pendingDeletes.filter((d) => d !== itemId) });
          }
        }
        // Client steps, a few rounds so upload → analyze → request can finish in one pump.
        for (let round = 0; round < 3; round++) {
          const todo = Object.values(get().byItem).filter((p) => CLIENT_STEPS.includes(p.stage));
          if (!todo.length) break;
          for (const prep of todo) await step(prep);
        }
        if (Object.values(get().byItem).some((p) => SERVER_STEPS.includes(p.stage))) {
          try {
            const res = await api.jobs(get().jobsSince);
            addUrls(res.urls);
            res.jobs.forEach(applyJob);
            // A little overlap guards against clock skew; applying a job twice is harmless.
            set({ jobsSince: Math.max(0, res.serverTime - 30) });
          } catch {
            // offline: poll again later
          }
        }
        if (get().assetsStale) await get().refreshAssets();
      };

      return {
        byItem: {},
        assets: null,
        urls: {},
        jobsSince: 0,
        assetsStale: true,
        pendingDeletes: [],

        start: (item) => {
          if (!canPrepare(item.category) || !avatarBackendConfigured()) return;
          const cur = get().byItem[item.id];
          // Same photo and already under way (or done): nothing to do. A new photo starts over.
          if (
            cur &&
            cur.photoPath === item.photo.localPath &&
            cur.category === item.category &&
            cur.stage !== 'error' &&
            cur.stage !== 'failed'
          )
            return;
          set({
            byItem: {
              ...get().byItem,
              [item.id]: {
                itemId: item.id,
                category: item.category,
                stage: 'upload',
                photoPath: item.photo.localPath,
                attempt: cur ? (cur.attempt ?? 0) + 1 : undefined,
                updatedAt: Date.now(),
              },
            },
          });
          void get().pump();
        },

        confirmFit: (itemId, corrections) => {
          patch(itemId, { corrections: { ...get().byItem[itemId]?.corrections, ...corrections }, stage: 'request' });
          void get().pump();
        },

        acceptPhoto: (itemId) => {
          const prep = get().byItem[itemId];
          if (!prep) return;
          const corrections = { ...prep.corrections, acceptPhoto: true };
          const ask = prep.analysis?.ask.length && !prep.corrections;
          patch(itemId, { corrections, needsPhoto: false, message: undefined, stage: ask ? 'confirm' : 'request' });
          void get().pump();
        },

        approve: async (itemId) => {
          const prep = get().byItem[itemId];
          const variantId = prep?.job?.variantId;
          if (!prep?.job || !variantId) return;
          const { urls, ...variant } = await api.review(variantId, true);
          addUrls(urls);
          patch(itemId, { stage: 'approved', job: { ...prep.job, state: 'approved', variant } });
          set({ assetsStale: true });
          await get().refreshAssets();
        },

        requestCorrection: async (itemId, corrections, note) => {
          const prep = get().byItem[itemId];
          if (!prep) return;
          if (prep.job?.variantId && prep.stage === 'ready_for_review') {
            try {
              await api.review(prep.job.variantId, false);
            } catch {
              // rejecting is bookkeeping; the new request matters more
            }
          }
          patch(itemId, {
            corrections: { ...prep.corrections, ...corrections },
            correctionNote: note?.trim() || undefined,
            attempt: (prep.attempt ?? 0) + 1,
            stage: 'request',
            message: undefined,
          });
          void get().pump();
        },

        retry: (itemId) => {
          const prep = get().byItem[itemId];
          if (!prep) return;
          const stage: PrepStage = !prep.analysis ? 'upload' : prep.needsPhoto ? 'analyze' : 'request';
          patch(itemId, { stage, attempt: (prep.attempt ?? 0) + 1, message: undefined });
          void get().pump();
        },

        forget: (itemId) => {
          const { [itemId]: removed, ...rest } = get().byItem;
          const known = !!removed || !!get().assets?.variants.some((v) => v.itemId === itemId);
          set({
            byItem: rest,
            pendingDeletes: known ? [...new Set([...get().pendingDeletes, itemId])] : get().pendingDeletes,
            assets: get().assets && {
              ...get().assets!,
              variants: get().assets!.variants.filter((v) => v.itemId !== itemId),
            },
          });
          if (known) void get().pump();
        },

        pump: () => {
          // One pass at a time; callers share the pass in flight.
          running ??= work().finally(() => {
            running = null;
          });
          return running;
        },

        refreshAssets: async () => {
          if (!avatarBackendConfigured()) return;
          try {
            const { urls, ...assets } = await api.assets();
            set({ assets, assetsStale: false, urls: { ...get().urls, ...urls } });
          } catch {
            // keep the cached manifest; images already on disk still draw
          }
        },

        reset: (itemIds) =>
          set({
            byItem: {},
            assets: null,
            urls: {},
            jobsSince: 0,
            assetsStale: true,
            pendingDeletes: [...new Set([...get().pendingDeletes, ...itemIds])],
          }),
      };
    },
    {
      name: STORAGE_KEYS.avatar,
      storage: appStorage,
      version: 1,
      partialize: (s) => ({
        byItem: s.byItem,
        assets: s.assets,
        urls: s.urls,
        jobsSince: s.jobsSince,
        assetsStale: s.assetsStale,
        pendingDeletes: s.pendingDeletes,
      }),
    },
  ),
);

/** Approved layers for one item, newest first. */
export function approvedVariants(assets: WardrobeAssets | null, itemId: string | undefined) {
  if (!assets || !itemId) return [];
  return assets.variants.filter((v) => v.itemId === itemId).reverse();
}
