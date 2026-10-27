import { colors } from '@/theme';

import { Text } from './Text';

export function Wordmark({ size = 34, color = colors.cream }: { size?: number; color?: string }) {
  return (
    <Text variant="wordmark" color={color} style={{ fontSize: size, lineHeight: size * 1.1 }}>
      Closr
    </Text>
  );
}
