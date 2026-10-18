import { StyleSheet, Text, View } from 'react-native';

import type { ContentRating } from '@/content/catalog';
import { colors, radii, ratingTheme } from '@/theme';

export function RatingPill({
  rating,
  unlocked = false,
}: {
  rating: ContentRating;
  unlocked?: boolean;
}) {
  const theme = ratingTheme[rating];

  const background = unlocked ? colors.successBg : theme.bg;
  const foreground = unlocked ? colors.success : theme.fg;

  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <Text style={[styles.text, { color: foreground }]}>
        {unlocked ? `✓ ${theme.label}` : theme.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },

  text: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
