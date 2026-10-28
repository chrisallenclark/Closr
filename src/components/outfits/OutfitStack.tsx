import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ItemImage } from '@/components/ui';
import type { ResolvedPiece } from '@/features/wardrobe/hooks';
import type { Slot } from '@/features/outfits/types';

export interface OutfitStackProps {
  pieces: ResolvedPiece[];
  width: number;
  height: number;
}

/**
 * Head-to-toe composition for the builder: top, bottom and shoes stacked vertically with slight
 * overlaps (like an outfit on a hanger), outerwear and accessory floating at the sides. Once
 * photos have background-removed cutouts this reads as a true flat lay.
 */
export function OutfitStack({ pieces, width, height }: OutfitStackProps) {
  const by = (slot: Slot) => pieces.find((p) => p.slot === slot);
  // Size the main pieces to fill the panel, then centre the whole composition vertically.
  const main = Math.min(width * 0.84, height / 2.45);
  const shoe = main * 0.6;
  const side = main * 0.5;
  const span = main * 0.86 + main * 0.84 + shoe;
  const top = by('top');
  const bottom = by('bottom');
  const shoes = by('shoes');
  const outer = by('outerwear');
  const accessory = by('accessory');
  const onepiece = by('onepiece');

  const tile = (p: ResolvedPiece | undefined, size: number, style: object, height = size) =>
    p ? (
      <Animated.View key={`${p.slot}-${p.item.id}`} entering={FadeIn.duration(260)} exiting={FadeOut.duration(160)} style={[styles.shadow, style]}>
        <ItemImage photo={p.item.photo} style={{ width: size, height }} radius={16} />
      </Animated.View>
    ) : null;

  const mainLeft = (width - main) / 2;
  const topY = Math.max(0, (height - span) / 2);
  const bottomY = topY + main * 0.86;
  const shoesY = bottomY + main * 0.84;

  return (
    <View style={{ width, height }}>
      {tile(outer, side, { position: 'absolute', left: 0, top: topY + main * 0.5, zIndex: 0 })}
      {tile(accessory, side * 0.8, { position: 'absolute', right: 0, top: bottomY + main * 0.2, zIndex: 0 })}
      {tile(bottom, main, { position: 'absolute', left: mainLeft, top: bottomY, zIndex: 1 })}
      {tile(top, main, { position: 'absolute', left: mainLeft, top: topY, zIndex: 2 })}
      {tile(onepiece, main, { position: 'absolute', left: mainLeft, top: topY, zIndex: 2 }, main * 1.7)}
      {tile(shoes, shoe, { position: 'absolute', left: (width - shoe) / 2 + main * 0.12, top: shoesY, zIndex: 3 })}
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
