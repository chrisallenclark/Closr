import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PressableScale, Text } from '@/components/ui';
import type { FitKey } from '@/features/avatar/types';
import { colors, gutter, radii, space } from '@/theme';

/**
 * Visual fit confirmation: each option is a silhouette, so people pick what they see instead of
 * guessing what "relaxed" means. Shown only for the fit values the reading wasn't sure about, or
 * all of them when asking for a correction. Drawings only: no garment photos ship in the app.
 */

export const FIT_OPTIONS: Record<FitKey, { value: string; label: string }[]> = {
  width: [
    { value: 'fitted', label: 'Fitted' },
    { value: 'regular', label: 'Regular' },
    { value: 'relaxed', label: 'Relaxed' },
    { value: 'boxy', label: 'Boxy' },
    { value: 'oversized', label: 'Oversized' },
  ],
  length: [
    { value: 'cropped', label: 'Cropped' },
    { value: 'short', label: 'Short' },
    { value: 'standard', label: 'Standard' },
    { value: 'long', label: 'Long' },
    { value: 'longline', label: 'Longline' },
  ],
  sleeves: [
    { value: 'sleeveless', label: 'Sleeveless' },
    { value: 'short', label: 'Short' },
    { value: 'elbow', label: 'Elbow' },
    { value: 'long', label: 'Long' },
  ],
  legShape: [
    { value: 'skinny', label: 'Skinny' },
    { value: 'slim', label: 'Slim' },
    { value: 'straight', label: 'Straight' },
    { value: 'relaxed', label: 'Relaxed' },
    { value: 'baggy', label: 'Baggy' },
    { value: 'wide-leg', label: 'Wide leg' },
  ],
  rise: [
    { value: 'low', label: 'Low' },
    { value: 'mid', label: 'Mid' },
    { value: 'high', label: 'High' },
  ],
};

export const FIT_TITLES: Record<FitKey, string> = {
  width: 'How wide is it on the body?',
  length: 'Where does the hem sit?',
  sleeves: 'Sleeve length',
  legShape: 'Leg shape',
  rise: 'Where does the waist sit?',
};

const W = 64;
const H = 84;

/** A tee/shirt outline: body half-width, hem and sleeve end vary with the option. */
function topPath(key: FitKey, value: string): string {
  const widths: Record<string, number> = { fitted: 15, regular: 18, relaxed: 21, boxy: 23, oversized: 26 };
  const hems: Record<string, number> = { cropped: 50, short: 58, standard: 66, long: 74, longline: 82 };
  const sleeves: Record<string, number> = { sleeveless: 0, short: 10, elbow: 20, long: 34 };
  const bw = key === 'width' ? widths[value] ?? 18 : 18;
  const hem = key === 'length' ? hems[value] ?? 66 : 66;
  const sl = key === 'sleeves' ? sleeves[value] ?? 10 : key === 'width' && bw > 22 ? 13 : 10;
  const boxy = key === 'width' && (value === 'boxy' || value === 'oversized');
  const cx = W / 2;
  const sh = boxy ? bw + 2 : bw;
  const top = 14;
  const arm = sl ? `L${cx + sh + sl * 0.55},${top + 6 + sl} L${cx + sh - 1},${top + 9 + sl * 1.05}` : '';
  const armL = sl ? `L${cx - sh + 1},${top + 9 + sl * 1.05} L${cx - sh - sl * 0.55},${top + 6 + sl}` : '';
  return [
    `M${cx - 6},${top}`,
    `Q${cx},${top + 6} ${cx + 6},${top}`,
    `L${cx + sh},${top + 4}`,
    arm,
    `L${cx + bw},${hem}`,
    `L${cx - bw},${hem}`,
    armL,
    `L${cx - sh},${top + 4}`,
    'Z',
  ].join(' ');
}

/** Trousers outline: thigh, knee and hem width per leg shape; waist height per rise. */
function bottomPath(key: FitKey, value: string): string {
  const shapes: Record<string, [number, number]> = {
    skinny: [9, 5],
    slim: [10, 7],
    straight: [11, 9],
    relaxed: [12, 11],
    baggy: [14, 13],
    'wide-leg': [13, 16],
  };
  const [thigh, hemW] = key === 'legShape' ? shapes[value] ?? [11, 9] : [11, 9];
  const waist = key === 'rise' ? ({ low: 14, mid: 9, high: 4 } as Record<string, number>)[value] ?? 9 : 9;
  const cx = W / 2;
  const crotch = 34;
  const hem = 80;
  return [
    `M${cx - 15},${waist}`,
    `L${cx + 15},${waist}`,
    `L${cx + 2 + thigh * 1.25},${crotch}`,
    `L${cx + 2 + hemW * 1.1 + 2},${hem}`,
    `L${cx + 3},${hem}`,
    `L${cx},${crotch + 2}`,
    `L${cx - 3},${hem}`,
    `L${cx - 2 - hemW * 1.1 - 2},${hem}`,
    `L${cx - 2 - thigh * 1.25},${crotch}`,
    'Z',
  ].join(' ');
}

export function Silhouette({ fitKey, value, selected }: { fitKey: FitKey; value: string; selected: boolean }) {
  const d = fitKey === 'legShape' || fitKey === 'rise' ? bottomPath(fitKey, value) : topPath(fitKey, value);
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <Path d={d} fill={selected ? colors.ink : colors.taupeDeep} stroke={selected ? colors.ink : colors.taupe} strokeWidth={1} strokeLinejoin="round" />
    </Svg>
  );
}

export interface GarmentFitPickerProps {
  keys: FitKey[];
  values: Partial<Record<FitKey, string>>;
  /** What the reading suggested, marked on its tile. */
  suggested?: Partial<Record<FitKey, string | null>>;
  onChange: (key: FitKey, value: string) => void;
}

export function GarmentFitPicker({ keys, values, suggested = {}, onChange }: GarmentFitPickerProps) {
  return (
    <View style={styles.root}>
      {keys.map((key) => (
        <View key={key} style={styles.group}>
          <Text variant="subtitle">{FIT_TITLES[key]}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.row}>
            {FIT_OPTIONS[key].map((o) => {
              const selected = values[key] === o.value;
              return (
                <PressableScale
                  key={o.value}
                  onPress={() => onChange(key, o.value)}
                  style={[styles.tile, selected && styles.tileSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={o.label}
                >
                  <Silhouette fitKey={key} value={o.value} selected={selected} />
                  <Text variant="label" color={selected ? colors.ink : colors.text}>
                    {o.label}
                  </Text>
                  {suggested[key] === o.value ? (
                    <Text variant="micro" color={selected ? colors.inkMuted : colors.textFaint}>
                      Suggested
                    </Text>
                  ) : null}
                </PressableScale>
              );
            })}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xl },
  group: { gap: space.sm },
  bleed: { marginHorizontal: -gutter },
  row: { paddingHorizontal: gutter, gap: space.sm },
  tile: {
    width: 92,
    paddingVertical: space.md,
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tileSelected: { backgroundColor: colors.cream, borderColor: colors.cream },
});
