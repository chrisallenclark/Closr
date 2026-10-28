import type { ClothingItem, ColorId, ItemFit } from '../wardrobe/types';
import { outfitHarmony } from './harmony';
import { REQUIRED_SLOTS, SLOTS, type OutfitPieces, type Slot } from './types';

export interface StylePreferences {
  favoriteColors: ColorId[];
  avoidColors: ColorId[];
  /** Preferred fit; "Mixed" or undefined means no preference. */
  fit?: ItemFit | 'Mixed';
}

export interface GenerateOptions {
  /** Slots that must keep a specific item. */
  locked?: OutfitPieces;
  /** Items that are not in the wardrobe yet (e.g. a piece being considered in a store). */
  extraItems?: ClothingItem[];
  count?: number;
  /** Different seeds produce different shuffles; the same seed is reproducible. */
  seed?: number;
  preferences?: StylePreferences;
  now?: Date;
}

export interface ScoredOutfit {
  pieces: OutfitPieces;
  /** 0..1 — how well the pieces work together. */
  score: number;
}

const OPTIONAL_SLOTS: Slot[] = ['outerwear', 'accessory'];
const FIT_ORDER: ItemFit[] = ['Slim', 'Fitted', 'Regular', 'Relaxed', 'Oversized'];
const MAX_ATTEMPTS = 400;
const RECENT_WEAR_MS = 2 * 24 * 60 * 60 * 1000;

/** Small seedable PRNG (mulberry32) so shuffles are testable. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function groupBySlot(items: ClothingItem[]): Record<Slot, ClothingItem[]> {
  const groups: Record<Slot, ClothingItem[]> = {
    top: [],
    bottom: [],
    onepiece: [],
    outerwear: [],
    shoes: [],
    accessory: [],
  };
  for (const item of items) groups[item.category].push(item);
  return groups;
}

/**
 * Required slots that have no items, i.e. what's blocking outfit generation. Owning a one-piece
 * covers both top and bottom.
 */
export function missingSlots(items: ClothingItem[]): Slot[] {
  const groups = groupBySlot(items);
  const coveredByOnePiece = groups.onepiece.length > 0;
  return REQUIRED_SLOTS.filter(
    (slot) => groups[slot].length === 0 && !(coveredByOnePiece && slot !== 'shoes'),
  );
}

export function piecesKey(pieces: OutfitPieces): string {
  return SLOTS.map((s) => pieces[s] ?? '-').join('|');
}

export function scoreOutfit(
  items: ClothingItem[],
  preferences?: StylePreferences,
  now: Date = new Date(),
): number {
  let score = outfitHarmony(items) * 0.85;
  if (preferences) {
    const colors = new Set(items.map((i) => i.colors[0]).filter(Boolean));
    let fav = 0;
    for (const c of preferences.favoriteColors) if (colors.has(c)) fav += 0.04;
    score += Math.min(fav, 0.1);
    for (const c of preferences.avoidColors) if (colors.has(c)) score -= 0.15;
  }
  const fitPref = preferences?.fit && preferences.fit !== 'Mixed' ? preferences.fit : undefined;
  for (const item of items) {
    if (item.favorite) score += 0.01;
    if (fitPref && item.fit) {
      const gap = Math.abs(FIT_ORDER.indexOf(item.fit) - FIT_ORDER.indexOf(fitPref));
      score += gap === 0 ? 0.03 : gap >= 3 ? -0.05 : gap === 2 ? -0.02 : 0;
    }
    if (item.lastWornAt && now.getTime() - Date.parse(item.lastWornAt) < RECENT_WEAR_MS) {
      score -= 0.06;
    }
  }
  return Math.max(0, Math.min(1, score + 0.1));
}

function differsEnough(a: OutfitPieces, b: OutfitPieces): boolean {
  let diff = 0;
  for (const s of SLOTS) if (a[s] !== b[s]) diff++;
  return diff >= 2;
}

/**
 * Builds complete outfits (top + bottom or a one-piece, plus shoes and optional
 * outerwear/accessory) by sampling
 * combinations and ranking them with the harmony score. Returns [] when nothing complete can be made.
 */
export function generateOutfits(items: ClothingItem[], options: GenerateOptions = {}): ScoredOutfit[] {
  const { locked = {}, extraItems = [], count = 3, seed = 1, preferences, now } = options;
  const all = [...items, ...extraItems];
  const byId = new Map(all.map((i) => [i.id, i]));
  const groups = groupBySlot(items);
  const rng = createRng(seed);

  const pools = {} as Record<Slot, (ClothingItem | null)[]>;
  for (const slot of SLOTS) {
    const lockedId = locked[slot];
    const lockedItem = lockedId ? byId.get(lockedId) : undefined;
    if (lockedItem) {
      pools[slot] = [lockedItem];
    } else if (OPTIONAL_SLOTS.includes(slot)) {
      // "none" is a valid choice for optional slots, weighted so they appear about half the time.
      pools[slot] = groups[slot].length ? [null, ...groups[slot]] : [null];
    } else {
      pools[slot] = groups[slot];
    }
  }

  // An outfit is either separates (top + bottom) or a one-piece; locks decide when one is pinned.
  const canSeparates = !locked.onepiece && pools.top.length > 0 && pools.bottom.length > 0;
  const canOnePiece = !locked.top && !locked.bottom && pools.onepiece.length > 0;
  if (pools.shoes.length === 0 || (!canSeparates && !canOnePiece)) return [];
  const onePieceShare = !canSeparates
    ? 1
    : !canOnePiece
      ? 0
      : pools.onepiece.length / (pools.onepiece.length + pools.top.length);

  const sepCombos = canSeparates ? pools.top.length * pools.bottom.length : 0;
  const opCombos = canOnePiece ? pools.onepiece.length : 0;
  const rest = pools.outerwear.length * pools.shoes.length * pools.accessory.length;
  const attempts = Math.min(MAX_ATTEMPTS, (sepCombos + opCombos) * rest * 3);
  const seen = new Map<string, { pieces: OutfitPieces; score: number; rank: number }>();

  for (let i = 0; i < attempts; i++) {
    const onePiece = rng() < onePieceShare;
    const slots = SLOTS.filter((s) =>
      onePiece ? s !== 'top' && s !== 'bottom' : s !== 'onepiece',
    );
    const pieces: OutfitPieces = {};
    const chosen: ClothingItem[] = [];
    for (const slot of slots) {
      const pool = pools[slot];
      const pick = pool[Math.floor(rng() * pool.length)] ?? null;
      if (pick) {
        pieces[slot] = pick.id;
        chosen.push(pick);
      }
    }
    const key = piecesKey(pieces);
    if (seen.has(key)) continue;
    const score = scoreOutfit(chosen, preferences, now);
    // Jitter only affects ranking, so different seeds surface different good looks.
    seen.set(key, { pieces, score, rank: score + rng() * 0.08 });
  }

  const ranked = [...seen.values()].sort((a, b) => b.rank - a.rank);
  const result: ScoredOutfit[] = [];
  for (const candidate of ranked) {
    if (result.length >= count) break;
    if (result.every((r) => differsEnough(r.pieces, candidate.pieces))) {
      result.push({ pieces: candidate.pieces, score: candidate.score });
    }
  }
  for (const candidate of ranked) {
    if (result.length >= count) break;
    if (!result.some((r) => piecesKey(r.pieces) === piecesKey(candidate.pieces))) {
      result.push({ pieces: candidate.pieces, score: candidate.score });
    }
  }
  return result;
}
