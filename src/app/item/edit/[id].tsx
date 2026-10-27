import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ImagePlus, Shirt } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ItemForm } from '@/components/wardrobe/ItemForm';
import { Button, EmptyState, haptic, Header, ItemImage, Screen } from '@/components/ui';
import { useItem } from '@/features/wardrobe/hooks';
import { useWardrobe } from '@/features/wardrobe/store';
import type { ClothingDraft } from '@/features/wardrobe/types';
import { pickPhoto, type PhotoSource, type PickedPhoto } from '@/services/photos';
import { colors, gutter, radii, space } from '@/theme';

export default function EditItem() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useItem(id);
  const { width } = useWindowDimensions();
  const updateItem = useWardrobe((s) => s.updateItem);
  const replacePhoto = useWardrobe((s) => s.replacePhoto);

  const [draft, setDraft] = useState<ClothingDraft | null>(() =>
    item
      ? {
          name: item.name,
          category: item.category,
          subcategory: item.subcategory,
          colors: item.colors,
          seasons: item.seasons,
          formality: item.formality,
          brand: item.brand,
          notes: item.notes,
        }
      : null,
  );
  const [newPhoto, setNewPhoto] = useState<PickedPhoto | null>(null);
  const [saving, setSaving] = useState(false);

  if (!item || !draft) {
    return (
      <Screen header={<Header leading="close" />}>
        <EmptyState icon={Shirt} title="Item not found" body="It may have been deleted." />
      </Screen>
    );
  }

  const size = width - gutter * 2;
  const pick = async (source: PhotoSource) => {
    const p = await pickPhoto(source);
    if (p) setNewPhoto(p);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (newPhoto) await replacePhoto(item.id, newPhoto);
      updateItem(item.id, { ...draft, name: draft.name.trim() || item.name });
      haptic.success();
      router.back();
    } catch (error) {
      console.error(error);
      Alert.alert("Couldn't save", 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      edges={{ top: false }}
      header={<Header title="Edit Item" leading="close" />}
      footer={
        <View style={styles.footer}>
          <Button label="Save changes" loading={saving} disabled={draft.colors.length === 0} onPress={save} />
        </View>
      }
    >
      <View style={styles.body}>
        {newPhoto ? (
          <Image source={{ uri: newPhoto.uri }} style={[styles.preview, { width: size, height: size }]} contentFit="cover" />
        ) : (
          <ItemImage photo={item.photo} style={{ width: size, height: size }} radius={radii.lg} />
        )}
        <View style={styles.replaceRow}>
          <Button label="Retake" icon={Camera} variant="secondary" size="sm" style={styles.flex} onPress={() => pick('camera')} />
          <Button label="Choose photo" icon={ImagePlus} variant="secondary" size="sm" style={styles.flex} onPress={() => pick('library')} />
        </View>
        <ItemForm draft={draft} onChange={setDraft} nameEdited onNameEdited={() => {}} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.lg, paddingTop: space.sm },
  preview: { borderRadius: radii.lg },
  replaceRow: { flexDirection: 'row', gap: space.md, marginBottom: space.md },
  flex: { flex: 1 },
  footer: {
    paddingHorizontal: gutter,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
