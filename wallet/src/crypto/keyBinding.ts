import { sha256 } from '@noble/hashes/sha2.js';

// Signs the UTF-8 bytes of a JWS signing input with the holder key and
// returns the raw 64-byte ES256 signature (r||s). In the app this is the
// Secure Enclave; the private key is never handed to this module.
export type HolderSigner = (signingInput: string) => Promise<Uint8Array>;

export type BuildPresentationInput = {
  // The stored issuer-signed SD-JWT VC: <issuer JWT>~<disclosure>~...~
  credential: string;
  signWithHolderKey: HolderSigner;
  // Verifier identifier the presentation is intended for (KB-JWT `aud`).
  audience: string;
  // Verifier-issued challenge (KB-JWT `nonce`).
  nonce: string;
  // Names of the claims to reveal. Everything else stays undisclosed.
  disclose: readonly string[];
  nowSeconds?: number;
};

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function encodeJson(value: unknown): string {
  return bytesToBase64url(new TextEncoder().encode(JSON.stringify(value)));
}

function disclosureName(disclosure: string): string | null {
  try {
    const decoded = JSON.parse(
      new TextDecoder().decode(base64urlToBytes(disclosure)),
    );

    if (
      Array.isArray(decoded) &&
      decoded.length === 3 &&
      typeof decoded[1] === 'string'
    ) {
      return decoded[1];
    }
  } catch {
    // Treated as a non-matching disclosure below.
  }

  return null;
}

// Builds an SD-JWT presentation with a Key Binding JWT (RFC 9901 format):
//
//   <issuer JWT>~<selected disclosures>~<KB-JWT>
//
// KB-JWT header:  { typ: "kb+jwt", alg: "ES256" }
// KB-JWT payload: { iat, aud, nonce, sd_hash }
//
// `sd_hash` is SHA-256 over everything before the KB-JWT (issuer JWT plus
// the selected disclosures, including the trailing '~'), which ties the
// proof to exactly what is being presented.
export async function buildPresentation(input: BuildPresentationInput): Promise<string> {
  const { credential, signWithHolderKey, audience, nonce, disclose } = input;

  if (!audience || !nonce) {
    throw new Error('A verifier audience and nonce are required');
  }

  const parts = credential.split('~');

  if (parts.length < 2 || parts[parts.length - 1] !== '') {
    throw new Error('Stored credential is not an unbound SD-JWT');
  }

  const issuerJwt = parts[0];
  const wanted = new Set(disclose);
  const selected: string[] = [];
  const found = new Set<string>();

  for (const disclosure of parts.slice(1, -1)) {
    const name = disclosureName(disclosure);

    if (name !== null && wanted.has(name)) {
      selected.push(disclosure);
      found.add(name);
    }
  }

  for (const name of wanted) {
    if (!found.has(name)) {
      throw new Error(`Credential has no "${name}" disclosure`);
    }
  }

  const sdJwtPart = `${[issuerJwt, ...selected].join('~')}~`;

  const header = { typ: 'kb+jwt', alg: 'ES256' };
  const payload = {
    iat: input.nowSeconds ?? Math.floor(Date.now() / 1000),
    aud: audience,
    nonce,
    sd_hash: bytesToBase64url(sha256(new TextEncoder().encode(sdJwtPart))),
  };

  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;

  const signature = await signWithHolderKey(signingInput);

  if (signature.length !== 64) {
    throw new Error('Holder signature must be a 64-byte ES256 signature');
  }

  return `${sdJwtPart}${signingInput}.${bytesToBase64url(signature)}`;
}
