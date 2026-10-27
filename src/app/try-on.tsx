import { Image } from 'expo-image';
import { Camera, ImagePlus, ScanFace, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Badge, Button, haptic, Header, Screen, Text } from '@/components/ui';
import { useProfile } from '@/features/profile/store';
import { pickPhoto, resolvePhotoUri, type PhotoSource } from '@/services/photos';
import { colors, gutter, radii, space } from '@/theme';

export default function TryOn() {
  const { width } = useWindowDimensions();
  const bodyPhoto = useProfile((s) => s.profile?.bodyPhoto);
  const setBodyPhoto = useProfile((s) => s.setBodyPhoto);
  const [busy, setBusy] = useState(false);
  const uri = resolvePhotoUri(bodyPhoto);
  const frameW = width - gutter * 2;

  const pick = async (source: PhotoSource) => {
    const photo = await pickPhoto(source, [3, 4]);
    if (!photo) return;
    setBusy(true);
    try {
      await setBodyPhoto(photo);
      haptic.success();
    } catch (error) {
      console.error(error);
      Alert.alert("Couldn't save photo", 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<Header title="Virtual Try-On" right={<Badge label="Coming soon" tone="soon" />} />}>
      <View style={styles.intro}>
        <Text variant="display">See it on you</Text>
        <Text variant="body" color={colors.textMuted}>
          Virtual try-on is in development. It will dress your own photo in outfits from your closet.
          Save a reference photo now so it’s ready the day it launches.
        </Text>
      </View>

      <View style={[styles.frame, { width: frameW, height: (frameW * 4) / 3 }]}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        ) : (
          <View style={styles.empty}>
            <ScanFace size={40} color={colors.taupe} strokeWidth={1.2} />
            <Text variant="subtitle" align="center">
              Your reference photo
            </Text>
            <Text variant="caption" color={colors.textMuted} align="center" style={styles.tips}>
              Full body, head to toe · stand straight facing the camera · fitted clothes · plain
              background · good light
            </Text>
          </View>
        )}
      </View>

      <View style={styles.buttons}>
        <Button label="Take photo" icon={Camera} variant="secondary" style={styles.flex} loading={busy} onPress={() => pick('camera')} />
        <Button label="From library" icon={ImagePlus} variant="secondary" style={styles.flex} disabled={busy} onPress={() => pick('library')} />
      </View>

      <View style={styles.note}>
        <Sparkles size={14} color={colors.textMuted} />
        <Text variant="caption" color={colors.textMuted} style={styles.flex}>
          Stored only on this iPhone. Nothing is uploaded until try-on launches and you choose to use
          it.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { gap: space.sm, marginTop: space.sm, marginBottom: space.xl },
  frame: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl },
  tips: { maxWidth: 260 },
  buttons: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  note: { flexDirection: 'row', gap: space.sm, marginTop: space.xl },
});
