// The fixed list of words a rule can use. It travels inside the signed policy,
// so adding a term does not need an app update.
export type Vocabulary = {
  version: string;
  topics: Record<string, string>;
  formats: string[];
  features: string[];
  rating_ages: number[];
  // Label providers the wallet trusts. Signed labels from anyone else count
  // as ordinary platform labels.
  labellers: { id: string; jwk: { kty: string; crv: string; x: string; y: string } }[];
};

export const DEFAULT_VOCABULARY: Vocabulary = {
  version: '2026.1',
  topics: {
    news: 'News',
    'news/war': 'War news',
    'news/politics': 'Political news',
    'news/crime': 'Crime news',
    'news/world': 'World news',
    science: 'Science',
    'science/space': 'Space',
    'science/biology': 'Biology',
    nature: 'Nature',
    technology: 'Technology',
    'technology/coding': 'Coding',
    'technology/ai': 'Artificial intelligence',
    'technology/ai-companions': 'AI companions',
    education: 'Education',
    'life-skills': 'Life skills',
    health: 'Health',
    'health/mental-health': 'Mental health',
    'health/sleep': 'Sleep',
    entertainment: 'Entertainment',
    'entertainment/movies': 'Movies and TV',
    'entertainment/music': 'Music',
    games: 'Games',
    'games/gambling': 'Gambling-style games (slots, poker, loot boxes)',
    sports: 'Sports',
    shopping: 'Shopping',
    social: 'Social media',
    violence: 'Violence',
    'violence/graphic': 'Graphic violence',
    harm: 'Harmful content',
    'harm/self-harm': 'Self-harm',
    'harm/sexual': 'Sexual content',
    'harm/hate': 'Hate',
    'harm/drugs': 'Drugs',
    'harm/gambling': 'Gambling and betting',
  },
  formats: ['video', 'short', 'article', 'documentary', 'game', 'audio', 'live_stream', 'chat', 'app'],
  features: ['comments', 'chat', 'stranger_messages', 'purchases', 'ads', 'location_sharing', 'ai_chat'],
  rating_ages: [0, 7, 13, 16, 18],
  // A demo labeller. In production this list would come from the
  // certification authority.
  labellers: [
    {
      id: 'did:example:chaise-labeller',
      jwk: { kty: 'EC', crv: 'P-256', x: 'YABRcZOLRxNToAZA5E35PZDXqVGR7S36f_DZR31zvTM', y: 'tFykk4FJIULfiuhTaFEyJfCw4gU1U2wXKVdGgHQWtLI' },
    },
  ],
};

export function isTopic(vocabulary: Vocabulary, topic: string): boolean {
  return Object.prototype.hasOwnProperty.call(vocabulary.topics, topic);
}

// news/war -> ['news', 'news/war'], so a rule on 'news' also covers war news.
export function withParents(topic: string): string[] {
  const parts = topic.split('/');
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

// The closest known term for a topic this vocabulary does not list:
// news/war/ukraine -> news/war. Null when nothing matches.
export function nearestTopic(vocabulary: Vocabulary, topic: string): string | null {
  const parents = withParents(topic);
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    if (isTopic(vocabulary, parents[i])) return parents[i];
  }
  return null;
}
