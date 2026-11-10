import * as Crypto from 'expo-crypto';

import { registerRequest } from './challengeStore';
import { VERIFIER_CONFIG } from './config';
import { bytesToBase64url } from './encoding';
import { encodeJson, type LabelManifest } from '@/family/labels';

import type { AgeRequirement, VerificationRequest } from './types';

export const WALLET_SCHEME = 'childsafewallet';
export const CALLBACK_URL = 'footube://verify-callback';

const REQUEST_TTL_MS = 5 * 60 * 1000;

async function randomToken(byteLength: number): Promise<string> {
  return bytesToBase64url(await Crypto.getRandomBytesAsync(byteLength));
}

function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join('&');
}

// Creates a fresh request with a cryptographically random id and nonce, and
// records it so the eventual response can be checked against what was asked.
export async function startVerification(
  contentId: string,
  requirement: AgeRequirement,
  labels?: LabelManifest,
): Promise<VerificationRequest> {
  const now = Date.now();

  const request: VerificationRequest = {
    requestId: await randomToken(16),
    requestedAgeBand: requirement,
    verifierId: VERIFIER_CONFIG.verifierId,
    callbackUrl: CALLBACK_URL,
    nonce: await randomToken(24),
    createdAt: now,
    expiresAt: now + REQUEST_TTL_MS,
    labels,
  };

  registerRequest(request, contentId);

  return request;
}

// Only the age requirement, the content's labels (so the wallet can apply the
// family's rules), the verifier's identity, a callback and the challenge go
// in the URL: no exact age, name, contact details or selfie.
export function buildWalletUrl(request: VerificationRequest): string {
  const query = toQueryString({
    requestId: request.requestId,
    requestedAgeBand: request.requestedAgeBand,
    verifierId: request.verifierId,
    callbackUrl: request.callbackUrl,
    nonce: request.nonce,
    createdAt: String(request.createdAt),
    expiresAt: String(request.expiresAt),
    ...(request.labels ? { labels: encodeJson(request.labels) } : {}),
  });

  return `${WALLET_SCHEME}://verify-request?${query}`;
}
