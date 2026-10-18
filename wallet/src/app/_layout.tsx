import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { DemoBannerFrame } from '@/components/demo-banner';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* The demo banner is always light, so keep the status bar dark on it. */}
      <StatusBar style="dark" />
      <DemoBannerFrame>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="get-credential" />
          <Stack.Screen name="verify-request" />
        </Stack>
      </DemoBannerFrame>
    </ThemeProvider>
  );
}
