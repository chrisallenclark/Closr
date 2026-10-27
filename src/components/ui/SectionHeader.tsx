import { ChevronRight } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { colors, space } from '@/theme';

import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  action?: React.ReactNode;
}

export function SectionHeader({ title, subtitle, actionLabel, onAction, action }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text variant="title">{title}</Text>
        {subtitle ? (
          <Text variant="caption" color={colors.textMuted}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
      {actionLabel && onAction ? (
        <PressableScale onPress={onAction} style={styles.action} hitSlop={8}>
          <Text variant="label" color={colors.textMuted}>
            {actionLabel}
          </Text>
          <ChevronRight size={14} color={colors.textMuted} />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: space.md, gap: space.md },
  text: { flex: 1, gap: 2 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
