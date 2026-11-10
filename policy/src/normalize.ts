import type { ContentRecord } from './types';
import { isTopic, nearestTopic, withParents, type Vocabulary } from './vocabulary';

type Raw = Record<string, unknown>;

const stringList = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : null;

// Turns untrusted labels into a clean record. Anything unclear becomes
// "not checked", never "safe": an unknown term moves to its nearest known
// parent, and if there is none the whole field counts as unchecked.
export function normalizeRecord(raw: Raw, vocabulary: Vocabulary, trusted: boolean): ContentRecord | null {
  if (typeof raw.content_id !== 'string' || raw.content_id.length === 0 || raw.content_id.length > 200) return null;

  const record: ContentRecord = { content_id: raw.content_id, trusted };
  if (typeof raw.title === 'string') record.title = raw.title.slice(0, 200);
  if (typeof raw.platform === 'string') record.platform = raw.platform.slice(0, 100);

  const topics = stringList(raw.topics);
  if (topics) {
    const known = topics.map((topic) => nearestTopic(vocabulary, topic));
    if (known.every((topic): topic is string => topic !== null)) {
      record.topics = [...new Set(known.flatMap(withParents))].filter((topic) => isTopic(vocabulary, topic));
    }
  }

  const features = stringList(raw.features);
  if (features && features.every((feature) => vocabulary.features.includes(feature))) {
    record.features = [...new Set(features)];
  }

  if (typeof raw.format === 'string' && vocabulary.formats.includes(raw.format)) record.format = raw.format;

  const rating = raw.rating_age;
  if (typeof rating === 'number' && Number.isInteger(rating) && rating >= 0 && rating <= 21) record.rating_age = rating;

  if (typeof raw.live === 'boolean') record.live = raw.live;
  return record;
}

// The labels Cedar sees. Title and platform stay out of the decision.
export function cedarAttributes(record: ContentRecord): Record<string, unknown> {
  const attributes: Record<string, unknown> = { content_id: record.content_id, trusted: record.trusted };
  if (record.topics) attributes.topics = record.topics;
  if (record.features) attributes.features = record.features;
  if (record.format !== undefined) attributes.format = record.format;
  if (record.rating_age !== undefined) attributes.rating_age = record.rating_age;
  if (record.live !== undefined) attributes.live = record.live;
  return attributes;
}
