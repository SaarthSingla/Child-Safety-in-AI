import { sha256 } from '@noble/hashes/sha2.js';
import * as Crypto from 'expo-crypto';

import type { Article } from '@/content/catalog';
import { VERIFIER_CONFIG, type VerifierConfig } from '@/verifier/config';
import { base64urlToBytes, bytesToBase64url } from '@/verifier/encoding';
import { verifyHolderPresentation } from '@/verifier/verifyPresentation';

import { setFamilyState, type FamilyDecision } from './familyState';
import { encodeJson, manifestFor } from './labels';

export const CURATION_CALLBACK_URL = 'footube://curate-callback';
export const CURATION_RESULT_SCHEMA = 'nlpps.curation/1';
const REQUEST_TTL_MS = 5 * 60 * 1000;
// Decisions expire at the next quarter hour; never trust one for longer.
const MAX_VALIDITY_MS = 15 * 60 * 1000;

export type CurationRequest = {
  requestId: string;
  nonce: string;
  verifierId: string;
  callbackUrl: string;
  createdAt: number;
  expiresAt: number;
  contentIds: string[];
};

// Single-use challenges, like the age-verification store.
const pending = new Map<string, CurationRequest>();
const used = new Set<string>();

export function resetCurationStore(): void {
  pending.clear();
  used.clear();
}

export function registerCurationRequest(request: CurationRequest): void {
  pending.set(request.requestId, request);
}

async function randomToken(bytes: number): Promise<string> {
  return bytesToBase64url(await Crypto.getRandomBytesAsync(bytes));
}

export async function startCuration(articles: readonly Article[], nowMs: number = Date.now()): Promise<CurationRequest> {
  const request: CurationRequest = {
    requestId: await randomToken(16),
    nonce: await randomToken(24),
    verifierId: VERIFIER_CONFIG.verifierId,
    callbackUrl: CURATION_CALLBACK_URL,
    createdAt: nowMs,
    expiresAt: nowMs + REQUEST_TTL_MS,
    contentIds: articles.map((a) => a.id),
  };
  registerCurationRequest(request);
  return request;
}

export function buildCurationUrl(request: CurationRequest, articles: readonly Article[]): string {
  const params: Record<string, string> = {
    requestId: request.requestId,
    verifierId: request.verifierId,
    callbackUrl: request.callbackUrl,
    nonce: request.nonce,
    createdAt: String(request.createdAt),
    expiresAt: String(request.expiresAt),
    manifest: encodeJson(manifestFor(articles)),
  };
  return `childsafewallet://curate-request?${Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')}`;
}

// Must match the wallet: nonce' = base64url(SHA-256(nonce "." result)).
export function boundNonce(nonce: string, resultParam: string): string {
  return bytesToBase64url(sha256(new TextEncoder().encode(`${nonce}.${resultParam}`)));
}

export type CurationResponse = { requestId?: string; result?: string; presentation?: string; error?: string };

export type CurationOutcome =
  | { type: 'applied'; status: 'active' | 'none'; version: number | null; hidden: number }
  // Nothing changed: the response was declined, unverifiable or malformed.
  | { type: 'not_applied'; reason: string };

const DECISIONS: readonly FamilyDecision[] = ['allow', 'ask', 'hide'];

// The one place a wallet's curation answer becomes family state. Like the
// age verifier, it trusts only what the verifier can check against its own
// record of the challenge: an unverifiable answer changes nothing.
export function handleCurationResponse(
  response: CurationResponse,
  options: { nowMs?: number; config?: VerifierConfig } = {},
): CurationOutcome {
  const nowMs = options.nowMs ?? Date.now();
  const config = options.config ?? VERIFIER_CONFIG;
  const request = response.requestId ? pending.get(response.requestId) : undefined;

  if (!request) {
    return { type: 'not_applied', reason: response.requestId && used.has(response.requestId) ? 'request_replayed' : 'request_unknown' };
  }

  pending.delete(request.requestId);
  used.add(request.requestId);

  if (nowMs > request.expiresAt) return { type: 'not_applied', reason: 'request_expired' };
  if (response.error) return { type: 'not_applied', reason: `wallet: ${response.error.slice(0, 40)}` };
  if (!response.result || !response.presentation) return { type: 'not_applied', reason: 'no_result' };

  const proof = verifyHolderPresentation(
    response.presentation,
    {
      nonce: boundNonce(request.nonce, response.result),
      audience: config.verifierId,
      requestCreatedAtMs: request.createdAt,
      nowMs,
    },
    config,
  );

  if (!proof.verified) return { type: 'not_applied', reason: proof.reason ?? 'proof_invalid' };

  let result: {
    schema?: unknown;
    request_id?: unknown;
    status?: unknown;
    policy_version?: unknown;
    decisions?: unknown;
    valid_until?: unknown;
  };

  try {
    result = JSON.parse(new TextDecoder().decode(base64urlToBytes(response.result)));
  } catch {
    return { type: 'not_applied', reason: 'result_malformed' };
  }

  if (result.schema !== CURATION_RESULT_SCHEMA || result.request_id !== request.requestId) {
    return { type: 'not_applied', reason: 'result_mismatch' };
  }

  const validUntil = typeof result.valid_until === 'string' ? Date.parse(result.valid_until) : NaN;
  if (!Number.isFinite(validUntil) || validUntil <= nowMs) return { type: 'not_applied', reason: 'result_expired' };
  const validUntilMs = Math.min(validUntil, nowMs + MAX_VALIDITY_MS);

  if (result.status === 'none') {
    setFamilyState({ status: 'none', validUntilMs, checkedAtMs: nowMs });
    return { type: 'applied', status: 'none', version: null, hidden: 0 };
  }

  if (result.status !== 'active' || !Array.isArray(result.decisions) || typeof result.policy_version !== 'number') {
    return { type: 'not_applied', reason: 'result_malformed' };
  }

  const asked = new Set(request.contentIds);
  const decisions = new Map<string, FamilyDecision>();

  for (const entry of result.decisions as { content_id?: unknown; decision?: unknown }[]) {
    if (
      typeof entry?.content_id === 'string' &&
      asked.has(entry.content_id) &&
      DECISIONS.includes(entry.decision as FamilyDecision)
    ) {
      decisions.set(entry.content_id, entry.decision as FamilyDecision);
    }
  }

  setFamilyState({ status: 'active', version: result.policy_version, decisions, validUntilMs, checkedAtMs: nowMs });
  return {
    type: 'applied',
    status: 'active',
    version: result.policy_version,
    hidden: [...decisions.values()].filter((d) => d !== 'allow').length,
  };
}

export function buildAskGuardianUrl(article: Article): string {
  return `childsafewallet://ask-guardian?verifierId=${encodeURIComponent(VERIFIER_CONFIG.verifierId)}&labels=${encodeURIComponent(encodeJson(manifestFor([article])))}`;
}
