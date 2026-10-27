import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

import { PressableScale } from './PressableScale';

export interface IconButtonProps {
  icon: LucideIcon;
  onPress?: () => void;
  variant?: 'surface' | 'cream' | 'plain' | 'glass';
  size?: number;
  iconColor?: string;
  fill?: string;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

export function IconButton({
  icon: Icon,
  onPress,
  variant = 'surface',
  size = 40,
  iconColor,
  fill,
  accessibilityLabel,
  style,
  disabled,
}: IconButtonProps) {
  const color = iconColor ?? (variant === 'cream' ? colors.ink : colors.text);
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.base,
        { width: size, height: size, borderRadius: size / 2 },
        styles[variant],
        style,
      ]}
    >
      <Icon size={size * 0.46} color={color} strokeWidth={1.7} fill={fill ?? 'transparent'} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  surface: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cream: { backgroundColor: colors.cream },
  plain: { backgroundColor: 'transparent' },
  glass: { backgroundColor: 'rgba(20,16,13,0.55)' },
});
