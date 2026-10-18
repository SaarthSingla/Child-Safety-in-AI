import { describe, expect, it } from 'vitest';

import { evaluatePolicies, isWithinWindow } from '../evaluate';
import { POLICY_TEMPLATES } from '../templates';
import { ANY_CATEGORY, type PolicyRule } from '../types';

function rule(partial: Partial<PolicyRule>): PolicyRule {
  return {
    id: partial.id ?? 'r1',
    category: partial.category ?? 'World',
    action: 'BLOCK',
    condition: partial.condition,
    explanation: partial.explanation ?? 'test rule',
    createdAt: 0,
  };
}

// Local wall-clock time on a fixed day.
const at = (hh: number, mm = 0) => new Date(2026, 9, 7, hh, mm);

describe('evaluatePolicies', () => {
  it('allows everything when there are no rules', () => {
    expect(evaluatePolicies([], { category: 'World', now: at(12) })).toEqual({ decision: 'ALLOW' });
  });

  it('blocks a matching category, case-insensitively', () => {
    const r = rule({ category: 'World' });
    expect(evaluatePolicies([r], { category: 'world', now: at(12) })).toEqual({ decision: 'BLOCK', rule: r });
  });

  it('allows other categories', () => {
    expect(evaluatePolicies([rule({ category: 'World' })], { category: 'Health', now: at(12) })).toEqual({
      decision: 'ALLOW',
    });
  });

  it('applies an any-category rule to everything', () => {
    const r = rule({ category: ANY_CATEGORY });
    expect(evaluatePolicies([r], { category: 'Nature', now: at(12) }).decision).toBe('BLOCK');
  });

  it('treats unlabelled content as matching every category rule', () => {
    expect(evaluatePolicies([rule({ category: 'World' })], { now: at(12) }).decision).toBe('BLOCK');
    expect(evaluatePolicies([rule({ category: 'World' })], { category: '  ', now: at(12) }).decision).toBe('BLOCK');
  });

  it('only blocks inside the rule time window', () => {
    const r = rule({ category: 'Society', condition: { time: { after: '08:00', before: '15:00' } } });

    expect(evaluatePolicies([r], { category: 'Society', now: at(7, 59) }).decision).toBe('ALLOW');
    expect(evaluatePolicies([r], { category: 'Society', now: at(8) }).decision).toBe('BLOCK');
    expect(evaluatePolicies([r], { category: 'Society', now: at(14, 59) }).decision).toBe('BLOCK');
    expect(evaluatePolicies([r], { category: 'Society', now: at(15) }).decision).toBe('ALLOW');
  });

  it('handles a window that crosses midnight', () => {
    const bedtime = POLICY_TEMPLATES.find((t) => t.key === 'bedtime')!;
    const r = rule(bedtime.rule);

    expect(evaluatePolicies([r], { category: 'Health', now: at(20, 59) }).decision).toBe('ALLOW');
    expect(evaluatePolicies([r], { category: 'Health', now: at(21) }).decision).toBe('BLOCK');
    expect(evaluatePolicies([r], { category: 'Health', now: at(2) }).decision).toBe('BLOCK');
    expect(evaluatePolicies([r], { category: 'Health', now: at(6) }).decision).toBe('ALLOW');
  });

  it('returns the first matching rule so its explanation can be shown', () => {
    const first = rule({ id: 'a', category: ANY_CATEGORY, explanation: 'first' });
    const second = rule({ id: 'b', category: 'World', explanation: 'second' });
    expect(evaluatePolicies([first, second], { category: 'World', now: at(12) })).toEqual({
      decision: 'BLOCK',
      rule: first,
    });
  });
});

describe('isWithinWindow', () => {
  it('treats a malformed or zero-length window as always, so a broken rule still blocks', () => {
    expect(isWithinWindow({ after: '25:00', before: '06:00' }, at(12))).toBe(true);
    expect(isWithinWindow({ after: 'nine', before: '06:00' }, at(12))).toBe(true);
    expect(isWithinWindow({ after: '10:00', before: '10:00' }, at(3))).toBe(true);
  });
});
