import * as SecureStore from 'expo-secure-store';

const ISSUER_URL_KEY = 'childsafe_issuer_base_url_v1';

// Placeholder. Enter the real issuer address in the app's Settings tab.
export const DEFAULT_ISSUER_BASE_URL = 'https://your-issuer.example.com';

export async function getIssuerBaseUrl(): Promise<string> {
  const stored = await SecureStore.getItemAsync(ISSUER_URL_KEY);

  return stored?.trim() || DEFAULT_ISSUER_BASE_URL;
}

export async function setIssuerBaseUrl(url: string): Promise<void> {
  const normalized = url.trim().replace(/\/+$/, '');

  if (!normalized.startsWith('https://')) {
    throw new Error('Issuer URL must use HTTPS');
  }

  await SecureStore.setItemAsync(
    ISSUER_URL_KEY,
    normalized,
  );
}
