import { grantVerifiedSession, recordWalletApproval } from '@/content/authorization';

import {
  consumeRequest,
  isRequestExpired,
  recordOutcome,
} from './challengeStore';
import { VERIFIER_CONFIG, type VerifierConfig } from './config';
import type { DenialReason, VerificationOutcome } from './types';
import { verifyPresentation } from './verifyPresentation';

export type WalletResponse = {
  requestId: string;
  presentation?: string;
  denied?: boolean;
  // The wallet's free-text hint. Untrusted: it is whitelisted below and only
  // ever changes which message is shown.
  denialReason?: string;
};

export type HandledResponse = {
  outcome: VerificationOutcome;
  // Known only when the requestId matched a challenge this verifier issued.
  contentId?: string;
};

const DENIAL_REASONS: readonly DenialReason[] = [
  'user_denied',
  'no_credential',
  'credential_invalid',
  'age_requirement_not_met',
  'policy_blocked',
];

function toDenialReason(value: string | undefined): DenialReason {
  return DENIAL_REASONS.find((reason) => reason === value) ?? 'user_denied';
}

// The one place a wallet response becomes an access decision. The wallet's
// say-so is never trusted: the only route to `verified` is the verifier
// accepting the presentation against the verifier's OWN record of the
// challenge (nonce, audience, requirement, timing), never against anything
// in the URL.
export function handlePresentationResponse(
  response: WalletResponse,
  options: { nowMs?: number; config?: VerifierConfig } = {},
): HandledResponse {
  const nowMs = options.nowMs ?? Date.now();
  const config = options.config ?? VERIFIER_CONFIG;

  const consumed = consumeRequest(response.requestId);

  if (consumed.status === 'unknown') {
    return { outcome: { type: 'rejected', reason: 'request_unknown' } };
  }

  if (consumed.status === 'already_used') {
    return { outcome: { type: 'rejected', reason: 'request_replayed' } };
  }

  const { request, contentId } = consumed;

  const finish = (outcome: VerificationOutcome): HandledResponse => {
    recordOutcome(request.requestId, outcome);
    return { outcome, contentId };
  };

  if (response.denied) {
    return finish({
      type: 'denied',
      reason: toDenialReason(response.denialReason),
    });
  }

  if (isRequestExpired(request, nowMs)) {
    return finish({ type: 'rejected', reason: 'request_expired' });
  }

  if (!response.presentation) {
    return finish({ type: 'rejected', reason: 'no_presentation' });
  }

  const result = verifyPresentation(
    response.presentation,
    {
      nonce: request.nonce,
      audience: config.verifierId,
      requirement: request.requestedAgeBand,
      requestCreatedAtMs: request.createdAt,
      nowMs,
    },
    config,
  );

  if (!result.verified || !result.credential) {
    return finish({
      type: 'rejected',
      reason: result.reason ?? 'malformed_presentation',
    });
  }

  grantVerifiedSession(result.credential);
  // The wallet presented for this article only after its guardian policy
  // allowed it, so the approval covers this article and no other.
  recordWalletApproval(contentId, nowMs);

  return finish({ type: 'verified', credential: result.credential });
}
