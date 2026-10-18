import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { VERIFIER_CONFIG, type VerifierConfig } from '../config';
import { base64urlToBytes, bytesToBase64url } from '../encoding';
import type { AgeRequirement, HolderJWK } from '../types';

export const NOW_MS = Date.UTC(2026, 8, 25, 12, 0, 0);
export const NOW_S = Math.floor(NOW_MS / 1000);

export type KeyPair = { secretKey: Uint8Array; jwk: HolderJWK };

export function generateKeyPair(): KeyPair {
  const secretKey = p256.utils.randomSecretKey();
  const publicKey = p256.getPublicKey(secretKey, false);

  return {
    secretKey,
    jwk: {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToBase64url(publicKey.slice(1, 33)),
      y: bytesToBase64url(publicKey.slice(33, 65)),
    },
  };
}

export function encodeJson(value: unknown): string {
  return bytesToBase64url(new TextEncoder().encode(JSON.stringify(value)));
}

export function decodeJson(segment: string): any {
  return JSON.parse(new TextDecoder().decode(base64urlToBytes(segment)));
}

function sign(secretKey: Uint8Array, signingInput: string): string {
  return bytesToBase64url(
    p256.sign(new TextEncoder().encode(signingInput), secretKey),
  );
}

export function digestOf(disclosure: string): string {
  return bytesToBase64url(sha256(new TextEncoder().encode(disclosure)));
}

export function makeDisclosure(name: string, value: unknown): string {
  const salt = bytesToBase64url(p256.utils.randomSecretKey().slice(0, 16));
  return encodeJson([salt, name, value]);
}

export function verifierConfigFor(issuer: KeyPair): VerifierConfig {
  return { ...VERIFIER_CONFIG, trustedIssuerJwk: issuer.jwk };
}

export type IssueOptions = {
  issuer: KeyPair;
  holder?: KeyPair | null;
  ageBand?: string;
  confidence?: number;
  iss?: string;
  kid?: string;
  vct?: string;
  typ?: string;
  alg?: string;
  iat?: number;
  exp?: number;
  sdAlg?: string;
  omitAgeBand?: boolean;
};

export type IssuedCredential = {
  // Full issuer-signed SD-JWT VC as the issuer hands it out: jwt~d~d~d~
  credential: string;
  issuerJwt: string;
  disclosures: Record<string, string>;
};

// Mirrors the real issuer's output shape: three selectively disclosable
// claims, SHA-256 digests in `_sd`, holder key in `cnf.jwk`, ES256.
export function issueCredential(options: IssueOptions): IssuedCredential {
  const disclosures: Record<string, string> = {};

  if (!options.omitAgeBand) {
    disclosures.age_band = makeDisclosure('age_band', options.ageBand ?? '18plus');
  }

  disclosures.prediction_confidence = makeDisclosure(
    'prediction_confidence',
    options.confidence ?? 0.91,
  );
  disclosures.assurance_method = makeDisclosure(
    'assurance_method',
    'facial_age_estimation',
  );

  const header = {
    alg: options.alg ?? 'ES256',
    typ: options.typ ?? 'dc+sd-jwt',
    kid: options.kid ?? VERIFIER_CONFIG.trustedIssuerKid,
  };

  const payload: Record<string, unknown> = {
    iss: options.iss ?? VERIFIER_CONFIG.trustedIssuer,
    iat: options.iat ?? NOW_S - 10,
    exp: options.exp ?? NOW_S + 3600,
    vct: options.vct ?? VERIFIER_CONFIG.expectedCredentialType,
    _sd: Object.values(disclosures).map(digestOf).sort(),
    _sd_alg: options.sdAlg ?? 'sha-256',
  };

  if (options.holder !== null) {
    payload.cnf = { jwk: (options.holder ?? generateKeyPair()).jwk };
  }

  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const issuerJwt = `${signingInput}.${sign(options.issuer.secretKey, signingInput)}`;

  return {
    credential: `${issuerJwt}~${Object.values(disclosures).join('~')}~`,
    issuerJwt,
    disclosures,
  };
}

export type PresentOptions = {
  holderSecretKey: Uint8Array;
  audience?: string;
  nonce?: string;
  iat?: number;
  disclose?: string[];
  typ?: string;
  alg?: string;
  // Overrides for building deliberately wrong proofs.
  sdHash?: string;
  omitKeyBinding?: boolean;
};

// Presentation = issuer JWT + selected disclosures + Key Binding JWT.
export function present(
  issued: IssuedCredential,
  options: PresentOptions,
): string {
  const names = options.disclose ?? ['age_band'];
  const selected = names.map((name) => issued.disclosures[name]);
  const sdJwtPart = `${[issued.issuerJwt, ...selected].join('~')}~`;

  if (options.omitKeyBinding) {
    return sdJwtPart;
  }

  const header = { typ: options.typ ?? 'kb+jwt', alg: options.alg ?? 'ES256' };
  const payload = {
    iat: options.iat ?? NOW_S,
    aud: options.audience ?? VERIFIER_CONFIG.verifierId,
    nonce: options.nonce ?? 'test-nonce',
    sd_hash:
      options.sdHash ?? bytesToBase64url(sha256(new TextEncoder().encode(sdJwtPart))),
  };

  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;

  return `${sdJwtPart}${signingInput}.${sign(options.holderSecretKey, signingInput)}`;
}

export function expectations(overrides: Partial<{
  nonce: string;
  audience: string;
  requirement: AgeRequirement;
  requestCreatedAtMs: number;
  nowMs: number;
}> = {}) {
  return {
    nonce: 'test-nonce',
    audience: VERIFIER_CONFIG.verifierId,
    requirement: '18plus' as AgeRequirement,
    requestCreatedAtMs: NOW_MS - 5_000,
    nowMs: NOW_MS,
    ...overrides,
  };
}

// Flips one character inside a base64url segment so it still decodes.
export function corruptSegment(segment: string): string {
  const flipped = segment[5] === 'A' ? 'B' : 'A';
  return segment.slice(0, 5) + flipped + segment.slice(6);
}
