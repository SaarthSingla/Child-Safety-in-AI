import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { DemoBannerFrame } from '@/components/demo-banner';
import { CedarEngineHost } from '@/nlpps/CedarEngine';
import { syncPolicy } from '@/nlpps/sync';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Pick up guardian changes whenever the wallet comes to the foreground.
  // A failed sync is harmless: the wallet keeps the policy it has.
  useEffect(() => {
    syncPolicy().catch(() => undefined);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncPolicy().catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* The demo banner is always light, so keep the status bar dark on it. */}
      <StatusBar style="dark" />
      <CedarEngineHost />
      <DemoBannerFrame>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="get-credential" />
          <Stack.Screen name="verify-request" />
          <Stack.Screen name="curate-request" />
          <Stack.Screen name="ask-guardian" />
          <Stack.Screen name="pair" />
          <Stack.Screen name="policy-source" />
        </Stack>
      </DemoBannerFrame>
    </ThemeProvider>
  );
}
