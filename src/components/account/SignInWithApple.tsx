import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { Button, haptic, Text } from '@/components/ui';
import { useAccount } from '@/features/account/store';
import { colors, radii } from '@/theme';

/** Apple's own button (required by App Review), with Closr's busy and error handling. */
export function SignInWithApple({ onSignedIn }: { onSignedIn?: () => void }) {
  const signIn = useAccount((s) => s.signIn);
  const [available, setAvailable] = useState(Platform.OS === 'ios');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') void AppleAuthentication.isAvailableAsync().then(setAvailable);
  }, []);

  const press = async () => {
    setBusy(true);
    try {
      if ((await signIn()) === 'ok') {
        haptic.success();
        onSignedIn?.();
      }
    } catch (error) {
      console.warn(error);
      Alert.alert("Couldn't sign in", 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!available) {
    return (
      <View style={styles.gap}>
        <Button label="Sign in with Apple" variant="secondary" disabled />
        <Text variant="caption" color={colors.textMuted} align="center">
          Sign in with Apple is available on iPhone.
        </Text>
      </View>
    );
  }
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
      cornerRadius={radii.pill}
      style={[styles.button, busy && styles.busy]}
      onPress={() => !busy && void press()}
    />
  );
}

const styles = StyleSheet.create({
  button: { width: '100%', height: 50 },
  busy: { opacity: 0.5 },
  gap: { gap: 8 },
});
