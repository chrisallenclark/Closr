import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fonts, radii, space } from '@/theme';

import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label?: string;
}

export function TextField({ label, style, ...rest }: TextFieldProps) {
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="eyebrow" color={colors.textMuted}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.cream}
        keyboardAppearance="dark"
        {...rest}
        style={[styles.input, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  input: {
    height: 50,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 16,
  },
});
