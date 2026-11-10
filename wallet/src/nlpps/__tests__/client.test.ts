import { describe, expect, it } from 'vitest';

import { isSameFamily } from '../client';

const guardian = { kty: 'EC', crv: 'P-256', x: 'gx', y: 'gy' };
const other = { kty: 'EC', crv: 'P-256', x: 'ox', y: 'oy' };
const link = { childRef: 'child-1', guardianKeys: [guardian] };

describe('linking again after the server moves', () => {
  it('accepts a new link for the same child and guardian', () => {
    expect(isSameFamily(link, { childRef: 'child-1', guardianKeys: [other, guardian] })).toBe(true);
  });

  it('refuses a different child or different guardians', () => {
    expect(isSameFamily(link, { childRef: 'child-2', guardianKeys: [guardian] })).toBe(false);
    expect(isSameFamily(link, { childRef: 'child-1', guardianKeys: [other] })).toBe(false);
  });
});
