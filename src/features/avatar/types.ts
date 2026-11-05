/**
 * Data model for mannequin-ready garment assets (Build Outfit dress-up).
 *
 * Each wardrobe item gets reusable layers prepared once on Closr's canonical mannequin; outfits
 * are composed by stacking approved layers, so switching never generates anything. This mirrors
 * the asset store written by scripts/avatar-prototype/poc/asset_store.py: the same records live in
 * cloud storage, keyed by item id, and are cached on the device.
 *
 * Not wired into the app yet.
 */

/** Where a fit value came from. A user's correction always wins. */
export type FitSource = 'photo-measurement' | 'vision' | 'worn-photo' | 'user' | 'deleted';

export interface FitValue<T> {
  value: T | null;
  /** 0–1. Below the ask threshold, Closr asks the user to confirm with visual options. */
  confidence: number;
  source: FitSource;
}

/** Independent fit attributes: width, length, sleeves and leg shape are separate, never one label. */
export interface TopFit {
  width: FitValue<'fitted' | 'regular' | 'relaxed' | 'boxy' | 'oversized'>;
  length: FitValue<'cropped' | 'short' | 'standard' | 'long' | 'longline'>;
  sleeves: FitValue<'sleeveless' | 'short' | 'elbow' | 'three-quarter' | 'long'>;
  shoulderDrop: FitValue<'none' | 'slight' | 'dropped'>;
  /** Knit vs woven decides how the fabric drapes (soft folds vs crisp creases). */
  fabric: FitValue<'knit' | 'woven' | 'rib' | 'fleece' | 'denim' | 'other'>;
  /** Button-up identity; whether it's worn open is styling, not fit. */
  hasClosure: FitValue<boolean>;
}

export interface BottomFit {
  legShape: FitValue<'skinny' | 'slim' | 'straight' | 'relaxed' | 'baggy' | 'wide-leg' | 'extra-wide'>;
  rise: FitValue<'low' | 'mid' | 'high'>;
  /** How long the leg is relative to the shoe; drives the default stacking. */
  length: FitValue<'cropped' | 'standard' | 'long'>;
}

/** How a top rests at the waist. Untucked drapes keep the shirt fully outside the waistband. */
export type Drape = 'free' | 'natural' | 'relaxed' | 'easy' | 'smooth' | 'crisp';
export type Closure = 'buttoned' | 'open';
export type Tuck = 'untucked' | 'front' | 'half' | 'full';
export type Stacking = 'minimal' | 'natural' | 'heavy' | 'puddled';

/** The styling a prepared layer represents. Never names an outfit: layers are reusable. */
export interface TopStyling {
  drape: Drape;
  closure?: Closure;
  tuck: Tuck;
  /** Open button-ups are drawn as an outer layer over another top. */
  slot: 'inner' | 'outer';
}

/** e.g. "drape=natural", "drape=crisp;closure=open", "legs=follow", "pair". */
export type VariantKey = string;

export type VariantStatus = 'preparing' | 'needs_review' | 'approved' | 'rejected' | 'failed';

/** A file in the asset store: a remote key once synced, a relative path in the device cache. */
export interface StoredFile {
  remoteKey?: string;
  localPath?: string;
  bytes?: number;
}

export interface GarmentVariant {
  key: VariantKey;
  itemId: string;
  /** The canonical mannequin this layer is aligned to; a new mannequin means re-preparing. */
  mannequinId: string;
  status: VariantStatus;
  /** Lossless layer, cropped to the garment, on the mannequin canvas. */
  master: StoredFile;
  /** Phone-size layer the stage draws. */
  display: StoredFile;
  /** Position of the cropped layer on the mannequin canvas (canvas pixels). */
  placement: { x: number; y: number; w: number; h: number };
  styling: TopStyling | { legs: 'follow' } | Record<string, never>;
  checks: {
    alignment: number;
    waistbandExposed?: number;
    centreLiftPx?: number;
    printMismatches?: string[];
  };
  provenance: { model: string; renders: number; costUsd: number };
  createdAt: string;
  reviewedAt?: string;
}

export interface GarmentAssets {
  itemId: string;
  category: 'top' | 'bottom' | 'onepiece' | 'outerwear' | 'shoes' | 'accessory';
  fit: Partial<TopFit> | Partial<BottomFit>;
  /** Original garment photo(s): the source of truth for colour, print and texture. */
  sources: StoredFile[];
  /** Optional photos of the user wearing it; deletable on their own, with the values they produced. */
  wornSources: StoredFile[];
  defaultVariant: VariantKey;
  variants: Record<VariantKey, GarmentVariant>;
}

/** One preparation request: made on upload (default variant) or when a user asks for another style. */
export interface PrepJob {
  id: string;
  itemId: string;
  variant: VariantKey;
  state: 'queued' | 'classifying' | 'awaiting_fit_confirmation' | 'rendering' | 'checking' | 'needs_review' | 'done' | 'failed';
  attempts: number;
  /** Shown to the user when a photo can't be used, e.g. text hidden by a fold. */
  needsAnotherPhoto?: string;
  costUsd: number;
}
