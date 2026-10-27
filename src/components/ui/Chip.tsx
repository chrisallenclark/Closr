import { ScrollView, StyleSheet, View } from 'react-native';

import { colors, gutter, radii, space } from '@/theme';

import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  swatch?: string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'onCream';
}

export function Chip({ label, selected, onPress, swatch, size = 'md', tone = 'default' }: ChipProps) {
  const onCream = tone === 'onCream';
  const style = [
    styles.chip,
    size === 'sm' && styles.sm,
    onCream && styles.onCream,
    selected && styles.selected,
  ];
  const content = (
    <>
      {swatch ? <View style={[styles.swatch, { backgroundColor: swatch }]} /> : null}
      <Text
        variant={size === 'sm' ? 'micro' : 'label'}
        color={selected ? colors.ink : onCream ? colors.inkMuted : colors.text}
      >
        {label}
      </Text>
    </>
  );
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <PressableScale
      onPress={onPress}
      hapticFeedback="select"
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={style}
    >
      {content}
    </PressableScale>
  );
}

/** Horizontally scrolling row of chips that bleeds to the screen edges. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.rowOuter}
    >
      {children}
    </ScrollView>
  );
}

/** Wrapping group of chips, for forms. */
export function ChipWrap({ children }: { children: React.ReactNode }) {
  return <View style={styles.wrap}>{children}</View>;
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sm: { height: 24, paddingHorizontal: 10 },
  onCream: { backgroundColor: 'rgba(26,20,16,0.06)', borderColor: 'rgba(26,20,16,0.08)' },
  selected: { backgroundColor: colors.cream, borderColor: colors.cream },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  rowOuter: { marginHorizontal: -gutter, flexGrow: 0 },
  row: { paddingHorizontal: gutter, gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
