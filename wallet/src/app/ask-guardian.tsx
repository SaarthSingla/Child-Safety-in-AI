import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { findVerifierById } from '@/config/verifierRegistry';
import { AskGuardianPanel } from '@/nlpps/AskGuardianPanel';
import { cedarEngine } from '@/nlpps/CedarEngine';
import { decodeManifest } from '@/nlpps/curation';
import { decideContent, type WalletDecision } from '@/nlpps/decide';

// Opened by a platform (childsafewallet://ask-guardian?verifierId=…&labels=…)
// when the family rules hide an item, so the child can ask a guardian.
export default function AskGuardianScreen() {
  const params = useLocalSearchParams<{ verifierId: string; labels: string }>();
  const verifier = findVerifierById(params.verifierId);
  const [decision, setDecision] = useState<WalletDecision | null>(null);
  const manifest = decodeManifest(params.labels);

  useEffect(() => {
    if (!verifier) return;
    decideContent(cedarEngine, manifest, `${params.verifierId}:unknown`).then(setDecision, (err) =>
      setDecision({ kind: 'unavailable', reason: err instanceof Error ? err.message : 'evaluation failed', record: null }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.labels]);

  const back = async () => {
    if (verifier) {
      try {
        await Linking.openURL(verifier.appUrl);
      } catch {
        // stay in the wallet
      }
    }
    router.replace('/');
  };

  if (!verifier) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Unknown app</Text>
        <Pressable style={styles.secondary} onPress={() => router.replace('/')}>
          <Text style={styles.secondaryText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  if (!decision) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#111" />
      </View>
    );
  }

  if (decision.kind !== 'decided') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{decision.kind === 'no_policy' ? 'No family rules here' : 'Can’t check your family rules'}</Text>
        <Text style={styles.text}>
          {decision.kind === 'no_policy'
            ? 'This wallet isn’t linked to a guardian, so there’s nobody to ask.'
            : `This wallet doesn’t have a verified copy of the rules right now (${decision.reason}). Open Policies and tap Sync.`}
        </Text>
        <Pressable style={styles.primary} onPress={back}>
          <Text style={styles.primaryText}>Back to {verifier.displayName}</Text>
        </Pressable>
      </View>
    );
  }

  if (decision.result.decision === 'allow') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>It’s allowed now</Text>
        <Text style={styles.text}>Your family’s rules allow this. Go back and refresh to open it.</Text>
        <Pressable style={styles.primary} onPress={back}>
          <Text style={styles.primaryText}>Back to {verifier.displayName}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <AskGuardianPanel
        record={decision.record}
        decision={decision.result}
        message={decision.message}
        platformName={verifier.displayName}
        onDone={back}
        doneLabel={`Back to ${verifier.displayName}`}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#F7F8FA' },
  container: { flexGrow: 1, backgroundColor: '#F7F8FA', padding: 24, paddingTop: 48 },
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 10 },
  text: { fontSize: 16, lineHeight: 23, color: '#555', marginBottom: 20 },
  primary: { backgroundColor: '#111', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  primaryText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  secondary: { alignItems: 'center', paddingVertical: 14 },
  secondaryText: { color: '#111', fontSize: 16, fontWeight: '600' },
});
