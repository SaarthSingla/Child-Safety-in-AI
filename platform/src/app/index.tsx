import { useCallback, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArticleCard } from '@/components/ArticleCard';
import { Logo } from '@/components/Logo';
import { decideArticleAccess } from '@/content/authorization';
import { CATALOG, type ContentRating } from '@/content/catalog';
import { colors, radii } from '@/theme';

type Filter = 'all' | ContentRating;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'everyone', label: 'Everyone' },
  { value: '12+', label: '12+' },
  { value: '18+', label: '18+' },
];

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');
  const [, refresh] = useState(0);

  // The verified session lives outside React, so re-read it whenever this
  // screen comes back into focus (e.g. after verifying inside an article).
  useFocusEffect(
    useCallback(() => {
      refresh((n) => n + 1);
    }, []),
  );

  const articles = CATALOG.filter(
    (article) => filter === 'all' || article.rating === filter,
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={articles}
        keyExtractor={(article) => article.id}
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 20,
        }}
        ListHeaderComponent={
          <View>
            <Logo />

            <Text style={styles.tagline}>Stories worth reading</Text>

            <View style={styles.info}>
              <Text style={styles.infoIcon}>🛡️</Text>
              <Text style={styles.infoText}>
                Some articles are age-restricted. Prove your age range with
                ChildSafe Wallet, without sharing your exact age or a photo.
              </Text>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filters}
              contentContainerStyle={styles.filtersContent}
            >
              {FILTERS.map(({ value, label }) => {
                const selected = filter === value;

                return (
                  <Pressable
                    key={value}
                    onPress={() => setFilter(value)}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        renderItem={({ item, index }) => (
          <ArticleCard
            article={item}
            featured={index === 0}
            allowed={decideArticleAccess(item).allowed}
            onPress={() => router.push(`/article/${item.id}`)}
          />
        )}
        ListFooterComponent={
          <Text style={styles.footer}>
            Sample articles for demonstration only.
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  tagline: {
    fontSize: 15,
    color: colors.muted,
    marginTop: 8,
  },

  info: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.brandTint,
    borderRadius: radii.control,
    padding: 14,
    marginTop: 18,
  },

  infoIcon: {
    fontSize: 16,
    marginRight: 10,
  },

  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: colors.body,
  },

  filters: {
    marginTop: 18,
    marginBottom: 18,
    marginHorizontal: -20,
  },

  filtersContent: {
    paddingHorizontal: 20,
  },

  chip: {
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginRight: 8,
  },

  chipSelected: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },

  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.body,
  },

  chipTextSelected: {
    color: '#FFFFFF',
  },

  footer: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.muted,
    marginTop: 8,
  },
});
