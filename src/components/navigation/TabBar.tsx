import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { House, Layers, Shirt, ShoppingBag, User, type LucideIcon } from 'lucide-react-native';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale, Text } from '@/components/ui';
import { colors } from '@/theme';

const ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  index: { icon: House, label: 'Home' },
  wardrobe: { icon: Shirt, label: 'Wardrobe' },
  outfits: { icon: Layers, label: 'Outfits' },
  shop: { icon: ShoppingBag, label: 'Shop' },
  profile: { icon: User, label: 'Profile' },
};

/** Floating blurred tab bar with cream active state, modelled on the Closr mockup. */
export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, styles.tint]} />
      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const meta = ICONS[route.name];
          if (!meta) return null;
          const focused = state.index === index;
          const Icon = meta.icon;
          const color = focused ? colors.cream : colors.textFaint;
          return (
            <PressableScale
              key={route.key}
              hapticFeedback="select"
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={meta.label}
              style={styles.tab}
              onPress={() => {
                const event = emitter.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) navigateToTab(route.key);
              }}
            >
              <Icon
                size={22}
                color={color}
                strokeWidth={focused ? 1.9 : 1.6}
                fill={focused ? 'rgba(239,228,210,0.16)' : 'transparent'}
              />
              <Text variant="micro" color={color}>
                {meta.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    overflow: 'hidden',
  },
  tint: { backgroundColor: Platform.OS === 'ios' ? 'rgba(20,16,13,0.72)' : colors.bg },
  row: { flexDirection: 'row', paddingTop: 10 },
  tab: { flex: 1, alignItems: 'center', gap: 4 },
});
