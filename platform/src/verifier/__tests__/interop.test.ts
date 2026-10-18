import { createHash, webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { bytesToBase64url, base64urlToBytes } from '../encoding';
import { verifyPresentation } from '../verifyPresentation';
import {
  NOW_MS,
  NOW_S,
  decodeJson,
  digestOf,
  encodeJson,
  expectations,
  generateKeyPair,
  issueCredential,
  makeDisclosure,
  verifierConfigFor,
} from './testKit';
import { VERIFIER_CONFIG } from '../config';

// Runs the wallet's REAL Key Binding builder against Footube's verifier.
// Skipped automatically if the sibling wallet folder is absent.
const walletModulePath = fileURLToPath(
  new URL('../../../../wallet/src/crypto/keyBinding.ts', import.meta.url),
);

type HolderSigner = (signingInput: string) => Promise<Uint8Array>;

type BuildPresentation = (input: {
  credential: string;
  signWithHolderKey: HolderSigner;
  audience: string;
  nonce: string;
  disclose: readonly string[];
  nowSeconds?: number;
}) => Promise<string>;

const issuer = generateKeyPair();
const holder = generateKeyPair();
const config = verifierConfigFor(issuer);

// Stands in for the Secure Enclave, which does not exist under Node. Like the
// enclave, WebCrypto ECDSA is randomised and returns raw r||s (64 bytes).
function softwareSigner(keyPair: { jwk: JsonWebKey; secretKey: Uint8Array }): HolderSigner {
  const keyPromise = webcrypto.subtle.importKey(
    'jwk',
    { ...keyPair.jwk, d: bytesToBase64url(keyPair.secretKey) },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  return async (signingInput) =>
    new Uint8Array(
      await webcrypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        await keyPromise,
        new TextEncoder().encode(signingInput),
      ),
    );
}

describe.skipIf(!existsSync(walletModulePath))('wallet builder <-> Footube verifier', () => {
  let buildPresentation: BuildPresentation;

  beforeAll(async () => {
    ({ buildPresentation } = await import(/* @vite-ignore */ walletModulePath));
  });

  const build = (credential: string, overrides: Partial<Parameters<BuildPresentation>[0]> = {}) =>
    buildPresentation({
      credential,
      signWithHolderKey: softwareSigner(holder),
      audience: VERIFIER_CONFIG.verifierId,
      nonce: 'n-123',
      disclose: ['age_band'],
      nowSeconds: NOW_S,
      ...overrides,
    });

  it('produces a presentation the verifier accepts', async () => {
    const issued = issueCredential({ issuer, holder });
    const presentation = await build(issued.credential);

    const result = verifyPresentation(presentation, expectations({ nonce: 'n-123' }), config);

    expect(result.verified).toBe(true);
    expect(result.credential?.ageBand).toBe('18plus');
  });

  it('discloses only age_band and never leaks the holder private key', async () => {
    const issued = issueCredential({ issuer, holder, confidence: 0.87 });
    const presentation = await build(issued.credential);

    const disclosures = presentation.split('~').slice(1, -1);
    expect(disclosures.map((d) => decodeJson(d)[1])).toEqual(['age_band']);

    expect(presentation).not.toContain(issued.disclosures.prediction_confidence);
    expect(presentation).not.toContain(issued.disclosures.assurance_method);
    expect(presentation).not.toContain(bytesToBase64url(holder.secretKey));
  });

  it('is rejected when the wallet key is not the one the credential is bound to', async () => {
    const issued = issueCredential({ issuer, holder });
    const presentation = await build(issued.credential, {
      signWithHolderKey: softwareSigner(generateKeyPair()),
    });

    expect(verifyPresentation(presentation, expectations({ nonce: 'n-123' }), config).reason).toBe(
      'holder_proof_invalid',
    );
  });

  it('is rejected for a different verifier audience or nonce', async () => {
    const issued = issueCredential({ issuer, holder });

    expect(
      verifyPresentation(await build(issued.credential, { audience: 'did:example:other' }), expectations({ nonce: 'n-123' }), config).reason,
    ).toBe('audience_mismatch');

    expect(
      verifyPresentation(await build(issued.credential), expectations({ nonce: 'different' }), config).reason,
    ).toBe('nonce_mismatch');
  });

  it('accepts randomised signatures: two presentations differ yet both verify', async () => {
    const issued = issueCredential({ issuer, holder });
    const first = await build(issued.credential);
    const second = await build(issued.credential);

    expect(first).not.toBe(second);
    expect(verifyPresentation(first, expectations({ nonce: 'n-123' }), config).verified).toBe(true);
    expect(verifyPresentation(second, expectations({ nonce: 'n-123' }), config).verified).toBe(true);
  });

  it('rejects a signer that does not return a 64-byte ES256 signature', async () => {
    const issued = issueCredential({ issuer, holder });

    await expect(
      build(issued.credential, { signWithHolderKey: async () => new Uint8Array(70) }),
    ).rejects.toThrow();
  });

  it('refuses to build from a credential that already carries key binding, or lacks the claim', async () => {
    const issued = issueCredential({ issuer, holder });

    await expect(build(`${issued.credential}a.b.c`)).rejects.toThrow();
    await expect(build(issued.credential, { disclose: ['no_such_claim'] })).rejects.toThrow();
    await expect(build(issued.credential, { nonce: '' })).rejects.toThrow();
  });

  it('produces a KB-JWT that a fully independent ES256 implementation (WebCrypto) verifies', async () => {
    const issued = issueCredential({ issuer, holder });
    const presentation = await build(issued.credential);

    const cut = presentation.lastIndexOf('~') + 1;
    const sdJwtPart = presentation.slice(0, cut);
    const [h, p, s] = presentation.slice(cut).split('.');

    const key = await webcrypto.subtle.importKey(
      'jwk',
      holder.jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );

    const ok = await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new Uint8Array(base64urlToBytes(s)),
      new TextEncoder().encode(`${h}.${p}`),
    );

    expect(ok).toBe(true);
    expect(decodeJson(h)).toEqual({ typ: 'kb+jwt', alg: 'ES256' });

    const payload = decodeJson(p);
    expect(payload.sd_hash).toBe(createHash('sha256').update(sdJwtPart).digest('base64url'));
    expect(payload.aud).toBe(VERIFIER_CONFIG.verifierId);
    expect(payload.nonce).toBe('n-123');
    expect(payload.iat).toBe(NOW_S);
  });
});

describe('issuer signatures from an independent ES256 implementation', () => {
  it('accepts credentials signed by WebCrypto, including high-S signatures', async () => {
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicJwk = (await webcrypto.subtle.exportKey('jwk', pair.publicKey)) as {
      kty: 'EC'; crv: 'P-256'; x: string; y: string;
    };
    const webCryptoConfig = verifierConfigFor({ secretKey: new Uint8Array(), jwk: { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y } });

    // WebCrypto does not normalise S, so across many signatures about half
    // are "high-S". All must verify.
    for (let i = 0; i < 24; i += 1) {
      const disclosure = makeDisclosure('age_band', '18plus');

      const header = { alg: 'ES256', typ: 'dc+sd-jwt', kid: VERIFIER_CONFIG.trustedIssuerKid };
      const payload = {
        iss: VERIFIER_CONFIG.trustedIssuer,
        iat: NOW_S - 10,
        exp: NOW_S + 3600,
        vct: VERIFIER_CONFIG.expectedCredentialType,
        cnf: { jwk: holder.jwk },
        _sd: [digestOf(disclosure)],
        _sd_alg: 'sha-256',
      };

      const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
      const signature = new Uint8Array(
        await webcrypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          pair.privateKey,
          new TextEncoder().encode(signingInput),
        ),
      );

      const issuerJwt = `${signingInput}.${bytesToBase64url(signature)}`;
      const issued = { issuerJwt, disclosures: { age_band: disclosure }, credential: `${issuerJwt}~${disclosure}~` };

      // Build the KB-JWT with the test kit (noble) over that presentation.
      const { present } = await import('./testKit');
      const presentation = present(issued as never, { holderSecretKey: holder.secretKey });

      const result = verifyPresentation(presentation, { ...expectations(), nowMs: NOW_MS }, webCryptoConfig);

      expect(result.verified, `signature #${i}: ${result.reason}`).toBe(true);
    }
  });
});
