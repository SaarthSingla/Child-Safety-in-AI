import { describe, expect, it } from 'vitest';

import { CATALOG, getArticleById, isRestricted, requirementFor } from '@/content/catalog';

describe('article catalogue', () => {
  it('has unique ids and real content for every article', () => {
    const ids = CATALOG.map((article) => article.id);

    expect(new Set(ids).size).toBe(ids.length);

    for (const article of CATALOG) {
      expect(article.title.length).toBeGreaterThan(5);
      expect(article.summary.length).toBeGreaterThan(20);
      expect(article.body.length).toBeGreaterThanOrEqual(3);
      expect(article.readMinutes).toBeGreaterThan(0);
    }
  });

  it('offers every tier: open, 12+ and 18+', () => {
    const ratings = new Set(CATALOG.map((article) => article.rating));

    expect(ratings).toEqual(new Set(['everyone', '12+', '18+']));
  });

  it('maps each rating to the requirement the verifier must be shown', () => {
    for (const article of CATALOG) {
      const expected =
        article.rating === '12+' ? '12plus' : article.rating === '18+' ? '18plus' : null;

      expect(requirementFor(article)).toBe(expected);
      expect(isRestricted(article)).toBe(expected !== null);
    }
  });

  it('includes the war feature as 18+ and a teen-appropriate article as 12+', () => {
    expect(getArticleById('life-under-siege')?.rating).toBe('18+');
    expect(getArticleById('sleep-screens-teen-brain')?.rating).toBe('12+');
  });

  it('returns undefined for an unknown article', () => {
    expect(getArticleById('nope')).toBeUndefined();
    expect(getArticleById(undefined)).toBeUndefined();
  });
});
