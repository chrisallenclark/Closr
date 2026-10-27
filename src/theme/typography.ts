import type { TextStyle } from 'react-native';

export const fonts = {
  display: 'CormorantGaramond_600SemiBold',
  displayBold: 'CormorantGaramond_700Bold',
  displayMedium: 'CormorantGaramond_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
} as const;

export const type = {
  wordmark: { fontFamily: fonts.displayBold, fontSize: 34, letterSpacing: -0.5 },
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, letterSpacing: -0.3 },
  headline: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32 },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 17 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
  micro: { fontFamily: fonts.bodyMedium, fontSize: 10, lineHeight: 13 },
  eyebrow: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;
