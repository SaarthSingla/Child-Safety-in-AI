
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getCredential,
  deleteCredential,
  deleteAllWalletData,
  type StoredCredential,
} from '../crypto/credentialStore';
import { getOrCreateHolderKey } from '../../src/crypto/holderKey';
import { verifySdJwtCredential, type VerificationResult } from '../../src/crypto/sdJwt';

export default function CredentialScreen() {
  const [credential, setCredential] = useState<StoredCredential | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  const loadCredential = useCallback(async () => {
    setLoading(true);

    try {
      const stored = await getCredential();
      setCredential(stored);

      if (!stored) {
        setVerification(null);
        return;
      }

      setVerifying(true);

      try {
        const holderKey = await getOrCreateHolderKey();

        const result = verifySdJwtCredential(
          stored.credential,
          holderKey.publicJwk,
        );

        setVerification(result);
      } catch (error) {
        console.error('Credential verification failed:', error);

        setVerification({
          verified: false,
          issuerSignatureValid: false,
          trustedIssuer: false,
          credentialTypeValid: false,
          timeValid: false,
          disclosuresValid: false,
          holderBindingValid: false,
          reason:
            error instanceof Error
              ? error.message
              : 'Credential verification failed',
        });
      }
    } finally {
      setVerifying(false);
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCredential();
    }, [loadCredential]),
  );

  const handleDeleteCredential = () => {
    Alert.alert(
      'Delete credential?',
      'This will remove the stored age credential from this wallet.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteCredential();
            router.replace('/');
          },
        },
      ],
    );
  };

  const handleDeleteAllData = () => {
    Alert.alert(
      'Delete all wallet data?',
      'This removes the stored credential and wallet data from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            await deleteAllWalletData();
            setCredential(null);
            setVerification(null);
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading credential...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!credential) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No Credential</Text>
          <Text style={styles.emptyText}>
            No age credential is currently stored in this wallet.
          </Text>
          <Pressable
            style={styles.backButton}
            onPress={() => router.replace('/')}
          >
            <Text style={styles.backButtonText}>Back to Wallet</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const verified = verification?.verified === true;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View style={styles.checkCircle}>
            <Text style={styles.check}>✓</Text>
          </View>

          <Text style={styles.title}>Age Credential</Text>

          <View
            style={[
              styles.statusBadge,
              verified ? styles.verifiedBadge : styles.failedBadge,
            ]}
          >
            <Text
              style={[
                styles.statusText,
                verified ? styles.verifiedText : styles.failedText,
              ]}
            >
              {verifying
                ? 'VERIFYING...'
                : verified
                  ? '✓ VERIFIED'
                  : '✕ VERIFICATION FAILED'}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>AGE BAND</Text>
          <Text style={styles.value}>{credential.ageBand}</Text>

        {credential.assuranceMethod && (
          <>
            <Text style={styles.label}>ASSURANCE METHOD</Text>
            <Text style={styles.value}>{credential.assuranceMethod}</Text>
          </>
        )}

        {credential.issuer && (
          <>
            <Text style={styles.label}>ISSUER</Text>
            <Text style={styles.valueSmall}>{credential.issuer}</Text>
          </>
        )}

        {credential.vct && (
          <>
            <Text style={styles.label}>CREDENTIAL TYPE</Text>
            <Text style={styles.valueSmall}>{credential.vct}</Text>
          </>
        )}

        {credential.issuedAt && (
          <>
            <Text style={styles.label}>ISSUED</Text>
            <Text style={styles.valueSmall}>
              {new Date(credential.issuedAt * 1000).toLocaleString()}
            </Text>
          </>
        )}

        {credential.expiresAt && (
          <>
            <Text style={styles.label}>EXPIRES</Text>
            <Text style={styles.valueSmall}>
              {new Date(credential.expiresAt * 1000).toLocaleString()}
            </Text>
          </>
        )}
      </View>

      <View style={styles.verificationCard}>
        <Text style={styles.verificationTitle}>
          Cryptographic Verification
        </Text>

        {verification ? (
          <>
            <VerificationRow
              label="Issuer signature"
              valid={verification.issuerSignatureValid}
            />

            <VerificationRow
              label="Trusted issuer"
              valid={verification.trustedIssuer}
            />

            <VerificationRow
              label="Credential type"
              valid={verification.credentialTypeValid}
            />

            <VerificationRow
              label="Validity period"
              valid={verification.timeValid}
            />

            <VerificationRow
              label="SD-JWT disclosures"
              valid={verification.disclosuresValid}
            />

            <VerificationRow
              label="Wallet holder binding"
              valid={verification.holderBindingValid}
            />

            {!verification.verified && verification.reason && (
              <Text style={styles.errorText}>
                {verification.reason}
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.pendingText}>
            Verification has not been completed.
          </Text>
        )}
      </View>

      <View style={styles.storageBadge}>
        <Text style={styles.storageText}>STORED IN WALLET</Text>
      </View>

      <Text style={styles.note}>
        The original selfie is not contained in this credential.
      </Text>

      <Text style={styles.demoNote}>
        Demo verification checks the issuer signature, trusted issuer,
        credential type, validity period, SD-JWT disclosures, and binding to
        this wallet's public key.
      </Text>

        <Pressable
          style={styles.backButton}
          onPress={() => router.replace('/')}
        >
          <Text style={styles.backButtonText}>Back to Wallet</Text>
        </Pressable>

      <Pressable
        style={styles.deleteButton}
        onPress={handleDeleteCredential}
      >
        <Text style={styles.deleteText}>Delete Credential</Text>
      </Pressable>

      <Pressable
        style={styles.deleteAllButton}
        onPress={handleDeleteAllData}
      >
        <Text style={styles.deleteAllText}>Delete All Wallet Data</Text>
      </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function VerificationRow({
  label,
  valid,
}: {
  label: string;
  valid: boolean;
}) {
  return (
    <View style={styles.verificationRow}>
      <Text style={styles.verificationLabel}>{label}</Text>

      <Text
        style={[
          styles.verificationResult,
          valid ? styles.pass : styles.fail,
        ]}
      >
        {valid ? 'PASS' : 'FAIL'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F8FA',
  },

  scroll: {
    flex: 1,
    backgroundColor: '#F7F8FA',
  },

  container: {
    padding: 24,
    paddingTop: 24,
    paddingBottom: 48,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  loadingText: {
    fontSize: 16,
  },

  emptyTitle: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
  },

  emptyText: {
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.7,
  },

  header: {
    alignItems: 'center',
    marginBottom: 24,
  },

  checkCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#208AEF',
    marginBottom: 12,
  },

  check: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
  },

  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
  },

  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },

  verifiedBadge: {
    backgroundColor: '#DFF6E8',
  },

  failedBadge: {
    backgroundColor: '#FDE2E2',
  },

  statusText: {
    fontSize: 13,
    fontWeight: '700',
  },

  verifiedText: {
    color: '#16803C',
  },

  failedText: {
    color: '#C62828',
  },

  card: {
    borderRadius: 16,
    padding: 20,
    backgroundColor: '#F5F5F5',
    marginBottom: 16,
  },

  label: {
    fontSize: 11,
    fontWeight: '700',
    opacity: 0.55,
    marginTop: 14,
    marginBottom: 5,
  },

  value: {
    fontSize: 22,
    fontWeight: '700',
  },

  valueSmall: {
    fontSize: 14,
    lineHeight: 20,
  },

  verificationCard: {
    borderRadius: 16,
    padding: 20,
    backgroundColor: '#F5F5F5',
    marginBottom: 16,
  },

  verificationTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 14,
  },

  verificationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CCC',
  },

  verificationLabel: {
    fontSize: 14,
    flex: 1,
  },

  verificationResult: {
    fontSize: 12,
    fontWeight: '800',
  },

  pass: {
    color: '#16803C',
  },

  fail: {
    color: '#C62828',
  },

  errorText: {
    marginTop: 14,
    color: '#C62828',
    fontSize: 13,
    lineHeight: 19,
  },

  pendingText: {
    opacity: 0.6,
    fontSize: 14,
  },

  storageBadge: {
    alignSelf: 'center',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: '#E8F1FF',
    marginBottom: 12,
  },

  storageText: {
    color: '#1769AA',
    fontSize: 12,
    fontWeight: '700',
  },

  note: {
    textAlign: 'center',
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 10,
  },

  demoNote: {
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    opacity: 0.55,
    marginBottom: 24,
  },

  deleteButton: {
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 8,
  },

  deleteText: {
    color: '#C62828',
    fontWeight: '600',
  },

  deleteAllButton: {
    alignItems: 'center',
    paddingVertical: 14,
  },

  deleteAllText: {
    color: '#C62828',
    fontWeight: '700',
  },

  backButton: {
    alignItems: 'center',
    backgroundColor: '#208AEF',
    borderRadius: 12,
    paddingVertical: 15,
    marginBottom: 16,
  },

  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
