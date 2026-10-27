import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, View, type ScrollViewProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, gutter } from '@/theme';

export interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  /** Extra bottom padding, e.g. to clear the floating tab bar. */
  bottomInset?: number;
  padded?: boolean;
  edges?: { top?: boolean; bottom?: boolean };
  contentStyle?: ViewStyle;
  scrollProps?: ScrollViewProps;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

export const TAB_BAR_CLEARANCE = 110;

export function Screen({
  children,
  scroll = true,
  bottomInset = 0,
  padded = true,
  edges = { top: true, bottom: true },
  contentStyle,
  scrollProps,
  header,
  footer,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const top = edges.top !== false ? insets.top : 0;
  const bottom = (edges.bottom !== false ? insets.bottom : 0) + bottomInset;
  const inner = [padded && styles.padded, contentStyle];

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      <StatusBar style="light" />
      {header}
      {scroll ? (
        <ScrollView
          {...scrollProps}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[...inner, { paddingBottom: bottom + 24 }]}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, ...inner, { paddingBottom: footer ? 0 : bottom }]}>{children}</View>
      )}
      {footer ? <View style={{ paddingBottom: Math.max(bottom, 12) }}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  padded: { paddingHorizontal: gutter },
});
