import * as Crypto from 'expo-crypto';

// Uniform integer in [0, maxExclusive) from the OS CSPRNG, using rejection
// sampling so small ranges carry no modulo bias.
export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 256) {
    throw new Error('maxExclusive must be an integer in 1..256');
  }
  const limit = 256 - (256 % maxExclusive);
  for (;;) {
    const [byte] = Crypto.getRandomBytes(1);
    if (byte < limit) return byte % maxExclusive;
  }
}
