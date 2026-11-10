// Generated from policy/src by `npm run sync` in policy/. Do not edit here.
import { DAYS, type ApprovedItem, type CompiledPolicy, type ContentMatch, type Day, type Exception, type PolicyDocument, type Rule, type TimeWindow } from './types';
import { localMinutes, parseTime } from './time';
import { validatePolicy } from './validate';

export const GENERATOR_VERSION = '1.0.0';

// Turns a validated policy into two sets of Cedar rules: one for "hide" and
// one for "ask". Cedar has no "unknown" value, so for each rule we write two
// conditions: "definitely true" and "definitely false". When neither holds, a
// label the rule needs is missing, and the rule's on_unknown setting decides.

type Formula =
  | { kind: 'and'; parts: Formula[] }
  | { kind: 'or'; parts: Formula[] }
  | { kind: 'not'; part: Formula }
  // Depends on a label that might be missing.
  | { kind: 'label'; field: string; test: string }
  // Always known: time and whether the labels are trusted.
  | { kind: 'known'; test: string };

const and = (...parts: Formula[]): Formula => ({ kind: 'and', parts });
const or = (...parts: Formula[]): Formula => ({ kind: 'or', parts });
const not = (part: Formula): Formula => ({ kind: 'not', part });
const known = (test: string): Formula => ({ kind: 'known', test });
const label = (field: string, test: string): Formula => ({ kind: 'label', field, test });

// Terms are checked against the vocabulary before they get here, and
// JSON.stringify escapes them, so no text can break out into Cedar code.
const list = (terms: readonly (string | number)[]): string => JSON.stringify(terms);

function contentFormula(match: ContentMatch): Formula {
  const parts: Formula[] = [];
  if (match.topics) parts.push(label('topics', `resource.topics.containsAny(${list(match.topics)})`));
  if (match.features) parts.push(label('features', `resource.features.containsAny(${list(match.features)})`));
  if (match.formats) parts.push(label('format', `${list(match.formats)}.contains(resource.format)`));
  if (match.min_rating_age !== undefined) parts.push(label('rating_age', `resource.rating_age >= ${match.min_rating_age}`));
  if (match.live !== undefined) parts.push(label('live', `resource.live == ${match.live}`));
  return and(...parts);
}

function dayNumbers(days: readonly Day[]): number[] {
  return days.map((day) => DAYS.indexOf(day));
}

function whenFormula(when: TimeWindow | undefined): Formula {
  if (!when) return and();

  const days = when.days ? list(dayNumbers(when.days)) : null;
  const on = (field: 'day' | 'prev_day') => (days ? ` && ${days}.contains(context.${field})` : '');

  if (when.after === undefined || when.before === undefined) {
    return days ? known(`${days}.contains(context.day)`) : and();
  }

  const start = parseTime(when.after);
  const end = parseTime(when.before);

  // A window crossing midnight belongs to the day it started, so 01:00 on
  // Monday counts as part of Sunday night.
  return start < end
    ? known(`(context.minute >= ${start} && context.minute < ${end}${on('day')})`)
    : known(`((context.minute >= ${start}${on('day')}) || (context.minute < ${end}${on('prev_day')}))`);
}

function exceptionFormula(clause: Exception): Formula {
  const parts: Formula[] = [];
  const { content_ids: ids, until, ...match } = clause;
  if (Object.keys(match).length > 0) {
    parts.push(contentFormula(match));
    // Anyone can add a label, so only signed labels can unlock an exception.
    parts.push(known('resource.trusted'));
  }
  if (ids) parts.push(known(`${list(ids)}.contains(resource.content_id)`));
  if (until) parts.push(known(`context.now < ${localMinutes(until)}`));
  return and(...parts);
}

function ruleFormula(rule: Rule): Formula {
  const parts = [contentFormula(rule.content), whenFormula(rule.when)];
  if (rule.expires) parts.push(known(`context.now < ${localMinutes(rule.expires)}`));
  if (rule.except?.length) parts.push(not(or(...rule.except.map(exceptionFormula))));
  return and(...parts);
}

function isTrue(formula: Formula): string {
  switch (formula.kind) {
    case 'label':
      return `(resource has ${formula.field} && ${formula.test})`;
    case 'known':
      return formula.test;
    case 'and':
      return formula.parts.length ? `(${formula.parts.map(isTrue).join(' && ')})` : 'true';
    case 'or':
      return formula.parts.length ? `(${formula.parts.map(isTrue).join(' || ')})` : 'false';
    case 'not':
      return isFalse(formula.part);
  }
}

function isFalse(formula: Formula): string {
  switch (formula.kind) {
    case 'label':
      return `(resource has ${formula.field} && !(${formula.test}))`;
    case 'known':
      return `!(${formula.test})`;
    case 'and':
      return formula.parts.length ? `(${formula.parts.map(isFalse).join(' || ')})` : 'false';
    case 'or':
      return formula.parts.length ? `(${formula.parts.map(isFalse).join(' && ')})` : 'true';
    case 'not':
      return isTrue(formula.part);
  }
}

function approvedFormula(items: readonly ApprovedItem[]): Formula {
  return or(
    ...items.map((item) => {
      const id = known(`${JSON.stringify(item.content_id)} == resource.content_id`);
      return item.until ? and(id, known(`context.now < ${localMinutes(item.until)}`)) : id;
    }),
  );
}

const forbid = (condition: string): string => `forbid(principal, action, resource) when { ${condition} };`;
const PERMIT_ALL = 'permit(principal, action, resource);';

// Rule ids in the output start with the layer, so the wallet can run only the
// fixed protections if a policy expires.
export function generate(policy: PolicyDocument): CompiledPolicy {
  const issues = validatePolicy(policy);
  if (issues.length > 0) {
    throw new Error(`invalid policy: ${issues[0].path}: ${issues[0].message}`);
  }

  const compiled: CompiledPolicy = { hide: { base: PERMIT_ALL }, ask: { base: PERMIT_ALL } };
  const approved = isTrue(approvedFormula(policy.approved_items));

  for (const rule of [...policy.rules].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const formula = ruleFormula(rule);
    const yes = isTrue(formula);
    compiled[rule.effect][`${rule.layer}__${rule.id}__match`] = forbid(yes);
    if (rule.on_unknown !== 'allow') {
      compiled[rule.on_unknown][`${rule.layer}__${rule.id}__unknown`] = forbid(`!${yes} && !${isFalse(formula)} && !${approved}`);
    }
  }

  return compiled;
}

// Which rule produced a Cedar policy id, and whether it fired on a real match
// or on a missing label.
export function reasonOf(policyId: string): { rule_id: string; kind: 'match' | 'unknown' } | null {
  const parts = policyId.split('__');
  return parts.length === 3 ? { rule_id: parts[1], kind: parts[2] === 'unknown' ? 'unknown' : 'match' } : null;
}

export function fixedOnly(policies: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(policies).filter(([id]) => id === 'base' || id.startsWith('fixed__')));
}

// Describes the shape of a content record to Cedar's validator.
export const CEDAR_SCHEMA = {
  '': {
    entityTypes: {
      Child: {},
      Content: {
        shape: {
          type: 'Record',
          attributes: {
            content_id: { type: 'String' },
            trusted: { type: 'Boolean' },
            topics: { type: 'Set', element: { type: 'String' }, required: false },
            features: { type: 'Set', element: { type: 'String' }, required: false },
            format: { type: 'String', required: false },
            rating_age: { type: 'Long', required: false },
            live: { type: 'Boolean', required: false },
          },
        },
      },
    },
    actions: {
      view: {
        appliesTo: {
          principalTypes: ['Child'],
          resourceTypes: ['Content'],
          context: {
            type: 'Record',
            attributes: { minute: { type: 'Long' }, day: { type: 'Long' }, prev_day: { type: 'Long' }, now: { type: 'Long' } },
          },
        },
      },
    },
  },
} as const;
