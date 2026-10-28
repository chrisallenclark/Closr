import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Shirt } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { PhotoRef } from '@/features/wardrobe/types';
import { resolvePhotoUri } from '@/services/photos';
import { colors, gradients } from '@/theme';

export interface ItemImageProps {
  photo?: PhotoRef;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  /** Inner padding used when showing a background-removed cutout. */
  inset?: number;
}

/**
 * Every clothing photo sits on the same warm "studio" backdrop so a wardrobe of mixed user photos
 * still reads as one curated set. The whole photo is always shown (never cropped); once
 * background-removed cutouts exist they render inset on the backdrop for a product-shot look.
 */
export function ItemImage({ photo, style, radius = 14, inset = 10 }: ItemImageProps) {
  const uri = resolvePhotoUri(photo);
  const isCutout = !!photo?.cutoutPath;
  return (
    <View style={[styles.frame, { borderRadius: radius }, style]}>
      <LinearGradient colors={gradients.studio} style={StyleSheet.absoluteFill} />
      {uri ? (
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, isCutout && { margin: inset }]}
          contentFit="contain"
          transition={180}
          recyclingKey={uri}
        />
      ) : (
        <View style={styles.placeholder}>
          <Shirt size={28} color={colors.taupe} strokeWidth={1.2} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: colors.creamMuted },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
