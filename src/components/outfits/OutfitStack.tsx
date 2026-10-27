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
  const unit = Math.min(width, height / 1.72);
  const main = unit * 0.7;
  const shoe = unit * 0.44;
  const side = unit * 0.36;

  const top = by('top');
  const bottom = by('bottom');
  const shoes = by('shoes');
  const outer = by('outerwear');
  const accessory = by('accessory');

  const tile = (p: ResolvedPiece | undefined, size: number, style: object) =>
    p ? (
      <Animated.View key={`${p.slot}-${p.item.id}`} entering={FadeIn.duration(260)} exiting={FadeOut.duration(160)} style={[styles.shadow, style]}>
        <ItemImage photo={p.item.photo} style={{ width: size, height: size }} radius={16} />
      </Animated.View>
    ) : null;

  const mainLeft = (width - main) / 2;
  const topY = height * 0.03;
  const bottomY = topY + main * 0.86;
  const shoesY = Math.min(bottomY + main * 0.84, height - shoe);

  return (
    <View style={{ width, height }}>
      {tile(outer, side, { position: 'absolute', left: 0, top: topY + main * 0.42, zIndex: 0 })}
      {tile(accessory, side * 0.85, { position: 'absolute', right: 0, top: topY + main * 0.55, zIndex: 0 })}
      {tile(bottom, main, { position: 'absolute', left: mainLeft, top: bottomY, zIndex: 1 })}
      {tile(top, main, { position: 'absolute', left: mainLeft, top: topY, zIndex: 2 })}
      {tile(shoes, shoe, { position: 'absolute', left: (width - shoe) / 2 + main * 0.18, top: shoesY, zIndex: 3 })}
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
