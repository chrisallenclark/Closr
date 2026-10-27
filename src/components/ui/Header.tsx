import { router } from 'expo-router';
import { ArrowLeft, X } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { colors, gutter, space } from '@/theme';

import { IconButton } from './IconButton';
import { Text } from './Text';

export interface HeaderProps {
  title?: string;
  subtitle?: string;
  /** "back" shows an arrow, "close" an X (for modals), "none" hides it. */
  leading?: 'back' | 'close' | 'none';
  onLeadingPress?: () => void;
  right?: React.ReactNode;
}

/** Centered-title navigation header used by pushed and modal screens. */
export function Header({ title, subtitle, leading = 'back', onLeadingPress, right }: HeaderProps) {
  const back = onLeadingPress ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <View style={styles.row}>
      <View style={styles.side}>
        {leading !== 'none' ? (
          <IconButton
            icon={leading === 'close' ? X : ArrowLeft}
            variant="plain"
            onPress={back}
            accessibilityLabel={leading === 'close' ? 'Close' : 'Back'}
          />
        ) : null}
      </View>
      <View style={styles.center}>
        {title ? (
          <Text variant="subtitle" numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text variant="caption" color={colors.textMuted} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: gutter - space.sm,
  },
  side: { minWidth: 72, flexDirection: 'row', alignItems: 'center' },
  right: { justifyContent: 'flex-end', gap: space.sm },
  center: { flex: 1, alignItems: 'center' },
});
