import { useMemo } from 'react';

import type { OutfitPieces } from '../outfits/types';
import { approvedVariants, useAvatar } from './store';
import { MANNEQUIN_CATEGORIES, type StageLayers } from './types';

/**
 * The approved mannequin layers for an outfit, read from the cached manifest. Pure lookup: no
 * network and no model calls, so switching garments only swaps which cached image is drawn.
 */
export function useStageLayers(pieces: OutfitPieces) {
  const assets = useAvatar((s) => s.assets);
  const urls = useAvatar((s) => s.urls);
  return useMemo(() => {
    const layers: StageLayers = {};
    const missing: string[] = [];
    for (const slot of MANNEQUIN_CATEGORIES) {
      const id = pieces[slot];
      if (!id) continue;
      const v = approvedVariants(assets, id)[0];
      if (v) layers[slot] = v;
      else missing.push(id);
    }
    // A one-piece or an extra can't be worn on the mannequin yet: show the flat lay instead.
    const unsupported = !!pieces.onepiece;
    const available = !!assets && !unsupported && Object.keys(layers).length > 0;
    const stackable = !!assets && !!layers.bottom && !!layers.shoes &&
      assets.derived.some((d) => d.pantsVariantId === layers.bottom!.id && d.shoesVariantId === layers.shoes!.id);
    return { assets, urls, layers, missing, available, stackable };
  }, [assets, urls, pieces]);
}
