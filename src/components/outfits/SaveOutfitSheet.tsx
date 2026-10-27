import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Chip, ChipWrap, haptic, Sheet, Text, TextField } from '@/components/ui';
import { useOutfits } from '@/features/outfits/store';
import { OCCASIONS, type Occasion, type Outfit, type OutfitPieces } from '@/features/outfits/types';
import { colors, space } from '@/theme';

export interface SaveOutfitSheetProps {
  visible: boolean;
  pieces: OutfitPieces;
  existing?: Outfit;
  favorite: boolean;
  source: Outfit['source'];
  onClose: () => void;
}

export function SaveOutfitSheet({ visible, pieces, existing, favorite, source, onClose }: SaveOutfitSheetProps) {
  const addOutfit = useOutfits((s) => s.addOutfit);
  const updateOutfit = useOutfits((s) => s.updateOutfit);
  const toggleFavorite = useOutfits((s) => s.toggleFavorite);
  const count = useOutfits((s) => s.outfits.length);

  const [name, setName] = useState('');
  const [occasion, setOccasion] = useState<Occasion | undefined>();

  const [wasVisible, setWasVisible] = useState(false);
  // Reset the form each time the sheet opens.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setName(existing?.name ?? `Look ${String(count + 1).padStart(2, '0')}`);
      setOccasion(existing?.occasion);
    }
  }

  const save = () => {
    const finalName = name.trim() || 'Untitled look';
    let id: string;
    if (existing) {
      updateOutfit(existing.id, { name: finalName, occasion, pieces });
      if (existing.favorite !== favorite) toggleFavorite(existing.id);
      id = existing.id;
    } else {
      const outfit = addOutfit({ name: finalName, occasion, pieces, source });
      if (favorite) toggleFavorite(outfit.id);
      id = outfit.id;
    }
    haptic.success();
    onClose();
    router.replace(`/outfit/${id}`);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={existing ? 'Update outfit' : 'Save outfit'} footer={<Button label="Save" onPress={save} />}>
      <View style={styles.body}>
        <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Sunday Coffee" />
        <View style={styles.section}>
          <Text variant="eyebrow" color={colors.textMuted}>
            Occasion
          </Text>
          <ChipWrap>
            {OCCASIONS.map((o) => (
              <Chip key={o} label={o} selected={occasion === o} onPress={() => setOccasion(occasion === o ? undefined : o)} />
            ))}
          </ChipWrap>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  section: { gap: space.md },
});
