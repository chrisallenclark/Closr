import { StyleSheet, View } from 'react-native';

import { Chip, ChipWrap, ColorSwatches, PressableScale, Text, TextField } from '@/components/ui';
import {
  CATEGORIES,
  defaultFormality,
  FORMALITY_LABELS,
  getCategory,
  SEASONS,
  suggestName,
} from '@/features/wardrobe/catalog';
import type { ClothingDraft, Formality } from '@/features/wardrobe/types';
import { colors, radii, space } from '@/theme';

export const MAX_COLORS = 3;

export function emptyDraft(): ClothingDraft {
  return {
    name: '',
    category: 'top',
    subcategory: 'graphic-tee',
    colors: [],
    seasons: [],
    formality: 1,
  };
}

export interface ItemFormProps {
  draft: ClothingDraft;
  onChange: (draft: ClothingDraft) => void;
  /** "match" hides fields that don't matter for a quick in-store check. */
  mode?: 'full' | 'match';
  /** Whether the name was typed by the user (stops auto-naming). */
  nameEdited: boolean;
  onNameEdited: () => void;
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

export function ItemForm({ draft, onChange, mode = 'full', nameEdited, onNameEdited }: ItemFormProps) {
  const category = getCategory(draft.category);

  const update = (patch: Partial<ClothingDraft>) => {
    const next = { ...draft, ...patch };
    if (!nameEdited) next.name = suggestName(next.category, next.subcategory, next.colors);
    onChange(next);
  };

  const toggleColor = (id: string) => {
    const has = draft.colors.includes(id);
    if (!has && draft.colors.length >= MAX_COLORS) return;
    update({ colors: has ? draft.colors.filter((c) => c !== id) : [...draft.colors, id] });
  };

  return (
    <View style={styles.form}>
      <Section title="Category">
        <ChipWrap>
          {CATEGORIES.map((c) => (
            <Chip
              key={c.id}
              label={c.plural}
              selected={draft.category === c.id}
              onPress={() => {
                const sub = c.subcategories[0]!.id;
                update({ category: c.id, subcategory: sub, formality: defaultFormality(c.id, sub) });
              }}
            />
          ))}
        </ChipWrap>
      </Section>

      <Section title="Type">
        <ChipWrap>
          {category.subcategories.map((s) => (
            <Chip
              key={s.id}
              label={s.label}
              selected={draft.subcategory === s.id}
              onPress={() => update({ subcategory: s.id, formality: s.formality })}
            />
          ))}
        </ChipWrap>
      </Section>

      <Section title="Colour" hint={`Main colour first · up to ${MAX_COLORS}`}>
        <ColorSwatches selected={draft.colors} onToggle={toggleColor} ordered />
      </Section>

      <Section title="Dress level">
        <View style={styles.segment}>
          {([1, 2, 3, 4, 5] as Formality[]).map((f) => {
            const active = draft.formality === f;
            return (
              <PressableScale
                key={f}
                hapticFeedback="select"
                onPress={() => update({ formality: f })}
                style={[styles.segmentItem, active && styles.segmentActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text variant="label" color={active ? colors.ink : colors.textMuted}>
                  {FORMALITY_LABELS[f]}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </Section>

      {mode === 'full' ? (
        <>
          <Section title="Seasons" hint="Optional">
            <ChipWrap>
              {SEASONS.map((s) => {
                const active = draft.seasons.includes(s.id);
                return (
                  <Chip
                    key={s.id}
                    label={s.label}
                    selected={active}
                    onPress={() =>
                      update({
                        seasons: active
                          ? draft.seasons.filter((x) => x !== s.id)
                          : [...draft.seasons, s.id],
                      })
                    }
                  />
                );
              })}
            </ChipWrap>
          </Section>

          <TextField
            label="Name"
            value={draft.name}
            placeholder="e.g. Brown Cargo Pants"
            onChangeText={(name) => {
              onNameEdited();
              onChange({ ...draft, name });
            }}
          />
          <TextField
            label="Brand"
            value={draft.brand ?? ''}
            placeholder="Optional"
            autoCapitalize="words"
            onChangeText={(brand) => onChange({ ...draft, brand: brand || undefined })}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.xxl },
  section: { gap: space.md },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  segmentItem: {
    flex: 1,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.cream },
});
