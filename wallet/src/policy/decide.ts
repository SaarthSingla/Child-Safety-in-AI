// Generated from policy/src by `npm run sync` in policy/. Do not edit here.
import { fixedOnly, reasonOf } from './generate';
import type { CompiledPolicy, ContentRecord, Decision, DecisionContext, PolicyEngine } from './types';

export type Reason = { rule_id: string; kind: 'match' | 'unknown' };

export type ItemDecision = {
  content_id: string;
  decision: Decision;
  // Stays on the phone. Used for "why" and for asking a guardian.
  reasons: Reason[];
};

const readable = (reasons: string[]): Reason[] => reasons.map(reasonOf).filter((reason): reason is Reason => reason !== null);

// Runs the hide rules, then the ask rules. Any error counts as "ask", because
// Cedar skips a rule that fails and a skipped rule must never mean "allow".
export async function decideItems(
  engine: PolicyEngine,
  compiled: CompiledPolicy,
  records: readonly ContentRecord[],
  context: DecisionContext,
  options: { expired?: boolean } = {},
): Promise<ItemDecision[]> {
  const requests = records.map((record) => ({ record, context }));
  const expired = options.expired === true;

  let hide;
  let ask;
  try {
    hide = await engine.authorize(expired ? fixedOnly(compiled.hide) : compiled.hide, requests);
    ask = await engine.authorize(expired ? fixedOnly(compiled.ask) : compiled.ask, requests);
  } catch {
    return records.map((record) => ({ content_id: record.content_id, decision: 'ask', reasons: [] }));
  }

  return records.map((record, index) => {
    const blocked = hide[index];
    const asked = ask[index];

    if (!blocked || !asked || blocked.errors > 0 || asked.errors > 0) {
      return { content_id: record.content_id, decision: 'ask', reasons: [] };
    }

    const reasons = readable([...blocked.reasons, ...asked.reasons]);
    if (blocked.denied) return { content_id: record.content_id, decision: 'hide', reasons };
    if (asked.denied) return { content_id: record.content_id, decision: 'ask', reasons };

    // With only the fixed protections running, nothing can be called safe.
    return expired ? { content_id: record.content_id, decision: 'ask', reasons: [] } : { content_id: record.content_id, decision: 'allow', reasons: [] };
  });
}
