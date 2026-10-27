import { Heart } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { resolvePieces } from '@/features/wardrobe/hooks';
import type { ClothingItem } from '@/features/wardrobe/types';
import type { Outfit } from '@/features/outfits/types';
import { colors, space } from '@/theme';

import { OutfitBoard } from './OutfitBoard';

export interface OutfitCardProps {
  outfit: Outfit;
  itemMap: Map<string, ClothingItem>;
  width: number;
  onPress?: () => void;
}

export function OutfitCard({ outfit, itemMap, width, onPress }: OutfitCardProps) {
  const pieces = resolvePieces(outfit.pieces, itemMap);
  return (
    <Card onPress={onPress} style={[styles.card, { width }]} accessibilityLabel={outfit.name}>
      <OutfitBoard pieces={pieces} width={width - 16} gap={4} radius={8} />
      <View style={styles.meta}>
        <View style={styles.title}>
          <Text variant="label" numberOfLines={1} style={styles.flex}>
            {outfit.name}
          </Text>
          {outfit.favorite ? <Heart size={13} color={colors.cream} fill={colors.cream} /> : null}
        </View>
        <Text variant="micro" color={colors.textMuted}>
          {[outfit.occasion, `${pieces.length} pieces`].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 8 },
  meta: { paddingHorizontal: 4, paddingTop: space.sm, gap: 2 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1 },
});
