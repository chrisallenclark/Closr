import { Check } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { COLORS } from '@/features/wardrobe/catalog';
import type { ColorId } from '@/features/wardrobe/types';
import { colors, space } from '@/theme';

import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ColorSwatchesProps {
  selected: ColorId[];
  onToggle: (id: ColorId) => void;
  /** Show the selection order (1 = primary colour). */
  ordered?: boolean;
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 > 160;
}

export function ColorSwatches({ selected, onToggle, ordered }: ColorSwatchesProps) {
  return (
    <View style={styles.grid}>
      {COLORS.map((c) => {
        const index = selected.indexOf(c.id);
        const active = index >= 0;
        const mark = isLight(c.hex) ? colors.ink : colors.cream;
        return (
          <PressableScale
            key={c.id}
            onPress={() => onToggle(c.id)}
            hapticFeedback="select"
            style={styles.cell}
            accessibilityRole="button"
            accessibilityLabel={c.label}
            accessibilityState={{ selected: active }}
          >
            <View style={[styles.swatch, { backgroundColor: c.hex }, active && styles.active]}>
              {active ? (
                ordered ? (
                  <Text variant="label" color={mark}>
                    {index + 1}
                  </Text>
                ) : (
                  <Check size={16} color={mark} strokeWidth={2.4} />
                )
              ) : null}
            </View>
            <Text variant="micro" color={active ? colors.text : colors.textFaint} numberOfLines={1}>
              {c.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  cell: { width: '16.66%', alignItems: 'center', gap: 4 },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  active: { borderWidth: 2, borderColor: colors.cream },
});
