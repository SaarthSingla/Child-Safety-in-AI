import type { Vocabulary } from './vocabulary';

export type AgeBand = '0_5' | '6_11' | '12_17' | '18plus';
export type Effect = 'hide' | 'ask';
export type OnUnknown = 'hide' | 'ask' | 'allow';
export type Decision = 'allow' | 'ask' | 'hide';
export type Layer = 'fixed' | 'age' | 'family';
export type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const DAYS: readonly Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const AGE_BANDS: readonly AgeBand[] = ['0_5', '6_11', '12_17', '18plus'];

// What a rule is about. All listed fields must match; any value within a
// field is enough.
export type ContentMatch = {
  topics?: string[];
  formats?: string[];
  features?: string[];
  min_rating_age?: number;
  live?: boolean;
};

export type TimeWindow = {
  // Local time, HH:MM, on quarter hours. A window may cross midnight.
  after?: string;
  before?: string;
  days?: Day[];
};

export type Exception = ContentMatch & {
  // Approved items, from "ask a guardian".
  content_ids?: string[];
  // Local time, YYYY-MM-DDTHH:MM. The exception stops applying at this moment.
  until?: string;
};

// The form the LLM fills in. It can only name fields and terms from the
// vocabulary, and it has no way to allow anything.
export type RuleForm = {
  effect: Effect;
  content: ContentMatch;
  when?: TimeWindow;
  except?: Exception[];
  // Local time, YYYY-MM-DDTHH:MM.
  expires?: string;
  // The parent said unlabelled content counts too.
  include_unlabelled?: boolean;
  explanation: { child: string; guardian: string };
};

export type Rule = RuleForm & {
  id: string;
  layer: Layer;
  instruction_id: string;
  // Set by code, never by the LLM.
  on_unknown: OnUnknown;
  author: string;
  source_text: string;
};

// A parent approved this item although its labels are missing. It only
// settles the "nobody checked" case: if the item is later labelled as
// something a rule blocks, the rule still applies.
export type ApprovedItem = { content_id: string; until?: string };

export type PolicyDocument = {
  schema: 'nlpps.policy/1';
  child_ref: string;
  version: number;
  previous_hash: string | null;
  age_band: AgeBand;
  timezone: string;
  vocabulary: Vocabulary;
  rules: Rule[];
  approved_items: ApprovedItem[];
  created_at: string;
};

// One standard description of a content item. A missing field means "nobody
// checked". An empty list means "checked, and nothing found".
export type ContentRecord = {
  content_id: string;
  // True only when an approved labeller signed these labels.
  trusted: boolean;
  title?: string;
  platform?: string;
  topics?: string[];
  features?: string[];
  format?: string;
  rating_age?: number;
  live?: boolean;
};

export type DecisionContext = {
  minute: number;
  day: number;
  prev_day: number;
  // Local wall-clock time as minutes since 1970.
  now: number;
};

export type CompiledPolicy = {
  hide: Record<string, string>;
  ask: Record<string, string>;
};

export type EngineRequest = { record: ContentRecord; context: DecisionContext };
export type EngineResult = { denied: boolean; reasons: string[]; errors: number };

// The thing that runs Cedar. Node on the server and in tests, a sealed
// WebView on the phone.
export type PolicyEngine = {
  authorize(policies: Record<string, string>, requests: EngineRequest[]): Promise<EngineResult[]>;
};
