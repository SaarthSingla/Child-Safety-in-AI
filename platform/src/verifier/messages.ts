import { requirementLabel } from './policy';
import type {
  AgeRequirement,
  DenialReason,
  VerificationFailureCode,
} from './types';

// Simple user-facing text only. Raw cryptographic errors and diagnostic
// codes are never shown; the code is available for development logging.
export function userMessageForFailure(
  reason: VerificationFailureCode,
  requirement: AgeRequirement = '18plus',
): string {
  switch (reason) {
    case 'issuer_signature_invalid':
    case 'untrusted_issuer':
      return 'Age verification failed.\nThe credential signature is invalid.';

    case 'credential_expired':
      return 'Age verification failed.\nThe credential has expired.';

    case 'age_requirement_not_met':
      return `This article requires a ${requirementLabel(requirement)} credential.`;

    case 'no_holder_binding':
    case 'no_key_binding_jwt':
    case 'key_binding_malformed':
    case 'key_binding_algorithm_invalid':
    case 'holder_proof_invalid':
    case 'sd_hash_mismatch':
    case 'key_binding_expired':
    case 'key_binding_not_yet_valid':
      return 'Age verification failed.\nThe wallet could not prove control of the credential.';

    case 'request_replayed':
      return 'Age verification failed.\nThis verification request has already been used.';

    case 'request_expired':
      return 'The verification request expired. Please try again.';

    default:
      return 'Age verification failed.\nThe credential could not be verified.';
  }
}

export function userMessageForDenial(
  reason: DenialReason,
  requirement: AgeRequirement,
): string {
  switch (reason) {
    case 'no_credential':
      return 'No age credential was found in ChildSafe Wallet.\nGet one in the wallet first, then try again.';

    case 'credential_invalid':
      return 'Age verification failed.\nThe credential in your wallet could not be verified. It may have expired.';

    case 'age_requirement_not_met':
      return `This article requires a ${requirementLabel(requirement)} credential.`;

    case 'policy_blocked':
      return 'Blocked by a guardian policy in ChildSafe Wallet.\nFootube allows this article, but this device does not.';

    default:
      return 'Age verification was declined in the wallet.';
  }
}

export const VERIFIED_MESSAGE = '✓ Age verified';

export const EXPIRED_SESSION_MESSAGE =
  'Your age verification has expired. Please verify again.';
