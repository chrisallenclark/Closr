import { router } from 'expo-router';
import { Layers, Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { OutfitCard } from '@/components/outfits/OutfitCard';
import {
  Chip,
  ChipRow,
  EmptyState,
  IconButton,
  Screen,
  TAB_BAR_CLEARANCE,
  Text,
} from '@/components/ui';
import { useOutfits } from '@/features/outfits/store';
import { OCCASIONS, type Occasion } from '@/features/outfits/types';
import { useItemMap } from '@/features/wardrobe/hooks';
import { colors, gutter, space } from '@/theme';

const GAP = 12;
type Filter = 'all' | 'favorites' | Occasion;

export default function Outfits() {
  const { width } = useWindowDimensions();
  const outfits = useOutfits((s) => s.outfits);
  const itemMap = useItemMap();
  const [filter, setFilter] = useState<Filter>('all');

  const usedOccasions = useMemo(
    () => OCCASIONS.filter((o) => outfits.some((x) => x.occasion === o)),
    [outfits],
  );
  const visible = outfits.filter((o) =>
    filter === 'all' ? true : filter === 'favorites' ? o.favorite : o.occasion === filter,
  );
  const cardW = (width - gutter * 2 - GAP) / 2;

  return (
    <Screen bottomInset={TAB_BAR_CLEARANCE}>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text variant="display">Outfits</Text>
          <Text variant="caption" color={colors.textMuted}>
            {outfits.length} saved
          </Text>
        </View>
        <IconButton icon={Plus} variant="cream" onPress={() => router.push('/outfit/builder')} accessibilityLabel="Build outfit" />
      </View>

      {outfits.length ? (
        <>
          <ChipRow>
            <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
            <Chip label="Favourites" selected={filter === 'favorites'} onPress={() => setFilter('favorites')} />
            {usedOccasions.map((o) => (
              <Chip key={o} label={o} selected={filter === o} onPress={() => setFilter(o)} />
            ))}
          </ChipRow>
          <View style={styles.grid}>
            {visible.map((o) => (
              <OutfitCard key={o.id} outfit={o} itemMap={itemMap} width={cardW} onPress={() => router.push(`/outfit/${o.id}`)} />
            ))}
          </View>
          {visible.length === 0 ? (
            <Text variant="body" color={colors.textMuted} align="center" style={styles.none}>
              No outfits here yet.
            </Text>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={Layers}
          title="No saved outfits"
          body="Mix pieces in the builder or let Smart Shuffle suggest looks, then save the ones you love."
          actionLabel="Build an outfit"
          onAction={() => router.push('/outfit/builder')}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm, marginBottom: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, marginTop: space.lg },
  none: { marginTop: space.xxl },
});
