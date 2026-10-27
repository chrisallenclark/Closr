import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import {
  Button,
  Chip,
  ChipWrap,
  ColorSwatches,
  haptic,
  IconButton,
  Screen,
  Text,
  TextField,
  Wordmark,
} from '@/components/ui';
import { useProfile } from '@/features/profile/store';
import { STYLE_TAGS, type StyleTag } from '@/features/profile/types';
import { colors, gutter, space } from '@/theme';

const STEPS = 3;

function Progress({ step }: { step: number }) {
  return (
    <View style={styles.progress}>
      {Array.from({ length: STEPS }, (_, i) => (
        <View key={i} style={[styles.bar, i < step && styles.barActive]} />
      ))}
    </View>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <Screen scroll={false} padded={false}>
      <LinearGradient
        colors={['#2B221C', colors.bg]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.6, y: 0.8 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.welcome}>
        <Animated.View entering={FadeIn.duration(900)} style={styles.brand}>
          <Wordmark size={76} />
          <Text variant="eyebrow" color={colors.sand} style={styles.tagline}>
            Your wardrobe.{'\n'}A higher standard.
          </Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(400).duration(700)} style={styles.pillars}>
          {['Organize', 'Style', 'Experiment', 'Evolve'].map((w) => (
            <Text key={w} variant="eyebrow" color={colors.textMuted}>
              {w}
            </Text>
          ))}
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(700).duration(700)} style={styles.cta}>
          <Text variant="body" color={colors.textMuted} style={styles.lede}>
            Photograph what you own, build better outfits from it, and know what’s worth buying
            next.
          </Text>
          <Button label="Get started" size="lg" onPress={onStart} />
        </Animated.View>
      </View>
    </Screen>
  );
}

export default function Onboarding() {
  const complete = useProfile((s) => s.completeOnboarding);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [tags, setTags] = useState<StyleTag[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);

  if (step === 0) return <Welcome onStart={() => setStep(1)} />;

  const canContinue = step === 1 ? name.trim().length > 0 : step === 2 ? tags.length > 0 : true;
  const next = () => {
    if (step < STEPS) return setStep(step + 1);
    haptic.success();
    complete({ name: name.trim(), styleTags: tags, favoriteColors: favorites, avoidColors: [] });
  };

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <Screen
      header={
        <View style={styles.header}>
          <IconButton icon={ArrowLeft} variant="plain" onPress={() => setStep(step - 1)} accessibilityLabel="Back" />
          <Progress step={step} />
          <View style={{ width: 40 }} />
        </View>
      }
      footer={
        <View style={styles.footer}>
          <Button
            label={step === STEPS ? 'Enter Closr' : 'Continue'}
            size="lg"
            onPress={next}
            disabled={!canContinue}
          />
        </View>
      }
    >
      <Animated.View key={step} entering={FadeInDown.duration(450)} style={styles.step}>
        {step === 1 ? (
          <>
            <Text variant="eyebrow" color={colors.sand}>
              Step 1 of 3
            </Text>
            <Text variant="display">What should we call you?</Text>
            <TextField
              value={name}
              onChangeText={setName}
              placeholder="First name"
              autoFocus
              autoCapitalize="words"
              returnKeyType="next"
              onSubmitEditing={() => canContinue && next()}
            />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Text variant="eyebrow" color={colors.sand}>
              Step 2 of 3
            </Text>
            <Text variant="display">How would you describe your style?</Text>
            <Text variant="body" color={colors.textMuted}>
              Pick a few. This shapes your outfit suggestions and you can change it anytime.
            </Text>
            <ChipWrap>
              {STYLE_TAGS.map((t) => (
                <Chip key={t} label={t} selected={tags.includes(t)} onPress={() => setTags(toggle(tags, t))} />
              ))}
            </ChipWrap>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Text variant="eyebrow" color={colors.sand}>
              Step 3 of 3
            </Text>
            <Text variant="display">Colours you reach for</Text>
            <Text variant="body" color={colors.textMuted}>
              Optional. Outfits with these colours get a small boost.
            </Text>
            <ColorSwatches selected={favorites} onToggle={(id) => setFavorites(toggle(favorites, id))} />
          </>
        ) : null}
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  welcome: { flex: 1, paddingHorizontal: gutter + 8, justifyContent: 'space-between', paddingVertical: space.xxxl },
  brand: { marginTop: space.xxxl, gap: space.md },
  tagline: { lineHeight: 20, letterSpacing: 3.2 },
  pillars: { gap: space.sm, alignSelf: 'flex-end', alignItems: 'flex-end' },
  cta: { gap: space.xl },
  lede: { maxWidth: 320 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: gutter - space.sm,
    height: 56,
  },
  progress: { flex: 1, flexDirection: 'row', gap: 6, paddingHorizontal: space.lg },
  bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.surfaceRaised },
  barActive: { backgroundColor: colors.cream },
  step: { gap: space.lg, paddingTop: space.xl },
  footer: { paddingHorizontal: gutter, paddingTop: space.md },
});
