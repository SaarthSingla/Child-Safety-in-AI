import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

export type HolderJWK = {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
};

export type ParsedCredential = {
  ageBand: string;
  predictionConfidence?: number;
  assuranceMethod?: string;
  issuer?: string;
  vct?: string;
  issuedAt?: number;
  expiresAt?: number;
};

export type VerificationResult = {
  verified: boolean;
  issuerSignatureValid: boolean;
  trustedIssuer: boolean;
  credentialTypeValid: boolean;
  timeValid: boolean;
  disclosuresValid: boolean;
  holderBindingValid: boolean;
  reason?: string;
};

export const TRUSTED_ISSUER =
  'https://issuer.childsafe.demo';

export const EXPECTED_VCT =
  'urn:childsafe:age-credential:v1';

const EXPECTED_TYP = 'dc+sd-jwt';

const EXPECTED_KID =
  'https://issuer.childsafe.demo#dev-es256';

const TRUSTED_ISSUER_JWK: HolderJWK = {
  kty: 'EC',
  crv: 'P-256',
  x: '4VlTlYrZ6xcCUGaiJDHTgIrajlh0kV1_A42zTtIVxms',
  y: 'z_gPX-4vwIk2-DNQgOA5ijBKT5zMSogEEGkUer_d9Pc',
} as const;

const CLOCK_SKEW_SECONDS = 60;

function base64urlToBytes(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const padded =
    normalized +
    '='.repeat((4 - (normalized.length % 4)) % 4);

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function base64urlDecode(value: string): string {
  return new TextDecoder().decode(
    base64urlToBytes(value),
  );
}

function decodeJson(
  value: string,
): Record<string, any> {
  return JSON.parse(base64urlDecode(value));
}

function bytesToBase64url(
  bytes: Uint8Array,
): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function jwkToPublicKey(
  jwk: HolderJWK,
): Uint8Array {
  const x = base64urlToBytes(jwk.x);
  const y = base64urlToBytes(jwk.y);

  if (x.length !== 32 || y.length !== 32) {
    throw new Error(
      'Invalid P-256 JWK coordinates',
    );
  }

  const publicKey = new Uint8Array(65);

  publicKey[0] = 0x04;

  publicKey.set(x, 1);
  publicKey.set(y, 33);

  return publicKey;
}

function sameHolderJwk(
  a: HolderJWK,
  b: HolderJWK,
): boolean {
  return (
    a.kty === b.kty &&
    a.crv === b.crv &&
    a.x === b.x &&
    a.y === b.y
  );
}

export function parseSdJwtCredential(
  credential: string,
): ParsedCredential {
  if (
    !credential ||
    typeof credential !== 'string'
  ) {
    throw new Error('Invalid credential');
  }

  const parts = credential.split('~');

  if (parts.length < 2) {
    throw new Error(
      'Invalid SD-JWT credential format',
    );
  }

  const jwt = parts[0];
  const jwtParts = jwt.split('.');

  if (jwtParts.length !== 3) {
    throw new Error(
      'Invalid JWT inside SD-JWT credential',
    );
  }

  const payload = decodeJson(jwtParts[1]);

  const disclosures = parts.slice(1, -1);

  let ageBand: string | undefined;
  let predictionConfidence:
    | number
    | undefined;
  let assuranceMethod:
    | string
    | undefined;

  for (const disclosure of disclosures) {
    if (!disclosure) continue;

    try {
      const decoded = decodeJson(disclosure);

      if (
        Array.isArray(decoded) &&
        decoded.length >= 3
      ) {
        const claimName = decoded[1];
        const claimValue = decoded[2];

        if (claimName === 'age_band') {
          ageBand = claimValue;
        }

        if (
          claimName ===
          'prediction_confidence'
        ) {
          predictionConfidence =
            Number(claimValue);
        }

        if (
          claimName ===
          'assurance_method'
        ) {
          assuranceMethod = claimValue;
        }
      }
    } catch {
      // Parsing continues; cryptographic
      // verification handles integrity.
    }
  }

  if (!ageBand) {
    throw new Error(
      'Credential does not contain an age_band disclosure',
    );
  }

  return {
    ageBand,
    predictionConfidence,
    assuranceMethod,
    issuer: payload.iss,
    vct: payload.vct,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

export function verifySdJwtCredential(
  credential: string,
  holderPublicJwk: HolderJWK,
): VerificationResult {
  try {
    if (
      !credential ||
      typeof credential !== 'string'
    ) {
      throw new Error('Invalid credential');
    }

    const parts = credential.split('~');

    if (parts.length < 2) {
      throw new Error(
        'Invalid SD-JWT format',
      );
    }

    const issuerJwt = parts[0];
    const jwtParts = issuerJwt.split('.');

    if (jwtParts.length !== 3) {
      throw new Error(
        'Invalid issuer JWT',
      );
    }

    const header = decodeJson(jwtParts[0]);
    const payload = decodeJson(jwtParts[1]);

    /*
     * 1. JOSE header validation
     */

    if (header.typ !== EXPECTED_TYP) {
      throw new Error(
        'Invalid credential type header',
      );
    }

    if (header.alg !== 'ES256') {
      throw new Error(
        `Unsupported signature algorithm: ${header.alg}`,
      );
    }

    if (header.kid !== EXPECTED_KID) {
      throw new Error(
        'Untrusted issuer key identifier',
      );
    }

    /*
     * 2. Trusted issuer
     */

    if (payload.iss !== TRUSTED_ISSUER) {
      throw new Error(
        'Credential issuer is not trusted',
      );
    }

    /*
     * 3. Credential type
     */

    if (payload.vct !== EXPECTED_VCT) {
      throw new Error(
        'Credential type is not trusted',
      );
    }

    /*
     * 4. Verify issuer ES256 signature
     *
     * JWS signing input:
     *
     * BASE64URL(header) + "." +
     * BASE64URL(payload)
     *
     * ES256 signature is the compact
     * R || S representation (64 bytes).
     *
     * noble-curves v2 hashes the message
     * internally for p256.verify().
     */

    const signingInput =
      new TextEncoder().encode(
        `${jwtParts[0]}.${jwtParts[1]}`,
      );

    const signature =
      base64urlToBytes(jwtParts[2]);

    if (signature.length !== 64) {
      throw new Error(
        'Invalid ES256 signature length',
      );
    }

    const issuerPublicKey =
      jwkToPublicKey(
        TRUSTED_ISSUER_JWK,
      );

    const signatureValid = p256.verify(
      signature,
      signingInput,
      issuerPublicKey,
      { lowS: false },
    );

    if (!signatureValid) {
      throw new Error(
        'Issuer signature verification failed',
      );
    }

    /*
     * 5. Time validity
     */

    const now = Math.floor(
      Date.now() / 1000,
    );

    if (
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error(
        'Credential is missing iat or exp',
      );
    }

    if (
      payload.iat >
      now + CLOCK_SKEW_SECONDS
    ) {
      throw new Error(
        'Credential issued in the future',
      );
    }

    if (
      payload.exp <=
      now - CLOCK_SKEW_SECONDS
    ) {
      throw new Error(
        'Credential has expired',
      );
    }

    /*
     * 6. Holder binding
     */

    const credentialHolder =
      payload.cnf?.jwk;

    if (!credentialHolder) {
      throw new Error(
        'Credential has no holder binding',
      );
    }

    if (
      !sameHolderJwk(
        credentialHolder,
        holderPublicJwk,
      )
    ) {
      throw new Error(
        'Credential holder binding does not match wallet key',
      );
    }

    /*
     * 7. SD-JWT disclosure integrity
     *
     * IMPORTANT:
     * The hash input is the original
     * base64url-encoded disclosure string,
     * not the decoded JSON.
     */

    if (
      payload._sd_alg !== 'sha-256'
    ) {
      throw new Error(
        'Unsupported SD-JWT hash algorithm',
      );
    }

    const disclosures =
      parts.slice(1, -1);

    const sdHashes: string[] =
      Array.isArray(payload._sd)
        ? payload._sd
        : [];

    for (const disclosure of disclosures) {
      if (!disclosure) continue;

      const digest =
        bytesToBase64url(
          sha256(
            new TextEncoder().encode(
              disclosure,
            ),
          ),
        );

      if (!sdHashes.includes(digest)) {
        throw new Error(
          'Disclosure digest does not match issuer payload',
        );
      }
    }

    return {
      verified: true,
      issuerSignatureValid: true,
      trustedIssuer: true,
      credentialTypeValid: true,
      timeValid: true,
      disclosuresValid: true,
      holderBindingValid: true,
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      verified: false,
      issuerSignatureValid: false,
      trustedIssuer: false,
      credentialTypeValid: false,
      timeValid: false,
      disclosuresValid: false,
      holderBindingValid: false,
      reason,
    };
  }
}