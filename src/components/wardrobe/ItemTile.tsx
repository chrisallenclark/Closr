import { Heart } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { ItemImage, PressableScale, Text } from '@/components/ui';
import type { ClothingItem } from '@/features/wardrobe/types';
import { colors } from '@/theme';

export interface ItemTileProps {
  item: ClothingItem;
  size: number;
  onPress?: () => void;
  selected?: boolean;
  showName?: boolean;
}

export function ItemTile({ item, size, onPress, selected, showName }: ItemTileProps) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.name}
      style={{ width: size }}
    >
      <View>
        <ItemImage photo={item.photo} style={{ width: size, height: size }} radius={12} />
        {item.favorite ? (
          <View style={styles.heart}>
            <Heart size={11} color={colors.ink} fill={colors.ink} />
          </View>
        ) : null}
        {selected ? <View style={styles.selected} pointerEvents="none" /> : null}
      </View>
      {showName ? (
        <Text variant="caption" numberOfLines={1} style={styles.name} color={colors.textMuted}>
          {item.name}
        </Text>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  heart: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(239,228,210,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.cream,
  },
  name: { marginTop: 6 },
});
