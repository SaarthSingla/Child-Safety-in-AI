import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { DemoBannerFrame } from '@/components/DemoBanner';
import { colors } from '@/theme';

// Footube's design is light-only, so the navigation theme is pinned to match.
const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.background },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="dark" />
      <DemoBannerFrame>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="article/[id]" />
          <Stack.Screen name="verify-callback" />
        </Stack>
      </DemoBannerFrame>
    </ThemeProvider>
  );
}
