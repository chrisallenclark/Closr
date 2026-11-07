import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import type { DerivedStack, Placement, Stacking, StageLayers, WardrobeAssets } from '@/features/avatar/types';
import { absoluteUrl, type SignedUrls } from '@/services/avatarApi';

export type { StageLayers };

export interface MannequinStageProps {
  assets: WardrobeAssets;
  urls: SignedUrls;
  layers: StageLayers;
  stacking?: Stacking;
  width: number;
  height: number;
}

/** Image source for a storage key. The key is immutable, so it doubles as the disk-cache key. */
export function layerSource(urls: SignedUrls, key: string | undefined) {
  if (!key) return undefined;
  const url = urls[key];
  return url ? { uri: absoluteUrl(url), cacheKey: key } : { uri: undefined, cacheKey: key };
}

/** The stacked hem for this pants × shoes pair, when the server has made it. */
export function derivedFor(assets: WardrobeAssets, layers: StageLayers, stacking: Stacking): DerivedStack | undefined {
  if (!layers.bottom || !layers.shoes) return undefined;
  return assets.derived.find(
    (d) => d.pantsVariantId === layers.bottom!.id && d.shoesVariantId === layers.shoes!.id && d.stacking === stacking,
  );
}

/**
 * The dress-up stage: approved layers stacked on the canonical mannequin, entirely on the device.
 * Switching a garment swaps one cached image; nothing is generated. Draw order follows the
 * prototype's occlusion rules: shoe backs, pants (hem stacked on the chosen shoe), shoe toes,
 * top, then an outer layer.
 */
export function MannequinStage({ assets, urls, layers, stacking = 'natural', width, height }: MannequinStageProps) {
  const [cw, ch] = assets.mannequin.canvas;
  // Fill the height: a narrower box crops the plate's empty sides (the figure stays whole); a
  // wider one shows a blurred copy of the plate behind it instead of a hard edge.
  const narrow = width / height < cw / ch;
  const scale = narrow ? height / ch : Math.min(width / cw, height / ch);
  const w = cw * scale;
  const h = ch * scale;

  const box = (p: Placement) => ({ left: p.x * scale, top: p.y * scale, width: p.w * scale, height: p.h * scale });
  const layer = (id: string, key: string | undefined, p: Placement | undefined) =>
    key && p ? (
      <Image
        key={id}
        source={layerSource(urls, key)}
        style={[styles.abs, box(p)]}
        contentFit="fill"
        cachePolicy="memory-disk"
        transition={0}
        accessibilityIgnoresInvertColors
      />
    ) : null;

  const shoes = layers.shoes;
  const back = shoes?.styling.back;
  const toe = shoes?.styling.toe;
  const split = !!(layers.bottom && back && toe);
  const stack = derivedFor(assets, layers, stacking);

  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {!narrow ? (
        <Image
          source={layerSource(urls, assets.mannequin.plate)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={24}
          cachePolicy="memory-disk"
          transition={0}
        />
      ) : null}
      <View style={{ width: w, height: h }}>
        <Image
          source={layerSource(urls, assets.mannequin.plate)}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
          cachePolicy="memory-disk"
          transition={0}
        />
        {shoes && split ? layer('shoe-back', back!.key, back) : null}
        {layers.bottom
          ? stack
            ? layer('pants', stack.display, stack.placement)
            : layer('pants', layers.bottom.display, layers.bottom.placement)
          : null}
        {shoes && split ? layer('shoe-toe', toe!.key, toe) : null}
        {shoes && !split ? layer('shoes', shoes.display, shoes.placement) : null}
        {layers.top ? layer('top', layers.top.display, layers.top.placement) : null}
        {layers.outerwear ? layer('outer', layers.outerwear.display, layers.outerwear.placement) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
});
