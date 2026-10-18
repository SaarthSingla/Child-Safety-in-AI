import { p256 } from '@noble/curves/nist.js';

import { base64urlToBytes, isRecord } from './encoding';

// Returns the uncompressed SEC1 public key (0x04 || X || Y), or null if the
// value is not a well-formed P-256 EC JWK.
export function jwkToPublicKey(jwk: unknown): Uint8Array | null {
  if (
    !isRecord(jwk) ||
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' ||
    typeof jwk.y !== 'string'
  ) {
    return null;
  }

  try {
    const x = base64urlToBytes(jwk.x);
    const y = base64urlToBytes(jwk.y);

    if (x.length !== 32 || y.length !== 32) {
      return null;
    }

    const publicKey = new Uint8Array(65);
    publicKey[0] = 0x04;
    publicKey.set(x, 1);
    publicKey.set(y, 33);

    return publicKey;
  } catch {
    return null;
  }
}

// JWS ES256: SHA-256 over the ASCII signing input, signature is the 64 byte
// R || S form. noble-curves hashes the message itself. `lowS: false` accepts
// signatures from other ES256 implementations that do not normalise S.
export function verifyEs256(
  signature: Uint8Array,
  signingInput: string,
  publicKey: Uint8Array,
): boolean {
  if (signature.length !== 64) {
    return false;
  }

  try {
    return p256.verify(
      signature,
      new TextEncoder().encode(signingInput),
      publicKey,
      { lowS: false },
    );
  } catch {
    return false;
  }
}
