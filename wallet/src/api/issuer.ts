import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';

import { getIssuerBaseUrl } from '@/config/issuerConfig';

export type HolderJWK = {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
};

export type IssuanceSession = {
  session_id: string;
  nonce: string;
  issued_at: number;
  expires_at: number;
  holder_key_thumbprint: string;
};

export async function startIssuance(
  holderPublicJwk: HolderJWK,
): Promise<IssuanceSession> {
  const issuerBaseUrl = await getIssuerBaseUrl();

  const form = new FormData();
  form.append('holder_public_jwk', JSON.stringify(holderPublicJwk));
  

  const response = await fetch(`${issuerBaseUrl}/issuance/start`, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Issuance start failed (${response.status}): ${errorText}`,
    );
  }

  return response.json();
}

export async function issueCredential(
  imageUri: string,
  session: IssuanceSession,
  holderPublicJwk: HolderJWK,
): Promise<string> {
  const issuerBaseUrl = await getIssuerBaseUrl();

  const form = new FormData();

  form.append(
    'image',
    new File(imageUri),
  );

  form.append('session_id', session.session_id);
  form.append('nonce', session.nonce);
  form.append('issued_at', String(session.issued_at));
  form.append('expires_at', String(session.expires_at));
  form.append('holder_public_jwk', JSON.stringify(holderPublicJwk));
  form.append('holder_key_thumbprint', session.holder_key_thumbprint);
  console.log('ISSUE_REQUEST_START', Date.now());
  const response = await fetch(`${issuerBaseUrl}/issue`, {
    method: 'POST',
    body: form,
  });
  console.log('ISSUE_RESPONSE_RECEIVED', Date.now());
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Credential issuance failed (${response.status}): ${errorText}`,
    );
  }

  const data = await response.json();

  if (!data.credential) {
    throw new Error('Issuer response did not contain a credential');
  }

  return data.credential;
}
