/** `onepiece` (dresses, jumpsuits, swimsuits…) stands in for a top and bottom together. */
export type Category = 'top' | 'bottom' | 'onepiece' | 'outerwear' | 'shoes' | 'accessory';

/** How a garment fits. Matches the profile's fit preference (minus "Mixed"). */
export type ItemFit = 'Slim' | 'Fitted' | 'Regular' | 'Relaxed' | 'Oversized';

export type Season = 'spring' | 'summer' | 'fall' | 'winter';

/** 1 = very casual (lounge), 5 = formal (suit, dress shoes). */
export type Formality = 1 | 2 | 3 | 4 | 5;

export type ColorId = string;

/**
 * A photo reference that survives app updates and is ready for cloud sync.
 *
 * `localPath` is relative to the app's photo directory (never an absolute path, because the
 * iOS container path changes between installs/updates). `remoteUrl` is filled in once sync
 * exists. `cutoutPath` will hold a background-removed PNG when that pipeline ships.
 */
export interface PhotoRef {
  localPath?: string;
  remoteUrl?: string;
  cutoutPath?: string;
  width?: number;
  height?: number;
}

export interface ClothingItem {
  id: string;
  name: string;
  category: Category;
  subcategory: string;
  /** Ordered: the first entry is the dominant colour. */
  colors: ColorId[];
  seasons: Season[];
  formality: Formality;
  fit?: ItemFit;
  brand?: string;
  notes?: string;
  favorite: boolean;
  wearCount: number;
  lastWornAt?: string;
  photo: PhotoRef;
  createdAt: string;
  updatedAt: string;
}

/** The editable fields of an item, used by the add/edit form. */
export type ClothingDraft = Pick<
  ClothingItem,
  'name' | 'category' | 'subcategory' | 'colors' | 'seasons' | 'formality' | 'fit' | 'brand' | 'notes'
>;
