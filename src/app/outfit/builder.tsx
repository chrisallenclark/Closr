import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, Heart, Layers, Lock, Plus, Shuffle } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OutfitStack } from '@/components/outfits/OutfitStack';
import { SaveOutfitSheet } from '@/components/outfits/SaveOutfitSheet';
import { SlotPickerSheet } from '@/components/outfits/SlotPickerSheet';
import {
  Button,
  EmptyState,
  haptic,
  Header,
  IconButton,
  ItemImage,
  PressableScale,
  Text,
} from '@/components/ui';
import { generateOutfits, missingSlots } from '@/features/outfits/generator';
import { outfitHarmony } from '@/features/outfits/harmony';
import { parsePieces } from '@/features/outfits/params';
import { useOutfits } from '@/features/outfits/store';
import { SLOTS, type OutfitPieces, type Slot } from '@/features/outfits/types';
import { usePreferences } from '@/features/outfits/useDailyOutfit';
import { resolvePieces, useItemMap } from '@/features/wardrobe/hooks';
import { useWardrobe } from '@/features/wardrobe/store';
import { colors, gutter, radii, space } from '@/theme';

const SLOT_LABELS: Record<Slot, string> = {
  top: 'Top',
  bottom: 'Bottom',
  outerwear: 'Layer',
  shoes: 'Shoes',
  accessory: 'Extra',
};

const RAIL = 72;

export default function Builder() {
  const params = useLocalSearchParams<Record<string, string>>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const items = useWardrobe((s) => s.items);
  const itemMap = useItemMap();
  const preferences = usePreferences();
  const editing = useOutfits((s) => (params.outfitId ? s.outfits.find((o) => o.id === params.outfitId) : undefined));

  const [locks, setLocks] = useState<Set<Slot>>(() => new Set(params.lock ? [params.lock as Slot] : []));
  // Opened empty (or with just one locked piece)? Start with a generated look.
  const [initial] = useState(() => {
    const start = editing?.pieces ?? parsePieces(params);
    if (editing || SLOTS.filter((s) => start[s]).length > 1) return { pieces: start, candidates: [] };
    const looks = generateOutfits(items, { locked: start, count: 3, seed: Date.now() % 1e9, preferences });
    return looks.length
      ? { pieces: looks[0]!.pieces, candidates: looks.map((l) => l.pieces) }
      : { pieces: start, candidates: [] };
  });
  const [pieces, setPieces] = useState<OutfitPieces>(initial.pieces);
  const [candidates, setCandidates] = useState<OutfitPieces[]>(initial.candidates);
  const [index, setIndex] = useState(0);
  const [picking, setPicking] = useState<Slot | null>(null);
  const [saving, setSaving] = useState(false);
  const [favorite, setFavorite] = useState(editing?.favorite ?? false);

  const missing = useMemo(() => missingSlots(items), [items]);
  const resolved = resolvePieces(pieces, itemMap);
  const harmony = resolved.length >= 2 ? outfitHarmony(resolved.map((r) => r.item)) : null;

  const shuffle = () => {
    const locked: OutfitPieces = {};
    for (const slot of locks) if (pieces[slot]) locked[slot] = pieces[slot];
    const looks = generateOutfits(items, { locked, count: 3, seed: Math.floor(Math.random() * 1e9), preferences });
    if (!looks.length) return;
    haptic.tap();
    setCandidates(looks.map((l) => l.pieces));
    setIndex(0);
    setPieces(looks[0]!.pieces);
  };

  const goTo = (next: number) => {
    const target = candidates[next];
    if (!target) return;
    haptic.select();
    setIndex(next);
    setPieces(target);
  };

  const toggleLock = (slot: Slot) => {
    haptic.select();
    const next = new Set(locks);
    if (next.has(slot)) next.delete(slot);
    else next.add(slot);
    setLocks(next);
  };

  const previewW = width - gutter * 2 - RAIL - space.md;
  const previewH = Math.max(320, height - insets.top - insets.bottom - 56 - 150);
  const canSave = resolved.length >= 2;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header
        title={editing ? 'Edit Outfit' : 'Build Outfit'}
        right={
          <PressableScale onPress={() => setSaving(true)} disabled={!canSave} style={styles.savePill}>
            <Text variant="label" color={colors.ink}>
              Save
            </Text>
          </PressableScale>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Nothing to style yet"
          body="Add a few pieces to your wardrobe and the builder will start putting looks together."
          actionLabel="Add an item"
          onAction={() => router.push('/item/new')}
        />
      ) : (
        <>
          <View style={styles.body}>
            <View style={styles.rail}>
              {SLOTS.map((slot) => {
                const item = pieces[slot] ? itemMap.get(pieces[slot]!) : undefined;
                const isLocked = locks.has(slot);
                return (
                  <PressableScale
                    key={slot}
                    onPress={() => setPicking(slot)}
                    onLongPress={() => toggleLock(slot)}
                    style={styles.slot}
                    accessibilityLabel={`${SLOT_LABELS[slot]}${isLocked ? ', locked' : ''}`}
                    accessibilityHint="Tap to choose, long press to lock"
                  >
                    <View>
                      {item ? (
                        <ItemImage photo={item.photo} style={[styles.slotImg, isLocked && styles.slotLocked]} radius={12} />
                      ) : (
                        <View style={[styles.slotImg, styles.slotEmpty]}>
                          <Plus size={18} color={colors.textFaint} />
                        </View>
                      )}
                      {isLocked ? (
                        <View style={styles.lockBadge}>
                          <Lock size={10} color={colors.ink} strokeWidth={2.5} />
                        </View>
                      ) : null}
                    </View>
                    <Text variant="micro" color={item ? colors.text : colors.textFaint}>
                      {SLOT_LABELS[slot]}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>

            <LinearGradient colors={['#2B231D', '#191411']} style={[styles.preview, { height: previewH }]}>
              {missing.length && resolved.length === 0 ? (
                <View style={styles.previewEmpty}>
                  <Text variant="headline" align="center">
                    Almost there
                  </Text>
                  <Text variant="caption" color={colors.textMuted} align="center">
                    Add {missing.join(', ')} to unlock Smart Shuffle. You can still pick pieces on the left.
                  </Text>
                </View>
              ) : (
                <OutfitStack pieces={resolved} width={previewW - 24} height={previewH - 24} />
              )}
              {harmony !== null ? (
                <View style={styles.harmony}>
                  <Text variant="micro" color={colors.creamDeep}>
                    Harmony {Math.round(harmony * 100)}
                  </Text>
                </View>
              ) : null}
            </LinearGradient>
          </View>

          <View style={[styles.controls, { paddingBottom: insets.bottom + space.md }]}>
            <View style={styles.pager}>
              <IconButton icon={ChevronLeft} variant="plain" disabled={index <= 0} onPress={() => goTo(index - 1)} accessibilityLabel="Previous look" />
              <Text variant="label" color={colors.textMuted}>
                {candidates.length ? `Outfit ${index + 1} / ${candidates.length}` : 'Your outfit'}
              </Text>
              <IconButton
                icon={ChevronRight}
                variant="plain"
                disabled={index >= candidates.length - 1}
                onPress={() => goTo(index + 1)}
                accessibilityLabel="Next look"
              />
            </View>
            <View style={styles.actions}>
              <IconButton
                icon={Heart}
                size={52}
                fill={favorite ? colors.cream : undefined}
                onPress={() => {
                  haptic.select();
                  setFavorite(!favorite);
                }}
                accessibilityLabel="Favourite"
              />
              <Button label="Shuffle Looks" icon={Shuffle} size="lg" style={styles.flex} disabled={missing.length > 0} onPress={shuffle} />
            </View>
            <Text variant="micro" color={colors.textFaint} align="center">
              Smart Shuffle uses colour & dress-level rules · long-press a slot to lock it
            </Text>
          </View>
        </>
      )}

      <SlotPickerSheet
        slot={picking}
        items={items}
        selectedId={picking ? pieces[picking] : undefined}
        locked={picking ? locks.has(picking) : false}
        onToggleLock={() => picking && toggleLock(picking)}
        onClose={() => setPicking(null)}
        onSelect={(id) => {
          if (!picking) return;
          haptic.select();
          setPieces({ ...pieces, [picking]: id });
          setPicking(null);
        }}
      />
      <SaveOutfitSheet
        visible={saving}
        pieces={pieces}
        existing={editing}
        favorite={favorite}
        source={candidates.length ? 'shuffle' : 'manual'}
        onClose={() => setSaving(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  savePill: {
    backgroundColor: colors.cream,
    paddingHorizontal: 16,
    height: 32,
    borderRadius: radii.pill,
    justifyContent: 'center',
  },
  body: { flex: 1, flexDirection: 'row', paddingHorizontal: gutter, gap: space.md },
  rail: { width: RAIL, gap: space.sm },
  slot: { alignItems: 'center', gap: 4 },
  slotImg: { width: RAIL - 8, height: RAIL - 8 },
  slotLocked: { borderWidth: 2, borderColor: colors.cream },
  slotEmpty: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: {
    flex: 1,
    borderRadius: radii.xl,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  previewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.lg },
  harmony: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    paddingHorizontal: 10,
    height: 22,
    borderRadius: radii.pill,
    justifyContent: 'center',
    backgroundColor: 'rgba(20,16,13,0.6)',
  },
  controls: { paddingHorizontal: gutter, paddingTop: space.md, gap: space.sm },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
