import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, ChipWrap, ColorSwatches, Sheet, Text } from '@/components/ui';
import { SEASONS } from '@/features/wardrobe/catalog';
import type { WardrobeFilter } from '@/features/wardrobe/selectors';
import { colors, space } from '@/theme';

export interface FilterSheetProps {
  visible: boolean;
  value: WardrobeFilter;
  onChange: (f: WardrobeFilter) => void;
  onClose: () => void;
}

export function FilterSheet({ visible, value, onChange, onClose }: FilterSheetProps) {
  const [draft, setDraft] = useState<WardrobeFilter>(value);
  const [wasVisible, setWasVisible] = useState(visible);
  // Re-sync the draft each time the sheet opens.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setDraft(value);
  }

  const toggle = <T,>(list: T[] | undefined, v: T) =>
    list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v];

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filter"
      footer={
        <View style={styles.footer}>
          <Button label="Reset" variant="secondary" style={styles.flex} onPress={() => setDraft({})} />
          <Button
            label="Apply"
            style={styles.flex}
            onPress={() => {
              onChange(draft);
              onClose();
            }}
          />
        </View>
      }
    >
      <View style={styles.body}>
        <View style={styles.section}>
          <Text variant="eyebrow" color={colors.textMuted}>
            Show
          </Text>
          <ChipWrap>
            <Chip label="Everything" selected={!draft.favoritesOnly} onPress={() => setDraft({ ...draft, favoritesOnly: false })} />
            <Chip label="Favourites" selected={!!draft.favoritesOnly} onPress={() => setDraft({ ...draft, favoritesOnly: true })} />
          </ChipWrap>
        </View>
        <View style={styles.section}>
          <Text variant="eyebrow" color={colors.textMuted}>
            Season
          </Text>
          <ChipWrap>
            {SEASONS.map((s) => (
              <Chip
                key={s.id}
                label={s.label}
                selected={!!draft.seasons?.includes(s.id)}
                onPress={() => setDraft({ ...draft, seasons: toggle(draft.seasons, s.id) })}
              />
            ))}
          </ChipWrap>
        </View>
        <View style={styles.section}>
          <Text variant="eyebrow" color={colors.textMuted}>
            Colour
          </Text>
          <ColorSwatches
            selected={draft.colors ?? []}
            onToggle={(id) => setDraft({ ...draft, colors: toggle(draft.colors, id) })}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xxl },
  section: { gap: space.md },
  footer: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
});
