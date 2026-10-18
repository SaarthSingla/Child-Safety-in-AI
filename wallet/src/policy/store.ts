import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { PolicyRule } from './types';

const POLICIES_KEY = 'childsafe_guardian_policies_v1';
const PIN_KEY = 'childsafe_guardian_pin_v1';

const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function loadPolicies(): Promise<PolicyRule[]> {
  const stored = await SecureStore.getItemAsync(POLICIES_KEY);

  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as PolicyRule[]) : [];
  } catch {
    return [];
  }
}

async function savePolicies(rules: PolicyRule[]): Promise<void> {
  await SecureStore.setItemAsync(POLICIES_KEY, JSON.stringify(rules), options);
}

export async function addPolicy(
  rule: Pick<PolicyRule, 'category' | 'condition' | 'explanation'>,
): Promise<PolicyRule[]> {
  const created: PolicyRule = {
    ...rule,
    id: Crypto.randomUUID(),
    action: 'BLOCK',
    createdAt: Date.now(),
  };

  const rules = [...(await loadPolicies()), created];
  await savePolicies(rules);
  return rules;
}

export async function removePolicy(id: string): Promise<PolicyRule[]> {
  const rules = (await loadPolicies()).filter((rule) => rule.id !== id);
  await savePolicies(rules);
  return rules;
}

// Demo stand-in for guardian authority (CHAISE uses the relationship graph).
async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

export async function hasGuardianPin(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PIN_KEY)) !== null;
}

export async function setGuardianPin(pin: string): Promise<void> {
  const salt = Crypto.randomUUID();
  const hash = await hashPin(pin, salt);
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify({ salt, hash }), options);
}

export async function checkGuardianPin(pin: string): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(PIN_KEY);

  if (!stored) {
    return false;
  }

  try {
    const { salt, hash } = JSON.parse(stored) as { salt: string; hash: string };
    return (await hashPin(pin, salt)) === hash;
  } catch {
    return false;
  }
}
