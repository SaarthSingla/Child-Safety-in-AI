// Generated from policy/src by `npm run sync` in policy/. Do not edit here.
import { DAYS, type ContentMatch, type ContentRecord, type Day, type Decision, type DecisionContext, type Exception, type PolicyDocument, type Rule, type TimeWindow } from './types';
import { referenceDecision } from './reference';
import { formatTime, parseTime } from './time';
import { withParents } from './vocabulary';

// Plain-language text built from the rule's fields. It never comes from the
// LLM, so the parent sees what will actually be enforced.
const DAY_NAMES: Record<Day, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

function joinWords(words: string[], last = 'or'): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} ${last} ${words[words.length - 1]}`;
}

function clock(time: string): string {
  const minute = parseTime(time);
  const hour = Math.floor(minute / 60);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const minutes = minute % 60 ? `:${String(minute % 60).padStart(2, '0')}` : '';
  return `${twelve}${minutes} ${hour < 12 ? 'AM' : 'PM'}`;
}

function describeContent(match: ContentMatch, topicName: (topic: string) => string): string {
  const parts: string[] = [];
  if (match.topics) parts.push(joinWords(match.topics.map(topicName)));
  if (match.formats) parts.push(`in these formats: ${joinWords(match.formats)}`);
  if (match.features) parts.push(`with ${joinWords(match.features.map((f) => f.replaceAll('_', ' ')))}`);
  if (match.min_rating_age !== undefined) parts.push(`rated ${match.min_rating_age}+ or higher`);
  if (match.live !== undefined) parts.push(match.live ? 'that is live' : 'that is not live');
  if (parts.length === 0) return 'all content';
  return match.topics ? parts.join(', ') : `content ${parts.join(', ')}`;
}

function describeWhen(when: TimeWindow | undefined): string {
  if (!when) return 'at all times';
  const parts: string[] = [];
  if (when.after && when.before) parts.push(`from ${clock(when.after)} to ${clock(when.before)}`);
  if (when.days) parts.push(`starting on ${joinWords(when.days.map((day) => DAY_NAMES[day]))}`);
  return parts.join(', ') || 'at all times';
}

function describeException(clause: Exception, topicName: (topic: string) => string): string {
  const { content_ids: ids, until, ...match } = clause;
  const what = ids ? `${ids.length === 1 ? 'one approved item' : `${ids.length} approved items`}` : describeContent(match, topicName);
  return until ? `${what} until ${until.replace('T', ' ')}` : what;
}

export function describeRule(rule: Rule, policy: Pick<PolicyDocument, 'vocabulary'>): string {
  const topicName = (topic: string) => policy.vocabulary.topics[topic] ?? topic;
  const verb = rule.effect === 'hide' ? 'Hide' : 'Ask before showing';
  let text = `${verb} ${describeContent(rule.content, topicName)} ${describeWhen(rule.when)}`;
  if (rule.except?.length) text += `, except ${joinWords(rule.except.map((clause) => describeException(clause, topicName)))}`;
  if (rule.expires) text += `, until ${rule.expires.replace('T', ' ')}`;
  return `${text}.`;
}

export type ImpactExample = { description: string; before: Decision; after: Decision };

const WORD: Record<Decision, string> = { allow: 'shown', ask: 'needs your OK', hide: 'hidden' };

function collectTimes(rules: Rule[]): number[] {
  const times = new Set<number>([0, 720]);
  for (const rule of rules) {
    for (const time of [rule.when?.after, rule.when?.before]) {
      if (time) {
        const minute = parseTime(time);
        times.add(minute);
        times.add((minute + 1439) % 1440);
      }
    }
  }
  return [...times].sort((a, b) => a - b);
}

function candidates(rules: Rule[]): ContentRecord[] {
  const matches = rules.flatMap((rule) => [rule.content as ContentMatch, ...(rule.except ?? [])]);
  const topics = [...new Set(matches.flatMap((m) => m.topics ?? []))];
  const formats = [...new Set(matches.flatMap((m) => m.formats ?? []))];
  const features = [...new Set(matches.flatMap((m) => m.features ?? []))];
  const ratings = [...new Set(matches.flatMap((m) => (m.min_rating_age === undefined ? [] : [m.min_rating_age, Math.max(0, m.min_rating_age - 1)])))];

  const topicSets: (string[] | undefined)[] = [undefined, [], ...topics.map(withParents)];
  const formatSets: (string | undefined)[] = [undefined, ...formats];
  const featureSets: (string[] | undefined)[] = [undefined, [], ...features.map((f) => [f])];
  const ratingSets: (number | undefined)[] = [undefined, ...ratings];

  const records: ContentRecord[] = [];
  for (const t of topicSets) {
    for (const format of formatSets) {
      for (const feature of featureSets) {
        for (const rating of ratingSets) {
          for (const trusted of [false, true]) {
            const record: ContentRecord = { content_id: 'example', trusted };
            if (t) record.topics = t;
            if (format) record.format = format;
            if (feature) record.features = feature;
            if (rating !== undefined) record.rating_age = rating;
            records.push(record);
          }
        }
      }
    }
  }
  return records;
}

function describeRecord(record: ContentRecord, vocabulary: PolicyDocument['vocabulary']): string {
  const parts: string[] = [];
  if (record.topics === undefined) parts.push('content with no topic label');
  else if (record.topics.length === 0) parts.push('content with no matching topic');
  else parts.push(vocabulary.topics[record.topics[record.topics.length - 1]] ?? record.topics[record.topics.length - 1]);
  if (record.format) parts.push(`(${record.format})`);
  if (record.rating_age !== undefined) parts.push(`rated ${record.rating_age}+`);
  if (record.features?.length) parts.push(`with ${record.features.join(', ').replaceAll('_', ' ')}`);
  return parts.join(' ');
}

// Compares two policies on every combination of the terms they mention, at
// every time boundary on every day, and reports real differences.
export function impactExamples(before: PolicyDocument, after: PolicyDocument, limit = 6): { examples: ImpactExample[]; changed: boolean } {
  const rules = [...before.rules, ...after.rules];
  const records = candidates(rules);
  const times = collectTimes(rules);
  const seen = new Set<string>();
  const examples: ImpactExample[] = [];
  let changed = false;

  for (const record of records) {
    for (let day = 0; day < 7; day += 1) {
      for (const minute of times) {
        const context: DecisionContext = { minute, day, prev_day: (day + 6) % 7, now: 0 };
        const was = referenceDecision(before, record, context);
        const now = referenceDecision(after, record, context);
        if (was === now) continue;
        changed = true;
        const description = `${describeRecord(record, after.vocabulary)} at ${formatTime(minute)} on ${DAY_NAMES[DAYS[day]]}: ${WORD[was]} → ${WORD[now]}`;
        const key = `${describeRecord(record, after.vocabulary)}|${was}|${now}`;
        if (!seen.has(key) && examples.length < limit) {
          seen.add(key);
          examples.push({ description, before: was, after: now });
        }
      }
    }
  }

  return { examples, changed };
}

// Things a parent may not expect, in plain words.
export function notesFor(rules: Rule[], policy: Pick<PolicyDocument, 'vocabulary' | 'age_band'>): string[] {
  const notes: string[] = [];
  const name = (topic: string) => policy.vocabulary.topics[topic] ?? topic;

  for (const rule of rules) {
    if (rule.layer === 'family' && rule.content.topics && rule.on_unknown === 'allow') {
      notes.push(`Items with no topic label are not covered by "${rule.content.topics.map(name).join(', ')}" unless you say so.`);
    }
    if (rule.except?.some((clause) => Object.keys(clause).some((key) => key !== 'content_ids' && key !== 'until'))) {
      notes.push('Exceptions only work on labels signed by a trusted labeller.');
    }
  }

  const topicRules = rules.filter((rule) => rule.content.topics && rule.when);
  for (let i = 0; i < topicRules.length; i += 1) {
    for (let j = i + 1; j < topicRules.length; j += 1) {
      const [a, b] = [topicRules[i], topicRules[j]];
      if (a.when?.after === b.when?.before && a.when?.before === b.when?.after && a.when?.after) {
        notes.push(`An item labelled both ${name(a.content.topics![0])} and ${name(b.content.topics![0])} will be hidden all day.`);
      }
    }
  }

  return [...new Set(notes)];
}
