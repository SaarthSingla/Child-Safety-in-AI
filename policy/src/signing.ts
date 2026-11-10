import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { GENERATOR_VERSION } from './generate';
import type { CompiledPolicy, ContentRecord, PolicyDocument } from './types';
import { validatePolicy } from './validate';

export type PublicJwk = { kty: string; crv: string; x: string; y: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function bytesToBase64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    out += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += ALPHABET[c & 63];
  }
  return out;
}

export function base64urlToBytes(text: string): Uint8Array {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error('not base64url');
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (value >> bits) & 255;
      index += 1;
    }
  }
  return out.slice(0, index);
}

// One exact text form for any JSON value, so a hash means the same thing on
// every machine.
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const object = value as Record<string, unknown>;
  const fields = Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`);
  return `{${fields.join(',')}}`;
}

export function hashText(text: string): string {
  return bytesToBase64url(sha256(encoder.encode(text)));
}

export function hashOf(value: unknown): string {
  return hashText(canonicalize(value));
}

export function jwkToPublicKey(jwk: PublicJwk): Uint8Array {
  const key = new Uint8Array(65);
  key[0] = 0x04;
  key.set(base64urlToBytes(jwk.x), 1);
  key.set(base64urlToBytes(jwk.y), 33);
  return key;
}

export function verifySignature(signature: string, message: string, jwk: PublicJwk): boolean {
  try {
    const bytes = base64urlToBytes(signature);
    return bytes.length === 64 && p256.verify(bytes, encoder.encode(message), jwkToPublicKey(jwk), { lowS: false });
  } catch {
    return false;
  }
}

export function keyId(jwk: PublicJwk): string {
  return hashText(canonicalize({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
}

// The policy plus its Cedar rules. The parent's device signs this hash.
export type PolicyBundle = {
  policy: PolicyDocument;
  compiled: CompiledPolicy;
  generator_version: string;
};

export function makeBundle(policy: PolicyDocument, compiled: CompiledPolicy): PolicyBundle {
  return { policy, compiled, generator_version: GENERATOR_VERSION };
}

export function guardianMessage(bundleHash: string): string {
  return `nlpps-approve:${bundleHash}`;
}

// The server's wrapper. It adds fresh dates to the same signed bundle, so an
// old copy cannot be replayed forever.
export type PolicyEnvelope = {
  schema: 'nlpps.envelope/1';
  bundle: PolicyBundle;
  bundle_hash: string;
  guardian: { kid: string; signature: string };
  issued_at: string;
  expires_at: string;
};

export function signingInput(envelope: PolicyEnvelope): string {
  return canonicalize(envelope);
}

export type SignedEnvelope = { envelope: PolicyEnvelope; signature: string; kid: string };

export type EnvelopeTrust = {
  server: PublicJwk;
  guardians: PublicJwk[];
  childRef: string;
};

export type EnvelopeFailure =
  | 'bad_server_signature'
  | 'unknown_guardian'
  | 'bad_guardian_signature'
  | 'hash_mismatch'
  | 'wrong_child'
  | 'invalid_policy'
  | 'older_version'
  | 'changed_without_new_version';

export type EnvelopeCheck = { ok: true; envelope: PolicyEnvelope } | { ok: false; reason: EnvelopeFailure };

// Checks everything the wallet needs before it will use a policy. An expired
// policy still passes here, because the wallet keeps it and falls back to the
// fixed protections plus asking.
export function verifyEnvelope(
  signed: SignedEnvelope,
  trust: EnvelopeTrust,
  current: { version: number; bundleHash: string } | null,
): EnvelopeCheck {
  const { envelope, signature } = signed;

  if (!verifySignature(signature, signingInput(envelope), trust.server)) return { ok: false, reason: 'bad_server_signature' };

  const guardian = trust.guardians.find((jwk) => keyId(jwk) === envelope.guardian.kid);
  if (!guardian) return { ok: false, reason: 'unknown_guardian' };
  if (hashOf(envelope.bundle) !== envelope.bundle_hash) return { ok: false, reason: 'hash_mismatch' };
  if (!verifySignature(envelope.guardian.signature, guardianMessage(envelope.bundle_hash), guardian)) {
    return { ok: false, reason: 'bad_guardian_signature' };
  }

  const policy = envelope.bundle.policy;
  if (policy.child_ref !== trust.childRef) return { ok: false, reason: 'wrong_child' };
  if (validatePolicy(policy).length > 0) return { ok: false, reason: 'invalid_policy' };

  if (current) {
    if (policy.version < current.version) return { ok: false, reason: 'older_version' };
    if (policy.version === current.version && envelope.bundle_hash !== current.bundleHash) {
      return { ok: false, reason: 'changed_without_new_version' };
    }
  }

  return { ok: true, envelope };
}

export function isExpired(envelope: PolicyEnvelope, now: Date): boolean {
  return now.getTime() >= Date.parse(envelope.expires_at);
}

// Labels from an approved labeller. One signature covers a whole list of
// item hashes, which keeps checking a page of items fast.
export type LabelBatch = { labeller: string; hashes: string[]; signature: string };

export type RawLabels = Omit<ContentRecord, 'trusted'>;

export function labelHash(labels: Record<string, unknown>): string {
  return hashOf(labels);
}

export function labelBatchMessage(batch: Pick<LabelBatch, 'labeller' | 'hashes'>): string {
  return canonicalize({ labeller: batch.labeller, hashes: batch.hashes });
}

export function verifyLabelBatch(batch: LabelBatch, labellers: { id: string; jwk: PublicJwk }[]): boolean {
  const labeller = labellers.find((entry) => entry.id === batch.labeller);
  return labeller ? verifySignature(batch.signature, labelBatchMessage(batch), labeller.jwk) : false;
}

export function utf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
