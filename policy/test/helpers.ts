import { baselineRules, DEFAULT_VOCABULARY, type AgeBand, type PolicyDocument, type Rule } from '../src/index';

export function policyOf(rules: Rule[], ageBand: AgeBand = '12_17'): PolicyDocument {
  return {
    schema: 'nlpps.policy/1',
    child_ref: 'child_test',
    version: 1,
    previous_hash: null,
    age_band: ageBand,
    timezone: 'Asia/Kolkata',
    vocabulary: DEFAULT_VOCABULARY,
    rules,
    approved_items: [],
    created_at: '2026-11-03T00:00:00.000Z',
  };
}

export function familyRule(id: string, fields: Partial<Rule>): Rule {
  return {
    id,
    layer: 'family',
    instruction_id: `ins_${id}`,
    effect: 'hide',
    content: {},
    on_unknown: 'allow',
    author: 'guardian:test',
    source_text: 'test',
    explanation: { child: 'Not now.', guardian: 'Test rule' },
    ...fields,
  };
}

export { baselineRules };
