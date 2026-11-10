// Generated from policy/src by `npm run sync` in policy/. Do not edit here.
import type { AgeBand, OnUnknown, Rule, RuleForm } from './types';

const YOUNG: readonly AgeBand[] = ['0_5', '6_11'];

// What to do when a label a rule needs is missing. This is decided here, not
// by the LLM, so a translation mistake cannot weaken it.
//
//   Serious harm and age limits:  hide for under 13s, ask for 13 to 17.
//   Family preferences:           allow, unless the parent said otherwise.
//
// Blocking every unlabelled item would make real feeds unusable.
export function onUnknownFor(layer: Rule['layer'], ageBand: AgeBand, form: Pick<RuleForm, 'include_unlabelled'>): OnUnknown {
  if (layer === 'family') return form.include_unlabelled ? 'ask' : 'allow';
  return YOUNG.includes(ageBand) ? 'hide' : 'ask';
}

const HIGHEST_RATING: Record<AgeBand, number | null> = { '0_5': 0, '6_11': 7, '12_17': 13, '18plus': null };

const system = (form: RuleForm, id: string, layer: 'fixed' | 'age', ageBand: AgeBand): Rule => ({
  ...form,
  id,
  layer,
  instruction_id: `system_${id}`,
  on_unknown: onUnknownFor(layer, ageBand, form),
  author: 'system',
  source_text: form.explanation.guardian,
});

// The rules every child starts with. Fixed protections cannot be removed,
// relaxed or given exceptions.
export function baselineRules(ageBand: AgeBand): Rule[] {
  if (ageBand === '18plus') return [];

  const rules: Rule[] = [
    system(
      {
        effect: 'hide',
        content: { topics: ['harm'] },
        explanation: { child: 'This content is not suitable for you.', guardian: 'Always hide self-harm, sexual, hateful, drug and gambling content' },
      },
      'harm',
      'fixed',
      ageBand,
    ),
    system(
      {
        effect: 'hide',
        content: { min_rating_age: 18 },
        explanation: { child: 'This is for adults.', guardian: 'Always hide content rated for adults' },
      },
      'adult',
      'fixed',
      ageBand,
    ),
  ];

  const limit = HIGHEST_RATING[ageBand];
  if (limit !== null) {
    rules.push(
      system(
        {
          effect: 'hide',
          content: { min_rating_age: limit + 1 },
          explanation: { child: 'This is rated for older children.', guardian: `Hide content rated above ${limit}+` },
        },
        'rating',
        'age',
        ageBand,
      ),
    );
  }

  return rules;
}
