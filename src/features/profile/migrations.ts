import { STYLE_TAGS, type PaletteId, type StyleProfile, type StyleTag } from './types';

export type ProfileV1 = Omit<StyleProfile, 'styleTags' | 'palettes' | 'fit'> & { styleTags: string[] };

/** v1 kept colour moods ("Earth Tones", "Monochrome") among style tags; v2 moves them to palettes. */
export function migrateV1(profile: ProfileV1): StyleProfile {
  const moved: Record<string, PaletteId> = { 'Earth Tones': 'earth', Monochrome: 'monochrome' };
  const palettes = profile.styleTags.map((t) => moved[t]).filter((p): p is PaletteId => !!p);
  const styleTags = profile.styleTags.filter((t): t is StyleTag =>
    (STYLE_TAGS as readonly string[]).includes(t),
  );
  return { ...profile, styleTags, palettes };
}
