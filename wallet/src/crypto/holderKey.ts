import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

import SecureKey from '../../modules/secure-key';

import { deleteCredential } from './credentialStore';

// Earlier builds kept a software P-256 private key here. It is removed on
// first run of a Secure Enclave build, together with the credential that was
// bound to it, so a fresh credential is issued to the hardware key.
const LEGACY_PRIVATE_KEY_STORAGE = 'childsafe_holder_private_key_v1';

export type HolderJWK = {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
};

function base64url(bytes: Uint8Array): string {
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
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function removeLegacySoftwareKey(): Promise<void> {
  const legacy = await SecureStore.getItemAsync(LEGACY_PRIVATE_KEY_STORAGE);

  if (legacy) {
    await deleteCredential();
    await SecureStore.deleteItemAsync(LEGACY_PRIVATE_KEY_STORAGE);
  }
}

// The private key is generated inside the Secure Enclave and never leaves it;
// only the public key is ever available to JavaScript.
export async function getOrCreateHolderKey(): Promise<{
  publicJwk: HolderJWK;
}> {
  await removeLegacySoftwareKey();

  const jwk = await SecureKey.getOrCreatePublicJwk();

  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new Error('Unexpected holder public key format');
  }

  return {
    publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
  };
}

// ES256 signature (raw r||s, 64 bytes) over the UTF-8 bytes of signingInput,
// computed inside the Secure Enclave.
export async function signWithHolderKey(signingInput: string): Promise<Uint8Array> {
  const signature = base64urlToBytes(await SecureKey.sign(signingInput));

  if (signature.length !== 64) {
    throw new Error('Unexpected holder signature length');
  }

  return signature;
}

export async function getHolderPublicJWK(): Promise<HolderJWK> {
  const { publicJwk } = await getOrCreateHolderKey();
  return publicJwk;
}

export async function getHolderThumbprint(): Promise<string> {
  const { publicJwk } = await getOrCreateHolderKey();

  // RFC 7638 canonical JWK representation.
  const canonical = JSON.stringify({
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
    y: publicJwk.y,
  });

  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    new TextEncoder().encode(canonical),
  );

  return base64url(new Uint8Array(digest));
}
