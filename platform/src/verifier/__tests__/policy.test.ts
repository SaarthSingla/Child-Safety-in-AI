import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({ getRandomBytesAsync: async () => new Uint8Array(16) }));

import {
  WALLET_APPROVAL_TTL_MS,
  clearVerifiedSession,
  decideArticleAccess,
  getVerifiedSession,
} from '@/content/authorization';
import { getArticleById } from '@/content/catalog';

import { registerRequest, resetChallengeStore } from '../challengeStore';
import { bytesToBase64url } from '../encoding';
import { userMessageForDenial } from '../messages';
import { buildWalletUrl } from '../presentation';
import { handlePresentationResponse } from '../responseHandler';
import type { AgeRequirement, VerificationRequest } from '../types';
import { NOW_MS, NOW_S, generateKeyPair, issueCredential, present, verifierConfigFor } from './testKit';

const issuer = generateKeyPair();
const holder = generateKeyPair();
const config = verifierConfigFor(issuer);

const war = getArticleById('life-under-siege')!; // 18+, World
const teen = getArticleById('sleep-screens-teen-brain')!; // 12+, Health
const otherTeen = getArticleById('spotting-cyberbullying')!; // 12+, Society
const open = getArticleById('how-bees-build-a-hive')!;

function newRequest(contentId: string, requirement: AgeRequirement): VerificationRequest {
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

function approve(request: VerificationRequest, ageBand: string) {
  const issued = issueCredential({ issuer, holder, ageBand });
  const presentation = present(issued, {
    holderSecretKey: holder.secretKey,
    nonce: request.nonce,
    audience: config.verifierId,
    iat: NOW_S,
  });

  return handlePresentationResponse(
    { requestId: request.requestId, presentation },
    { nowMs: NOW_MS, config },
  );
}

function policyBlock(request: VerificationRequest) {
  return handlePresentationResponse(
    { requestId: request.requestId, denied: true, denialReason: 'policy_blocked' },
    { nowMs: NOW_MS, config },
  );
}

beforeEach(() => {
  resetChallengeStore();
  clearVerifiedSession();
});

describe('wallet request carries the content label', () => {
  const base: VerificationRequest = {
    requestId: 'r',
    requestedAgeBand: '12plus',
    verifierId: 'did:example:footube',
    callbackUrl: 'footube://verify-callback',
    nonce: 'n',
    createdAt: 1,
    expiresAt: 2,
  };

  it('includes the category when given', () => {
    const url = new URL(buildWalletUrl({ ...base, contentCategory: 'Life skills' }));
    expect(url.searchParams.get('contentCategory')).toBe('Life skills');
  });

  it('omits it when absent', () => {
    expect(new URL(buildWalletUrl(base)).searchParams.has('contentCategory')).toBe(false);
  });
});

describe('scenario 1: app passes and the wallet allows', () => {
  it('opens the article the wallet approved', () => {
    expect(approve(newRequest(teen.id, '12plus'), '12_17').outcome.type).toBe('verified');
    expect(decideArticleAccess(teen, NOW_MS)).toEqual({ allowed: true });
  });

  it('does not let one approval open a different gated article', () => {
    approve(newRequest(teen.id, '12plus'), '12_17');
    expect(decideArticleAccess(otherTeen, NOW_MS)).toEqual({
      allowed: false,
      reason: 'wallet_approval_required',
    });
  });

  it('never needs the wallet for open content', () => {
    expect(decideArticleAccess(open, NOW_MS)).toEqual({ allowed: true });
  });

  it('expires the approval so time-based rules take effect', () => {
    approve(newRequest(teen.id, '12plus'), '12_17');
    expect(decideArticleAccess(teen, NOW_MS + WALLET_APPROVAL_TTL_MS - 1).allowed).toBe(true);
    expect(decideArticleAccess(teen, NOW_MS + WALLET_APPROVAL_TTL_MS)).toEqual({
      allowed: false,
      reason: 'wallet_approval_required',
    });
  });
});

describe('scenario 2: app passes but the wallet blocks', () => {
  it('keeps the article locked and reports a guardian policy', () => {
    const { outcome } = policyBlock(newRequest(war.id, '18plus'));

    expect(outcome).toEqual({ type: 'denied', reason: 'policy_blocked' });
    expect(getVerifiedSession()).toBeNull();
    expect(decideArticleAccess(war, NOW_MS).allowed).toBe(false);
    expect(userMessageForDenial('policy_blocked', '18plus')).toMatch(/guardian policy/i);
  });

  it('is not overridden by an earlier age proof for another article', () => {
    // An adult proves 18+ for one article; the platform's own check would
    // now pass for the war feature, but the wallet blocked that article.
    approve(newRequest(teen.id, '12plus'), '18plus');
    policyBlock(newRequest(war.id, '18plus'));

    expect(decideArticleAccess(war, NOW_MS)).toEqual({
      allowed: false,
      reason: 'wallet_approval_required',
    });
    expect(decideArticleAccess(teen, NOW_MS).allowed).toBe(true);
  });
});
