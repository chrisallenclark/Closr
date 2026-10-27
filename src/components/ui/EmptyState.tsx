import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { colors, space } from '@/theme';

import { Button } from './Button';
import { Text } from './Text';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, body, actionLabel, onAction, compact }: EmptyStateProps) {
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <View style={styles.iconRing}>
        <Icon size={26} color={colors.sand} strokeWidth={1.4} />
      </View>
      <Text variant="headline" align="center">
        {title}
      </Text>
      <Text variant="body" color={colors.textMuted} align="center" style={styles.body}>
        {body}
      </Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={styles.button} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: space.xxxl * 1.5, gap: space.md },
  compact: { paddingVertical: space.xxl },
  iconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    marginBottom: space.sm,
  },
  body: { maxWidth: 290 },
  button: { marginTop: space.md, alignSelf: 'center' },
});
