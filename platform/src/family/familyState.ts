export type FamilyDecision = 'allow' | 'ask' | 'hide';

// What Footube knows about the reader's family rules. In memory only, and
// populated only from a curation result the verifier authenticated.
export type FamilyState =
  // Not checked yet (or the last check could not be verified).
  | { status: 'unknown' }
  // The wallet proved it has no guardian link: no family rules apply.
  | { status: 'none'; validUntilMs: number; checkedAtMs: number }
  | { status: 'active'; version: number; decisions: Map<string, FamilyDecision>; validUntilMs: number; checkedAtMs: number };

let state: FamilyState = { status: 'unknown' };

export function getFamilyState(): FamilyState {
  return state;
}

export function setFamilyState(next: FamilyState): void {
  state = next;
}

export function resetFamilyState(): void {
  state = { status: 'unknown' };
}

export type FamilyCheck =
  | { kind: 'no_rules' }
  | { kind: 'allowed' }
  | { kind: 'blocked'; decision: Exclude<FamilyDecision, 'allow'> }
  // Rules are active but the decision set has expired: refresh before use.
  | { kind: 'stale' };

export function familyCheck(articleId: string, nowMs: number = Date.now()): FamilyCheck {
  if (state.status !== 'active') return { kind: 'no_rules' };
  if (nowMs >= state.validUntilMs) return { kind: 'stale' };

  // An item the wallet did not decide on is treated as needing a guardian's
  // OK rather than silently allowed.
  const decision = state.decisions.get(articleId) ?? 'ask';
  return decision === 'allow' ? { kind: 'allowed' } : { kind: 'blocked', decision };
}
