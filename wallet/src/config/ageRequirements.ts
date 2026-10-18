export type AgeRequirement = '12plus' | '18plus';

type RequirementInfo = {
  label: string;
  // "…proof that you are <descriptor>."
  descriptor: string;
  // Bands, as issued in the credential's age_band claim, that satisfy it.
  allowedBands: readonly string[];
  // What the verifier will actually learn. The only disclosable claim is
  // age_band, so a 12+ request necessarily reveals which of the two
  // qualifying bands the holder is in.
  disclosureNote: string;
};

const REQUIREMENTS: Record<AgeRequirement, RequirementInfo> = {
  '12plus': {
    label: '12+',
    descriptor: '12 or older',
    allowedBands: ['12_17', '18plus'],
    disclosureNote:
      'Your age range (12–17 or 18+) will be shared. Your exact age, date of birth and selfie are never shared.',
  },
  '18plus': {
    label: '18+',
    descriptor: '18 or older',
    allowedBands: ['18plus'],
    disclosureNote:
      'No exact age, date of birth or selfie will be shared. Only proof that you meet the 18+ requirement is sent.',
  },
};

export function parseAgeRequirement(
  value: string | undefined,
): AgeRequirement | undefined {
  return value === '12plus' || value === '18plus' ? value : undefined;
}

export function getRequirementInfo(requirement: AgeRequirement): RequirementInfo {
  return REQUIREMENTS[requirement];
}

// Explicit allowlist of bands, never inferred from confidence or from
// "not a minor".
export function bandSatisfies(
  ageBand: string,
  requirement: AgeRequirement,
): boolean {
  return REQUIREMENTS[requirement].allowedBands.includes(ageBand);
}
