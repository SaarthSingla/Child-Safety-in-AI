import { describe, expect, it } from 'vitest';

import { baselineRules, DEFAULT_VOCABULARY, generate, makeBundle, type PolicyDocument, type PolicyEnvelope, type Rule } from '@/policy';

import { cedarEntries, cedarText, jsonText } from '../source';

const gambling: Rule = {
  id: 'r1', layer: 'family', instruction_id: 'i', effect: 'hide', content: { topics: ['games/gambling', 'harm/gambling'] }, when: { after: '12:00', before: '16:00' },
  on_unknown: 'allow', author: 'g', source_text: 'no gambling from 12 to 4', explanation: { child: 'c', guardian: 'g' },
};

const policy: PolicyDocument = {
  schema: 'nlpps.policy/1', child_ref: 'c', version: 3, previous_hash: null, age_band: '12_17', timezone: 'Asia/Kolkata',
  vocabulary: DEFAULT_VOCABULARY, rules: [...baselineRules('12_17'), gambling], approved_items: [], created_at: 'now',
};

const bundle = makeBundle(policy, generate(policy));
const envelope: PolicyEnvelope = { schema: 'nlpps.envelope/1', bundle, bundle_hash: 'h', guardian: { kid: 'k', signature: 's' }, issued_at: 'i', expires_at: 'e' };

describe('policy source view', () => {
  it('shows only the Cedar generated from the chosen rule', () => {
    const entries = cedarEntries(bundle.compiled, gambling);
    expect(entries.map((e) => `${e.set}:${e.id}`)).toEqual(['hide:family__r1__match']);
    expect(entries[0].text).toContain('forbid');
    expect(entries[0].text).toContain('harm/gambling');
  });

  it('includes the unknown-label policy when the rule has one', () => {
    const harm = policy.rules.find((r) => r.id === 'harm')!;
    expect(cedarEntries(bundle.compiled, harm).map((e) => e.id)).toEqual(['fixed__harm__match', 'fixed__harm__unknown']);
  });

  it('shows every policy, base permits included, for the whole policy', () => {
    const all = cedarEntries(bundle.compiled);
    expect(all.length).toBe(Object.keys(bundle.compiled.hide).length + Object.keys(bundle.compiled.ask).length);
    expect(cedarText(all)).toContain('// hide set · base');
  });

  it('shows the rule, or the policy without signatures, as JSON', () => {
    expect(JSON.parse(jsonText(envelope, gambling))).toEqual(gambling);
    const whole = JSON.parse(jsonText(envelope));
    expect(whole.policy.version).toBe(3);
    expect(whole).not.toHaveProperty('guardian');
  });
});
