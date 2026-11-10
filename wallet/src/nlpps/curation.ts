import { sha256 } from '@noble/hashes/sha2.js';

import { MAX_MANIFEST_ITEMS } from '@/config/nlppsConfig';
import {
  base64urlToBytes,
  bytesToBase64url,
  fillTopicsFromText,
  labelHash,
  normalizeRecord,
  verifyLabelBatch,
  type ContentRecord,
  type Decision,
  type ItemDecision,
  type LabelBatch,
  type RawRecord,
  type Vocabulary,
} from '@/policy';

export const CURATION_RESULT_SCHEMA = 'nlpps.curation/1';

// What a platform sends. `batch` is optional: without an approved labeller's
// signature the labels still count, but they can never unlock an exception.
export type Manifest = { items: Record<string, unknown>[]; batch?: LabelBatch };

export type CurationResult = {
  schema: typeof CURATION_RESULT_SCHEMA;
  request_id: string;
  // active: family rules applied. none: this wallet has no guardian link.
  status: 'active' | 'none';
  policy_version: number | null;
  // A receipt: which policy decided, on exactly which labels.
  policy_hash: string | null;
  manifest_hash: string;
  decisions: { content_id: string; decision: Decision }[];
  valid_until: string;
  evaluated_at: string;
};

export function decodeManifest(param: string | undefined): Manifest | null {
  if (!param) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64urlToBytes(param))) as Partial<Manifest>;
    if (!Array.isArray(parsed.items) || parsed.items.length === 0 || parsed.items.length > MAX_MANIFEST_ITEMS) return null;
    if (!parsed.items.every((item) => typeof item === 'object' && item !== null)) return null;
    return { items: parsed.items, batch: parsed.batch };
  } catch {
    return null;
  }
}

// Turns a platform's labels into standard records. Only labels covered by a
// valid signature from an approved labeller are marked as trusted.
export function toRecords(manifest: Manifest, vocabulary: Vocabulary): ContentRecord[] | null {
  const signed = manifest.batch && verifyLabelBatch(manifest.batch, vocabulary.labellers) ? new Set(manifest.batch.hashes) : null;

  const records = manifest.items.map((raw) => {
    const trusted = signed?.has(labelHash(raw)) ?? false;
    return normalizeRecord(fillTopicsFromText(raw as RawRecord), vocabulary, trusted);
  });

  return records.every((record): record is ContentRecord => record !== null) ? records : null;
}

export function resultFrom(input: {
  requestId: string;
  manifestParam: string;
  policy: { version: number; hash: string } | null;
  decisions: ItemDecision[];
  now: Date;
  validUntil: Date;
}): CurationResult {
  return {
    schema: CURATION_RESULT_SCHEMA,
    request_id: input.requestId,
    status: input.policy ? 'active' : 'none',
    policy_version: input.policy?.version ?? null,
    policy_hash: input.policy?.hash ?? null,
    manifest_hash: bytesToBase64url(sha256(new TextEncoder().encode(input.manifestParam))),
    // Only the decision for each item, never the reasons.
    decisions: input.decisions.map(({ content_id, decision }) => ({ content_id, decision })),
    valid_until: input.validUntil.toISOString(),
    evaluated_at: input.now.toISOString(),
  };
}

export function encodeResult(result: CurationResult): string {
  return bytesToBase64url(new TextEncoder().encode(JSON.stringify(result)));
}

// The phone's secure chip signs this, tying the decisions to the app's
// one-time code, so a changed result fails to verify.
export function boundNonce(nonce: string, resultParam: string): string {
  return bytesToBase64url(sha256(new TextEncoder().encode(`${nonce}.${resultParam}`)));
}
