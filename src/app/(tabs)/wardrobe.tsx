import { router } from 'expo-router';
import { Plus, Search, Shirt, SlidersHorizontal, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryTile } from '@/components/wardrobe/CategoryTile';
import { FilterSheet } from '@/components/wardrobe/FilterSheet';
import { ItemTile } from '@/components/wardrobe/ItemTile';
import {
  Button,
  Chip,
  ChipRow,
  EmptyState,
  IconButton,
  PressableScale,
  TAB_BAR_CLEARANCE,
  Text,
  TextField,
} from '@/components/ui';
import { CATEGORIES, getSubcategoryLabel } from '@/features/wardrobe/catalog';
import {
  activeFilterCount,
  filterItems,
  groupBySubcategory,
  type WardrobeFilter,
} from '@/features/wardrobe/selectors';
import { useWardrobe } from '@/features/wardrobe/store';
import type { Category } from '@/features/wardrobe/types';
import { colors, gutter, radii, space } from '@/theme';

const COLS = 4;
const GAP = 8;
const TILE_COLS = 3;
const TILE_LIMIT = 6;

export default function Wardrobe() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const items = useWardrobe((s) => s.items);

  const [category, setCategory] = useState<Category | undefined>();
  const [subcategory, setSubcategory] = useState<string | undefined>();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<WardrobeFilter>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [showAllTiles, setShowAllTiles] = useState(false);

  const inCategory = useMemo(() => filterItems(items, { category }), [items, category]);
  const groups = useMemo(() => groupBySubcategory(inCategory), [inCategory]);
  const visible = useMemo(
    () => filterItems(items, { ...filter, category, subcategory, query }),
    [items, filter, category, subcategory, query],
  );

  const cell = (width - gutter * 2 - GAP * (COLS - 1)) / COLS;
  const tileW = (width - gutter * 2 - GAP * (TILE_COLS - 1)) / TILE_COLS;
  const filters = activeFilterCount(filter);
  const tiles = showAllTiles ? groups : groups.slice(0, TILE_LIMIT);

  const selectCategory = (c?: Category) => {
    setCategory(c);
    setSubcategory(undefined);
    setShowAllTiles(false);
  };

  const header = (
    <View>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text variant="display">My Wardrobe</Text>
          <Text variant="caption" color={colors.textMuted}>
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </Text>
        </View>
        <IconButton
          icon={searching ? X : Search}
          onPress={() => {
            setSearching(!searching);
            setQuery('');
          }}
          accessibilityLabel={searching ? 'Close search' : 'Search'}
        />
        <IconButton icon={Plus} variant="cream" onPress={() => router.push('/item/new')} accessibilityLabel="Add item" />
      </View>

      {searching ? (
        <View style={styles.search}>
          <TextField value={query} onChangeText={setQuery} placeholder="Search name, brand, type" autoFocus returnKeyType="search" />
        </View>
      ) : null}

      {items.length ? (
        <>
          <ChipRow>
            <Chip label="All" selected={!category} onPress={() => selectCategory(undefined)} />
            {CATEGORIES.map((c) => (
              <Chip key={c.id} label={c.plural} selected={category === c.id} onPress={() => selectCategory(c.id)} />
            ))}
          </ChipRow>

          {tiles.length > 1 || subcategory ? (
            <View style={styles.tiles}>
              {tiles.map((g) => (
                <CategoryTile
                  key={`${g.category}:${g.subcategory}`}
                  label={getSubcategoryLabel(g.category, g.subcategory)}
                  count={g.count}
                  photo={g.cover.photo}
                  width={tileW}
                  active={subcategory === g.subcategory}
                  onPress={() => setSubcategory(subcategory === g.subcategory ? undefined : g.subcategory)}
                />
              ))}
            </View>
          ) : null}
          {groups.length > TILE_LIMIT ? (
            <PressableScale onPress={() => setShowAllTiles(!showAllTiles)} style={styles.more}>
              <Text variant="label" color={colors.textMuted}>
                {showAllTiles ? 'Show less' : `Show all ${groups.length} types`}
              </Text>
            </PressableScale>
          ) : null}

          <View style={styles.allRow}>
            <View style={styles.flex}>
              <Text variant="title">
                {subcategory && category ? getSubcategoryLabel(category, subcategory) : 'All Items'}
              </Text>
              {visible.length !== inCategory.length ? (
                <Text variant="caption" color={colors.textMuted}>
                  {visible.length} shown
                </Text>
              ) : null}
            </View>
            <PressableScale onPress={() => setFilterOpen(true)} style={styles.filterBtn} accessibilityLabel="Filter">
              <SlidersHorizontal size={14} color={colors.text} />
              <Text variant="label">{filters ? `Filter · ${filters}` : 'Filter'}</Text>
            </PressableScale>
          </View>
        </>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <FlatList
        data={visible}
        key={COLS}
        numColumns={COLS}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        columnWrapperStyle={styles.column}
        contentContainerStyle={[styles.content, { paddingBottom: TAB_BAR_CLEARANCE + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ItemTile item={item} size={cell} onPress={() => router.push(`/item/${item.id}`)} />
        )}
        ListEmptyComponent={
          items.length ? (
            <View style={styles.noResults}>
              <Text variant="body" color={colors.textMuted} align="center">
                Nothing matches these filters.
              </Text>
              <Button
                label="Clear filters"
                variant="secondary"
                size="sm"
                onPress={() => {
                  setFilter({});
                  setQuery('');
                  setSubcategory(undefined);
                }}
              />
            </View>
          ) : (
            <EmptyState
              icon={Shirt}
              title="Start your wardrobe"
              body="Photograph a few pieces you wear most — a top, a bottom and shoes is enough to get outfit ideas."
              actionLabel="Add your first item"
              onAction={() => router.push('/item/new')}
            />
          )
        }
      />
      <FilterSheet visible={filterOpen} value={filter} onChange={setFilter} onClose={() => setFilterOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: gutter },
  column: { gap: GAP, marginBottom: GAP },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm, marginBottom: space.lg },
  search: { marginBottom: space.lg },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, marginTop: space.lg },
  more: { alignSelf: 'center', paddingVertical: space.md },
  allRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.xl, marginBottom: space.md },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  noResults: { alignItems: 'center', gap: space.lg, paddingVertical: space.xxxl },
});
