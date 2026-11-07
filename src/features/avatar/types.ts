/**
 * Mannequin-ready garment assets for Build Outfit ("dress-up").
 *
 * Each wardrobe item is prepared once on the Closr backend into a layer aligned to the canonical
 * mannequin; outfits are composed on the device by stacking approved layers, so switching
 * garments never calls an image model. These types mirror the backend's JSON (server/closr_server).
 * Records are keyed by the existing `ClothingItem.id`; there is no second garment record.
 */

/** Categories the mannequin can wear today. */
export type MannequinCategory = 'top' | 'outerwear' | 'bottom' | 'shoes';

export const MANNEQUIN_CATEGORIES: readonly MannequinCategory[] = ['top', 'outerwear', 'bottom', 'shoes'];

/** Where a fit value came from. A user's correction always wins. */
export type FitSource = 'vision' | 'worn-photo' | 'user';

export interface FitValue<T = string> {
  value: T | null;
  /** 0–1. Below the server's ask threshold, the app confirms it with visual options. */
  confidence: number;
  source: FitSource;
}

/** Fit attributes the visual picker can confirm or correct. Width, length and leg are separate. */
export type FitKey = 'width' | 'length' | 'sleeves' | 'legShape' | 'rise';

export type Corrections = Partial<Record<FitKey, string>> & { acceptPhoto?: boolean };

export interface Analysis {
  category: MannequinCategory;
  /** Set when the photo looks like another category than the one chosen. */
  categoryNote: string | null;
  construction?: string | null;
  fit: Partial<Record<FitKey | 'shoulderDrop' | 'fabric' | 'hasClosure', FitValue<string | boolean>>>;
  /** Fit keys the user should confirm before preparing. */
  ask: FitKey[];
  defaultDrape: string | null;
  /** Why this photo can't be prepared reliably (e.g. text hidden by a fold). */
  needsAnotherPhoto: string | null;
}

export type JobState = 'waiting' | 'preparing' | 'ready_for_review' | 'approved' | 'rejected' | 'failed';

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShoePart extends Placement {
  key: string;
}

export interface Variant {
  id: string;
  itemId: string;
  category: MannequinCategory;
  /** e.g. "drape=natural", "drape=crisp;closure=open", "legs=follow", "pair". */
  key: string;
  version: number;
  status: 'needs_review' | 'approved' | 'rejected' | 'superseded';
  mannequinId: string;
  /** Storage keys, fetched through the authenticated files endpoint. */
  display: string;
  master: string;
  /** Position of the cropped layer on the mannequin canvas, in canvas pixels. */
  placement: Placement;
  styling: { drape?: string; closure?: string; back?: ShoePart; toe?: ShoePart; [k: string]: unknown };
  checks: Record<string, unknown>;
}

/** Approved layers to draw on the mannequin, one per slot. */
export interface StageLayers {
  top?: Variant;
  outerwear?: Variant;
  bottom?: Variant;
  shoes?: Variant;
}

export interface Job {
  id: string;
  itemId: string;
  category: MannequinCategory;
  variantKey: string;
  state: JobState;
  attempts: number;
  message: string | null;
  variantId: string | null;
  updatedAt: number;
  variant?: Variant;
}

export type Stacking = 'minimal' | 'natural' | 'heavy' | 'puddled';

export const STACKINGS: readonly Stacking[] = ['minimal', 'natural', 'heavy', 'puddled'];

/** Pants hem gathered against a specific pair of shoes (made on the server, no model call). */
export interface DerivedStack {
  pantsVariantId: string;
  shoesVariantId: string;
  stacking: Stacking;
  display: string;
  placement: Placement;
}

export interface MannequinInfo {
  id: string;
  /** [width, height] of the canvas every placement is measured on. */
  canvas: [number, number];
  displayScale: number;
  plate: string;
  landmarks: Record<string, unknown>;
}

export interface WardrobeAssets {
  mannequin: MannequinInfo;
  variants: Variant[];
  derived: DerivedStack[];
}

export interface Usage {
  credits: number;
  spent_total_usd: number;
  usable_assets: number;
  [k: string]: unknown;
}

/**
 * Where an item is in the prepare flow on this device. The first three stages are client steps
 * that are retried until they reach the server; the rest mirror the server job.
 */
export type PrepStage =
  | 'upload'
  | 'analyze'
  | 'confirm'
  | 'request'
  | JobState
  | 'error';

export interface ItemPrep {
  itemId: string;
  category: MannequinCategory;
  stage: PrepStage;
  /** The local photo this preparation is for; a new photo restarts the flow. */
  photoPath?: string;
  analysis?: Analysis;
  corrections?: Corrections;
  correctionNote?: string;
  /** Changes the job's idempotency key when the user explicitly asks for a fresh attempt. */
  attempt?: number;
  job?: Job;
  /** A user-facing message for `error` / `failed`. */
  message?: string;
  /** The photo itself can't be prepared reliably; only a new photo (or accepting it) helps. */
  needsPhoto?: boolean;
  updatedAt: number;
}
