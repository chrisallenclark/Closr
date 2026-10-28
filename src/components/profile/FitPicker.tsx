import { StyleSheet, View } from 'react-native';

import { PressableScale, Text } from '@/components/ui';
import { FITS, type Fit } from '@/features/profile/types';
import { colors, radii, space } from '@/theme';

const DESCRIPTIONS: Record<Fit, string> = {
  Slim: 'Close to the body',
  Fitted: 'Tailored, clean lines',
  Regular: 'True to size',
  Relaxed: 'A little extra room',
  Oversized: 'Roomy, dropped shoulders',
  Mixed: 'Depends on the piece',
};

export interface FitPickerProps {
  value?: Fit;
  onChange: (fit: Fit) => void;
}

export function FitPicker({ value, onChange }: FitPickerProps) {
  return (
    <View style={styles.list}>
      {FITS.map((fit) => {
        const active = value === fit;
        return (
          <PressableScale
            key={fit}
            onPress={() => onChange(fit)}
            hapticFeedback="select"
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={[styles.row, active && styles.active]}
          >
            <View style={styles.flex}>
              <Text variant="bodyStrong" color={active ? colors.ink : colors.text}>
                {fit}
              </Text>
              <Text variant="caption" color={active ? colors.inkMuted : colors.textMuted}>
                {DESCRIPTIONS[fit]}
              </Text>
            </View>
            <View style={[styles.radio, active && styles.radioActive]} />
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  active: { backgroundColor: colors.cream, borderColor: colors.cream },
  flex: { flex: 1, gap: 2 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.taupe },
  radioActive: { borderColor: colors.ink, borderWidth: 5 },
});
