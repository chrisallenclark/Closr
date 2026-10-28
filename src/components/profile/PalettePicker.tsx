import { Check } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { PressableScale, Text } from '@/components/ui';
import { PALETTES, type PaletteId } from '@/features/profile/types';
import { getColor } from '@/features/wardrobe/catalog';
import { colors, radii, space } from '@/theme';

export interface PalettePickerProps {
  selected: PaletteId[];
  onToggle: (id: PaletteId) => void;
}

/** Two-column grid of colour-mood cards, each previewing its swatches. */
export function PalettePicker({ selected, onToggle }: PalettePickerProps) {
  return (
    <View style={styles.grid}>
      {PALETTES.map((p) => {
        const active = selected.includes(p.id);
        return (
          <PressableScale
            key={p.id}
            onPress={() => onToggle(p.id)}
            hapticFeedback="select"
            accessibilityRole="button"
            accessibilityLabel={p.label}
            accessibilityState={{ selected: active }}
            style={[styles.card, active && styles.active]}
          >
            <View style={styles.swatches}>
              {p.colors.slice(0, 5).map((c) => (
                <View key={c} style={[styles.swatch, { backgroundColor: getColor(c)?.hex }]} />
              ))}
            </View>
            <View style={styles.labelRow}>
              <Text variant="label" color={active ? colors.text : colors.textMuted} style={styles.flex}>
                {p.label}
              </Text>
              {active ? <Check size={14} color={colors.cream} strokeWidth={2.4} /> : null}
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  card: {
    width: '47.5%',
    padding: space.md,
    gap: space.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  active: { borderColor: colors.cream, backgroundColor: colors.surfaceRaised },
  swatches: { flexDirection: 'row' },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    marginRight: -6,
    borderWidth: 1.5,
    borderColor: 'rgba(239,228,210,0.22)',
  },
  labelRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
