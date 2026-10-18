import { ANY_CATEGORY, type PolicyDecision, type PolicyRule, type TimeWindow } from './types';

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minuteOfDay(hhmm: string): number | null {
  const match = HH_MM.exec(hhmm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function isValidTime(hhmm: string): boolean {
  return minuteOfDay(hhmm) !== null;
}

// A malformed window counts as "always", so a broken rule still blocks.
export function isWithinWindow(window: TimeWindow, now: Date): boolean {
  const start = minuteOfDay(window.after);
  const end = minuteOfDay(window.before);

  if (start === null || end === null || start === end) {
    return true;
  }

  const minute = now.getHours() * 60 + now.getMinutes();

  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

function categoryMatches(rule: PolicyRule, category: string | undefined): boolean {
  if (rule.category === ANY_CATEGORY) {
    return true;
  }

  const label = category?.trim().toLowerCase();

  // Unlabelled content could be anything, so every category rule applies.
  if (!label) {
    return true;
  }

  return rule.category.toLowerCase() === label;
}

// The wallet's second-factor check: the platform has already applied its own
// rules; this blocks content the guardian's policy forbids on this device.
export function evaluatePolicies(
  rules: readonly PolicyRule[],
  request: { category?: string; now: Date },
): PolicyDecision {
  for (const rule of rules) {
    if (rule.action !== 'BLOCK' || !categoryMatches(rule, request.category)) {
      continue;
    }

    const window = rule.condition?.time;

    if (window && !isWithinWindow(window, request.now)) {
      continue;
    }

    return { decision: 'BLOCK', rule };
  }

  return { decision: 'ALLOW' };
}

export function describeRule(rule: PolicyRule): string {
  const what = rule.category === ANY_CATEGORY ? 'All content' : rule.category;
  const window = rule.condition?.time;

  return window ? `${what}, ${window.after}–${window.before}` : `${what}, always`;
}
