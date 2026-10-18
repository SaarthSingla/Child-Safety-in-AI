import { ANY_CATEGORY, type PolicyRule } from './types';

export type PolicyTemplate = {
  key: string;
  label: string;
  rule: Pick<PolicyRule, 'category' | 'condition' | 'explanation'>;
};

// Ready-made policies standing in for natural-language authoring.
export const POLICY_TEMPLATES: readonly PolicyTemplate[] = [
  {
    key: 'no-world-news',
    label: 'No war and world news',
    rule: { category: 'World', explanation: 'No war or world news on this device' },
  },
  {
    key: 'bedtime',
    label: 'Bedtime: nothing between 9 PM and 6 AM',
    rule: {
      category: ANY_CATEGORY,
      condition: { time: { after: '21:00', before: '06:00' } },
      explanation: 'Bedtime: no reading between 9 PM and 6 AM',
    },
  },
  {
    key: 'school-hours-society',
    label: 'No Society articles during school hours',
    rule: {
      category: 'Society',
      condition: { time: { after: '08:00', before: '15:00' } },
      explanation: 'No Society articles during school hours',
    },
  },
];
