import type { Article } from '@/content/catalog';
import { bytesToBase64url } from '@/verifier/encoding';

import labelBatch from './footubeLabelBatch.json';
import footubeLabels from './footubeLabels.json';

// The standard description of an item. Anything left out means "not checked".
export type ContentLabels = {
  content_id: string;
  title?: string;
  platform?: string;
  format?: string;
  topics?: string[];
  features?: string[];
  rating_age?: number;
  live?: boolean;
};

export type LabelBatch = { labeller: string; hashes: string[]; signature: string };

// What the wallet receives. The signature covers these exact labels, and it
// was made by a labeller away from this app, using `npm run sign-labels`.
export type LabelManifest = { items: ContentLabels[]; batch: LabelBatch };

const LABELS: readonly ContentLabels[] = footubeLabels;

export function labelsFor(article: Article): ContentLabels {
  // An article with no signed labels counts as "not checked".
  return LABELS.find((labels) => labels.content_id === article.id) ?? { content_id: article.id, title: article.title };
}

export function manifestFor(articles: readonly Article[]): LabelManifest {
  return { items: articles.map(labelsFor), batch: labelBatch };
}

export function encodeJson(value: unknown): string {
  return bytesToBase64url(new TextEncoder().encode(JSON.stringify(value)));
}
