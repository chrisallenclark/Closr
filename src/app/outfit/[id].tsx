import { router, useLocalSearchParams } from 'expo-router';
import { Check, Heart, Layers, Pencil, Trash } from 'lucide-react-native';
import { Alert, StyleSheet, useWindowDimensions, View } from 'react-native';

import { OutfitBoard } from '@/components/outfits/OutfitBoard';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  haptic,
  Header,
  IconButton,
  ItemImage,
  PressableScale,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { wearOutfit } from '@/features/actions';
import { MOOD_LINES, outfitHarmony, paletteMood } from '@/features/outfits/harmony';
import { useOutfits } from '@/features/outfits/store';
import { getSubcategoryLabel } from '@/features/wardrobe/catalog';
import { resolvePieces, useItemMap } from '@/features/wardrobe/hooks';
import { relativeDays } from '@/lib/time';
import { colors, gutter, space } from '@/theme';

export default function OutfitDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const outfit = useOutfits((s) => s.outfits.find((o) => o.id === id));
  const removeOutfit = useOutfits((s) => s.removeOutfit);
  const toggleFavorite = useOutfits((s) => s.toggleFavorite);
  const itemMap = useItemMap();
  const { width } = useWindowDimensions();

  if (!outfit) {
    return (
      <Screen header={<Header />}>
        <EmptyState icon={Layers} title="Outfit not found" body="It may have been deleted." />
      </Screen>
    );
  }

  const pieces = resolvePieces(outfit.pieces, itemMap);
  const items = pieces.map((p) => p.item);
  const harmony = items.length >= 2 ? Math.round(outfitHarmony(items) * 100) : null;

  const confirmDelete = () =>
    Alert.alert('Delete outfit?', 'The clothes stay in your wardrobe.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          router.back();
          removeOutfit(outfit.id);
        },
      },
    ]);

  return (
    <Screen
      header={
        <Header
          title={outfit.name}
          subtitle={outfit.occasion}
          onLeadingPress={() => (router.canGoBack() ? router.back() : router.replace('/outfits'))}
          right={
            <IconButton
              icon={Heart}
              variant="plain"
              fill={outfit.favorite ? colors.cream : undefined}
              onPress={() => {
                haptic.select();
                toggleFavorite(outfit.id);
              }}
              accessibilityLabel="Favourite"
            />
          }
        />
      }
    >
      <Card tone="hero" style={styles.board}>
        <OutfitBoard pieces={pieces} width={width - gutter * 2 - 24} gap={8} radius={14} />
        <View style={styles.meta}>
          <Text variant="caption" color={colors.creamDeep} style={styles.flex}>
            {items.length ? MOOD_LINES[paletteMood(items)] : ''}
          </Text>
          {harmony !== null ? <Badge label={`Harmony ${harmony}`} tone="cream" /> : null}
        </View>
      </Card>

      <View style={styles.stats}>
        <Text variant="caption" color={colors.textMuted}>
          Worn {outfit.wearCount}× · Last worn {relativeDays(outfit.lastWornAt).toLowerCase()}
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          label="Wearing it today"
          icon={Check}
          style={styles.flex}
          onPress={() => {
            haptic.success();
            wearOutfit(outfit.id);
          }}
        />
        <Button
          label="Edit"
          icon={Pencil}
          variant="secondary"
          onPress={() => router.push({ pathname: '/outfit/builder', params: { outfitId: outfit.id } })}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader title="Pieces" />
        {pieces.map(({ slot, item }) => (
          <PressableScale key={slot} onPress={() => router.push(`/item/${item.id}`)} style={styles.piece}>
            <ItemImage photo={item.photo} style={styles.thumb} radius={10} />
            <View style={styles.flex}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {item.name}
              </Text>
              <Text variant="caption" color={colors.textMuted}>
                {getSubcategoryLabel(item.category, item.subcategory)}
                {item.brand ? ` · ${item.brand}` : ''}
              </Text>
            </View>
          </PressableScale>
        ))}
        {pieces.length < 3 ? (
          <Text variant="caption" color={colors.textFaint}>
            Some pieces were removed from your wardrobe. Edit to fill the gaps.
          </Text>
        ) : null}
      </View>

      <Button label="Delete outfit" icon={Trash} variant="danger" onPress={confirmDelete} style={styles.delete} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  board: { padding: 12, gap: space.md, marginTop: space.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stats: { marginTop: space.md },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  section: { marginTop: space.xxl, gap: space.md },
  piece: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 56, height: 56 },
  delete: { marginTop: space.xxl },
});
