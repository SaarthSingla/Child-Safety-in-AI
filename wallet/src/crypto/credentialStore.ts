import * as SecureStore from 'expo-secure-store';

const VC_STORAGE_KEY = 'childsafe_age_credential_v1';

export type StoredCredential = {
  credential: string;
  ageBand: string;
  predictionConfidence?: number;
  assuranceMethod?: string;
  issuer?: string;
  vct?: string;
  issuedAt?: number;
  expiresAt?: number;
  storedAt: number;
};

export async function saveCredential(
  credential: StoredCredential,
): Promise<void> {
  await SecureStore.setItemAsync(
    VC_STORAGE_KEY,
    JSON.stringify(credential),
    {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
}

export async function getCredential(): Promise<StoredCredential | null> {
  const stored = await SecureStore.getItemAsync(VC_STORAGE_KEY);

  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as StoredCredential;
  } catch {
    return null;
  }
}

export async function deleteCredential(): Promise<void> {
  await SecureStore.deleteItemAsync(VC_STORAGE_KEY);
}

export async function deleteAllWalletData(): Promise<void> {
  await SecureStore.deleteItemAsync(VC_STORAGE_KEY);
}