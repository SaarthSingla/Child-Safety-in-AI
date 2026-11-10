import { Alert, Linking } from 'react-native';

import { CATALOG, type Article } from '@/content/catalog';

import { buildAskGuardianUrl, buildCurationUrl, startCuration } from './curation';

async function open(url: string): Promise<boolean> {
  if (!(await Linking.canOpenURL(url))) {
    Alert.alert('ChildSafeWallet not found', 'Install and set up ChildSafeWallet on this device to use family rules.');
    return false;
  }
  await Linking.openURL(url);
  return true;
}

// Asks the wallet to apply the family's rules to the whole feed. The answer
// arrives at footube://curate-callback.
export async function requestFamilyRules(articles: readonly Article[] = CATALOG): Promise<boolean> {
  const request = await startCuration(articles);
  return open(buildCurationUrl(request, articles));
}

export function askGuardianInWallet(article: Article): Promise<boolean> {
  return open(buildAskGuardianUrl(article));
}
