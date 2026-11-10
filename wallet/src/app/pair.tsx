import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { isSameFamily, pairDevice, parsePairLink } from '@/nlpps/client';
import { clearGuardianLink, getLink, saveLink, type GuardianLink } from '@/nlpps/store';
import { syncPolicy } from '@/nlpps/sync';

function host(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

// Links this wallet to a child profile on a guardian's NLPPS server.
// Opened from the QR code / link a guardian shows in Family Rules
// (childsafewallet://pair?server=…&code=…), or typed in by hand.
export default function PairScreen() {
  const params = useLocalSearchParams<{ server?: string; code?: string }>();
  const [server, setServer] = useState(params.server ?? '');
  const [code, setCode] = useState(params.code ?? '');
  const [existing, setExisting] = useState<GuardianLink | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLink().then(setExisting);
  }, []);

  const link = async () => {
    const pasted = parsePairLink(code) ?? parsePairLink(server);
    const target = pasted ?? { server: server.trim(), code: code.trim() };

    if (!target.server || !target.code) {
      setError(!target.server ? 'Enter the server address shown under the QR code, or scan the QR code with the Camera app.' : 'Enter the pairing code shown under the QR code.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const paired = await pairDevice(target.server, target.code, 'Child’s iPhone');

      if (existing && !isSameFamily(existing, paired)) {
        throw new Error(
          `That code is for a different family profile. This wallet follows ${existing.childName}’s rules; to link it elsewhere, a guardian first unlinks this phone in Family Rules → Phones.`,
        );
      }

      await saveLink({
        server: paired.server,
        deviceId: paired.deviceId,
        deviceToken: paired.deviceToken,
        childRef: paired.childRef,
        childName: paired.childName,
        guardianKeys: paired.guardianKeys,
        pairedAt: Date.now(),
      });

      const sync = await syncPolicy(8000);

      if (sync.status !== 'updated' && sync.status !== 'unchanged') {
        if (existing) await saveLink(existing);
        else await clearGuardianLink();
        throw new Error(
          sync.status === 'rejected'
            ? `The server’s policy failed verification (${sync.reason}).`
            : 'Linked, but the rules could not be downloaded. Check the connection and try again.',
        );
      }

      router.replace('/policies');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not link this wallet.');
    } finally {
      setBusy(false);
    }
  };

  if (existing === undefined) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#111" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>Family rules</Text>
      {existing ? (
        <>
          <Text style={styles.title}>Link again</Text>
          <Text style={styles.text}>
            This wallet follows {existing.childName}’s rules from {host(existing.server)}. If the
            guardian’s server moved to a new address, link again with a new code from the same
            family. Codes for a different family are refused.
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>Link to a guardian</Text>
          <Text style={styles.text}>
            A guardian sets the rules from their own phone in Family Rules. Linking lets this
            wallet download them, check their signature, and apply them before sharing an age
            proof or showing content.
          </Text>
        </>
      )}

      {params.server ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>GUARDIAN SERVER</Text>
          <Text style={styles.cardValue}>{host(server)}</Text>
          <Text style={styles.note}>Only rules signed by the ChildSafe policy key are accepted, whatever the server.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.label}>Server address</Text>
          <TextInput
            value={server}
            onChangeText={setServer}
            placeholder="https://… or 192.168.1.5:8787"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />
        </>
      )}

      <Text style={styles.label}>Pairing code</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="ABCD-1234"
        autoCapitalize="characters"
        autoCorrect={false}
        style={[styles.input, styles.code]}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.primary} onPress={link} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Link this wallet</Text>}
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => router.replace('/')}>
        <Text style={styles.secondaryText}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#F7F8FA' },
  container: { flexGrow: 1, backgroundColor: '#F7F8FA', padding: 24, paddingTop: 48 },
  center: { justifyContent: 'center', alignItems: 'center' },
  eyebrow: { fontSize: 13, fontWeight: '700', color: '#777', textTransform: 'uppercase', marginBottom: 10 },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 10 },
  text: { fontSize: 16, lineHeight: 23, color: '#555', marginBottom: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginBottom: 20 },
  cardLabel: { fontSize: 11, fontWeight: '700', opacity: 0.55, marginBottom: 6 },
  cardValue: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  note: { fontSize: 13, lineHeight: 19, color: '#555' },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8, color: '#333' },
  input: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#DDD', borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 16 },
  code: { fontSize: 22, letterSpacing: 2, fontWeight: '700', textAlign: 'center' },
  error: { color: '#C62828', fontSize: 14, marginBottom: 12 },
  primary: { backgroundColor: '#111', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  primaryText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  secondary: { alignItems: 'center', paddingVertical: 14 },
  secondaryText: { color: '#111', fontSize: 16, fontWeight: '600' },
});
