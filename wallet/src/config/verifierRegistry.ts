export type TrustedVerifier = {
  verifierId: string;
  displayName: string;
  // The only URL the wallet will hand an age presentation to.
  callbackUrl: string;
  // The only URL the wallet will hand curation decisions to.
  curationCallbackUrl: string;
  // Where "Back to <app>" goes.
  appUrl: string;
};

// DEMO allowlist of verifiers this wallet will present to. A request whose
// verifier or callback is not listed here is refused, so a crafted deep link
// cannot redirect a presentation to an arbitrary app or website.
const TRUSTED_VERIFIERS: readonly TrustedVerifier[] = [
  {
    verifierId: 'did:example:footube',
    displayName: 'Footube',
    callbackUrl: 'footube://verify-callback',
    curationCallbackUrl: 'footube://curate-callback',
    appUrl: 'footube://',
  },
];

export function findTrustedVerifier(
  verifierId: string | undefined,
  callbackUrl: string | undefined,
): TrustedVerifier | undefined {
  return TRUSTED_VERIFIERS.find(
    (verifier) =>
      verifier.verifierId === verifierId &&
      verifier.callbackUrl === callbackUrl,
  );
}

export function findTrustedCurationVerifier(
  verifierId: string | undefined,
  callbackUrl: string | undefined,
): TrustedVerifier | undefined {
  return TRUSTED_VERIFIERS.find(
    (verifier) => verifier.verifierId === verifierId && verifier.curationCallbackUrl === callbackUrl,
  );
}

export function findVerifierById(verifierId: string | undefined): TrustedVerifier | undefined {
  return TRUSTED_VERIFIERS.find((verifier) => verifier.verifierId === verifierId);
}
