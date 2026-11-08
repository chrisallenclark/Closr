import { useEffect } from 'react';
import { AppState } from 'react-native';

import { absoluteUrl, ApiError, avatarApi, avatarBackendConfigured, hasSession, type SyncChange } from '@/services/avatarApi';
import { deletePhoto, downloadPhoto, resolvePhotoUri } from '@/services/photos';

import type { Outfit } from '../outfits/types';
import { useOutfits } from '../outfits/store';
import type { StyleProfile } from '../profile/types';
import { useProfile } from '../profile/store';
import type { ClothingItem } from '../wardrobe/types';
import { useWardrobe } from '../wardrobe/store';
import { useSync } from './store';

/**
 * Wardrobe sync: items (with their photos), outfits and the style profile are backed up to the
 * signed-in account, so a reinstall or a new iPhone gets everything back.
 *
 * Local-first: the stores on the device stay the source of what the app shows. A pass sends every
 * record whose version changed since it was last sent (and any deletions), then applies newer
 * records from the server. Each record carries its `updatedAt`; the newer edit wins. Photos go to
 * private storage once and come back through signed URLs. Mannequin layers aren't part of this:
 * they're already on the server and arrive with the mannequin manifest.
 */

type Kind = SyncChange['kind'];

const ms = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);
const key = (kind: Kind, id: string) => `${kind}:${id}`;

/** While true, store changes come from sync itself and must not be echoed back as edits. */
let applying = false;
let running: Promise<void> | null = null;

function itemRecord(item: ClothingItem) {
  // Device paths mean nothing on another iPhone; the photo travels as its private storage key.
  const { localPath: _l, cutoutPath: _c, remoteUrl: _r, ...photo } = item.photo;
  return { ...item, photo };
}

function profileRecord(p: StyleProfile) {
  // The body reference photo for future try-on stays on this iPhone.
  const { bodyPhoto: _b, ...rest } = p;
  return rest;
}

/** Local records with a version string; a record is sent when its version differs from `pushed`. */
function localRecords(): { change: SyncChange; version: string }[] {
  const out: { change: SyncChange; version: string }[] = [];
  for (const i of useWardrobe.getState().items) {
    out.push({ change: { kind: 'item', id: i.id, updatedAt: ms(i.updatedAt), data: itemRecord(i) }, version: `${i.updatedAt}|${i.photo.remoteKey ?? ''}` });
  }
  for (const o of useOutfits.getState().outfits) {
    out.push({ change: { kind: 'outfit', id: o.id, updatedAt: ms(o.updatedAt), data: o }, version: o.updatedAt });
  }
  const p = useProfile.getState().profile;
  if (p) out.push({ change: { kind: 'profile', id: 'me', updatedAt: ms(p.updatedAt), data: profileRecord(p) }, version: p.updatedAt });
  return out;
}

function setItems(fn: (items: ClothingItem[]) => ClothingItem[]) {
  applying = true;
  try {
    useWardrobe.setState({ items: fn(useWardrobe.getState().items) });
  } finally {
    applying = false;
  }
}

/** Upload photos that aren't in the cloud yet; the item then syncs with the photo's key. */
async function uploadPhotos(): Promise<void> {
  for (const item of useWardrobe.getState().items) {
    if (item.photo.remoteKey || !item.photo.localPath) continue;
    const uri = resolvePhotoUri(item.photo, { preferCutout: false });
    if (!uri) continue;
    const { storageKey } = await avatarApi.uploadPhoto(item.id, uri);
    // Not an edit: updatedAt stays, so this never wins over a newer edit made elsewhere.
    setItems((items) => items.map((i) => (i.id === item.id ? { ...i, photo: { ...i.photo, remoteKey: storageKey } } : i)));
  }
}

async function applyItem(c: SyncChange, urls: Record<string, string>): Promise<void> {
  const local = useWardrobe.getState().items.find((i) => i.id === c.id);
  if (c.deleted) {
    if (!local) return;
    setItems((items) => items.filter((i) => i.id !== c.id));
    deletePhoto(local.photo);
    return;
  }
  const remote = c.data as ClothingItem;
  if (local && ms(local.updatedAt) >= c.updatedAt) return;
  let photo = { ...remote.photo };
  if (local && local.photo.remoteKey === remote.photo.remoteKey && local.photo.localPath) {
    photo = { ...local.photo, ...remote.photo };
  } else if (remote.photo.remoteKey && urls[remote.photo.remoteKey]) {
    photo.localPath = await downloadPhoto(absoluteUrl(urls[remote.photo.remoteKey]!), `${c.id}-${Date.now()}`);
    if (local) deletePhoto(local.photo);
  }
  const merged: ClothingItem = { ...remote, photo };
  setItems((items) => (local ? items.map((i) => (i.id === c.id ? merged : i)) : [merged, ...items]));
}

function applyOutfit(c: SyncChange): void {
  const local = useOutfits.getState().outfits.find((o) => o.id === c.id);
  if (!c.deleted && local && ms(local.updatedAt) >= c.updatedAt) return;
  applying = true;
  try {
    const rest = useOutfits.getState().outfits.filter((o) => o.id !== c.id);
    useOutfits.setState({ outfits: c.deleted ? rest : [c.data as Outfit, ...rest] });
  } finally {
    applying = false;
  }
}

function applyProfile(c: SyncChange): void {
  const local = useProfile.getState().profile;
  if (c.deleted || (local && ms(local.updatedAt) >= c.updatedAt)) return;
  applying = true;
  try {
    useProfile.setState({ profile: { ...(c.data as StyleProfile), bodyPhoto: local?.bodyPhoto } });
  } finally {
    applying = false;
  }
}

async function pass(): Promise<void> {
  await uploadPhotos();
  const sync = useSync.getState();
  const records = localRecords();
  const changed = records.filter((r) => sync.pushed[key(r.change.kind, r.change.id)] !== r.version);
  const tombstones = sync.tombstones;
  const res = await avatarApi.sync(sync.cursor, [...changed.map((r) => r.change), ...tombstones].slice(0, 500));
  const pushed = { ...useSync.getState().pushed };
  for (const r of changed) pushed[key(r.change.kind, r.change.id)] = r.version;
  const sent = new Set(tombstones.map((t) => key(t.kind, t.id)));
  for (const t of tombstones) delete pushed[key(t.kind, t.id)];
  for (const c of res.changes) {
    if (c.kind === 'item') await applyItem(c, res.urls);
    else if (c.kind === 'outfit') applyOutfit(c);
    else applyProfile(c);
  }
  // Records just applied from the server are current: don't send them back.
  for (const r of localRecords()) {
    const remote = res.changes.find((c) => c.kind === r.change.kind && c.id === r.change.id);
    if (remote && remote.updatedAt === r.change.updatedAt) pushed[key(r.change.kind, r.change.id)] = r.version;
  }
  useSync.setState({
    cursor: res.cursor,
    pushed,
    tombstones: useSync.getState().tombstones.filter((t) => !sent.has(key(t.kind, t.id))),
    lastSyncAt: Date.now(),
    error: null,
  });
}

/** One sync pass at a time; callers share the pass in flight. Never throws. */
export function syncNow(): Promise<void> {
  running ??= (async () => {
    if (!avatarBackendConfigured() || !(await hasSession())) return;
    try {
      await pass();
    } catch (error) {
      useSync.setState({ error: error instanceof ApiError && error.offline ? 'Offline: will sync later.' : 'Sync paused. Will try again.' });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Run a store reset or bulk change without recording it as deletions. */
export function withoutTracking(fn: () => void): void {
  applying = true;
  try {
    fn();
  } finally {
    applying = false;
  }
}

function tombstone(kind: Kind, id: string) {
  useSync.setState({ tombstones: [...useSync.getState().tombstones.filter((t) => !(t.kind === kind && t.id === id)), { kind, id, deleted: true, updatedAt: Date.now() }] });
}

/** Keeps the account in sync: on launch, on returning to the app, and shortly after any edit. */
export function useWardrobeSync(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !avatarBackendConfigured()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      if (applying) return;
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow(), 2000);
    };
    void syncNow();
    const app = AppState.addEventListener('change', (s) => s === 'active' && void syncNow());
    const unsubs = [
      useWardrobe.subscribe((state, prev) => {
        if (state.items === prev.items || applying) return;
        const ids = new Set(state.items.map((i) => i.id));
        prev.items.filter((i) => !ids.has(i.id)).forEach((i) => tombstone('item', i.id));
        soon();
      }),
      useOutfits.subscribe((state, prev) => {
        if (state.outfits === prev.outfits || applying) return;
        const ids = new Set(state.outfits.map((o) => o.id));
        prev.outfits.filter((o) => !ids.has(o.id)).forEach((o) => tombstone('outfit', o.id));
        soon();
      }),
      useProfile.subscribe((state, prev) => {
        if (state.profile !== prev.profile && !applying) soon();
      }),
    ];
    return () => {
      clearTimeout(timer);
      app.remove();
      unsubs.forEach((u) => u());
    };
  }, [enabled]);
}
