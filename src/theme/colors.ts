/**
 * Closr palette — dark espresso surfaces, warm taupe mid-tones and a cream accent.
 * The app is intentionally dark-only: the palette is the brand.
 */
export const colors = {
  bg: '#14100D',
  bgElevated: '#1B1612',
  surface: '#211B16',
  surfaceRaised: '#2A231D',
  surfacePressed: '#322A23',

  border: 'rgba(239, 228, 210, 0.08)',
  borderStrong: 'rgba(239, 228, 210, 0.16)',

  cream: '#EFE4D2',
  creamMuted: '#E2D5C0',
  creamDeep: '#D6C6AE',
  sand: '#B9A792',
  taupe: '#8C7B6B',
  taupeDeep: '#5E5146',

  text: '#F3EADC',
  textMuted: '#A99A8A',
  textFaint: '#6F6358',
  ink: '#1A1410',
  inkMuted: '#5B4D41',

  success: '#9AA67A',
  successInk: '#56603A',
  warning: '#D2A65E',
  danger: '#C77B6A',

  overlay: 'rgba(10, 8, 6, 0.72)',
} as const;

/** Gradients used across hero cards and item tiles. */
export const gradients = {
  heroCard: ['#4A3D33', '#2A221C'] as const,
  studio: ['#F1E8D9', '#E3D6C2'] as const,
  surface: ['#241D18', '#1C1713'] as const,
  fadeBottom: ['rgba(20,16,13,0)', 'rgba(20,16,13,0.85)'] as const,
};
