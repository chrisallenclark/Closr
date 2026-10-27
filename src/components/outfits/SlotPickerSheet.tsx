import { router } from 'expo-router';
import { Ban, Lock, LockOpen, Plus } from 'lucide-react-native';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { ItemTile } from '@/components/wardrobe/ItemTile';
import { PressableScale, Sheet, Text } from '@/components/ui';
import { REQUIRED_SLOTS, type Slot } from '@/features/outfits/types';
import { getCategory } from '@/features/wardrobe/catalog';
import type { ClothingItem } from '@/features/wardrobe/types';
import { colors, gutter, radii, space } from '@/theme';

export interface SlotPickerSheetProps {
  slot: Slot | null;
  items: ClothingItem[];
  selectedId?: string;
  locked: boolean;
  onSelect: (id: string | undefined) => void;
  onToggleLock: () => void;
  onClose: () => void;
}

const COLS = 3;
const GAP = 10;

export function SlotPickerSheet({ slot, items, selectedId, locked, onSelect, onToggleLock, onClose }: SlotPickerSheetProps) {
  const { width } = useWindowDimensions();
  const size = (width - gutter * 2 - GAP * (COLS - 1)) / COLS;
  if (!slot) return null;
  const def = getCategory(slot);
  const optional = !REQUIRED_SLOTS.includes(slot);
  const options = items.filter((i) => i.category === slot);

  return (
    <Sheet visible={!!slot} onClose={onClose} title={`Choose ${slot === 'accessory' ? 'an accessory' : def.label.toLowerCase()}`}>
      <PressableScale onPress={onToggleLock} style={styles.lockRow} hapticFeedback="select">
        {locked ? <Lock size={16} color={colors.cream} /> : <LockOpen size={16} color={colors.textMuted} />}
        <Text variant="label" color={locked ? colors.text : colors.textMuted} style={styles.flex}>
          {locked ? 'Locked — Shuffle keeps this piece' : 'Lock to keep this piece when shuffling'}
        </Text>
      </PressableScale>

      <View style={styles.grid}>
        {optional ? (
          <PressableScale onPress={() => onSelect(undefined)} style={[styles.special, { width: size, height: size }, !selectedId && styles.specialActive]}>
            <Ban size={22} color={colors.textMuted} strokeWidth={1.4} />
            <Text variant="caption" color={colors.textMuted}>
              None
            </Text>
          </PressableScale>
        ) : null}
        {options.map((item) => (
          <ItemTile key={item.id} item={item} size={size} selected={item.id === selectedId} showName onPress={() => onSelect(item.id)} />
        ))}
        <PressableScale
          onPress={() => {
            onClose();
            router.push({ pathname: '/item/new', params: { category: slot } });
          }}
          style={[styles.special, { width: size, height: size }]}
        >
          <Plus size={22} color={colors.textMuted} strokeWidth={1.4} />
          <Text variant="caption" color={colors.textMuted}>
            Add {def.label.toLowerCase()}
          </Text>
        </PressableScale>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    marginBottom: space.lg,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  special: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  specialActive: { borderColor: colors.cream, borderStyle: 'solid' },
});
