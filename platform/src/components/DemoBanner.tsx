import { useMemo, type ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/theme';

// iSPIRT / CHAISE demo banner pinned above every screen. The banner takes the
// status-bar inset itself, so screens below it see a top inset of 0.
export function DemoBannerFrame({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const belowBanner = useMemo(() => ({ ...insets, top: 0 }), [insets]);

  return (
    <View style={styles.frame}>
      <View
        style={[styles.banner, { paddingTop: insets.top + 6 }]}
        accessibilityRole="header"
        accessibilityLabel="iSPIRT, CHAISE Demo"
      >
        <Image source={require('../../assets/images/ispirt-logo.png')} style={styles.logo} />
        <View style={styles.divider} />
        <Text style={styles.title}>
          CHAISE <Text style={styles.titleLight}>Demo</Text>
        </Text>
      </View>

      <SafeAreaInsetsContext.Provider value={belowBanner}>
        <View style={styles.content}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    backgroundColor: colors.background,
  },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },

  logo: {
    width: 29,
    height: 36,
  },

  divider: {
    width: 1,
    height: 24,
    backgroundColor: colors.line,
    marginHorizontal: 12,
  },

  title: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: colors.ink,
  },

  titleLight: {
    fontWeight: '500',
    letterSpacing: 0,
    color: colors.muted,
  },

  content: {
    flex: 1,
  },
});
