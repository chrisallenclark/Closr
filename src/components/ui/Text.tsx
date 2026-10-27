import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { colors, type, type TypeVariant } from '@/theme';

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  color?: string;
  align?: 'left' | 'center' | 'right';
}

export function Text({ variant = 'body', color = colors.text, align, style, ...rest }: TextProps) {
  return (
    <RNText
      {...rest}
      style={[type[variant], { color }, align ? { textAlign: align } : null, style]}
    />
  );
}
