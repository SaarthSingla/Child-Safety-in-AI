import type { AgeRequirement } from './types';

// Explicit allowlists of issued age_band values. Never inferred from
// prediction confidence, and never from "not a minor".
const QUALIFYING_BANDS: Record<AgeRequirement, readonly string[]> = {
  '12plus': ['12_17', '18plus'],
  '18plus': ['18plus'],
};

export function satisfiesAgeRequirement(
  ageBand: string,
  requirement: AgeRequirement,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(QUALIFYING_BANDS, requirement)) {
    return false;
  }

  return QUALIFYING_BANDS[requirement].includes(ageBand);
}

export function requirementLabel(requirement: AgeRequirement): string {
  return requirement === '12plus' ? '12+' : '18+';
}
