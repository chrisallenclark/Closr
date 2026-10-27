import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { colors, radii } from '@/theme';

import { Text } from './Text';

export interface BadgeProps {
  label: string;
  tone?: 'success' | 'muted' | 'soon' | 'warning' | 'cream';
  icon?: LucideIcon;
}

const TONES = {
  success: { bg: 'rgba(154,166,122,0.18)', fg: colors.success },
  muted: { bg: 'rgba(239,228,210,0.08)', fg: colors.textMuted },
  soon: { bg: 'rgba(210,166,94,0.14)', fg: colors.warning },
  warning: { bg: 'rgba(199,123,106,0.16)', fg: colors.danger },
  cream: { bg: colors.cream, fg: colors.ink },
} as const;

export function Badge({ label, tone = 'muted', icon: Icon }: BadgeProps) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {Icon ? <Icon size={11} color={t.fg} strokeWidth={2} /> : null}
      <Text variant="micro" color={t.fg} style={styles.text}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    height: 20,
    borderRadius: radii.pill,
  },
  text: { letterSpacing: 0.3 },
});
