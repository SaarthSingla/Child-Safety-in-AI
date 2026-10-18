import { useCallback, useState } from 'react';

import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { router, useFocusEffect } from 'expo-router';

import {
  getCredential,
  type StoredCredential,
} from '@/crypto/credentialStore';

function formatAgeBand(ageBand: string): string {
  switch (ageBand) {
    case '0_5':
      return '0–5';

    case '6_11':
      return '6–11';

    case '12_17':
      return '12–17';

    case '18plus':
      return '18+';

    default:
      return ageBand;
  }
}

export default function HomeScreen() {
  const [credential, setCredential] =
    useState<StoredCredential | null>(null);

  const [loading, setLoading] = useState(true);

  const loadCredential = useCallback(async () => {
    try {
      const stored = await getCredential();
      setCredential(stored);
    } catch (error) {
      console.error(
        'Failed to load wallet credential:',
        error,
      );
      setCredential(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCredential();
    }, [loadCredential]),
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loading}>
          Loading wallet...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>
          ChildSafe
        </Text>

        <Text style={styles.subtitle}>
          Age Credential Wallet
        </Text>
      </View>

      {credential ? (
        <>
          <Pressable
            style={styles.credentialCard}
            onPress={() => router.push('/credential')}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>
                Age Credential
              </Text>

              <View style={styles.statusBadge}>
                <Text style={styles.statusText}>
                  STORED
                </Text>
              </View>
            </View>

            <Text style={styles.ageBand}>
              {formatAgeBand(credential.ageBand)}
            </Text>

            <Text style={styles.cardText}>
              Tap to view your credential details.
            </Text>

            <Text style={styles.arrow}>
              →
            </Text>
          </Pressable>

          <Pressable
            style={styles.button}
            onPress={() => router.push('/get-credential')}
          >
            <Text style={styles.buttonText}>
              Get Another Credential
            </Text>
          </Pressable>
        </>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            No credential yet
          </Text>

          <Text style={styles.cardText}>
            Get a privacy-preserving age credential
            that you can use to prove your age without
            sharing unnecessary personal information.
          </Text>

          <Pressable
            style={styles.button}
            onPress={() =>
              router.push('/get-credential')
            }
          >
            <Text style={styles.buttonText}>
              Get Age Credential
            </Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.footer}>
        Your credential stays in your wallet.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    paddingHorizontal: 24,
    paddingTop: 32,
  },

  loading: {
    fontSize: 17,
    color: '#666',
    textAlign: 'center',
  },

  header: {
    marginBottom: 40,
  },

  logo: {
    fontSize: 34,
    fontWeight: '700',
  },

  subtitle: {
    fontSize: 17,
    color: '#666',
    marginTop: 6,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
  },

  credentialCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    position: 'relative',
  },

  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  cardTitle: {
    fontSize: 23,
    fontWeight: '600',
  },

  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F0F0F0',
  },

  statusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#555',
  },

  ageBand: {
    fontSize: 38,
    fontWeight: '700',
    marginTop: 24,
  },

  cardText: {
    fontSize: 16,
    lineHeight: 24,
    color: '#555',
    marginTop: 10,
  },

  arrow: {
    fontSize: 26,
    fontWeight: '600',
    marginTop: 18,
    alignSelf: 'flex-end',
  },

  button: {
    backgroundColor: '#111',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },

  buttonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '600',
  },

  footer: {
    textAlign: 'center',
    marginTop: 28,
    color: '#777',
    fontSize: 14,
  },
});