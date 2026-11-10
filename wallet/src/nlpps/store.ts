import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { MAX_CURATIONS_PER_HOUR, NLPPS_SERVER_KEY } from '@/config/nlppsConfig';
import { verifyEnvelope, type PolicyEnvelope, type PublicJwk, type SignedEnvelope } from '@/policy';

// Keychain: the link, the parent's public keys, and the highest version and
// latest signed time seen, so an older file cannot be swapped back in.
// App file: the signed policy, checked again each time it is loaded.
const LINK_KEY = 'chaise_nlpps_link_v2';
const META_KEY = 'chaise_nlpps_meta_v2';
const CONSENT_KEY = 'chaise_nlpps_consent_v2';
const RATE_KEY = 'chaise_nlpps_rate_v2';
const POLICY_FILE = 'chaise-family-policy-v2.json';

const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export type GuardianLink = {
  server: string;
  deviceId: string;
  deviceToken: string;
  childRef: string;
  childName: string;
  guardianKeys: PublicJwk[];
  pairedAt: number;
};

export type PolicyMeta = {
  version: number;
  bundleHash: string;
  // The latest time a signed policy proved was real.
  lastSignedTime: string;
  syncedAt: number;
  lastAttemptAt?: number;
  lastError?: string;
};

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const getLink = () => readJson<GuardianLink>(LINK_KEY);
export const getPolicyMeta = () => readJson<PolicyMeta>(META_KEY);

export async function saveLink(link: GuardianLink): Promise<void> {
  await SecureStore.setItemAsync(LINK_KEY, JSON.stringify(link), options);
}

export async function savePolicyMeta(meta: PolicyMeta): Promise<void> {
  await SecureStore.setItemAsync(META_KEY, JSON.stringify(meta), options);
}

function policyFile(): File {
  return new File(Paths.document, POLICY_FILE);
}

let verified: { text: string; envelope: PolicyEnvelope } | null = null;

export async function savePolicy(signed: SignedEnvelope): Promise<void> {
  const file = policyFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(signed));
  const now = Date.now();
  await savePolicyMeta({ version: signed.envelope.bundle.policy.version, bundleHash: signed.envelope.bundle_hash, lastSignedTime: signed.envelope.issued_at, syncedAt: now, lastAttemptAt: now });
}

export type LoadedPolicy =
  | { status: 'none' }
  | { status: 'ok'; envelope: PolicyEnvelope; meta: PolicyMeta }
  // Missing, changed or older than the Keychain says. The wallet then acts
  // as if nothing is safe until it can sync.
  | { status: 'tampered'; reason: string };

export async function loadPolicy(): Promise<LoadedPolicy> {
  const [link, meta] = await Promise.all([getLink(), getPolicyMeta()]);

  if (!link) return { status: 'none' };
  if (!meta) return { status: 'tampered', reason: 'no policy has been downloaded yet' };

  const file = policyFile();
  if (!file.exists) return { status: 'tampered', reason: 'the policy file is missing' };

  const text = await file.text();
  if (verified?.text === text) return { status: 'ok', envelope: verified.envelope, meta };

  let signed: SignedEnvelope;
  try {
    signed = JSON.parse(text) as SignedEnvelope;
  } catch {
    return { status: 'tampered', reason: 'the policy file is unreadable' };
  }

  const check = verifyEnvelope(signed, { server: NLPPS_SERVER_KEY, guardians: link.guardianKeys, childRef: link.childRef }, { version: meta.version, bundleHash: meta.bundleHash });
  if (!check.ok) return { status: 'tampered', reason: check.reason };

  verified = { text, envelope: check.envelope };
  return { status: 'ok', envelope: check.envelope, meta };
}

export async function clearGuardianLink(): Promise<void> {
  verified = null;
  await Promise.all([SecureStore.deleteItemAsync(LINK_KEY), SecureStore.deleteItemAsync(META_KEY), SecureStore.deleteItemAsync(CONSENT_KEY), SecureStore.deleteItemAsync(RATE_KEY)]);
  const file = policyFile();
  if (file.exists) file.delete();
}

export async function hasCurationConsent(verifierId: string): Promise<boolean> {
  return ((await readJson<string[]>(CONSENT_KEY)) ?? []).includes(verifierId);
}

export async function grantCurationConsent(verifierId: string): Promise<void> {
  const list = (await readJson<string[]>(CONSENT_KEY)) ?? [];
  if (!list.includes(verifierId)) list.push(verifierId);
  await SecureStore.setItemAsync(CONSENT_KEY, JSON.stringify(list), options);
}

// Counts how often each app has asked in the last hour.
export async function allowCuration(verifierId: string, now = Date.now()): Promise<boolean> {
  const all = (await readJson<Record<string, number[]>>(RATE_KEY)) ?? {};
  const recent = (all[verifierId] ?? []).filter((time) => now - time < 3_600_000);
  if (recent.length >= MAX_CURATIONS_PER_HOUR) return false;
  all[verifierId] = [...recent, now];
  await SecureStore.setItemAsync(RATE_KEY, JSON.stringify(all), options);
  return true;
}
