import { contextAt, decideItems, isExpired, nextQuarterHour, trustedNow, type ContentRecord, type ItemDecision, type PolicyEnvelope, type PolicyEngine, type Vocabulary } from '@/policy';

import { toRecords, type Manifest } from './curation';
import { getLink, loadPolicy, type PolicyMeta } from './store';
import { syncIfDue } from './sync';

export type WalletDecision =
  // No guardian link: no family rules to apply.
  | { kind: 'no_policy'; record: ContentRecord | null }
  // Linked, but no trustworthy policy is available, so nothing is shared.
  | { kind: 'unavailable'; reason: string; record: ContentRecord | null }
  | { kind: 'decided'; result: ItemDecision; record: ContentRecord; message: string };

function messageFor(result: ItemDecision, envelope: PolicyEnvelope): string {
  const rules = envelope.bundle.policy.rules;
  const matched = result.reasons.find((reason) => reason.kind === 'match');
  if (matched) return rules.find((rule) => rule.id === matched.rule_id)?.explanation.child ?? 'A family rule applies.';
  return 'This hasn’t been checked yet, so a guardian needs to OK it first.';
}

export async function policyNow(now = new Date()): Promise<
  | { kind: 'none' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ready'; envelope: PolicyEnvelope; meta: PolicyMeta; vocabulary: Vocabulary; now: Date; expired: boolean }
> {
  syncIfDue().catch(() => undefined);
  const loaded = await loadPolicy();
  if (loaded.status === 'none') return { kind: 'none' };
  if (loaded.status === 'tampered') return { kind: 'unavailable', reason: loaded.reason };

  const trusted = trustedNow(now, loaded.meta.lastSignedTime);
  return { kind: 'ready', envelope: loaded.envelope, meta: loaded.meta, vocabulary: loaded.envelope.bundle.policy.vocabulary, now: trusted, expired: isExpired(loaded.envelope, trusted) };
}

export async function decideContent(engine: PolicyEngine, manifest: Manifest | null, fallbackId: string): Promise<WalletDecision> {
  const policy = await policyNow();
  if (policy.kind === 'none') return { kind: 'no_policy', record: null };
  if (policy.kind === 'unavailable') return { kind: 'unavailable', reason: policy.reason, record: null };

  const records = manifest ? toRecords(manifest, policy.vocabulary) : null;
  const record: ContentRecord = records?.[0] ?? { content_id: fallbackId, trusted: false };
  const { envelope } = policy;
  const [result] = await decideItems(engine, envelope.bundle.compiled, [record], contextAt(policy.now, envelope.bundle.policy.timezone), { expired: policy.expired });
  return { kind: 'decided', result, record, message: messageFor(result, envelope) };
}

export type CurationOutcome =
  | { kind: 'none'; now: Date; validUntil: Date }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'decided'; decisions: ItemDecision[]; policy: { version: number; hash: string }; now: Date; validUntil: Date };

export async function curateManifest(engine: PolicyEngine, manifest: Manifest): Promise<CurationOutcome> {
  const policy = await policyNow();
  const instant = new Date();
  if (policy.kind === 'none') return { kind: 'none', now: instant, validUntil: nextQuarterHour(instant) };
  if (policy.kind === 'unavailable') return { kind: 'unavailable', reason: policy.reason };

  const records = toRecords(manifest, policy.vocabulary);
  if (!records) return { kind: 'unavailable', reason: 'the list of items could not be read' };

  const { envelope, now, expired } = policy;
  const decisions = await decideItems(engine, envelope.bundle.compiled, records, contextAt(now, envelope.bundle.policy.timezone), { expired });

  return { kind: 'decided', decisions, policy: { version: envelope.bundle.policy.version, hash: envelope.bundle_hash }, now, validUntil: nextQuarterHour(now) };
}

export async function isLinked(): Promise<boolean> {
  return (await getLink()) !== null;
}
