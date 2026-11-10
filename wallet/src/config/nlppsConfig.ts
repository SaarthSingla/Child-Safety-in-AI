// The wallet accepts a policy only if it is signed by this server key AND by
// the parent's own device. The server's address arrives in the pairing link
// and is not trusted by itself.
//
// This is the demo key in nlpps/keys/nlpps-dev-signing.pem. The server prints
// its public key when it starts. In production it would come from a trusted
// list published by the certification authority.
export const NLPPS_SERVER_KEY = {
  kty: 'EC',
  crv: 'P-256',
  x: 'AzxrcrYsWsBXF1Upjh78pOpCEQyaZoLdwOWVuSLfczE',
  y: '1OFbNyXQ6OelCWp9fb2wG9EDmqJomifyXOe9P3oYweQ',
};

// How long a sync may hold up the screen. The wallet never waits forever and
// never falls back to "no rules".
export const SYNC_TIMEOUT_MS = 3500;

// How often the wallet checks for a new policy while in use.
export const SYNC_EVERY_MS = 15 * 60 * 1000;

export const MAX_MANIFEST_ITEMS = 100;

// A platform could send made-up items to work out the rules, so each app gets
// a limited number of questions.
export const MAX_CURATIONS_PER_HOUR = 30;
