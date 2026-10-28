import { useCallback, useEffect, useMemo } from 'react';

import { dayKey } from '@/lib/time';

import { useProfile } from '../profile/store';
import { preferredColors } from '../profile/types';
import { useWardrobe } from '../wardrobe/store';
import { generateOutfits, missingSlots, type StylePreferences } from './generator';
import { useOutfits } from './store';
import type { OutfitPieces, Slot } from './types';

function seedFromDay(day: string): number {
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function usePreferences(): StylePreferences {
  const profile = useProfile((s) => s.profile);
  return useMemo(
    () => ({
      favoriteColors: profile ? preferredColors(profile) : [],
      avoidColors: profile?.avoidColors ?? [],
    }),
    [profile],
  );
}

/**
 * Today's outfit: generated once per day (stable across app launches) and re-rolled on demand.
 */
export function useDailyOutfit(): {
  pieces: OutfitPieces | null;
  missing: Slot[];
  refresh: () => void;
} {
  const items = useWardrobe((s) => s.items);
  const daily = useOutfits((s) => s.daily);
  const setDaily = useOutfits((s) => s.setDaily);
  const preferences = usePreferences();
  const today = dayKey();
  const missing = useMemo(() => missingSlots(items), [items]);

  const valid = useMemo(() => {
    if (!daily || daily.day !== today) return false;
    const ids = new Set(items.map((i) => i.id));
    return Object.values(daily.pieces).every((id) => !id || ids.has(id));
  }, [daily, items, today]);

  useEffect(() => {
    if (valid || missing.length) return;
    const [best] = generateOutfits(items, { count: 1, seed: seedFromDay(today), preferences });
    setDaily(best ? { day: today, pieces: best.pieces } : null);
  }, [valid, missing.length, items, today, preferences, setDaily]);

  const refresh = useCallback(() => {
    const looks = generateOutfits(items, {
      count: 1,
      seed: Math.floor(Math.random() * 1e9),
      preferences,
    });
    if (looks[0]) setDaily({ day: today, pieces: looks[0].pieces });
  }, [items, preferences, setDaily, today]);

  return { pieces: valid && daily ? daily.pieces : null, missing, refresh };
}
