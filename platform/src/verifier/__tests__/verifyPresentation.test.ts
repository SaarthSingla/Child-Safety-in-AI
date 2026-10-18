import { describe, expect, it } from 'vitest';

import { VERIFIER_CONFIG } from '../config';
import { bytesToBase64url } from '../encoding';
import { satisfiesAgeRequirement } from '../policy';
import { verifyPresentation } from '../verifyPresentation';
import {
  NOW_S,
  corruptSegment,
  decodeJson,
  encodeJson,
  expectations,
  generateKeyPair,
  issueCredential,
  makeDisclosure,
  present,
  verifierConfigFor,
} from './testKit';

const issuer = generateKeyPair();
const holder = generateKeyPair();
const config = verifierConfigFor(issuer);

function valid(overrides: Parameters<typeof issueCredential>[0] extends infer T ? Partial<T> : never = {}) {
  const issued = issueCredential({ issuer, holder, ...overrides });
  return { issued, presentation: present(issued, { holderSecretKey: holder.secretKey }) };
}

function verify(presentation: unknown, overrides = {}) {
  return verifyPresentation(presentation, expectations(overrides), config);
}

describe('credential verification', () => {
  it('accepts a valid 18plus presentation and exposes every check', () => {
    const { presentation } = valid();
    const result = verify(presentation);

    expect(result).toMatchObject({
      verified: true,
      issuerSignatureValid: true,
      trustedIssuer: true,
      credentialTypeValid: true,
      timeValid: true,
      disclosuresValid: true,
      holderBindingPresent: true,
      holderProofValid: true,
      nonceValid: true,
      audienceValid: true,
      ageRequirementSatisfied: true,
    });
    expect(result.reason).toBeUndefined();
    expect(result.credential).toEqual({
      ageBand: '18plus',
      issuer: VERIFIER_CONFIG.trustedIssuer,
      vct: VERIFIER_CONFIG.expectedCredentialType,
      expiresAt: NOW_S + 3600,
    });
  });

  it('rejects a modified payload', () => {
    const { presentation } = valid();
    const [jwt, ...rest] = presentation.split('~');
    const [h, p, s] = jwt.split('.');
    const payload = decodeJson(p);
    payload.exp += 100000;

    const tampered = [`${h}.${encodeJson(payload)}.${s}`, ...rest].join('~');
    const result = verify(tampered);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('issuer_signature_invalid');
    expect(result.issuerSignatureValid).toBe(false);
  });

  it('rejects a modified signature', () => {
    const { presentation } = valid();
    const [jwt, ...rest] = presentation.split('~');
    const [h, p, s] = jwt.split('.');

    const result = verify([`${h}.${p}.${corruptSegment(s)}`, ...rest].join('~'));

    expect(result.reason).toBe('issuer_signature_invalid');
  });

  it('rejects a credential signed by a key that is not the trusted issuer key', () => {
    const attacker = generateKeyPair();
    const issued = issueCredential({ issuer: attacker, holder });
    const presentation = present(issued, { holderSecretKey: holder.secretKey });

    const result = verify(presentation);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('issuer_signature_invalid');
  });

  it('rejects an unsigned credential and other algorithms (algorithm confusion)', () => {
    const { presentation } = valid();
    const [jwt, ...rest] = presentation.split('~');
    const [, p] = jwt.split('.');

    for (const alg of ['none', 'HS256', 'RS256']) {
      const header = encodeJson({ alg, typ: 'dc+sd-jwt', kid: VERIFIER_CONFIG.trustedIssuerKid });
      const forged = [`${header}.${p}.`, ...rest].join('~');

      expect(verify(forged).verified).toBe(false);
    }
  });

  it('rejects a header that claims another algorithm even when the ES256 signature is valid', () => {
    // Isolates the alg check: the signature below verifies under the trusted
    // key, so only the header's alg claim distinguishes this from a good token.
    for (const alg of ['none', 'HS256', 'ES384']) {
      const issued = issueCredential({ issuer, holder, alg });
      const result = verify(present(issued, { holderSecretKey: holder.secretKey }));

      expect(result.verified).toBe(false);
      expect(result.reason).toBe('issuer_signature_invalid');
    }
  });

  it('rejects a wrong issuer identifier even when the signature is valid', () => {
    const issued = issueCredential({ issuer, holder, iss: 'https://evil.example' });
    const result = verify(present(issued, { holderSecretKey: holder.secretKey }));

    expect(result.reason).toBe('untrusted_issuer');
    expect(result.issuerSignatureValid).toBe(true);
    expect(result.trustedIssuer).toBe(false);
  });

  it('rejects a wrong key identifier', () => {
    const issued = issueCredential({ issuer, holder, kid: 'https://evil.example#key' });
    const result = verify(present(issued, { holderSecretKey: holder.secretKey }));

    expect(result.reason).toBe('untrusted_issuer');
  });

  it('rejects a wrong credential type', () => {
    const issued = issueCredential({ issuer, holder, vct: 'urn:other:credential:v1' });
    const result = verify(present(issued, { holderSecretKey: holder.secretKey }));

    expect(result.reason).toBe('wrong_credential_type');
    expect(result.credentialTypeValid).toBe(false);
  });

  it('rejects an expired credential', () => {
    const issued = issueCredential({ issuer, holder, iat: NOW_S - 7200, exp: NOW_S - 3600 });
    const result = verify(present(issued, { holderSecretKey: holder.secretKey }));

    expect(result.reason).toBe('credential_expired');
    expect(result.timeValid).toBe(false);
  });

  it('rejects a credential issued in the future', () => {
    const issued = issueCredential({ issuer, holder, iat: NOW_S + 3600, exp: NOW_S + 7200 });
    const result = verify(present(issued, { holderSecretKey: holder.secretKey }));

    expect(result.reason).toBe('credential_not_yet_valid');
  });

  it('rejects a disclosure whose hash the issuer never signed (age_band swap)', () => {
    // A minor's real credential, with the age_band disclosure swapped for a
    // forged one claiming 18plus.
    const issued = issueCredential({ issuer, holder, ageBand: '12_17' });
    const forgedDisclosure = makeDisclosure('age_band', '18plus');

    const sdJwtPart = `${issued.issuerJwt}~${forgedDisclosure}~`;
    const presentation = present(
      { ...issued, disclosures: { ...issued.disclosures, age_band: forgedDisclosure } },
      { holderSecretKey: holder.secretKey },
    );

    expect(presentation.startsWith(sdJwtPart)).toBe(true);

    const result = verify(presentation);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('disclosure_invalid');
    expect(result.disclosuresValid).toBe(false);
  });

  it('rejects a duplicated disclosure', () => {
    const issued = issueCredential({ issuer, holder });
    const d = issued.disclosures.age_band;
    const sdJwtPart = `${issued.issuerJwt}~${d}~${d}~`;
    const presentation = `${sdJwtPart}x.y.z`;

    expect(verify(presentation).reason).toBe('disclosure_invalid');
  });

  it('rejects an unsupported _sd_alg', () => {
    const issued = issueCredential({ issuer, holder, sdAlg: 'sha-512' });
    const result = verify(present(issued, { holderSecretKey: holder.secretKey }));

    expect(result.reason).toBe('disclosure_invalid');
  });

  it('rejects a presentation with no age_band disclosure', () => {
    const issued = issueCredential({ issuer, holder, omitAgeBand: true });
    const result = verify(
      present(issued, { holderSecretKey: holder.secretKey, disclose: ['assurance_method'] }),
    );

    expect(result.reason).toBe('age_band_missing');
    expect(result.verified).toBe(false);
  });
});

describe('holder proof (Key Binding JWT)', () => {
  it('rejects a missing Key Binding JWT: the credential alone is insufficient', () => {
    const issued = issueCredential({ issuer, holder });
    const result = verify(present(issued, { holderSecretKey: holder.secretKey, omitKeyBinding: true }));

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('no_key_binding_jwt');
    expect(result.holderBindingPresent).toBe(true);
    expect(result.holderProofValid).toBe(false);
  });

  it('rejects a credential with no cnf.jwk', () => {
    const issued = issueCredential({ issuer, holder: null });
    const result = verify(present(issued, { holderSecretKey: holder.secretKey }));

    expect(result.reason).toBe('no_holder_binding');
    expect(result.holderBindingPresent).toBe(false);
  });

  it('rejects a modified Key Binding JWT', () => {
    const { presentation } = valid();
    const idx = presentation.lastIndexOf('~') + 1;
    const [h, p, s] = presentation.slice(idx).split('.');
    const payload = decodeJson(p);
    payload.nonce = 'attacker-chosen';

    const tampered = `${presentation.slice(0, idx)}${h}.${encodeJson(payload)}.${s}`;
    const result = verify(tampered, { nonce: 'attacker-chosen' });

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('holder_proof_invalid');
  });

  it('rejects a proof signed with the wrong holder private key', () => {
    const issued = issueCredential({ issuer, holder });
    const otherKey = generateKeyPair();
    const result = verify(present(issued, { holderSecretKey: otherKey.secretKey }));

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('holder_proof_invalid');
    expect(result.holderProofValid).toBe(false);
  });

  it('rejects the wrong nonce', () => {
    const issued = issueCredential({ issuer, holder });
    const presentation = present(issued, { holderSecretKey: holder.secretKey, nonce: 'someone-elses-nonce' });
    const result = verify(presentation);

    expect(result.reason).toBe('nonce_mismatch');
    expect(result.holderProofValid).toBe(true);
    expect(result.nonceValid).toBe(false);
  });

  it('fails closed when the verifier has no expected nonce', () => {
    const { presentation } = valid();

    expect(verify(presentation, { nonce: '' }).reason).toBe('nonce_mismatch');
  });

  it('rejects the wrong audience', () => {
    const issued = issueCredential({ issuer, holder });
    const presentation = present(issued, { holderSecretKey: holder.secretKey, audience: 'did:example:other-verifier' });
    const result = verify(presentation);

    expect(result.reason).toBe('audience_mismatch');
    expect(result.nonceValid).toBe(true);
    expect(result.audienceValid).toBe(false);
  });

  it('rejects an expired Key Binding JWT', () => {
    const issued = issueCredential({ issuer, holder });
    const presentation = present(issued, { holderSecretKey: holder.secretKey, iat: NOW_S - 3600 });

    expect(verify(presentation).reason).toBe('key_binding_expired');
  });

  it('rejects a Key Binding JWT from the future', () => {
    const issued = issueCredential({ issuer, holder });
    const presentation = present(issued, { holderSecretKey: holder.secretKey, iat: NOW_S + 3600 });

    expect(verify(presentation).reason).toBe('key_binding_not_yet_valid');
  });

  it('rejects a Key Binding JWT made before the challenge existed', () => {
    const issued = issueCredential({ issuer, holder });
    const presentation = present(issued, { holderSecretKey: holder.secretKey, iat: NOW_S - 200 });

    expect(verify(presentation, { requestCreatedAtMs: NOW_S * 1000 - 1000 }).reason).toBe(
      'key_binding_expired',
    );
  });

  it('rejects a Key Binding JWT with the wrong type or algorithm', () => {
    const issued = issueCredential({ issuer, holder });

    expect(
      verify(present(issued, { holderSecretKey: holder.secretKey, typ: 'JWT' })).reason,
    ).toBe('key_binding_malformed');

    expect(
      verify(present(issued, { holderSecretKey: holder.secretKey, alg: 'none' })).reason,
    ).toBe('key_binding_algorithm_invalid');
  });

  it('rejects a Key Binding JWT whose sd_hash does not cover what was presented', () => {
    const issued = issueCredential({ issuer, holder });

    // Proof made for an age_band-only presentation...
    const forAgeBandOnly = present(issued, { holderSecretKey: holder.secretKey });
    const kb = forAgeBandOnly.slice(forAgeBandOnly.lastIndexOf('~') + 1);

    // ...lifted onto a presentation that also reveals prediction_confidence.
    const lifted = `${issued.issuerJwt}~${issued.disclosures.age_band}~${issued.disclosures.prediction_confidence}~${kb}`;
    const result = verify(lifted);

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('sd_hash_mismatch');
  });
});

describe('age policy', () => {
  it.each([
    ['18plus', true],
    ['12_17', false],
    ['6_11', false],
    ['0_5', false],
    ['', false],
    ['18PLUS', false],
    ['18plus ', false],
    ['adult', false],
  ])('satisfiesAgeRequirement(%j, 18plus) -> %s', (band, expected) => {
    expect(satisfiesAgeRequirement(band, '18plus')).toBe(expected);
  });

  it.each([
    ['18plus', true],
    ['12_17', true],
    ['6_11', false],
    ['0_5', false],
    ['', false],
    ['12_17 ', false],
    ['12+', false],
    ['adult', false],
  ])('satisfiesAgeRequirement(%j, 12plus) -> %s', (band, expected) => {
    expect(satisfiesAgeRequirement(band, '12plus')).toBe(expected);
  });

  it('fails closed for a requirement it does not know', () => {
    expect(satisfiesAgeRequirement('18plus', 'constructor' as never)).toBe(false);
    expect(satisfiesAgeRequirement('18plus', '' as never)).toBe(false);
  });

  describe('12plus tier through the verifier', () => {
    const run = (ageBand: string, requirement: '12plus' | '18plus') => {
      const issued = issueCredential({ issuer, holder, ageBand });
      return verify(present(issued, { holderSecretKey: holder.secretKey }), { requirement });
    };

    it.each(['12_17', '18plus'])('accepts a valid %s credential for 12+ content', (band) => {
      const result = run(band, '12plus');

      expect(result.verified).toBe(true);
      expect(result.credential?.ageBand).toBe(band);
    });

    it.each(['6_11', '0_5'])('rejects a valid %s credential for 12+ content', (band) => {
      const result = run(band, '12plus');

      expect(result.verified).toBe(false);
      expect(result.reason).toBe('age_requirement_not_met');
      expect(result.holderProofValid).toBe(true);
    });

    it('still rejects a 12_17 credential for 18+ content', () => {
      expect(run('12_17', '18plus').reason).toBe('age_requirement_not_met');
    });

    it('takes the requirement from the verifier, never from the presentation', () => {
      // A 12_17 credential cannot argue its way to 18+ access: the
      // requirement is whatever the verifier recorded for the request.
      const issued = issueCredential({ issuer, holder, ageBand: '12_17' });
      const presentation = present(issued, { holderSecretKey: holder.secretKey });

      expect(verify(presentation, { requirement: '12plus' }).verified).toBe(true);
      expect(verify(presentation, { requirement: '18plus' }).verified).toBe(false);
    });
  });

  it.each(['12_17', '6_11', '0_5'])(
    'rejects a fully valid %s credential, however confident the model was',
    (ageBand) => {
      const issued = issueCredential({ issuer, holder, ageBand, confidence: 0.99 });
      const result = verify(present(issued, { holderSecretKey: holder.secretKey }));

      expect(result.verified).toBe(false);
      expect(result.reason).toBe('age_requirement_not_met');
      expect(result.ageRequirementSatisfied).toBe(false);
      // Every cryptographic check passed; only policy said no.
      expect(result.holderProofValid).toBe(true);
      expect(result.credential).toBeUndefined();
    },
  );

  it('does not let prediction_confidence stand in for age_band', () => {
    const issued = issueCredential({ issuer, holder, ageBand: '12_17', confidence: 1 });
    const result = verify(
      present(issued, {
        holderSecretKey: holder.secretKey,
        disclose: ['prediction_confidence'],
      }),
    );

    expect(result.verified).toBe(false);
    expect(result.reason).toBe('age_band_missing');
  });
});

describe('privacy of the presentation', () => {
  it('reveals only the age_band disclosure when that is all that is presented', () => {
    const { presentation } = valid();
    const disclosures = presentation.split('~').slice(1, -1);

    expect(disclosures).toHaveLength(1);
    expect(decodeJson(disclosures[0])[1]).toBe('age_band');
  });
});

describe('robustness', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', {}],
    ['empty', ''],
    ['just a tilde', '~'],
    ['garbage', 'not a presentation'],
    ['bad jwt', 'a.b.c~d~e.f.g'],
    ['non-base64url', 'a!.b!.c!~d~e.f.g'],
    ['oversized', 'x'.repeat(20_000)],
  ])('fails closed on %s without throwing', (_label, input) => {
    let result;

    expect(() => {
      result = verify(input);
    }).not.toThrow();

    expect(result!.verified).toBe(false);
    expect(result!.reason).toBe('malformed_presentation');
  });

  it('never accepts a presentation built from a random signature', () => {
    const issued = issueCredential({ issuer, holder });
    const forged = `${issued.issuerJwt.split('.').slice(0, 2).join('.')}.${bytesToBase64url(new Uint8Array(64).fill(7))}`;

    expect(verify(`${forged}~${issued.disclosures.age_band}~a.b.c`).verified).toBe(false);
  });
});
