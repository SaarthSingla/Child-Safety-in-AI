import type { VerificationOutcome, VerificationRequest } from './types';

// DEMO-ONLY, IN-MEMORY challenge state. It does not survive an app restart
// and is not shared across devices or instances. A production verifier
// needs durable, atomic single-use challenge storage.

type PendingEntry = {
  request: VerificationRequest;
  contentId: string;
};

export type ConsumeResult =
  | { status: 'consumed'; request: VerificationRequest; contentId: string }
  | { status: 'already_used' }
  | { status: 'unknown' };

const pending = new Map<string, PendingEntry>();
const used = new Set<string>();
const outcomes = new Map<string, VerificationOutcome>();

export function registerRequest(
  request: VerificationRequest,
  contentId: string,
): void {
  pending.set(request.requestId, { request, contentId });
}

// Single use: the first call for a requestId consumes the challenge, whatever
// the presentation turns out to contain. Any later call is a replay.
export function consumeRequest(requestId: string): ConsumeResult {
  const entry = pending.get(requestId);

  if (entry) {
    pending.delete(requestId);
    used.add(requestId);

    return {
      status: 'consumed',
      request: entry.request,
      contentId: entry.contentId,
    };
  }

  return used.has(requestId) ? { status: 'already_used' } : { status: 'unknown' };
}

// First outcome wins, so a replayed callback cannot overwrite a result the
// UI has not picked up yet.
export function recordOutcome(
  requestId: string,
  outcome: VerificationOutcome,
): void {
  if (!outcomes.has(requestId)) {
    outcomes.set(requestId, outcome);
  }
}

export function takeOutcome(requestId: string): VerificationOutcome | undefined {
  const outcome = outcomes.get(requestId);
  outcomes.delete(requestId);
  return outcome;
}

export function isRequestExpired(
  request: VerificationRequest,
  nowMs: number = Date.now(),
): boolean {
  return nowMs > request.expiresAt;
}

export function resetChallengeStore(): void {
  pending.clear();
  used.clear();
  outcomes.clear();
}
