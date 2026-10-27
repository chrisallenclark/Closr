export { colors, gradients } from './colors';
export { fonts, type, type TypeVariant } from './typography';

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

/** Horizontal page gutter. */
export const gutter = 20;

export const radii = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const motion = {
  pressScale: 0.97,
  spring: { damping: 18, stiffness: 260, mass: 0.6 },
} as const;
