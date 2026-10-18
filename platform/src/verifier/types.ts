export type HolderJWK = {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
};

// What a piece of content requires of the reader. The demo has two tiers:
//   '12plus' -> age_band 12_17 or 18plus
//   '18plus' -> age_band 18plus
export type AgeRequirement = '12plus' | '18plus';

export type VerificationRequest = {
  requestId: string;
  requestedAgeBand: AgeRequirement;
  verifierId: string;
  callbackUrl: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
  // Label of the content being opened, so the wallet can apply the
  // guardian's policy (CHAISE's on-device second factor).
  contentCategory?: string;
};

// UI-facing progress of the wallet round trip. Display only: content
// access is always decided by content/authorization.ts from a verified
// credential, never from this value.
export type AgeVerificationState =
  | 'not_verified'
  | 'verification_requested'
  | 'verifying'
  | 'verified'
  | 'rejected'
  | 'expired';

// Diagnostic codes. These are for logs and for mapping to user-facing
// messages (verifier/messages.ts); raw cryptographic errors never reach the UI.
export type VerificationFailureCode =
  | 'malformed_presentation'
  | 'issuer_signature_invalid'
  | 'untrusted_issuer'
  | 'wrong_credential_type'
  | 'credential_expired'
  | 'credential_not_yet_valid'
  | 'disclosure_invalid'
  | 'age_band_missing'
  | 'no_holder_binding'
  | 'no_key_binding_jwt'
  | 'key_binding_malformed'
  | 'key_binding_algorithm_invalid'
  | 'holder_proof_invalid'
  | 'sd_hash_mismatch'
  | 'nonce_mismatch'
  | 'audience_mismatch'
  | 'key_binding_expired'
  | 'key_binding_not_yet_valid'
  | 'age_requirement_not_met'
  | 'request_unknown'
  | 'request_expired'
  | 'request_replayed'
  | 'no_presentation';

export type VerifiedAgeCredential = {
  ageBand: string;
  issuer: string;
  vct: string;
  // Credential expiry, seconds since the epoch (the JWT `exp` claim).
  expiresAt: number;
};

export type PresentationVerificationResult = {
  // True only when every cryptographic check AND the age policy passed.
  verified: boolean;

  issuerSignatureValid: boolean;
  trustedIssuer: boolean;
  credentialTypeValid: boolean;
  timeValid: boolean;
  disclosuresValid: boolean;

  holderBindingPresent: boolean;
  holderProofValid: boolean;

  nonceValid: boolean;
  audienceValid: boolean;

  ageRequirementSatisfied: boolean;

  reason?: VerificationFailureCode;

  // Present only when `verified` is true.
  credential?: VerifiedAgeCredential;
};

// Why the wallet declined. This is the wallet's own, untrusted hint: it is
// whitelisted and used only to choose a clearer message, never to grant access.
export type DenialReason =
  | 'user_denied'
  | 'no_credential'
  | 'credential_invalid'
  | 'age_requirement_not_met'
  // A guardian policy in the wallet blocked this content.
  | 'policy_blocked';

export type VerificationOutcome =
  | { type: 'verified'; credential: VerifiedAgeCredential }
  | { type: 'denied'; reason: DenialReason }
  | { type: 'rejected'; reason: VerificationFailureCode };
