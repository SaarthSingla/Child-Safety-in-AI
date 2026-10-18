import { VERIFIER_CONFIG, type VerifierConfig } from './config';
import {
  checkKeyBindingAudience,
  checkKeyBindingHeader,
  checkKeyBindingNonce,
  checkKeyBindingTime,
  parseKeyBindingJwt,
  verifyHolderProof,
} from './keyBindingVerifier';
import { satisfiesAgeRequirement } from './policy';
import {
  checkValidityWindow,
  extractHolderKey,
  isExpectedCredentialType,
  isTrustedIssuer,
  parsePresentation,
  verifyDisclosures,
  verifyIssuerSignature,
} from './sdJwtVerifier';
import type {
  AgeRequirement,
  PresentationVerificationResult,
  VerificationFailureCode,
} from './types';

export type PresentationExpectations = {
  // All three come from the verifier's own record of the request it issued.
  nonce: string;
  audience: string;
  requirement: AgeRequirement;
  requestCreatedAtMs: number;
  nowMs?: number;
};

// Verifies an SD-JWT + Key Binding JWT presentation. Pure and synchronous:
// no transport, storage or UI. Fails closed: any unexpected error is
// reported as a malformed presentation, never as success.
//
// Order (cryptographic checks first, policy last):
//   parse -> issuer JWT -> issuer signature -> trusted issuer -> VCT ->
//   iat/exp -> disclosures -> cnf.jwk -> KB-JWT structure/alg/signature ->
//   nonce -> audience -> KB time -> age_band -> age policy
export function verifyPresentation(
  presentation: unknown,
  expectations: PresentationExpectations,
  config: VerifierConfig = VERIFIER_CONFIG,
): PresentationVerificationResult {
  const checks = {
    issuerSignatureValid: false,
    trustedIssuer: false,
    credentialTypeValid: false,
    timeValid: false,
    disclosuresValid: false,
    holderBindingPresent: false,
    holderProofValid: false,
    nonceValid: false,
    audienceValid: false,
    ageRequirementSatisfied: false,
  };

  const fail = (
    reason: VerificationFailureCode,
  ): PresentationVerificationResult => ({
    ...checks,
    verified: false,
    reason,
  });

  try {
    const nowSeconds = Math.floor((expectations.nowMs ?? Date.now()) / 1000);
    const requestCreatedAtSeconds = Math.floor(
      expectations.requestCreatedAtMs / 1000,
    );

    // 1-2. Parse presentation and SD-JWT.
    const parsed = parsePresentation(presentation);

    if (!parsed) {
      return fail('malformed_presentation');
    }

    // 3-4. Issuer JWT structure and ES256 signature (verifier's own key).
    const issuer = verifyIssuerSignature(parsed.issuerJwt, config);

    if (!issuer.ok) {
      return fail(issuer.reason);
    }

    checks.issuerSignatureValid = true;

    // 5. Trusted issuer.
    if (!isTrustedIssuer(issuer.header, issuer.payload, config)) {
      return fail('untrusted_issuer');
    }

    checks.trustedIssuer = true;

    // 6. Credential type.
    if (!isExpectedCredentialType(issuer.header, issuer.payload, config)) {
      return fail('wrong_credential_type');
    }

    checks.credentialTypeValid = true;

    // 7. iat / exp.
    const windowFailure = checkValidityWindow(
      issuer.payload,
      nowSeconds,
      config,
    );

    if (windowFailure) {
      return fail(windowFailure);
    }

    checks.timeValid = true;

    // 8. Disclosures.
    const disclosures = verifyDisclosures(issuer.payload, parsed.disclosures);

    if (!disclosures.ok) {
      return fail(disclosures.reason);
    }

    checks.disclosuresValid = true;

    // 9. cnf.jwk.
    const holder = extractHolderKey(issuer.payload);

    if (!holder.ok) {
      return fail(holder.reason);
    }

    checks.holderBindingPresent = true;

    // 10. Key Binding JWT present and well-formed.
    if (parsed.keyBindingJwt.length === 0) {
      return fail('no_key_binding_jwt');
    }

    const keyBinding = parseKeyBindingJwt(parsed.keyBindingJwt);

    if (!keyBinding.ok) {
      return fail(keyBinding.reason);
    }

    // 11. KB-JWT algorithm and type.
    const headerFailure = checkKeyBindingHeader(keyBinding.header);

    if (headerFailure) {
      return fail(headerFailure);
    }

    // 12. KB-JWT signature under cnf.jwk, and sd_hash over what was presented.
    const proofFailure = verifyHolderProof(
      keyBinding,
      holder.publicKey,
      parsed.sdJwtPart,
    );

    if (proofFailure) {
      return fail(proofFailure);
    }

    checks.holderProofValid = true;

    // 13. Nonce.
    const nonceFailure = checkKeyBindingNonce(
      keyBinding.payload,
      expectations.nonce,
    );

    if (nonceFailure) {
      return fail(nonceFailure);
    }

    checks.nonceValid = true;

    // 14. Audience.
    const audienceFailure = checkKeyBindingAudience(
      keyBinding.payload,
      expectations.audience,
    );

    if (audienceFailure) {
      return fail(audienceFailure);
    }

    checks.audienceValid = true;

    // 15. KB-JWT time.
    const timeFailure = checkKeyBindingTime(
      keyBinding.payload,
      nowSeconds,
      requestCreatedAtSeconds,
      config,
    );

    if (timeFailure) {
      return fail(timeFailure);
    }

    // 16. age_band, only from a disclosure that passed every check above.
    const ageBand = disclosures.claims.age_band;

    if (typeof ageBand !== 'string') {
      return fail('age_band_missing');
    }

    // 17. Age policy runs only after all cryptographic checks succeeded.
    if (!satisfiesAgeRequirement(ageBand, expectations.requirement)) {
      return fail('age_requirement_not_met');
    }

    checks.ageRequirementSatisfied = true;

    // 18. Result.
    return {
      ...checks,
      verified: true,
      credential: {
        ageBand,
        issuer: config.trustedIssuer,
        vct: config.expectedCredentialType,
        expiresAt: issuer.payload.exp as number,
      },
    };
  } catch {
    return fail('malformed_presentation');
  }
}
