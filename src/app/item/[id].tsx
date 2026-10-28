import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Check, Heart, Layers, Pencil, Shirt, Trash } from 'lucide-react-native';
import { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ItemTile } from '@/components/wardrobe/ItemTile';
import {
  Button,
  Chip,
  ChipWrap,
  EmptyState,
  haptic,
  Header,
  IconButton,
  ItemImage,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { deleteItem } from '@/features/actions';
import { pairScore } from '@/features/outfits/harmony';
import { useOutfits } from '@/features/outfits/store';
import { FORMALITY_LABELS, getColor, getSubcategoryLabel, SEASONS } from '@/features/wardrobe/catalog';
import { useItem } from '@/features/wardrobe/hooks';
import { useWardrobe } from '@/features/wardrobe/store';
import { relativeDays } from '@/lib/time';
import { colors, gutter, radii, space } from '@/theme';

export default function ItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useItem(id);
  const items = useWardrobe((s) => s.items);
  const toggleFavorite = useWardrobe((s) => s.toggleFavorite);
  const markWorn = useWardrobe((s) => s.markWorn);
  const outfitCount = useOutfits((s) => s.outfits.filter((o) => Object.values(o.pieces).includes(id)).length);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const pairs = useMemo(() => {
    if (!item) return [];
    return items
      .filter((i) => i.category !== item.category)
      .map((i) => ({ item: i, score: pairScore(item, i) }))
      .filter((p) => p.score >= 0.7)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [item, items]);

  if (!item) {
    return (
      <Screen header={<Header />}>
        <EmptyState icon={Shirt} title="Item not found" body="It may have been deleted." />
      </Screen>
    );
  }

  const confirmDelete = () =>
    Alert.alert('Delete this item?', `${item.name} and its photo will be removed from this iPhone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          haptic.warning();
          router.back();
          deleteItem(item.id);
        },
      },
    ]);

  const seasons = SEASONS.filter((s) => item.seasons.includes(s.id)).map((s) => s.label);

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <View>
          <ItemImage photo={item.photo} style={{ width, height: width }} radius={0} inset={40} />
          <View style={[styles.overlay, { top: insets.top + 8 }]}>
            <IconButton icon={ArrowLeft} variant="glass" onPress={() => router.back()} accessibilityLabel="Back" />
            <View style={styles.overlayRight}>
              <IconButton icon={Pencil} variant="glass" onPress={() => router.push(`/item/edit/${item.id}`)} accessibilityLabel="Edit" />
              <IconButton
                icon={Heart}
                variant="glass"
                fill={item.favorite ? colors.cream : undefined}
                onPress={() => {
                  haptic.select();
                  toggleFavorite(item.id);
                }}
                accessibilityLabel={item.favorite ? 'Remove from favourites' : 'Add to favourites'}
              />
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.titleBlock}>
            {item.brand ? (
              <Text variant="eyebrow" color={colors.sand}>
                {item.brand}
              </Text>
            ) : null}
            <Text variant="display">{item.name}</Text>
            <Text variant="caption" color={colors.textMuted}>
              {getSubcategoryLabel(item.category, item.subcategory)}
              {item.fit ? ` · ${item.fit} fit` : ''} · {FORMALITY_LABELS[item.formality]}
              {seasons.length ? ` · ${seasons.join(', ')}` : ''}
            </Text>
          </View>

          <ChipWrap>
            {item.colors.map((c) => {
              const def = getColor(c);
              return def ? <Chip key={c} label={def.label} swatch={def.hex} /> : null;
            })}
          </ChipWrap>

          <View style={styles.stats}>
            <Stat value={String(item.wearCount)} label={item.wearCount === 1 ? 'Wear' : 'Wears'} />
            <View style={styles.divider} />
            <Stat value={relativeDays(item.lastWornAt)} label="Last worn" />
            <View style={styles.divider} />
            <Stat value={String(outfitCount)} label={outfitCount === 1 ? 'Outfit' : 'Outfits'} />
          </View>

          <View style={styles.actions}>
            <Button
              label="Build an outfit"
              icon={Layers}
              style={styles.flex}
              onPress={() => router.push({ pathname: '/outfit/builder', params: { [item.category]: item.id, lock: item.category } })}
            />
            <Button
              label="Wore it today"
              icon={Check}
              variant="secondary"
              style={styles.flex}
              onPress={() => {
                haptic.success();
                markWorn([item.id]);
              }}
            />
          </View>

          {pairs.length ? (
            <View>
              <SectionHeader title="Pairs well with" subtitle="Based on colour and dress level" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.row}>
                {pairs.map((p) => (
                  <ItemTile key={p.item.id} item={p.item} size={96} onPress={() => router.push(`/item/${p.item.id}`)} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <Button label="Delete item" icon={Trash} variant="danger" onPress={confirmDelete} style={styles.delete} />
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="subtitle" numberOfLines={1}>
        {value}
      </Text>
      <Text variant="micro" color={colors.textMuted}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  overlay: {
    position: 'absolute',
    left: gutter - 4,
    right: gutter - 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  overlayRight: { flexDirection: 'row', gap: space.sm },
  body: {
    marginTop: -radii.xl,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    backgroundColor: colors.bg,
    paddingHorizontal: gutter,
    paddingTop: space.xxl,
    gap: space.xl,
  },
  titleBlock: { gap: space.xs },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingVertical: space.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: space.sm },
  divider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.borderStrong },
  actions: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
  bleed: { marginHorizontal: -gutter },
  row: { paddingHorizontal: gutter, gap: space.sm },
  delete: { marginTop: space.lg },
});
