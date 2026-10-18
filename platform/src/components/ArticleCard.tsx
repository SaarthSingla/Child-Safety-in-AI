import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type Article, isRestricted } from '@/content/catalog';
import { colors, radii, shadow } from '@/theme';

import { ArticleCover } from './ArticleCover';
import { RatingPill } from './RatingPill';

export function ArticleCard({
  article,
  allowed,
  featured = false,
  onPress,
}: {
  article: Article;
  // Whether the reader can already open it (open content, or a verified
  // session that covers it). Display only.
  allowed: boolean;
  featured?: boolean;
  onPress: () => void;
}) {
  const restricted = isRestricted(article);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <ArticleCover
        accent={article.accent}
        category={article.category}
        height={featured ? 176 : 118}
      >
        {restricted && (
          <View style={[styles.badge, allowed && styles.badgeUnlocked]}>
            <Text style={[styles.badgeText, allowed && styles.badgeTextUnlocked]}>
              {allowed ? '✓ Unlocked' : '🔒 Age check'}
            </Text>
          </View>
        )}
      </ArticleCover>

      <View style={styles.body}>
        <Text style={[styles.title, featured && styles.titleFeatured]} numberOfLines={2}>
          {article.title}
        </Text>

        <Text style={styles.summary} numberOfLines={2}>
          {article.summary}
        </Text>

        <View style={styles.meta}>
          <Text style={styles.metaText}>{article.readMinutes} min read</Text>
          <RatingPill rating={article.rating} unlocked={restricted && allowed} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    overflow: 'hidden',
    marginBottom: 16,
    ...shadow,
  },

  pressed: {
    opacity: 0.93,
    transform: [{ scale: 0.99 }],
  },

  badge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(20,22,27,0.72)',
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  badgeUnlocked: {
    backgroundColor: colors.successBg,
  },

  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  badgeTextUnlocked: {
    color: colors.success,
  },

  body: {
    padding: 16,
  },

  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.ink,
  },

  titleFeatured: {
    fontSize: 22,
    lineHeight: 28,
  },

  summary: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    marginTop: 6,
  },

  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },

  metaText: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: '500',
  },
});
