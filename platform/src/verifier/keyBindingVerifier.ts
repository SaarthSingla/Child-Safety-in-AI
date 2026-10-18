import { sha256 } from '@noble/hashes/sha2.js';

import type { VerifierConfig } from './config';
import { verifyEs256 } from './es256';
import {
  base64urlToBytes,
  bytesToBase64url,
  decodeJsonSegment,
  isRecord,
} from './encoding';
import type { VerificationFailureCode } from './types';

const KEY_BINDING_TYP = 'kb+jwt';

type Failure = { ok: false; reason: VerificationFailureCode };

export type ParsedKeyBinding = {
  ok: true;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
};

export function parseKeyBindingJwt(
  keyBindingJwt: string,
): ParsedKeyBinding | Failure {
  const segments = keyBindingJwt.split('.');

  if (segments.length !== 3 || segments.some((s) => s.length === 0)) {
    return { ok: false, reason: 'key_binding_malformed' };
  }

  try {
    const header = decodeJsonSegment(segments[0]);
    const payload = decodeJsonSegment(segments[1]);
    const signature = base64urlToBytes(segments[2]);

    if (!isRecord(header) || !isRecord(payload)) {
      return { ok: false, reason: 'key_binding_malformed' };
    }

    return {
      ok: true,
      header,
      payload,
      signingInput: `${segments[0]}.${segments[1]}`,
      signature,
    };
  } catch {
    return { ok: false, reason: 'key_binding_malformed' };
  }
}

export function checkKeyBindingHeader(
  header: Record<string, unknown>,
): VerificationFailureCode | null {
  if (header.alg !== 'ES256') {
    return 'key_binding_algorithm_invalid';
  }

  if (header.typ !== KEY_BINDING_TYP) {
    return 'key_binding_malformed';
  }

  return null;
}

// Proof of possession: the KB-JWT must be signed by the key the issuer bound
// the credential to (cnf.jwk), and its `sd_hash` must cover exactly the
// issuer JWT + disclosures that were presented, so the proof cannot be
// lifted onto a different presentation.
export function verifyHolderProof(
  keyBinding: ParsedKeyBinding,
  holderPublicKey: Uint8Array,
  sdJwtPart: string,
): VerificationFailureCode | null {
  if (
    !verifyEs256(keyBinding.signature, keyBinding.signingInput, holderPublicKey)
  ) {
    return 'holder_proof_invalid';
  }

  const expectedSdHash = bytesToBase64url(
    sha256(new TextEncoder().encode(sdJwtPart)),
  );

  if (keyBinding.payload.sd_hash !== expectedSdHash) {
    return 'sd_hash_mismatch';
  }

  return null;
}

// `expectedNonce` must come from the verifier's own record of the request
// it issued, never from the presentation.
export function checkKeyBindingNonce(
  payload: Record<string, unknown>,
  expectedNonce: string,
): VerificationFailureCode | null {
  if (
    expectedNonce.length === 0 ||
    typeof payload.nonce !== 'string' ||
    payload.nonce !== expectedNonce
  ) {
    return 'nonce_mismatch';
  }

  return null;
}

export function checkKeyBindingAudience(
  payload: Record<string, unknown>,
  expectedAudience: string,
): VerificationFailureCode | null {
  if (
    expectedAudience.length === 0 ||
    typeof payload.aud !== 'string' ||
    payload.aud !== expectedAudience
  ) {
    return 'audience_mismatch';
  }

  return null;
}

export function checkKeyBindingTime(
  payload: Record<string, unknown>,
  nowSeconds: number,
  requestCreatedAtSeconds: number,
  config: VerifierConfig,
): VerificationFailureCode | null {
  const iat = payload.iat;
  const skew = config.clockSkewSeconds;

  if (typeof iat !== 'number' || !Number.isFinite(iat)) {
    return 'key_binding_malformed';
  }

  if (iat > nowSeconds + skew) {
    return 'key_binding_not_yet_valid';
  }

  // Too old, or made before the verifier even issued this challenge.
  if (
    nowSeconds - iat > config.keyBindingMaxAgeSeconds + skew ||
    iat < requestCreatedAtSeconds - skew
  ) {
    return 'key_binding_expired';
  }

  return null;
}
