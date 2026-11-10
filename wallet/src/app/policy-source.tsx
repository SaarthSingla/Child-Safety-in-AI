import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { loadPolicy, type LoadedPolicy } from '@/nlpps/store';
import { cedarEntries, cedarText, jsonText } from '@/nlpps/source';

type Mode = 'json' | 'cedar';

// Shows exactly what this phone enforces: the verified policy (or one rule
// of it) as JSON, and the Cedar policies generated from it. Read-only.
export default function PolicySourceScreen() {
  const { rule: ruleId } = useLocalSearchParams<{ rule?: string }>();
  const [policy, setPolicy] = useState<LoadedPolicy | null>(null);
  const [view, setView] = useState<Mode>('json');

  useEffect(() => {
    loadPolicy().then(setPolicy);
  }, []);

  if (!policy) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#111" />
      </View>
    );
  }

  if (policy.status !== 'ok') {
    return (
      <View style={styles.container}>
        <BackButton />
        <Text style={styles.warn}>No verified policy on this phone yet.</Text>
      </View>
    );
  }

  const { envelope } = policy;
  const rule = ruleId ? envelope.bundle.policy.rules.find((r) => r.id === ruleId) : undefined;

  if (ruleId && !rule) {
    return (
      <View style={styles.container}>
        <BackButton />
        <Text style={styles.warn}>This rule is no longer in the policy.</Text>
      </View>
    );
  }

  const entries = cedarEntries(envelope.bundle.compiled, rule);
  const text = view === 'json' ? jsonText(envelope, rule) : cedarText(entries);

  return (
    <View style={styles.container}>
      <BackButton />
      <Text style={styles.title}>{rule ? `Rule ${rule.id}` : `Policy version ${envelope.bundle.policy.version}`}</Text>
      <Text style={styles.meta}>
        {rule
          ? `${rule.layer} rule · ${entries.length} Cedar ${entries.length === 1 ? 'policy' : 'policies'}`
          : `Signatures verified · ${entries.length} Cedar policies`}
      </Text>

      <View style={styles.tabs}>
        {(['json', 'cedar'] as const).map((option) => (
          <Pressable key={option} style={[styles.tab, view === option && styles.tabOn]} onPress={() => setView(option)}>
            <Text style={[styles.tabText, view === option && styles.tabTextOn]}>{option === 'json' ? 'JSON' : 'Cedar'}</Text>
          </Pressable>
        ))}
      </View>

      {view === 'cedar' ? (
        <Text style={styles.note}>
          The phone checks the hide set first, then the ask set. A matching forbid means hide (or ask).
        </Text>
      ) : null}

      <ScrollView style={styles.codeBox} contentContainerStyle={styles.codeInner}>
        <Text selectable style={styles.code}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

function BackButton() {
  return (
    <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
      <Text style={styles.backText}>‹ Back</Text>
    </Pressable>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA', padding: 20, paddingTop: 60 },
  center: { justifyContent: 'center', alignItems: 'center' },
  back: { alignSelf: 'flex-start', marginBottom: 10 },
  backText: { fontSize: 17, fontWeight: '600', color: '#111' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  meta: { fontSize: 13, color: '#666', marginBottom: 14 },
  warn: { fontSize: 15, color: '#A15C07', marginTop: 12 },
  tabs: { flexDirection: 'row', backgroundColor: '#E9ECEF', borderRadius: 10, padding: 3, marginBottom: 10 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabOn: { backgroundColor: '#FFFFFF' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#666' },
  tabTextOn: { color: '#111' },
  note: { fontSize: 12, color: '#666', marginBottom: 8, lineHeight: 17 },
  codeBox: { flex: 1, backgroundColor: '#14181F', borderRadius: 12 },
  codeInner: { padding: 14 },
  code: { fontFamily: mono, fontSize: 11.5, lineHeight: 16, color: '#E6EDF3' },
});
