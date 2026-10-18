// Guardian policy rules, in the shape of a compiled CHAISE (NLPPS) policy
// object: a category, a condition, an action and a human explanation.
export type TimeWindow = {
  // Local time, 24-hour "HH:MM". A window may cross midnight (21:00-06:00).
  after: string;
  before: string;
};

export type PolicyRule = {
  id: string;
  // A content category label sent by the platform, or ANY_CATEGORY.
  category: string;
  action: 'BLOCK';
  condition?: { time?: TimeWindow };
  explanation: string;
  createdAt: number;
};

export type PolicyDecision =
  | { decision: 'ALLOW' }
  | { decision: 'BLOCK'; rule: PolicyRule };

export const ANY_CATEGORY = '*';

// Content labels the demo platform uses (CHAISE expects a shared label
// vocabulary from content certification; this is the demo's version).
export const CONTENT_CATEGORIES = [
  'World',
  'Society',
  'Health',
  'Life skills',
  'Science',
  'Technology',
  'Nature',
] as const;
