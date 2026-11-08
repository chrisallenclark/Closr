import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Check, ImageIcon, Layers, RotateCcw, Shirt, Sparkles, Wand2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, useWindowDimensions, View } from 'react-native';

import { SignInWithApple } from '@/components/account/SignInWithApple';
import { MannequinStage, type StageLayers } from '@/components/avatar/MannequinStage';
import { GarmentFitPicker } from '@/components/avatar/GarmentFitPicker';
import { Button, EmptyState, haptic, Header, ItemImage, Screen, Text, TextField } from '@/components/ui';
import { useAccount } from '@/features/account/store';
import { prepStatus } from '@/features/avatar/status';
import { canPrepare, useAvatar } from '@/features/avatar/store';
import type { Corrections, FitKey, ItemPrep } from '@/features/avatar/types';
import { useItem } from '@/features/wardrobe/hooks';
import { useWardrobe } from '@/features/wardrobe/store';
import { avatarBackendConfigured } from '@/services/avatarApi';
import { pickPhoto, type PhotoSource } from '@/services/photos';
import { colors, gutter, radii, space } from '@/theme';

/** Every fit value a correction can change, per category. */
const CORRECTABLE: Record<string, FitKey[]> = {
  top: ['width', 'length', 'sleeves'],
  outerwear: ['width', 'length', 'sleeves'],
  bottom: ['legShape', 'rise'],
  shoes: [],
};

function suggestedValues(analysis: ItemPrep['analysis'], corrections: Corrections | undefined): Partial<Record<FitKey, string>> {
  const out: Partial<Record<FitKey, string>> = {};
  for (const [k, v] of Object.entries(analysis?.fit ?? {})) {
    if (typeof v?.value === 'string') out[k as FitKey] = v.value;
  }
  const { acceptPhoto: _ignored, ...picked } = corrections ?? {};
  return { ...out, ...picked };
}

/** Differences the automatic photo comparison found, worth a look before approving. */
function reviewNotes(checks: Record<string, unknown>): string[] {
  const verify = checks.verify as { mismatches?: string[] } | undefined;
  // Missing hang tags and stickers are expected: the mannequin wears the garment, not its labels.
  return (verify?.mismatches ?? []).filter((m) => !/\b(tag|tags|sticker|stickers|hanger|mannequin)\b/i.test(m)).slice(0, 4);
}

/**
 * Prepare a garment for the mannequin: read the photo, confirm fit only where the reading is
 * unsure, prepare on the server, then review. Leaving the screen never cancels anything: the
 * flow continues in the background and resumes after a restart.
 */
export default function PrepareItem() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useItem(id);
  const prep = useAvatar((s) => (id ? s.byItem[id] : undefined));
  const assets = useAvatar((s) => s.assets);
  const urls = useAvatar((s) => s.urls);
  const needsSignIn = useAvatar((s) => s.needsSignIn);
  const signedIn = useAccount((s) => s.signedIn);
  const signInRequired = useAccount((s) => s.signInRequired);
  const { start, confirmFit, acceptPhoto, approve, requestCorrection, retry } = useAvatar.getState();
  const replacePhoto = useWardrobe((s) => s.replacePhoto);
  const { width } = useWindowDimensions();

  const [values, setValues] = useState<Partial<Record<FitKey, string>>>({});
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const suggested = useMemo(() => suggestedValues(prep?.analysis, prep?.corrections), [prep?.analysis, prep?.corrections]);
  // Start the picker from the reading (or the last correction) whenever that changes.
  const [seeded, setSeeded] = useState<typeof suggested | null>(null);
  if (seeded !== suggested) {
    setSeeded(suggested);
    setValues(suggested);
  }

  if (!item || !canPrepare(item.category) || !avatarBackendConfigured()) {
    return (
      <Screen header={<Header />}>
        <EmptyState
          icon={Shirt}
          title={!item ? 'Item not found' : !avatarBackendConfigured() ? 'Not available in this build' : 'Not supported yet'}
          body={
            !item
              ? 'It may have been deleted.'
              : !avatarBackendConfigured()
                ? 'Mannequin preparation needs the Closr server, which this build is not connected to.'
                : 'The mannequin can wear tops, layers, bottoms and shoes for now.'
          }
        />
      </Screen>
    );
  }

  const status = prepStatus(prep);
  const variant = prep?.job?.variant;
  const stageW = Math.min(width - gutter * 2, 420);
  const half = (stageW - space.md) / 2;
  const layers: StageLayers = variant ? { [variant.category]: variant } : {};
  const working = status.tone === 'working';

  const newPhoto = async (source: PhotoSource) => {
    const photo = await pickPhoto(source);
    if (!photo) return;
    await replacePhoto(item.id, photo); // the sync hook restarts preparation for the new photo
    haptic.success();
  };

  const askNewPhoto = () =>
    Alert.alert('Use a new photo', 'Lay the garment flat, front facing up, with any print or text fully visible.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Choose from library', onPress: () => void newPhoto('library') },
      { text: 'Take photo', onPress: () => void newPhoto('camera') },
    ]);

  const doApprove = async () => {
    setBusy(true);
    try {
      await approve(item.id);
      haptic.success();
    } catch {
      Alert.alert("Couldn't approve", 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const sendCorrection = async () => {
    const changed: Corrections = {};
    for (const k of CORRECTABLE[item.category] ?? []) if (values[k] && values[k] !== suggested[k]) changed[k] = values[k];
    if (!Object.keys(changed).length && !note.trim()) {
      Alert.alert('What should change?', 'Pick the fit that matches, or describe what looks wrong.');
      return;
    }
    await requestCorrection(item.id, changed, note);
    setCorrecting(false);
    setNote('');
  };

  return (
    <Screen header={<Header title="Mannequin" subtitle={item.name} />}>
      <View style={styles.body}>
        <View style={[styles.status, status.tone === 'problem' && styles.statusProblem]}>
          {working ? <ActivityIndicator color={colors.cream} /> : null}
          <View style={styles.flex}>
            <Text variant="bodyStrong">{status.label}</Text>
            <Text variant="caption" color={colors.textMuted}>
              {status.detail}
            </Text>
          </View>
        </View>
        {working ? (
          <Text variant="caption" color={colors.textFaint}>
            You can leave this screen. Preparation keeps going, even if you close the app.
          </Text>
        ) : null}

        {(needsSignIn || signInRequired) && !signedIn ? (
          <View style={styles.signIn}>
            <Text variant="bodyStrong">Sign in to prepare garments</Text>
            <Text variant="caption" color={colors.textMuted}>
              Prepared garments are saved privately to your account, so they’re on every iPhone you use. Anything already
              started continues after you sign in.
            </Text>
            <SignInWithApple />
          </View>
        ) : null}

        {!prep ? (
          <>
            <ItemImage photo={item.photo} style={{ width: stageW, height: stageW }} radius={radii.lg} inset={24} />
            <Text variant="body" color={colors.textMuted}>
              Closr prepares this garment once on your mannequin. After that, switching outfits is instant.
            </Text>
            <Button label="Prepare for Build Outfit" icon={Sparkles} size="lg" onPress={() => start(item)} />
          </>
        ) : null}

        {prep?.stage === 'confirm' && prep.analysis ? (
          <>
            {prep.analysis.categoryNote ? (
              <Text variant="caption" color={colors.warning}>
                {prep.analysis.categoryNote}
              </Text>
            ) : null}
            <View style={styles.confirmRow}>
              <ItemImage photo={item.photo} style={styles.thumb} radius={radii.md} inset={8} />
              <Text variant="body" color={colors.textMuted} style={styles.flex}>
                Pick what matches your {item.category === 'bottom' ? 'pants' : 'garment'} so it drapes right on the mannequin.
              </Text>
            </View>
            <GarmentFitPicker
              keys={prep.analysis.ask}
              values={values}
              suggested={suggested}
              onChange={(k, v) => setValues({ ...values, [k]: v })}
            />
            <Button
              label="Continue"
              size="lg"
              disabled={prep.analysis.ask.some((k) => !values[k])}
              onPress={() => {
                const picked: Corrections = {};
                for (const k of prep.analysis!.ask) picked[k] = values[k];
                confirmFit(item.id, picked);
              }}
            />
          </>
        ) : null}

        {variant && (prep?.stage === 'ready_for_review' || prep?.stage === 'approved') ? (
          <>
            <View style={styles.compare}>
              <View style={styles.compareCol}>
                <ItemImage photo={item.photo} style={{ width: half, height: half * (16 / 9) }} radius={radii.lg} inset={12} />
                <Text variant="micro" color={colors.textMuted} align="center">
                  Your photo
                </Text>
              </View>
              <View style={styles.compareCol}>
                <View style={[styles.stageFrame, { width: half, height: half * (16 / 9) }]}>
                  {assets ? (
                    <MannequinStage assets={assets} urls={urls} layers={layers} width={half} height={half * (16 / 9)} />
                  ) : (
                    <ActivityIndicator color={colors.cream} />
                  )}
                </View>
                <Text variant="micro" color={colors.textMuted} align="center">
                  On the mannequin
                </Text>
              </View>
            </View>
            {prep.stage === 'ready_for_review' ? (
              <Text variant="caption" color={colors.textMuted}>
                Check the colour, print, length and width. If something is off, ask for a correction instead of approving.
              </Text>
            ) : null}
            {prep.stage === 'ready_for_review' && reviewNotes(variant.checks).length ? (
              <View style={styles.notes}>
                <Text variant="label">Closr noticed</Text>
                {reviewNotes(variant.checks).map((n) => (
                  <Text key={n} variant="caption" color={colors.textMuted}>
                    · {n}
                  </Text>
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {correcting ? (
          <View style={styles.correction}>
            {(CORRECTABLE[item.category] ?? []).length ? (
              <GarmentFitPicker
                keys={CORRECTABLE[item.category]!}
                values={values}
                suggested={suggested}
                onChange={(k, v) => setValues({ ...values, [k]: v })}
              />
            ) : null}
            <TextField
              label="What looks wrong? (optional)"
              placeholder="e.g. the logo is missing, the hem is too long"
              value={note}
              onChangeText={setNote}
              maxLength={300}
              multiline
            />
            <View style={styles.buttons}>
              <Button label="Cancel" variant="secondary" style={styles.flex} onPress={() => setCorrecting(false)} />
              <Button label="Prepare again" icon={Wand2} style={styles.flex} onPress={() => void sendCorrection()} />
            </View>
          </View>
        ) : null}

        {prep?.stage === 'ready_for_review' && !correcting ? (
          <>
            <Button label="Looks right — approve" icon={Check} size="lg" loading={busy} onPress={() => void doApprove()} />
            <View style={styles.buttons}>
              <Button label="Request correction" variant="secondary" style={styles.flex} onPress={() => setCorrecting(true)} />
              <Button label="New photo" icon={Camera} variant="secondary" style={styles.flex} onPress={askNewPhoto} />
            </View>
          </>
        ) : null}

        {prep?.stage === 'approved' && !correcting ? (
          <>
            <Button
              label="Build an outfit"
              icon={Layers}
              size="lg"
              onPress={() => router.push({ pathname: '/outfit/builder', params: { [item.category]: item.id, lock: item.category } })}
            />
            <Button label="Request correction" variant="ghost" onPress={() => setCorrecting(true)} />
          </>
        ) : null}

        {prep && (prep.stage === 'failed' || prep.stage === 'error') ? (
          <>
            <ItemImage photo={item.photo} style={{ width: stageW, height: stageW * 0.8 }} radius={radii.lg} inset={24} />
            {prep.needsPhoto ? (
              <>
                <Button label="Use a new photo" icon={ImageIcon} size="lg" onPress={askNewPhoto} />
                <Button label="Use this photo anyway" variant="ghost" onPress={() => acceptPhoto(item.id)} />
              </>
            ) : (
              <>
                <Button label="Try again" icon={RotateCcw} size="lg" onPress={() => retry(item.id)} />
                <Button label="Use a new photo" variant="ghost" onPress={askNewPhoto} />
              </>
            )}
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.lg, paddingTop: space.sm, paddingBottom: space.xxxl },
  flex: { flex: 1 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  statusProblem: { borderColor: colors.danger },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 64, height: 64 },
  compare: { flexDirection: 'row', gap: space.md, alignSelf: 'center' },
  compareCol: { gap: space.xs },
  stageFrame: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: '#1d1814',
    alignItems: 'center',
    justifyContent: 'center',
  },
  correction: { gap: space.lg },
  signIn: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  notes: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.warning,
  },
  buttons: { flexDirection: 'row', gap: space.md },
});
