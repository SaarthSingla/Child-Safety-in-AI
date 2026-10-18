import { sha256 } from '@noble/hashes/sha2.js';

import type { VerifierConfig } from './config';
import { jwkToPublicKey, verifyEs256 } from './es256';
import {
  base64urlToBytes,
  bytesToBase64url,
  decodeJsonSegment,
  isRecord,
} from './encoding';
import type { HolderJWK, VerificationFailureCode } from './types';

const MAX_PRESENTATION_LENGTH = 16 * 1024;
const EXPECTED_TYP = 'dc+sd-jwt';

type Failure = { ok: false; reason: VerificationFailureCode };

function failure(reason: VerificationFailureCode): Failure {
  return { ok: false, reason };
}

export type ParsedPresentation = {
  issuerJwt: string;
  disclosures: string[];
  // Empty string when the presentation carries no Key Binding JWT.
  keyBindingJwt: string;
  // Everything up to and including the last '~': the exact bytes the
  // Key Binding JWT's `sd_hash` must cover.
  sdJwtPart: string;
};

// Presentation format (SD-JWT with Key Binding):
//   <issuer JWT>~<disclosure>~...~<disclosure>~<KB-JWT>
export function parsePresentation(
  presentation: unknown,
): ParsedPresentation | null {
  if (
    typeof presentation !== 'string' ||
    presentation.length === 0 ||
    presentation.length > MAX_PRESENTATION_LENGTH
  ) {
    return null;
  }

  const parts = presentation.split('~');

  if (parts.length < 2) {
    return null;
  }

  const issuerJwt = parts[0];
  const keyBindingJwt = parts[parts.length - 1];
  const disclosures = parts.slice(1, -1);

  const jwtSegments = issuerJwt.split('.');

  if (jwtSegments.length !== 3 || jwtSegments.some((s) => s.length === 0)) {
    return null;
  }

  if (disclosures.some((d) => d.length === 0)) {
    return null;
  }

  return {
    issuerJwt,
    disclosures,
    keyBindingJwt,
    sdJwtPart: presentation.slice(0, presentation.lastIndexOf('~') + 1),
  };
}

export type VerifiedIssuerJwt = {
  ok: true;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
};

// Verifies the issuer's ES256 signature against the verifier's OWN trust
// anchor (config.trustedIssuerJwk). Nothing is taken from the credential to
// decide which key to trust.
export function verifyIssuerSignature(
  issuerJwt: string,
  config: VerifierConfig,
): VerifiedIssuerJwt | Failure {
  const [encodedHeader, encodedPayload, encodedSignature] =
    issuerJwt.split('.');

  let header: unknown;
  let payload: unknown;

  try {
    header = decodeJsonSegment(encodedHeader);
    payload = decodeJsonSegment(encodedPayload);
  } catch {
    return failure('malformed_presentation');
  }

  if (!isRecord(header) || !isRecord(payload)) {
    return failure('malformed_presentation');
  }

  // Checked before any signature work so a credential can never choose a
  // weaker or different algorithm.
  if (header.alg !== 'ES256') {
    return failure('issuer_signature_invalid');
  }

  let signature: Uint8Array;

  try {
    signature = base64urlToBytes(encodedSignature);
  } catch {
    return failure('issuer_signature_invalid');
  }

  const issuerKey = jwkToPublicKey(config.trustedIssuerJwk);

  if (
    !issuerKey ||
    !verifyEs256(signature, `${encodedHeader}.${encodedPayload}`, issuerKey)
  ) {
    return failure('issuer_signature_invalid');
  }

  return { ok: true, header, payload };
}

export function isTrustedIssuer(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  config: VerifierConfig,
): boolean {
  return (
    header.kid === config.trustedIssuerKid &&
    payload.iss === config.trustedIssuer
  );
}

export function isExpectedCredentialType(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  config: VerifierConfig,
): boolean {
  return (
    header.typ === EXPECTED_TYP &&
    payload.vct === config.expectedCredentialType
  );
}

export function checkValidityWindow(
  payload: Record<string, unknown>,
  nowSeconds: number,
  config: VerifierConfig,
): VerificationFailureCode | null {
  const { iat, exp, nbf } = payload;
  const skew = config.clockSkewSeconds;

  if (
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    !Number.isFinite(iat) ||
    !Number.isFinite(exp)
  ) {
    return 'malformed_presentation';
  }

  if (nbf !== undefined && (typeof nbf !== 'number' || !Number.isFinite(nbf))) {
    return 'malformed_presentation';
  }

  if (iat > nowSeconds + skew || (nbf !== undefined && nbf > nowSeconds + skew)) {
    return 'credential_not_yet_valid';
  }

  if (exp <= nowSeconds - skew) {
    return 'credential_expired';
  }

  return null;
}

export type VerifiedDisclosures = {
  ok: true;
  claims: Record<string, unknown>;
};

// Every presented disclosure must hash (SHA-256 over the exact base64url
// string, per SD-JWT) to a digest the issuer signed into `_sd`. The holder
// may withhold disclosures but can never add or alter one.
export function verifyDisclosures(
  payload: Record<string, unknown>,
  disclosures: string[],
): VerifiedDisclosures | Failure {
  if (payload._sd_alg !== 'sha-256') {
    return failure('disclosure_invalid');
  }

  const signedDigests = payload._sd;

  if (
    !Array.isArray(signedDigests) ||
    signedDigests.some((digest) => typeof digest !== 'string')
  ) {
    return failure('disclosure_invalid');
  }

  const allowedDigests = new Set<string>(signedDigests);
  const seenDigests = new Set<string>();
  const claims: Record<string, unknown> = Object.create(null);

  for (const disclosure of disclosures) {
    const digest = bytesToBase64url(
      sha256(new TextEncoder().encode(disclosure)),
    );

    if (!allowedDigests.has(digest) || seenDigests.has(digest)) {
      return failure('disclosure_invalid');
    }

    seenDigests.add(digest);

    let decoded: unknown;

    try {
      decoded = decodeJsonSegment(disclosure);
    } catch {
      return failure('disclosure_invalid');
    }

    if (!Array.isArray(decoded) || decoded.length !== 3) {
      return failure('disclosure_invalid');
    }

    const [salt, name, value] = decoded as unknown[];

    if (typeof salt !== 'string' || typeof name !== 'string') {
      return failure('disclosure_invalid');
    }

    if (
      name === '_sd' ||
      name === '...' ||
      Object.prototype.hasOwnProperty.call(claims, name) ||
      Object.prototype.hasOwnProperty.call(payload, name)
    ) {
      return failure('disclosure_invalid');
    }

    claims[name] = value;
  }

  return { ok: true, claims };
}

export type HolderKey = {
  ok: true;
  jwk: HolderJWK;
  publicKey: Uint8Array;
};

export function extractHolderKey(
  payload: Record<string, unknown>,
): HolderKey | Failure {
  const cnf = payload.cnf;

  if (!isRecord(cnf)) {
    return failure('no_holder_binding');
  }

  const publicKey = jwkToPublicKey(cnf.jwk);

  if (!publicKey || !isRecord(cnf.jwk)) {
    return failure('no_holder_binding');
  }

  return {
    ok: true,
    jwk: cnf.jwk as HolderJWK,
    publicKey,
  };
}
