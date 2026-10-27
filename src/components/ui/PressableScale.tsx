import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { motion } from '@/theme';

import { haptic } from './haptics';

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  scale?: number;
  hapticFeedback?: 'tap' | 'select' | 'none';
}

/** Pressable with a subtle spring scale and a light haptic — the app's standard touch response. */
export function PressableScale({
  style,
  scale = motion.pressScale,
  hapticFeedback = 'tap',
  onPressIn,
  onPressOut,
  onPress,
  children,
  disabled,
  ...rest
}: PressableScaleProps) {
  const s = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        s.set(withSpring(scale, motion.spring));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.set(withSpring(1, motion.spring));
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (hapticFeedback !== 'none') haptic[hapticFeedback]();
        onPress?.(e);
      }}
    >
      {(state) => (
        <Animated.View style={[style, animated, disabled ? { opacity: 0.45 } : null]}>
          {typeof children === 'function' ? children(state) : children}
        </Animated.View>
      )}
    </Pressable>
  );
}
