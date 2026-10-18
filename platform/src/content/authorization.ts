import { satisfiesAgeRequirement } from '@/verifier/policy';
import type { VerifiedAgeCredential } from '@/verifier/types';

import { requirementFor, type Article } from './catalog';

// In-memory only. The single way to populate this is
// grantVerifiedSession(), which takes a VerifiedAgeCredential; that type is
// only ever produced by the verifier after every cryptographic check passed.
// There is deliberately no boolean "isAdult" flag anywhere.
let verifiedSession: VerifiedAgeCredential | null = null;

export function grantVerifiedSession(credential: VerifiedAgeCredential): void {
  verifiedSession = credential;
}

export function clearVerifiedSession(): void {
  verifiedSession = null;
  walletApprovals.clear();
}

// Per-article wallet approvals. The wallet checks the guardian's policy for
// each article, so one age proof does not unlock other articles. Bounded so
// a time-based guardian rule (e.g. bedtime) takes effect on open articles.
export const WALLET_APPROVAL_TTL_MS = 30 * 60 * 1000;

const walletApprovals = new Map<string, number>();

export function recordWalletApproval(contentId: string, nowMs: number = Date.now()): void {
  walletApprovals.set(contentId, nowMs + WALLET_APPROVAL_TTL_MS);
}

function hasWalletApproval(contentId: string, nowMs: number): boolean {
  const until = walletApprovals.get(contentId);
  return until !== undefined && nowMs < until;
}

export function getVerifiedSession(): VerifiedAgeCredential | null {
  return verifiedSession;
}

export type AccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | 'age_verification_required'
        | 'verification_expired'
        // Verified, but not to the level this article needs (e.g. a 12-17
        // credential against 18+ content).
        | 'insufficient_age_band'
        // Old enough, but the wallet has not approved this article yet.
        | 'wallet_approval_required';
    };

export function decideAccess(
  article: Article,
  session: VerifiedAgeCredential | null,
  nowMs: number = Date.now(),
): AccessDecision {
  const requirement = requirementFor(article);

  if (requirement === null) {
    return { allowed: true };
  }

  if (!session) {
    return { allowed: false, reason: 'age_verification_required' };
  }

  // The verified credential's own lifetime bounds how long access lasts.
  if (session.expiresAt * 1000 <= nowMs) {
    return { allowed: false, reason: 'verification_expired' };
  }

  if (!satisfiesAgeRequirement(session.ageBand, requirement)) {
    return { allowed: false, reason: 'insufficient_age_band' };
  }

  return { allowed: true };
}

// What the app enforces: the platform's own age check (decideAccess) and,
// for gated articles, the wallet's approval of this specific article.
export function decideArticleAccess(
  article: Article,
  nowMs: number = Date.now(),
): AccessDecision {
  const platform = decideAccess(article, verifiedSession, nowMs);

  if (!platform.allowed || requirementFor(article) === null) {
    return platform;
  }

  return hasWalletApproval(article.id, nowMs)
    ? { allowed: true }
    : { allowed: false, reason: 'wallet_approval_required' };
}
