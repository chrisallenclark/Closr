import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors, gradients, radii } from '@/theme';

import { PressableScale } from './PressableScale';

export interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** "surface" = espresso gradient, "hero" = warm taupe gradient, "cream" = studio cream. */
  tone?: 'surface' | 'hero' | 'cream';
  accessibilityLabel?: string;
}

export function Card({ children, onPress, style, tone = 'surface', accessibilityLabel }: CardProps) {
  const gradient =
    tone === 'hero' ? gradients.heroCard : tone === 'cream' ? gradients.studio : gradients.surface;
  const body = (
    <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={[styles.card, style]}>
      {children}
    </LinearGradient>
  );
  if (!onPress) return body;
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} scale={0.985}>
      {body}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
});
