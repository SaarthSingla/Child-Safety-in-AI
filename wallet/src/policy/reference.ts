// Generated from policy/src by `npm run sync` in policy/. Do not edit here.
import { DAYS, type ContentMatch, type ContentRecord, type Decision, type DecisionContext, type Exception, type PolicyDocument, type Rule } from './types';
import { localMinutes, parseTime } from './time';

// A plain description of what a policy means, written directly on the JSON.
// It does not share code with the generator. Tests compare the two, and the
// server uses it to find real examples of what a change will do.
type Truth = true | false | null;

function all(values: Truth[]): Truth {
  if (values.includes(false)) return false;
  return values.includes(null) ? null : true;
}

function any(values: Truth[]): Truth {
  if (values.includes(true)) return true;
  return values.includes(null) ? null : false;
}

const negate = (value: Truth): Truth => (value === null ? null : !value);

function matches(match: ContentMatch, record: ContentRecord): Truth {
  const checks: Truth[] = [];
  const overlap = (wanted: string[], have: string[] | undefined): Truth =>
    have === undefined ? null : wanted.some((term) => have.includes(term));

  if (match.topics) checks.push(overlap(match.topics, record.topics));
  if (match.features) checks.push(overlap(match.features, record.features));
  if (match.formats) checks.push(record.format === undefined ? null : match.formats.includes(record.format));
  if (match.min_rating_age !== undefined) checks.push(record.rating_age === undefined ? null : record.rating_age >= match.min_rating_age);
  if (match.live !== undefined) checks.push(record.live === undefined ? null : record.live === match.live);
  return all(checks);
}

function inWindow(rule: Rule, context: DecisionContext): boolean {
  const when = rule.when;
  if (!when) return true;
  const allowed = (day: number) => !when.days || when.days.includes(DAYS[day]);
  if (when.after === undefined || when.before === undefined) return allowed(context.day);

  const start = parseTime(when.after);
  const end = parseTime(when.before);
  if (start < end) return context.minute >= start && context.minute < end && allowed(context.day);
  return (context.minute >= start && allowed(context.day)) || (context.minute < end && allowed(context.prev_day));
}

function exceptionMatches(clause: Exception, record: ContentRecord, context: DecisionContext): Truth {
  const { content_ids: ids, until, ...match } = clause;
  const checks: Truth[] = [];
  if (Object.keys(match).length > 0) {
    checks.push(matches(match, record));
    checks.push(record.trusted);
  }
  if (ids) checks.push(ids.includes(record.content_id));
  if (until) checks.push(context.now < localMinutes(until));
  return all(checks);
}

const RANK: Record<Decision, number> = { allow: 0, ask: 1, hide: 2 };

function isApproved(policy: PolicyDocument, record: ContentRecord, context: DecisionContext): boolean {
  return policy.approved_items.some((item) => item.content_id === record.content_id && (!item.until || context.now < localMinutes(item.until)));
}

export function ruleOutcome(rule: Rule, record: ContentRecord, context: DecisionContext, approved = false): Decision {
  const active = !rule.expires || context.now < localMinutes(rule.expires);
  const excepted = any((rule.except ?? []).map((clause) => exceptionMatches(clause, record, context)));
  const truth = all([matches(rule.content, record), inWindow(rule, context), active, negate(excepted)]);
  if (truth === true) return rule.effect;
  return truth === null && !approved ? rule.on_unknown : 'allow';
}

export function referenceDecision(policy: PolicyDocument, record: ContentRecord, context: DecisionContext): Decision {
  let best: Decision = 'allow';
  const approved = isApproved(policy, record, context);
  for (const rule of policy.rules) {
    const outcome = ruleOutcome(rule, record, context, approved);
    if (RANK[outcome] > RANK[best]) best = outcome;
  }
  return best;
}
