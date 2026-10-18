import { useEffect, useState } from 'react';

import { StyleSheet, Text, View } from 'react-native';

import { router, useLocalSearchParams } from 'expo-router';

import {
  issueCredential,
  type HolderJWK,
  type IssuanceSession,
} from '@/api/issuer';

import { parseSdJwtCredential } from '@/crypto/sdJwt';

import { saveCredential } from '@/crypto/credentialStore';

export default function VerificationScreen() {
  const params = useLocalSearchParams<{
    imageUri: string;
    sessionId: string;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
    holderThumbprint: string;
    holderPublicJwk: string;
  }>();

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function issue() {
      try {
        const holderPublicJwk = JSON.parse(
          params.holderPublicJwk,
        ) as HolderJWK;

        const session: IssuanceSession = {
          session_id: params.sessionId,
          nonce: params.nonce,
          issued_at: Number(params.issuedAt),
          expires_at: Number(params.expiresAt),
          holder_key_thumbprint: params.holderThumbprint,
        };

        console.log('=== CHILDSAFE ISSUE REQUEST ===');

        const credential = await issueCredential(
          params.imageUri,
          session,
          holderPublicJwk,
        );

        if (cancelled) {
          return;
        }

        console.log('Credential received');
        console.log('Credential length:', credential.length);

        // Read the actual claims from the SD-JWT.
        const parsed = parseSdJwtCredential(credential);

        console.log('Age band:', parsed.ageBand);
        console.log(
          'Prediction confidence:',
          parsed.predictionConfidence,
        );
        console.log(
          'Assurance method:',
          parsed.assuranceMethod,
        );

        // Store the complete SD-JWT VC in the wallet.
        await saveCredential({
          credential,
          ageBand: parsed.ageBand,
          predictionConfidence: parsed.predictionConfidence,
          assuranceMethod: parsed.assuranceMethod,
          issuer: parsed.issuer,
          vct: parsed.vct,
          issuedAt: parsed.issuedAt,
          expiresAt: parsed.expiresAt,
          storedAt: Date.now(),
        });

        console.log('Credential securely stored');
        console.log('================================');

        if (cancelled) {
          return;
        }

        router.replace({
          pathname: '/credential',
        });
      } catch (err) {
        console.error('Credential issuance failed:', err);

        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Credential issuance failed.',
          );
        }
      }
    }

    issue();

    return () => {
      cancelled = true;
    };
  }, [
    params.imageUri,
    params.sessionId,
    params.nonce,
    params.issuedAt,
    params.expiresAt,
    params.holderThumbprint,
    params.holderPublicJwk,
  ]);

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorIcon}>!</Text>

        <Text style={styles.title}>
          Verification failed
        </Text>

        <Text style={styles.text}>
          {error}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.icon}>
        <Text style={styles.iconText}>✓</Text>
      </View>

      <Text style={styles.title}>
        Verifying your age
      </Text>

      <Text style={styles.text}>
        Your selfie is being processed securely for age
        verification.
      </Text>

      <Text style={styles.smallText}>
        Please keep the app open while verification is completed.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },

  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },

  iconText: {
    color: '#FFF',
    fontSize: 36,
  },

  errorIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#111',
    color: '#FFF',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 36,
    marginBottom: 24,
  },

  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },

  text: {
    fontSize: 17,
    lineHeight: 25,
    color: '#555',
    textAlign: 'center',
    marginTop: 16,
    maxWidth: 340,
  },

  smallText: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginTop: 24,
    maxWidth: 320,
  },
});