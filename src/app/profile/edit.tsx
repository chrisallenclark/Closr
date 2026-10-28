import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FitPicker } from '@/components/profile/FitPicker';
import { PalettePicker } from '@/components/profile/PalettePicker';
import { Button, Chip, ChipWrap, ColorSwatches, haptic, Header, Screen, Text, TextField } from '@/components/ui';
import { useProfile } from '@/features/profile/store';
import { STYLE_TAGS, type Fit, type PaletteId, type StyleTag } from '@/features/profile/types';
import { colors, gutter, space } from '@/theme';

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function EditProfile() {
  const profile = useProfile((s) => s.profile);
  const updateProfile = useProfile((s) => s.updateProfile);
  const [name, setName] = useState(profile?.name ?? '');
  const [tags, setTags] = useState<StyleTag[]>(profile?.styleTags ?? []);
  const [palettes, setPalettes] = useState<PaletteId[]>(profile?.palettes ?? []);
  const [fit, setFit] = useState<Fit | undefined>(profile?.fit);
  const [favorites, setFavorites] = useState(profile?.favoriteColors ?? []);
  const [avoid, setAvoid] = useState(profile?.avoidColors ?? []);

  const save = () => {
    updateProfile({
      name: name.trim() || profile?.name,
      styleTags: tags,
      palettes,
      fit,
      favoriteColors: favorites,
      avoidColors: avoid,
    });
    haptic.success();
    router.back();
  };

  return (
    <Screen
      edges={{ top: false }}
      header={<Header title="Style Profile" leading="close" />}
      footer={
        <View style={styles.footer}>
          <Button label="Save" onPress={save} disabled={tags.length === 0} />
        </View>
      }
    >
      <View style={styles.body}>
        <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Section title="Your style">
          <ChipWrap>
            {STYLE_TAGS.map((t) => (
              <Chip key={t} label={t} selected={tags.includes(t)} onPress={() => setTags(toggle(tags, t))} />
            ))}
          </ChipWrap>
        </Section>
        <Section title="Colours you gravitate toward">
          <PalettePicker selected={palettes} onToggle={(id) => setPalettes(toggle(palettes, id))} />
        </Section>
        <Section title="Fit">
          <FitPicker value={fit} onChange={setFit} />
        </Section>
        <Section title="Specific colours you love" hint="Optional">
          <ColorSwatches selected={favorites} onToggle={(c) => setFavorites(toggle(favorites, c))} />
        </Section>
        <Section title="Colours to avoid" hint="Kept out of suggestions">
          <ColorSwatches selected={avoid} onToggle={(c) => setAvoid(toggle(avoid, c))} />
        </Section>
      </View>
    </Screen>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text variant="eyebrow" color={colors.textMuted}>
          {title}
        </Text>
        {hint ? (
          <Text variant="caption" color={colors.textFaint}>
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.xxl, paddingTop: space.sm },
  section: { gap: space.md },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  footer: {
    paddingHorizontal: gutter,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
