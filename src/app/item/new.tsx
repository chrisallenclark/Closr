import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, useWindowDimensions, View } from 'react-native';

import { emptyDraft, ItemForm } from '@/components/wardrobe/ItemForm';
import { PhotoPicker } from '@/components/wardrobe/PhotoPicker';
import { Button, haptic, Header, Screen, Text } from '@/components/ui';
import { CATEGORY_IDS, getCategory, suggestName } from '@/features/wardrobe/catalog';
import { useWardrobe } from '@/features/wardrobe/store';
import type { Category, ClothingDraft, Formality } from '@/features/wardrobe/types';
import type { PickedPhoto } from '@/services/photos';
import { colors, gutter, space } from '@/theme';

type Params = {
  category?: string;
  subcategory?: string;
  colors?: string;
  formality?: string;
  photo?: string;
  w?: string;
  h?: string;
};

/** Optional prefill, used when "Will it match?" hands a piece over to be saved. */
function initialDraft(p: Params): ClothingDraft {
  const draft = emptyDraft();
  if (p.category && (CATEGORY_IDS as string[]).includes(p.category)) {
    draft.category = p.category as Category;
    const subs = getCategory(draft.category).subcategories;
    draft.subcategory = subs.find((s) => s.id === p.subcategory)?.id ?? subs[0]!.id;
  }
  if (p.colors) draft.colors = p.colors.split(',').filter(Boolean);
  if (p.formality) draft.formality = Math.min(5, Math.max(1, Number(p.formality))) as Formality;
  draft.name = suggestName(draft.category, draft.subcategory, draft.colors);
  return draft;
}

export default function NewItem() {
  const params = useLocalSearchParams<Params>();
  const { width } = useWindowDimensions();
  const addItem = useWardrobe((s) => s.addItem);

  const [photo, setPhoto] = useState<PickedPhoto | null>(
    params.photo ? { uri: params.photo, width: Number(params.w) || 1000, height: Number(params.h) || 1000 } : null,
  );
  const [draft, setDraft] = useState<ClothingDraft>(() => initialDraft(params));
  const [nameEdited, setNameEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const ready = !!photo && draft.colors.length > 0 && draft.name.trim().length > 0;
  const missing = !photo ? 'Add a photo to continue' : draft.colors.length === 0 ? 'Pick at least one colour' : '';

  const save = async (another: boolean) => {
    if (!photo || !ready) return;
    setSaving(true);
    try {
      await addItem({ ...draft, name: draft.name.trim() }, photo);
      haptic.success();
      if (another) {
        setPhoto(null);
        setDraft({ ...emptyDraft(), category: draft.category, subcategory: draft.subcategory, formality: draft.formality });
        setNameEdited(false);
        setSavedCount((n) => n + 1);
      } else {
        router.back();
      }
    } catch (error) {
      console.error(error);
      Alert.alert("Couldn't save", 'Something went wrong saving this photo. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      edges={{ top: false }}
      header={
        <Header
          title="Add Item"
          subtitle={savedCount ? `${savedCount} added` : undefined}
          leading="close"
        />
      }
      footer={
        <View style={styles.footer}>
          {missing ? (
            <Text variant="caption" color={colors.textMuted} align="center">
              {missing}
            </Text>
          ) : null}
          <View style={styles.buttons}>
            <Button label="Save & add another" variant="secondary" style={styles.flex} disabled={!ready || saving} onPress={() => save(true)} />
            <Button label="Save" style={styles.flex} loading={saving} disabled={!ready} onPress={() => save(false)} />
          </View>
        </View>
      }
    >
      <View style={styles.body}>
        <PhotoPicker photo={photo} onPicked={setPhoto} size={width - gutter * 2} />
        <ItemForm draft={draft} onChange={setDraft} nameEdited={nameEdited} onNameEdited={() => setNameEdited(true)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xxl, paddingTop: space.sm },
  footer: {
    paddingHorizontal: gutter,
    paddingTop: space.md,
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  buttons: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
});
