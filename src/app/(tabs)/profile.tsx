import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ChevronRight, Lock, ScanFace, Trash } from 'lucide-react-native';
import { useMemo } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  Chip,
  ChipWrap,
  ItemImage,
  PressableScale,
  Screen,
  SectionHeader,
  TAB_BAR_CLEARANCE,
  Text,
} from '@/components/ui';
import { eraseAllData } from '@/features/actions';
import { useOutfits } from '@/features/outfits/store';
import { useProfile } from '@/features/profile/store';
import { PALETTES } from '@/features/profile/types';
import { CATEGORIES, getColor } from '@/features/wardrobe/catalog';
import { countByCategory } from '@/features/wardrobe/selectors';
import { useWardrobe } from '@/features/wardrobe/store';
import { colors, radii, space } from '@/theme';

export default function Profile() {
  const profile = useProfile((s) => s.profile);
  const items = useWardrobe((s) => s.items);
  const outfits = useOutfits((s) => s.outfits);

  const counts = countByCategory(items);
  const max = Math.max(1, ...Object.values(counts));
  const wears = items.reduce((n, i) => n + i.wearCount, 0);
  const mostWorn = useMemo(
    () => [...items].filter((i) => i.wearCount > 0).sort((a, b) => b.wearCount - a.wearCount)[0],
    [items],
  );
  const neverWorn = items.filter((i) => i.wearCount === 0).length;

  const palette = useMemo(() => {
    const tally = new Map<string, number>();
    for (const i of items) if (i.colors[0]) tally.set(i.colors[0], (tally.get(i.colors[0]) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  if (!profile) return null;

  const confirmErase = () =>
    Alert.alert('Erase everything?', 'This deletes your wardrobe, photos, outfits and profile from this iPhone. It cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Erase', style: 'destructive', onPress: () => void eraseAllData() },
    ]);

  return (
    <Screen bottomInset={TAB_BAR_CLEARANCE}>
      <View style={styles.head}>
        <View style={styles.avatar}>
          <Text variant="display" color={colors.ink}>
            {profile.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.flex}>
          <Text variant="display">{profile.name}</Text>
          <Text variant="caption" color={colors.textMuted}>
            Member since {new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </Text>
        </View>
      </View>

      <Card onPress={() => router.push('/profile/edit')} style={styles.card}>
        <View style={styles.cardHead}>
          <Text variant="subtitle" style={styles.flex}>
            Style Profile
          </Text>
          <Text variant="label" color={colors.textMuted}>
            Edit
          </Text>
          <ChevronRight size={16} color={colors.textMuted} />
        </View>
        <ChipWrap>
          {profile.styleTags.map((t) => (
            <Chip key={t} label={t} size="sm" />
          ))}
        </ChipWrap>
        {profile.palettes.length || profile.fit ? (
          <Text variant="caption" color={colors.textMuted}>
            {[
              profile.palettes.map((id) => PALETTES.find((p) => p.id === id)?.label).join(', '),
              profile.fit ? `${profile.fit} fit` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
        {profile.favoriteColors.length ? (
          <View style={styles.dots}>
            {profile.favoriteColors.map((c) => (
              <View key={c} style={[styles.dot, { backgroundColor: getColor(c)?.hex }]} />
            ))}
          </View>
        ) : null}
      </Card>

      <View style={styles.statsRow}>
        <Stat value={items.length} label="Pieces" />
        <Stat value={outfits.length} label="Outfits" />
        <Stat value={wears} label="Wears logged" />
      </View>

      {items.length ? (
        <View style={styles.section}>
          <SectionHeader title="Your closet" />
          <Card style={styles.card}>
            {CATEGORIES.map((c) => (
              <View key={c.id} style={styles.barRow}>
                <Text variant="label" color={colors.textMuted} style={styles.barLabel}>
                  {c.plural}
                </Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${(counts[c.id] / max) * 100}%` }]} />
                </View>
                <Text variant="label" style={styles.barCount}>
                  {counts[c.id]}
                </Text>
              </View>
            ))}
            {palette.length ? (
              <View style={styles.palette}>
                {palette.map(([c, n]) => (
                  <View key={c} style={{ flex: n, backgroundColor: getColor(c)?.hex ?? colors.taupe }} />
                ))}
              </View>
            ) : null}
            <Text variant="caption" color={colors.textMuted}>
              {neverWorn ? `${neverWorn} piece${neverWorn === 1 ? '' : 's'} not worn yet. ` : ''}
              {mostWorn ? `Most worn: ${mostWorn.name} (${mostWorn.wearCount}×).` : 'Log what you wear from an item or outfit.'}
            </Text>
          </Card>
          {mostWorn ? (
            <PressableScale onPress={() => router.push(`/item/${mostWorn.id}`)} style={styles.mostWorn}>
              <ItemImage photo={mostWorn.photo} style={styles.mostImg} radius={10} />
              <View style={styles.flex}>
                <Text variant="micro" color={colors.sand}>
                  MOST WORN
                </Text>
                <Text variant="bodyStrong">{mostWorn.name}</Text>
              </View>
              <ChevronRight size={16} color={colors.textMuted} />
            </PressableScale>
          ) : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionHeader title="Labs" />
        <Card onPress={() => router.push('/try-on')} style={[styles.card, styles.rowCard]}>
          <ScanFace size={22} color={colors.cream} strokeWidth={1.5} />
          <View style={styles.flex}>
            <Text variant="bodyStrong">Virtual Try-On</Text>
            <Text variant="caption" color={colors.textMuted}>
              Save your reference photo now
            </Text>
          </View>
          <Badge label="Coming soon" tone="soon" />
        </Card>
      </View>

      <View style={styles.section}>
        <View style={styles.privacy}>
          <Lock size={14} color={colors.textMuted} />
          <Text variant="caption" color={colors.textMuted} style={styles.flex}>
            Your wardrobe and photos are stored privately on this iPhone. Account backup and sync will
            arrive in a later version.
          </Text>
        </View>
        <Button label="Erase all data" icon={Trash} variant="danger" onPress={confirmErase} />
        <Text variant="micro" color={colors.textFaint} align="center" style={styles.version}>
          Closr {Constants.expoConfig?.version ?? ''}
        </Text>
      </View>
    </Screen>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="headline">{value}</Text>
      <Text variant="micro" color={colors.textMuted}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.sm, marginBottom: space.xl },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { padding: space.lg, gap: space.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong },
  statsRow: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  stat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  section: { marginTop: space.xxl, gap: space.md },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  barLabel: { width: 84 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.sand },
  barCount: { width: 24, textAlign: 'right' },
  palette: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', marginTop: space.sm },
  mostWorn: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  mostImg: { width: 48, height: 48 },
  rowCard: { flexDirection: 'row', alignItems: 'center' },
  privacy: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  version: { marginTop: space.md },
});
