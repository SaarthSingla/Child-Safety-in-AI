import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  DEFAULT_ISSUER_BASE_URL,
  getIssuerBaseUrl,
  setIssuerBaseUrl,
} from '@/config/issuerConfig';

export default function SettingsScreen() {
  const [issuerUrl, setIssuerUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getIssuerBaseUrl().then(setIssuerUrl);
  }, []);

  const save = async () => {
    try {
      setSaving(true);

      await setIssuerBaseUrl(issuerUrl);

      Alert.alert(
        'Saved',
        'Issuer URL updated successfully.',
      );
    } catch (error) {
      Alert.alert(
        'Invalid URL',
        error instanceof Error
          ? error.message
          : 'Unable to save issuer URL.',
      );
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setIssuerUrl(DEFAULT_ISSUER_BASE_URL);
    await setIssuerBaseUrl(DEFAULT_ISSUER_BASE_URL);

    Alert.alert(
      'Reset',
      'Issuer URL restored to the demo server.',
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Developer Configuration
        </Text>

        <Text style={styles.label}>
          Issuer Base URL
        </Text>

        <TextInput
          value={issuerUrl}
          onChangeText={setIssuerUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://issuer.example.com"
          style={styles.input}
        />

        <Text style={styles.help}>
          Demo only. This controls which issuer the wallet contacts
          for age credential issuance.
        </Text>

        <Pressable
          style={styles.button}
          onPress={save}
          disabled={saving}
        >
          <Text style={styles.buttonText}>
            {saving ? 'Saving…' : 'Save Issuer URL'}
          </Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={reset}
        >
          <Text style={styles.secondaryText}>
            Reset to Demo Server
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 28,
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 22,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 24,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
  },
  help: {
    color: '#777',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
  },
  button: {
    backgroundColor: '#111',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 22,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  secondaryText: {
    color: '#444',
    fontSize: 15,
    fontWeight: '600',
  },
});
