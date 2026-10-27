import { router } from 'expo-router';
import {
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  Layers,
  RefreshCw,
  ScanLine,
  type LucideIcon,
} from 'lucide-react-native';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { OutfitBoard } from '@/components/outfits/OutfitBoard';
import { ItemTile } from '@/components/wardrobe/ItemTile';
import {
  Card,
  Chip,
  IconButton,
  PressableScale,
  Screen,
  SectionHeader,
  TAB_BAR_CLEARANCE,
  Text,
  Wordmark,
} from '@/components/ui';
import { MOOD_LINES, paletteMood } from '@/features/outfits/harmony';
import { piecesQuery } from '@/features/outfits/params';
import { REQUIRED_SLOTS } from '@/features/outfits/types';
import { useDailyOutfit } from '@/features/outfits/useDailyOutfit';
import { useProfile } from '@/features/profile/store';
import { getCategory } from '@/features/wardrobe/catalog';
import { resolvePieces, useItemMap } from '@/features/wardrobe/hooks';
import { useWardrobe } from '@/features/wardrobe/store';
import { formatDay, greeting } from '@/lib/time';
import { colors, gutter, radii, space } from '@/theme';

function QuickAction({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={styles.quick} accessibilityRole="button" accessibilityLabel={label}>
      <Icon size={24} color={colors.cream} strokeWidth={1.4} />
      <Text variant="label" align="center">
        {label}
      </Text>
    </PressableScale>
  );
}

export default function Home() {
  const { width } = useWindowDimensions();
  const profile = useProfile((s) => s.profile);
  const items = useWardrobe((s) => s.items);
  const itemMap = useItemMap();
  const { pieces, missing, refresh } = useDailyOutfit();

  const resolved = pieces ? resolvePieces(pieces, itemMap) : [];
  const mood = resolved.length ? MOOD_LINES[paletteMood(resolved.map((p) => p.item))] : '';
  const cardWidth = width - gutter * 2;
  const recent = items.slice(0, 8);
  const firstName = profile?.name.split(' ')[0] ?? '';

  const openToday = () =>
    pieces ? router.push({ pathname: '/outfit/builder', params: piecesQuery(pieces) }) : router.push('/item/new');

  return (
    <Screen bottomInset={TAB_BAR_CLEARANCE}>
      <View style={styles.top}>
        <Wordmark />
        <PressableScale onPress={() => router.navigate('/profile')} style={styles.avatar} accessibilityLabel="Profile">
          <Text variant="subtitle" color={colors.ink}>
            {firstName.charAt(0).toUpperCase()}
          </Text>
        </PressableScale>
      </View>

      <View style={styles.greetRow}>
        <View style={styles.flex}>
          <Text variant="title" style={styles.greet}>
            {greeting()}, {firstName}.
          </Text>
          <Text variant="caption" color={colors.textMuted}>
            Same style. A sharper you.
          </Text>
        </View>
        <Text variant="caption" color={colors.textMuted}>
          {formatDay()}
        </Text>
      </View>

      <Animated.View entering={FadeInDown.duration(500)}>
        <Card tone="hero" onPress={openToday} style={styles.today} accessibilityLabel="Today's outfit">
          <View style={styles.todayHead}>
            <View style={styles.flex}>
              <Text variant="headline">Today’s Outfit</Text>
              <Text variant="caption" color={colors.creamDeep}>
                {pieces ? mood : 'Unlock a fresh look every morning.'}
              </Text>
            </View>
            {pieces ? (
              <IconButton icon={ArrowRight} variant="glass" size={36} onPress={openToday} accessibilityLabel="Open in builder" />
            ) : null}
          </View>

          {pieces ? (
            <>
              <OutfitBoard pieces={resolved} width={cardWidth - 32} gap={8} radius={14} />
              <View style={styles.todayFoot}>
                <Text variant="micro" color={colors.creamDeep}>
                  Smart Shuffle · picked from your closet
                </Text>
                <PressableScale onPress={refresh} style={styles.reroll} accessibilityLabel="Another look">
                  <RefreshCw size={13} color={colors.cream} />
                  <Text variant="micro">Another look</Text>
                </PressableScale>
              </View>
            </>
          ) : (
            <View style={styles.checklist}>
              {REQUIRED_SLOTS.map((slot) => {
                const done = !missing.includes(slot);
                return (
                  <View key={slot} style={styles.checkRow}>
                    <View style={[styles.checkDot, done && styles.checkDone]}>
                      {done ? <Check size={12} color={colors.ink} strokeWidth={3} /> : null}
                    </View>
                    <Text variant="body" color={done ? colors.textMuted : colors.text}>
                      Add {slot === 'shoes' ? 'shoes' : `a ${getCategory(slot).label.toLowerCase()}`}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(100).duration(500)}>
        <Card onPress={() => router.push('/profile/edit')} style={styles.profile} accessibilityLabel="Your style profile">
          <View style={styles.profileIcon}>
            <Text variant="headline" color={colors.cream}>
              {firstName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.flex}>
            <Text variant="subtitle">Your Style Profile</Text>
            <Text variant="caption" color={colors.textMuted} style={styles.profileSub}>
              {profile?.styleTags[0] ? `Refined ${profile.styleTags[0]}` : 'Tell us your style'}
            </Text>
            <View style={styles.tags}>
              {profile?.styleTags.slice(0, 4).map((t) => <Chip key={t} label={t} size="sm" />)}
            </View>
          </View>
          <ChevronRight size={18} color={colors.textMuted} />
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(200).duration(500)} style={styles.quickRow}>
        <QuickAction icon={Camera} label={'Add\nItem'} onPress={() => router.push('/item/new')} />
        <QuickAction icon={Layers} label={'Build\nOutfit'} onPress={() => router.push('/outfit/builder')} />
        <QuickAction icon={ScanLine} label={'Will It\nMatch?'} onPress={() => router.push('/match')} />
      </Animated.View>

      {recent.length ? (
        <View style={styles.recent}>
          <SectionHeader
            title="Recently added"
            actionLabel="Wardrobe"
            onAction={() => router.navigate('/wardrobe')}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.recentRow}>
            {recent.map((item) => (
              <ItemTile key={item.id} item={item} size={92} onPress={() => router.push(`/item/${item.id}`)} />
            ))}
          </ScrollView>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.xl, marginBottom: space.lg },
  greet: { fontSize: 22, marginBottom: 2 },
  today: { padding: 16, gap: space.lg },
  todayHead: { flexDirection: 'row', alignItems: 'flex-start' },
  todayFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 28,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(20,16,13,0.45)',
  },
  checklist: { gap: space.md, paddingVertical: space.sm },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  checkDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: colors.cream, borderColor: colors.cream },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: 14, marginTop: space.md },
  profileIcon: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileSub: { marginBottom: space.sm },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quickRow: { flexDirection: 'row', gap: space.md, marginTop: space.md },
  quick: {
    flex: 1,
    height: 104,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  recent: { marginTop: space.xxl },
  bleed: { marginHorizontal: -gutter },
  recentRow: { paddingHorizontal: gutter, gap: space.sm },
});
