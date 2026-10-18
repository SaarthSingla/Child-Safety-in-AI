import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { radii } from '@/theme';

// Artwork-free cover: a solid accent colour with soft overlapping circles.
export function ArticleCover({
  accent,
  category,
  height,
  categoryBottom = 14,
  children,
}: {
  accent: string;
  category: string;
  height: number;
  // Lift the category chip when something overlaps the cover's bottom edge.
  categoryBottom?: number;
  children?: ReactNode;
}) {
  return (
    <View style={[styles.cover, { backgroundColor: accent, height }]}>
      <View
        style={[
          styles.circle,
          {
            width: height * 1.15,
            height: height * 1.15,
            borderRadius: height,
            right: -height * 0.32,
            top: -height * 0.4,
            opacity: 0.14,
          },
        ]}
      />
      <View
        style={[
          styles.circle,
          {
            width: height * 0.75,
            height: height * 0.75,
            borderRadius: height,
            left: -height * 0.22,
            bottom: -height * 0.32,
            opacity: 0.1,
          },
        ]}
      />

      <View style={[styles.category, { bottom: categoryBottom }]}>
        <Text style={styles.categoryText}>{category.toUpperCase()}</Text>
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    overflow: 'hidden',
  },

  circle: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
  },

  category: {
    position: 'absolute',
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },

  categoryText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
});
