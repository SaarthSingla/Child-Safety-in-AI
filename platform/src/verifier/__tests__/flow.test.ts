import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearVerifiedSession,
  decideAccess,
  getVerifiedSession,
  grantVerifiedSession,
} from '@/content/authorization';
import { getArticleById } from '@/content/catalog';

import { registerRequest, resetChallengeStore, takeOutcome } from '../challengeStore';
import { bytesToBase64url } from '../encoding';
import { handlePresentationResponse } from '../responseHandler';
import type { AgeRequirement, VerificationRequest } from '../types';
import {
  NOW_MS,
  NOW_S,
  decodeJson,
  encodeJson,
  generateKeyPair,
  issueCredential,
  present,
  verifierConfigFor,
} from './testKit';

const issuer = generateKeyPair();
const holder = generateKeyPair();
const config = verifierConfigFor(issuer);

// The 18+ war feature, a 12+ teen article, and an open article.
const war = getArticleById('life-under-siege')!;
const teen = getArticleById('sleep-screens-teen-brain')!;
const open = getArticleById('how-bees-build-a-hive')!;

function newRequest(
  contentId = war.id,
  requirement: AgeRequirement = '18plus',
): VerificationRequest {
  const request: VerificationRequest = {
    requestId: bytesToBase64url(crypto.getRandomValues(new Uint8Array(16))),
    requestedAgeBand: requirement,
    verifierId: config.verifierId,
    callbackUrl: 'footube://verify-callback',
    nonce: bytesToBase64url(crypto.getRandomValues(new Uint8Array(24))),
    createdAt: NOW_MS - 5_000,
    expiresAt: NOW_MS + 5 * 60 * 1000 - 5_000,
  };

  registerRequest(request, contentId);

  return request;
}

// What the wallet would send back for `request`.
function walletPresentation(
  request: VerificationRequest,
  options: { ageBand?: string; holderKey?: typeof holder } = {},
): string {
  const issued = issueCredential({ issuer, holder, ageBand: options.ageBand });

  return present(issued, {
    holderSecretKey: (options.holderKey ?? holder).secretKey,
    nonce: request.nonce,
    audience: config.verifierId,
    iat: NOW_S,
  });
}

function handle(response: Parameters<typeof handlePresentationResponse>[0], nowMs = NOW_MS) {
  return handlePresentationResponse(response, { nowMs, config });
}

const locked = () => decideAccess(war, getVerifiedSession(), NOW_MS);

beforeEach(() => {
  resetChallengeStore();
  clearVerifiedSession();
});

describe('ChildSafeTube -> wallet approval -> presentation -> verifier -> content', () => {
  it('unlocks 18+ content after a valid 18plus presentation', () => {
    const request = newRequest();

    expect(locked()).toEqual({ allowed: false, reason: 'age_verification_required' });

    const { outcome, contentId } = handle({
      requestId: request.requestId,
      presentation: walletPresentation(request),
    });

    expect(outcome.type).toBe('verified');
    expect(contentId).toBe(war.id);
    expect(locked()).toEqual({ allowed: true });

    // Handed to the UI exactly once.
    expect(takeOutcome(request.requestId)?.type).toBe('verified');
    expect(takeOutcome(request.requestId)).toBeUndefined();
  });

  it('keeps content locked when the wallet denies', () => {
    const request = newRequest();
    const { outcome } = handle({ requestId: request.requestId, denied: true });

    expect(outcome).toEqual({ type: 'denied', reason: 'user_denied' });
    expect(locked().allowed).toBe(false);
    expect(getVerifiedSession()).toBeNull();
  });

  it("uses the wallet's reason only to pick a message, and only from a whitelist", () => {
    const known = newRequest();
    expect(
      handle({ requestId: known.requestId, denied: true, denialReason: 'no_credential' }).outcome,
    ).toEqual({ type: 'denied', reason: 'no_credential' });

    const hostile = newRequest();
    expect(
      handle({
        requestId: hostile.requestId,
        denied: true,
        denialReason: '<script>alert(1)</script>',
      }).outcome,
    ).toEqual({ type: 'denied', reason: 'user_denied' });

    expect(locked().allowed).toBe(false);
  });

  it('cannot be unlocked by a wallet that claims denied=false with no proof', () => {
    const request = newRequest();
    const { outcome } = handle({ requestId: request.requestId });

    expect(outcome).toEqual({ type: 'rejected', reason: 'no_presentation' });
    expect(locked().allowed).toBe(false);
  });

  it('does not let a denial flag smuggle in acceptance', () => {
    const request = newRequest();
    const { outcome } = handle({
      requestId: request.requestId,
      denied: true,
      presentation: walletPresentation(request),
    });

    expect(outcome.type).toBe('denied');
    expect(locked().allowed).toBe(false);
  });

  it('keeps content locked for a tampered presentation', () => {
    const request = newRequest();
    const good = walletPresentation(request);
    const [jwt, ...rest] = good.split('~');
    const [h, p, s] = jwt.split('.');
    const payload = decodeJson(p);
    payload.vct = 'urn:other:type';

    const { outcome } = handle({
      requestId: request.requestId,
      presentation: [`${h}.${encodeJson(payload)}.${s}`, ...rest].join('~'),
    });

    expect(outcome).toEqual({ type: 'rejected', reason: 'issuer_signature_invalid' });
    expect(locked().allowed).toBe(false);
  });

  it('keeps content locked for a valid credential whose proof is from a different key', () => {
    const request = newRequest();
    const { outcome } = handle({
      requestId: request.requestId,
      presentation: walletPresentation(request, { holderKey: generateKeyPair() }),
    });

    expect(outcome).toEqual({ type: 'rejected', reason: 'holder_proof_invalid' });
    expect(locked().allowed).toBe(false);
  });

  it.each(['12_17', '6_11', '0_5'])('keeps 18+ content locked for a valid %s credential', (band) => {
    const request = newRequest();
    const { outcome } = handle({
      requestId: request.requestId,
      presentation: walletPresentation(request, { ageBand: band }),
    });

    expect(outcome).toEqual({ type: 'rejected', reason: 'age_requirement_not_met' });
    expect(locked().allowed).toBe(false);
  });
});

describe('challenge lifecycle and replay protection', () => {
  it('rejects a second presentation for the same challenge and keeps the first result', () => {
    const request = newRequest();
    const presentation = walletPresentation(request);

    expect(handle({ requestId: request.requestId, presentation }).outcome.type).toBe('verified');

    const replay = handle({ requestId: request.requestId, presentation });

    expect(replay.outcome).toEqual({ type: 'rejected', reason: 'request_replayed' });

    // The replay must not overwrite the first, still-unread outcome.
    expect(takeOutcome(request.requestId)?.type).toBe('verified');
  });

  it('consumes the challenge even when the first attempt fails', () => {
    const request = newRequest();
    const presentation = walletPresentation(request);

    expect(handle({ requestId: request.requestId, presentation: 'garbage' }).outcome.type).toBe('rejected');

    // The genuine presentation can no longer be used for this challenge.
    expect(handle({ requestId: request.requestId, presentation }).outcome).toEqual({
      type: 'rejected',
      reason: 'request_replayed',
    });
    expect(locked().allowed).toBe(false);
  });

  it('rejects a response for a challenge this verifier never issued', () => {
    const { outcome, contentId } = handle({
      requestId: 'never-issued',
      presentation: 'anything',
    });

    expect(outcome).toEqual({ type: 'rejected', reason: 'request_unknown' });
    expect(contentId).toBeUndefined();
  });

  it('rejects a response after the request expired', () => {
    const request = newRequest();
    const { outcome } = handle(
      { requestId: request.requestId, presentation: walletPresentation(request) },
      request.expiresAt + 1,
    );

    expect(outcome).toEqual({ type: 'rejected', reason: 'request_expired' });
    expect(locked().allowed).toBe(false);
  });

  it("rejects a presentation captured from another request's challenge", () => {
    const earlier = newRequest();
    const captured = walletPresentation(earlier);

    const later = newRequest();
    const { outcome } = handle({ requestId: later.requestId, presentation: captured });

    expect(outcome).toEqual({ type: 'rejected', reason: 'nonce_mismatch' });
    expect(locked().allowed).toBe(false);
  });
});

describe('age tiers: who can read what', () => {
  const session = (ageBand: string) => ({
    ageBand,
    issuer: config.trustedIssuer,
    vct: config.expectedCredentialType,
    expiresAt: NOW_S + 3600,
  });

  it('leaves open content readable without any check', () => {
    expect(decideAccess(open, null, NOW_MS)).toEqual({ allowed: true });
  });

  it('gates 12+ and 18+ content when nothing has been verified', () => {
    expect(decideAccess(teen, null, NOW_MS).allowed).toBe(false);
    expect(decideAccess(war, null, NOW_MS).allowed).toBe(false);
  });

  it('lets a verified 12-17 reader into 12+ content but not 18+ content', () => {
    expect(decideAccess(teen, session('12_17'), NOW_MS)).toEqual({ allowed: true });
    expect(decideAccess(war, session('12_17'), NOW_MS)).toEqual({
      allowed: false,
      reason: 'insufficient_age_band',
    });
  });

  it('lets a verified 18+ reader into everything', () => {
    for (const article of [open, teen, war]) {
      expect(decideAccess(article, session('18plus'), NOW_MS)).toEqual({ allowed: true });
    }
  });

  it.each(['6_11', '0_5'])('keeps a %s reader out of both restricted tiers', (band) => {
    expect(decideAccess(teen, session(band), NOW_MS).allowed).toBe(false);
    expect(decideAccess(war, session(band), NOW_MS).allowed).toBe(false);
    expect(decideAccess(open, session(band), NOW_MS).allowed).toBe(true);
  });

  it('stops honouring a verified session once the credential has expired', () => {
    expect(decideAccess(war, session('18plus'), NOW_MS)).toEqual({ allowed: true });
    expect(decideAccess(war, session('18plus'), (NOW_S + 3601) * 1000)).toEqual({
      allowed: false,
      reason: 'verification_expired',
    });
  });
});

describe('12+ articles end to end', () => {
  it('unlocks a 12+ article for a 12_17 credential, and only that article tier', () => {
    const request = newRequest(teen.id, '12plus');
    const { outcome } = handle({
      requestId: request.requestId,
      presentation: walletPresentation(request, { ageBand: '12_17' }),
    });

    expect(outcome.type).toBe('verified');
    expect(decideAccess(teen, getVerifiedSession(), NOW_MS).allowed).toBe(true);
    expect(decideAccess(war, getVerifiedSession(), NOW_MS).allowed).toBe(false);
  });

  it('unlocks a 12+ article for an 18plus credential', () => {
    const request = newRequest(teen.id, '12plus');
    const { outcome } = handle({
      requestId: request.requestId,
      presentation: walletPresentation(request, { ageBand: '18plus' }),
    });

    expect(outcome.type).toBe('verified');
    expect(decideAccess(war, getVerifiedSession(), NOW_MS).allowed).toBe(true);
  });

  it.each(['6_11', '0_5'])('rejects a valid %s credential for a 12+ article', (band) => {
    const request = newRequest(teen.id, '12plus');
    const { outcome } = handle({
      requestId: request.requestId,
      presentation: walletPresentation(request, { ageBand: band }),
    });

    expect(outcome).toEqual({ type: 'rejected', reason: 'age_requirement_not_met' });
    expect(decideAccess(teen, getVerifiedSession(), NOW_MS).allowed).toBe(false);
  });

  it('cannot use a presentation made for a 12+ request to open 18+ content', () => {
    // The verifier records the requirement per request; a 12_17 credential
    // presented against an 18+ request is refused.
    const request = newRequest(war.id, '18plus');
    const { outcome } = handle({
      requestId: request.requestId,
      presentation: walletPresentation(request, { ageBand: '12_17' }),
    });

    expect(outcome).toEqual({ type: 'rejected', reason: 'age_requirement_not_met' });
    expect(decideAccess(war, getVerifiedSession(), NOW_MS).allowed).toBe(false);
  });
});
