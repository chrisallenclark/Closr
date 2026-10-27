import { router, useLocalSearchParams } from 'expo-router';
import { CircleAlert, ScanLine } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { OutfitBoard } from '@/components/outfits/OutfitBoard';
import { emptyDraft, ItemForm } from '@/components/wardrobe/ItemForm';
import { ItemTile } from '@/components/wardrobe/ItemTile';
import { PhotoPicker } from '@/components/wardrobe/PhotoPicker';
import { Badge, Button, Card, haptic, Header, ItemImage, Screen, SectionHeader, Text } from '@/components/ui';
import { CANDIDATE_ID, matchCandidate, type MatchVerdict } from '@/features/matching/matcher';
import { usePreferences } from '@/features/outfits/useDailyOutfit';
import { resolvePieces, useItemMap } from '@/features/wardrobe/hooks';
import { CATEGORY_IDS, getCategory } from '@/features/wardrobe/catalog';
import { useWardrobe } from '@/features/wardrobe/store';
import type { Category, ClothingDraft, ClothingItem } from '@/features/wardrobe/types';
import type { PickedPhoto } from '@/services/photos';
import { colors, gutter, space } from '@/theme';

const VERDICTS: Record<MatchVerdict, { title: string; body: (n: number) => string }> = {
  strong: { title: 'Strong buy', body: (n) => `Works with ${n} pieces you already own.` },
  good: { title: 'Good match', body: (n) => `Pairs well with ${n} pieces in your closet.` },
  limited: { title: 'Limited match', body: (n) => `Only pairs with ${n} of your pieces — think about what you'd wear it with.` },
  none: { title: 'Hard to style', body: () => "Nothing in your closet is a natural match for this yet." },
};

export default function Match() {
  const { width } = useWindowDimensions();
  const items = useWardrobe((s) => s.items);
  const itemMap = useItemMap();
  const preferences = usePreferences();

  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const params = useLocalSearchParams<{ category?: string }>();
  const [draft, setDraft] = useState<ClothingDraft>(() => {
    const base = { ...emptyDraft(), formality: 2 as const };
    if (!params.category || !(CATEGORY_IDS as string[]).includes(params.category)) return base;
    const category = params.category as Category;
    const sub = getCategory(category).subcategories[0]!;
    return { ...base, category, subcategory: sub.id, formality: sub.formality };
  });
  const [checked, setChecked] = useState(false);

  const candidate: ClothingItem = useMemo(
    () => ({
      ...draft,
      id: CANDIDATE_ID,
      favorite: false,
      wearCount: 0,
      photo: photo ? { localPath: photo.uri } : {},
      createdAt: '',
      updatedAt: '',
    }),
    [draft, photo],
  );
  const result = useMemo(
    () => (checked ? matchCandidate(candidate, items, preferences) : null),
    [checked, candidate, items, preferences],
  );

  const inner = width - gutter * 2;

  if (result) {
    const verdict = VERDICTS[result.verdict];
    return (
      <Screen
        edges={{ top: false }}
        header={<Header title="Will It Match?" leading="close" />}
        footer={
          <View style={styles.footer}>
            <Button label="Check another" variant="secondary" style={styles.flex} onPress={() => setChecked(false)} />
            <Button
              label="I bought it"
              style={styles.flex}
              onPress={() =>
                router.replace({
                  pathname: '/item/new',
                  params: {
                    category: draft.category,
                    subcategory: draft.subcategory,
                    colors: draft.colors.join(','),
                    formality: String(draft.formality),
                    ...(photo ? { photo: photo.uri, w: String(photo.width), h: String(photo.height) } : {}),
                  },
                })
              }
            />
          </View>
        }
      >
        <Animated.View entering={FadeInDown.duration(400)}>
          <Card tone="hero" style={styles.verdict}>
            <ItemImage photo={candidate.photo} style={styles.verdictImg} radius={14} />
            <View style={styles.flex}>
              <Text variant="headline">{verdict.title}</Text>
              <Text variant="caption" color={colors.creamDeep}>
                {verdict.body(result.pairsWith.length)}
              </Text>
            </View>
          </Card>
        </Animated.View>

        {result.similar.length ? (
          <View style={styles.warning}>
            <CircleAlert size={18} color={colors.warning} />
            <Text variant="label" color={colors.text} style={styles.flex}>
              You already own {result.similar.length === 1 ? 'something' : `${result.similar.length} pieces`} very similar.
            </Text>
          </View>
        ) : null}
        {result.similar.length ? (
          <ScrollView horizontal style={styles.bleed} contentContainerStyle={styles.row} showsHorizontalScrollIndicator={false}>
            {result.similar.map((i) => (
              <ItemTile key={i.id} item={i} size={84} />
            ))}
          </ScrollView>
        ) : null}

        {result.outfits.length ? (
          <View style={styles.section}>
            <SectionHeader title="Outfits it unlocks" subtitle="Built from what you already own" />
            <ScrollView horizontal style={styles.bleed} contentContainerStyle={styles.row} showsHorizontalScrollIndicator={false}>
              {result.outfits.map((o, i) => (
                <Card key={i} style={styles.outfit}>
                  <OutfitBoard pieces={resolvePieces(o.pieces, itemMap, candidate)} width={inner * 0.62} gap={4} radius={8} />
                </Card>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {result.pairsWith.length ? (
          <View style={styles.section}>
            <SectionHeader title="Pairs well with" />
            <View style={styles.grid}>
              {result.pairsWith.slice(0, 12).map((m) => (
                <ItemTile key={m.item.id} item={m.item} size={(inner - 3 * 8) / 4} />
              ))}
            </View>
          </View>
        ) : null}

        <Text variant="micro" color={colors.textFaint} align="center" style={styles.note}>
          Matching uses the colours and type you selected. Automatic photo recognition is coming in a future
          update.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      edges={{ top: false }}
      header={<Header title="Will It Match?" leading="close" />}
      footer={
        <View style={styles.footer}>
          <Button
            label="Check my closet"
            icon={ScanLine}
            style={styles.flex}
            disabled={draft.colors.length === 0}
            onPress={() => {
              haptic.success();
              setChecked(true);
            }}
          />
        </View>
      }
    >
      <View style={styles.intro}>
        <Badge label="Manual check" />
        <Text variant="display">Thinking of buying something?</Text>
        <Text variant="body" color={colors.textMuted}>
          Snap it in the store, tell us what it is, and see how it works with your closet before you
          pay.
        </Text>
      </View>
      <PhotoPicker photo={photo} onPicked={setPhoto} size={inner * 0.7} hint="Optional — snap the piece so you remember it." />
      <View style={styles.form}>
        <ItemForm draft={draft} onChange={setDraft} mode="match" nameEdited={false} onNameEdited={() => {}} />
      </View>
      {items.length < 3 ? (
        <Text variant="caption" color={colors.warning} align="center" style={styles.note}>
          Add more of your wardrobe for better results — you have {items.length} item{items.length === 1 ? '' : 's'}.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { gap: space.sm, marginBottom: space.xl, marginTop: space.sm },
  form: { marginTop: space.xxl },
  footer: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: gutter,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: 14, marginTop: space.sm },
  verdictImg: { width: 88, height: 88 },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xl,
    marginBottom: space.md,
  },
  section: { marginTop: space.xxl },
  bleed: { marginHorizontal: -gutter },
  row: { paddingHorizontal: gutter, gap: space.md },
  outfit: { padding: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { marginTop: space.xxl },
});
