import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Camera, ImagePlus, RefreshCw } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Button, IconButton, Text } from '@/components/ui';
import { pickPhoto, type PhotoSource, type PickedPhoto } from '@/services/photos';
import { colors, gradients, radii, space } from '@/theme';

export interface PhotoPickerProps {
  photo: PickedPhoto | null;
  onPicked: (photo: PickedPhoto) => void;
  size: number;
  /** Shown above the buttons before a photo is picked. */
  hint?: string;
  aspect?: [number, number];
}

/** Square studio frame that captures or imports a photo, with tips for clean product-style shots. */
export function PhotoPicker({ photo, onPicked, size, hint, aspect = [1, 1] }: PhotoPickerProps) {
  const height = (size * aspect[1]) / aspect[0];
  const pick = async (source: PhotoSource) => {
    const result = await pickPhoto(source);
    if (result) onPicked(result);
  };

  return (
    <View style={[styles.frame, { width: size, height }]}>
      <LinearGradient colors={gradients.studio} style={StyleSheet.absoluteFill} />
      {photo ? (
        <>
          <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} />
          <View style={styles.retake}>
            <IconButton icon={RefreshCw} variant="glass" size={38} onPress={() => pick('library')} accessibilityLabel="Choose another photo" />
            <IconButton icon={Camera} variant="glass" size={38} onPress={() => pick('camera')} accessibilityLabel="Retake photo" />
          </View>
        </>
      ) : (
        <View style={styles.empty}>
          <View style={styles.guide} pointerEvents="none" />
          <Text variant="headline" color={colors.ink} align="center">
            Add a photo
          </Text>
          <Text variant="caption" color={colors.inkMuted} align="center" style={styles.hint}>
            {hint ?? 'Lay it flat or hang it on a plain background in soft light. The whole photo is kept.'}
          </Text>
          <View style={styles.buttons}>
            <Button label="Camera" icon={Camera} onPress={() => pick('camera')} size="sm" style={styles.dark} variant="secondary" />
            <Button label="Library" icon={ImagePlus} onPress={() => pick('library')} size="sm" style={styles.dark} variant="secondary" />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radii.lg, overflow: 'hidden', alignSelf: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  guide: {
    position: 'absolute',
    top: 18,
    left: 18,
    right: 18,
    bottom: 18,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(26,20,16,0.18)',
  },
  hint: { maxWidth: 230 },
  buttons: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  dark: { backgroundColor: colors.ink },
  retake: { position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', gap: space.sm },
});
