import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { ItemImage, PressableScale, Text } from '@/components/ui';
import type { PhotoRef } from '@/features/wardrobe/types';
import { colors, gradients } from '@/theme';

export interface CategoryTileProps {
  label: string;
  count: number;
  photo?: PhotoRef;
  width: number;
  active?: boolean;
  onPress?: () => void;
}

/** Cream "Graphic Tee · 4 items" tile from the mockup's wardrobe grid. */
export function CategoryTile({ label, count, photo, width, active, onPress }: CategoryTileProps) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}, ${count} items`}>
      <LinearGradient colors={gradients.studio} style={[styles.tile, { width }, active && styles.active]}>
        <ItemImage photo={photo} style={{ width: width - 12, height: width - 12 }} radius={10} />
        <View style={styles.meta}>
          <Text variant="label" color={colors.ink} numberOfLines={1}>
            {label}
          </Text>
          <Text variant="micro" color={colors.inkMuted}>
            {count} {count === 1 ? 'item' : 'items'}
          </Text>
        </View>
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: 14, padding: 6, paddingBottom: 8 },
  active: { borderWidth: 2, borderColor: colors.sand },
  meta: { paddingHorizontal: 4, paddingTop: 6, gap: 1 },
});
