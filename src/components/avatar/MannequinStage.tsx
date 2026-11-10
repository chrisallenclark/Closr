import { Image } from 'expo-image';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { recordLayerLoad } from '@/features/avatar/perf';

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

/**
 * Back-to-front draw order on the mannequin. The shoe is split around the hem (back under the
 * pants, toe over it). New garment types are added as slots here: a dress or skirt between the
 * shoes and the top, boots whose shaft sits over the hem after `shoeToe`, a tucked top before
 * `bottom`. The order is data, so the renderer doesn't change shape when they arrive.
 */
export const STAGE_ORDER = ['shoeBack', 'bottom', 'shoeToe', 'shoes', 'top', 'outerwear'] as const;
type StageSlot = (typeof STAGE_ORDER)[number];

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

  // Time from a layer starting to load until it's drawn, per storage key (device diagnostics).
  const started = useRef(new Map<string, number>());
  const timing = (k: string) => ({
    onLoadStart: () => started.current.set(k, performance.now()),
    onLoad: (e: { cacheType: 'none' | 'disk' | 'memory' }) => {
      const t0 = started.current.get(k);
      if (t0 !== undefined) recordLayerLoad({ ms: performance.now() - t0, cache: e.cacheType });
      started.current.delete(k);
    },
  });

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
        {...timing(key)}
      />
    ) : null;

  const shoes = layers.shoes;
  const back = shoes?.styling.back;
  const toe = shoes?.styling.toe;
  const split = !!(layers.bottom && back && toe);
  const stack = derivedFor(assets, layers, stacking);

  // What each draw slot shows for this outfit; STAGE_ORDER decides back-to-front order.
  const parts: Record<StageSlot, { key?: string; place?: Placement } | null> = {
    shoeBack: shoes && split ? { key: back!.key, place: back } : null,
    bottom: layers.bottom
      ? stack
        ? { key: stack.display, place: stack.placement }
        : { key: layers.bottom.display, place: layers.bottom.placement }
      : null,
    shoeToe: shoes && split ? { key: toe!.key, place: toe } : null,
    shoes: shoes && !split ? { key: shoes.display, place: shoes.placement } : null,
    top: layers.top ? { key: layers.top.display, place: layers.top.placement } : null,
    outerwear: layers.outerwear ? { key: layers.outerwear.display, place: layers.outerwear.placement } : null,
  };

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
        {STAGE_ORDER.map((slot) => (parts[slot] ? layer(slot, parts[slot]!.key, parts[slot]!.place) : null))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
});
