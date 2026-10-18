import type { HolderJWK } from './types';

export type VerifierConfig = {
  verifierId: string;
  trustedIssuer: string;
  trustedIssuerKid: string;
  trustedIssuerJwk: HolderJWK;
  expectedCredentialType: string;
  clockSkewSeconds: number;
  keyBindingMaxAgeSeconds: number;
};

// DEMO CONFIGURATION.
//
// The issuer public key below is this verifier's own, independently
// provisioned trust anchor. The verifier never reads a key out of a
// credential and trusts it.
//
// It is the key of the demo issuer instance that signed the wallet's
// credentials. The demo issuer (DevES256Signer) generates a NEW ephemeral
// key every time it starts, so this value, and the wallet's pinned copy in
// wallet/src/crypto/sdJwt.ts, must both be updated whenever the
// issuer restarts. Production would fetch/rotate issuer keys from a
// governed trust registry instead.
export const VERIFIER_CONFIG: VerifierConfig = {
  // Demo identifier only. Not a production DID deployment.
  verifierId: 'did:example:footube',

  trustedIssuer: 'https://issuer.childsafe.demo',
  trustedIssuerKid: 'https://issuer.childsafe.demo#dev-es256',
  trustedIssuerJwk: {
    kty: 'EC',
    crv: 'P-256',
    x: '4VlTlYrZ6xcCUGaiJDHTgIrajlh0kV1_A42zTtIVxms',
    y: 'z_gPX-4vwIk2-DNQgOA5ijBKT5zMSogEEGkUer_d9Pc',
  },

  expectedCredentialType: 'urn:childsafe:age-credential:v1',

  clockSkewSeconds: 60,

  // Matches the 5 minute verification request lifetime.
  keyBindingMaxAgeSeconds: 5 * 60,
};
