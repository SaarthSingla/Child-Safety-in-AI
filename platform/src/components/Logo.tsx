import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme';

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.badge,
          { width: size, height: size, borderRadius: size * 0.3 },
        ]}
      >
        <View
          style={{
            width: 0,
            height: 0,
            marginLeft: size * 0.08,
            borderTopWidth: size * 0.2,
            borderBottomWidth: size * 0.2,
            borderLeftWidth: size * 0.32,
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
            borderLeftColor: '#FFFFFF',
          }}
        />
      </View>

      <Text style={[styles.wordmark, { fontSize: size * 0.9 }]}>
        Foo<Text style={styles.wordmarkAccent}>tube</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  badge: {
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },

  wordmark: {
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.ink,
  },

  wordmarkAccent: {
    color: colors.brand,
  },
});
