import { router } from 'expo-router';
import { ArrowRight, Lightbulb, ScanLine, ShoppingBag } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Badge, Card, Chip, Screen, SectionHeader, TAB_BAR_CLEARANCE, Text } from '@/components/ui';
import { findGaps } from '@/features/insights/gaps';
import { getCategory } from '@/features/wardrobe/catalog';
import { useWardrobe } from '@/features/wardrobe/store';
import { colors, radii, space } from '@/theme';

export default function Shop() {
  const items = useWardrobe((s) => s.items);
  const gaps = findGaps(items);

  return (
    <Screen bottomInset={TAB_BAR_CLEARANCE}>
      <View style={styles.title}>
        <Text variant="display">Shop Smarter</Text>
        <Text variant="caption" color={colors.textMuted}>
          Buy pieces that work with what you own.
        </Text>
      </View>

      <Card tone="hero" onPress={() => router.push('/match')} style={styles.hero} accessibilityLabel="Will it match?">
        <View style={styles.heroIcon}>
          <ScanLine size={26} color={colors.ink} strokeWidth={1.6} />
        </View>
        <View style={styles.flex}>
          <Text variant="headline">Will It Match?</Text>
          <Text variant="caption" color={colors.creamDeep}>
            Check a piece in the store against your closet before you buy it.
          </Text>
        </View>
        <ArrowRight size={20} color={colors.cream} />
      </Card>

      <View style={styles.section}>
        <SectionHeader title="Wardrobe gaps" subtitle="What would add the most to your closet" />
        {items.length === 0 ? (
          <Text variant="body" color={colors.textMuted}>
            Add some of your wardrobe and Closr will point out what’s missing.
          </Text>
        ) : gaps.length === 0 ? (
          <Text variant="body" color={colors.textMuted}>
            Nicely balanced — no obvious gaps right now.
          </Text>
        ) : (
          <View style={styles.list}>
            {gaps.map((g) => (
              <Card
                key={g.id}
                onPress={g.category ? () => router.push({ pathname: '/match', params: { category: g.category! } }) : undefined}
                style={styles.gap}
              >
                <Lightbulb size={18} color={colors.sand} strokeWidth={1.6} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong">{g.title}</Text>
                  <Text variant="caption" color={colors.textMuted}>
                    {g.detail}
                  </Text>
                  {g.category ? (
                    <View style={styles.chip}>
                      <Chip label={`Check a ${getCategory(g.category).label.toLowerCase()}`} size="sm" />
                    </View>
                  ) : null}
                </View>
              </Card>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader title="Curated for your style" />
        <View style={styles.soon}>
          <ShoppingBag size={22} color={colors.taupe} strokeWidth={1.4} />
          <Badge label="In development" tone="soon" />
          <Text variant="body" color={colors.textMuted}>
            Product picks from partner retailers, filtered by your gaps and checked against your
            closet. Not live yet — nothing here is a real listing.
          </Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { marginTop: space.sm, marginBottom: space.xl, gap: 2 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.lg },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { marginTop: space.xxl },
  list: { gap: space.md },
  gap: { flexDirection: 'row', gap: space.md, padding: space.lg },
  chip: { flexDirection: 'row', marginTop: space.sm },
  soon: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
});
