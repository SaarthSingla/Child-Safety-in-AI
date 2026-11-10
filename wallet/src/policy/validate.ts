// Generated from policy/src by `npm run sync` in policy/. Do not edit here.
import { DAYS, type PolicyDocument, type Rule } from './types';
import { isTopic, type Vocabulary } from './vocabulary';

export type Issue = { path: string; message: string };

const TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[a-z0-9_]{1,40}$/;

const MATCH_FIELDS = ['topics', 'formats', 'features', 'min_rating_age', 'live'];
const FORM_FIELDS = ['effect', 'content', 'when', 'except', 'expires', 'include_unlabelled', 'explanation'];
const RULE_FIELDS = [...FORM_FIELDS, 'id', 'layer', 'instruction_id', 'on_unknown', 'author', 'source_text'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function unknownKeys(value: Record<string, unknown>, allowed: string[], path: string, issues: Issue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push({ path: `${path}.${key}`, message: 'unknown field' });
  }
}

function termList(value: unknown, path: string, known: (term: string) => boolean, issues: Issue[]): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    issues.push({ path, message: 'must be a list of 1 to 20 terms' });
    return;
  }
  for (const term of value) {
    if (typeof term !== 'string' || !known(term)) issues.push({ path, message: `unknown term: ${String(term)}` });
  }
}

function checkMatch(match: Record<string, unknown>, path: string, vocabulary: Vocabulary, issues: Issue[]): void {
  if (match.topics !== undefined) termList(match.topics, `${path}.topics`, (t) => isTopic(vocabulary, t), issues);
  if (match.formats !== undefined) termList(match.formats, `${path}.formats`, (t) => vocabulary.formats.includes(t), issues);
  if (match.features !== undefined) termList(match.features, `${path}.features`, (t) => vocabulary.features.includes(t), issues);
  if (match.min_rating_age !== undefined && (!Number.isInteger(match.min_rating_age) || (match.min_rating_age as number) < 0 || (match.min_rating_age as number) > 21)) {
    issues.push({ path: `${path}.min_rating_age`, message: 'must be a whole number from 0 to 21' });
  }
  if (match.live !== undefined && typeof match.live !== 'boolean') {
    issues.push({ path: `${path}.live`, message: 'must be true or false' });
  }
}

function checkExceptions(value: unknown, path: string, vocabulary: Vocabulary, issues: Issue[]): void {
  if (!Array.isArray(value) || value.length > 200) {
    issues.push({ path, message: 'must be a list' });
    return;
  }
  value.forEach((clause, index) => {
    const at = `${path}[${index}]`;
    if (!isRecord(clause)) {
      issues.push({ path: at, message: 'must be an object' });
      return;
    }
    unknownKeys(clause, [...MATCH_FIELDS, 'content_ids', 'until'], at, issues);
    checkMatch(clause, at, vocabulary, issues);
    const matches = MATCH_FIELDS.some((field) => clause[field] !== undefined) || clause.content_ids !== undefined;
    if (!matches) issues.push({ path: at, message: 'an exception must say what it covers' });
    const ids = clause.content_ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200))) {
      issues.push({ path: `${at}.content_ids`, message: 'must be a list of item ids' });
    }
    if (clause.until !== undefined && (typeof clause.until !== 'string' || !LOCAL.test(clause.until))) {
      issues.push({ path: `${at}.until`, message: 'must look like 2026-12-01T21:00' });
    }
  });
}

function checkWhen(when: unknown, path: string, issues: Issue[]): void {
  if (!isRecord(when)) {
    issues.push({ path, message: 'must be an object' });
    return;
  }
  unknownKeys(when, ['after', 'before', 'days'], path, issues);
  const { after, before, days } = when;
  if ((after === undefined) !== (before === undefined)) {
    issues.push({ path, message: 'a time window needs both a start and an end' });
  }
  if (after !== undefined || before !== undefined) {
    for (const [name, value] of [['after', after], ['before', before]] as const) {
      if (value !== undefined && (typeof value !== 'string' || !TIME.test(value))) {
        issues.push({ path: `${path}.${name}`, message: 'times must be on the quarter hour, such as 21:00 or 21:15' });
      }
    }
    if (after === before) issues.push({ path, message: 'a time window cannot start and end at the same time' });
  }
  if (days !== undefined) {
    if (!Array.isArray(days) || days.length === 0 || !days.every((day) => DAYS.includes(day))) {
      issues.push({ path: `${path}.days`, message: 'must be a list of days' });
    }
  }
}

export function validateRuleForm(form: unknown, vocabulary: Vocabulary, path = 'rule', fields = FORM_FIELDS): Issue[] {
  const issues: Issue[] = [];
  if (!isRecord(form)) return [{ path, message: 'must be an object' }];

  unknownKeys(form, fields, path, issues);
  if (form.effect !== 'hide' && form.effect !== 'ask') issues.push({ path: `${path}.effect`, message: 'must be hide or ask' });

  if (!isRecord(form.content)) {
    issues.push({ path: `${path}.content`, message: 'must be an object' });
  } else {
    unknownKeys(form.content, MATCH_FIELDS, `${path}.content`, issues);
    checkMatch(form.content, `${path}.content`, vocabulary, issues);
  }

  if (form.when !== undefined) checkWhen(form.when, `${path}.when`, issues);
  if (form.except !== undefined) checkExceptions(form.except, `${path}.except`, vocabulary, issues);
  if (form.expires !== undefined && (typeof form.expires !== 'string' || !LOCAL.test(form.expires))) {
    issues.push({ path: `${path}.expires`, message: 'must look like 2026-12-01T00:00' });
  }
  if (form.include_unlabelled !== undefined && typeof form.include_unlabelled !== 'boolean') {
    issues.push({ path: `${path}.include_unlabelled`, message: 'must be true or false' });
  }

  const explanation = form.explanation;
  if (!isRecord(explanation) || typeof explanation.child !== 'string' || typeof explanation.guardian !== 'string' || !explanation.child || !explanation.guardian || explanation.child.length > 200 || explanation.guardian.length > 300) {
    issues.push({ path: `${path}.explanation`, message: 'needs a short child and guardian sentence' });
  }

  // A rule with no content and no time would hide everything, always.
  if (isRecord(form.content) && Object.keys(form.content).length === 0 && form.when === undefined) {
    issues.push({ path, message: 'a rule must say what it covers or when it applies' });
  }

  return issues;
}

function checkRule(rule: Rule, index: number, vocabulary: Vocabulary, seen: Set<string>): Issue[] {
  const path = `rules[${index}]`;
  const issues = validateRuleForm(rule, vocabulary, path, RULE_FIELDS);

  if (typeof rule.id !== 'string' || !ID.test(rule.id)) issues.push({ path: `${path}.id`, message: 'bad id' });
  if (seen.has(rule.id)) issues.push({ path: `${path}.id`, message: 'duplicate id' });
  seen.add(rule.id);

  if (!['fixed', 'age', 'family'].includes(rule.layer)) issues.push({ path: `${path}.layer`, message: 'bad layer' });
  if (!['hide', 'ask', 'allow'].includes(rule.on_unknown)) issues.push({ path: `${path}.on_unknown`, message: 'bad value' });
  if (typeof rule.instruction_id !== 'string' || !rule.instruction_id) issues.push({ path: `${path}.instruction_id`, message: 'missing' });

  if (rule.layer === 'fixed') {
    if (rule.on_unknown === 'allow') issues.push({ path, message: 'fixed protections cannot allow unknown content' });
    if (rule.except?.length) issues.push({ path, message: 'fixed protections cannot have exceptions' });
    if (rule.expires) issues.push({ path, message: 'fixed protections cannot expire' });
  }

  return issues;
}

export function validatePolicy(policy: PolicyDocument): Issue[] {
  const issues: Issue[] = [];
  if (policy.schema !== 'nlpps.policy/1') issues.push({ path: 'schema', message: 'unknown schema' });
  if (!Number.isInteger(policy.version) || policy.version < 1) issues.push({ path: 'version', message: 'bad version' });
  if (!Array.isArray(policy.rules)) return [...issues, { path: 'rules', message: 'must be a list' }];
  const seen = new Set<string>();
  policy.rules.forEach((rule, index) => issues.push(...checkRule(rule, index, policy.vocabulary, seen)));
  if (!Array.isArray(policy.approved_items) || policy.approved_items.length > 500) {
    issues.push({ path: 'approved_items', message: 'must be a list of up to 500 items' });
  } else {
    policy.approved_items.forEach((item, index) => {
      const path = `approved_items[${index}]`;
      if (typeof item.content_id !== 'string' || !item.content_id || item.content_id.length > 200) issues.push({ path, message: 'bad item id' });
      if (item.until !== undefined && (typeof item.until !== 'string' || !LOCAL.test(item.until))) issues.push({ path, message: 'bad end time' });
    });
  }
  return issues;
}
