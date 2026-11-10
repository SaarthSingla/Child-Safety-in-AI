import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scrypt as scryptCb,
  sign,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import { keyId, type PublicJwk } from '../../policy/src/index';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;

export type SigningKey = { privateKey: KeyObject; publicJwk: PublicJwk; kid: string };

export function b64url(data: Buffer | Uint8Array | string): string {
  return Buffer.from(data).toString('base64url');
}

// The NLPPS policy-signing key. Unlike the demo issuer's key it is
// persistent: it is generated once, stored with 0600 permissions, and its
// public half is pinned in the wallet (wallet/src/nlpps/config.ts).
export function loadOrCreateSigningKey(path: string): SigningKey {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    writeFileSync(path, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
    chmodSync(path, 0o600);
  }

  const privateKey = createPrivateKey(readFileSync(path));
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' }) as { kty: string; crv: string; x: string; y: string };

  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
    throw new Error('NLPPS signing key must be an EC P-256 key');
  }

  const publicJwk: PublicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  return { privateKey, publicJwk, kid: keyId(publicJwk) };
}

export function signText(key: SigningKey, text: string): string {
  return b64url(sign('sha256', Buffer.from(text), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }));
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

// Short human-typeable codes (pairing, invites). No 0/O/1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function humanCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(.+)/, '$1-$2');
}

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, SCRYPT);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
