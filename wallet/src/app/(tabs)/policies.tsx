import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { listMyRequests, type ChildRequestStatus } from '@/nlpps/client';
import { getLink, loadPolicy, type GuardianLink, type LoadedPolicy } from '@/nlpps/store';
import { syncPolicy, type SyncResult } from '@/nlpps/sync';
import { describeRule, isExpired, type Rule } from '@/policy';

const EFFECT = {
  hide: { label: 'OFF', style: 'deny' },
  ask: { label: 'ASK FIRST', style: 'approve' },
} as const;

function ago(ms: number | undefined): string {
  if (!ms) return 'never';
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function syncMessage(result: SyncResult | null): string | null {
  if (!result) return null;
  switch (result.status) {
    case 'updated':
      return `Updated to version ${result.version}.`;
    case 'unchanged':
      return 'Up to date.';
    case 'offline':
      return 'Couldn’t reach the guardian’s server. Using the rules already on this phone.';
    case 'rejected':
      return `A policy from the server was refused (${result.reason}). The rules on this phone still apply.`;
    case 'unlinked':
      return 'A guardian unlinked this wallet.';
    default:
      return null;
  }
}

// The child's view of the family rules: read-only. Rules are written by
// guardians in Family Rules on their own phones; this wallet downloads the
// signed policy and enforces it.
export default function FamilyRulesScreen() {
  const [link, setLink] = useState<GuardianLink | null | undefined>(undefined);
  const [policy, setPolicy] = useState<LoadedPolicy | null>(null);
  const [requests, setRequests] = useState<ChildRequestStatus[]>([]);
  const [sync, setSync] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (withSync: boolean) => {
    setBusy(true);
    try {
      if (withSync) setSync(await syncPolicy(8000));
      const current = await getLink();
      setLink(current);
      setPolicy(await loadPolicy());
      if (current) {
        listMyRequests(current).then(setRequests, () => undefined);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh(true);
    }, [refresh]),
  );

  if (link === undefined) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#111" />
      </View>
    );
  }

  if (!link) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <Text style={styles.title}>Family rules</Text>
        {sync?.status === 'unlinked' ? <Text style={styles.notice}>{syncMessage(sync)}</Text> : null}
        <Text style={styles.text}>
          This wallet isn’t linked to a guardian. A parent can set rules from their own phone in
          Family Rules, then link this wallet by showing you a QR code.
        </Text>
        <Pressable style={styles.primary} onPress={() => router.push('/pair')}>
          <Text style={styles.primaryText}>Link to a guardian</Text>
        </Pressable>
        <Text style={styles.small}>
          You can also scan the guardian’s QR code with the iPhone Camera app.
        </Text>
      </ScrollView>
    );
  }

  const bundle = policy?.status === 'ok' ? policy.envelope.bundle : null;
  const rules: Rule[] = bundle ? [...bundle.policy.rules].sort((a, b) => a.effect.localeCompare(b.effect)) : [];
  const expired = policy?.status === 'ok' && isExpired(policy.envelope, new Date());

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => refresh(true)} />}
    >
      <Text style={styles.title}>Family rules</Text>
      <Text style={styles.text}>Set by {link.childName}’s guardians. Pull down to check for changes.</Text>

      <View style={styles.card}>
        {policy?.status === 'ok' ? (
          <>
            <Text style={styles.cardLabel}>VERSION {bundle?.policy.version}</Text>
            <Text style={styles.meta}>Signatures verified · synced {ago(policy.meta.syncedAt)}</Text>
            {expired ? <Text style={styles.warn}>These rules are out of date. Until this phone connects, everything needs a guardian’s OK.</Text> : null}
            {policy.meta.lastError && (policy.meta.lastAttemptAt ?? 0) > policy.meta.syncedAt ? (
              <Text style={styles.warn}>Last check failed: {policy.meta.lastError}</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.warn}>
            No verified copy of the rules yet ({policy?.status === 'tampered' ? policy.reason : 'not downloaded'}).
            The wallet won’t share age proofs until it syncs.
          </Text>
        )}
        {syncMessage(sync) && sync?.status !== 'unchanged' ? <Text style={styles.meta}>{syncMessage(sync)}</Text> : null}
        <Pressable style={styles.secondaryButton} onPress={() => refresh(true)} disabled={busy}>
          <Text style={styles.secondaryText}>{busy ? 'Checking…' : 'Sync now'}</Text>
        </Pressable>
        {sync?.status === 'offline' || policy?.status !== 'ok' ? (
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/pair')}>
            <Text style={styles.secondaryText}>Server moved? Link again</Text>
          </Pressable>
        ) : null}
        {policy?.status === 'ok' ? (
          <Pressable style={styles.secondaryButton} onPress={() => router.push('/policy-source')}>
            <Text style={styles.secondaryText}>View whole policy (JSON and Cedar)</Text>
          </Pressable>
        ) : null}
      </View>

      {rules.map((rule) => (
        <Pressable key={rule.id} style={styles.rule} onPress={() => router.push({ pathname: '/policy-source', params: { rule: rule.id } })}>
          <Text style={[styles.badge, styles[EFFECT[rule.effect].style]]}>{EFFECT[rule.effect].label}</Text>
          <Text style={styles.ruleChild}>{rule.explanation.child}</Text>
          <Text style={styles.ruleDetail}>{bundle ? describeRule(rule, bundle.policy) : null}</Text>
          <Text style={styles.ruleLink}>JSON and Cedar ›</Text>
        </Pressable>
      ))}

      {requests.length > 0 ? (
        <>
          <Text style={styles.section}>Your requests</Text>
          {requests.map((r) => (
            <View key={r.id} style={styles.request}>
              <Text style={styles.requestTitle}>{r.content.title ?? r.content.content_id}</Text>
              <Text style={styles.meta}>
                {r.status === 'pending' ? 'Waiting for a guardian' : r.status === 'approved' ? 'Approved' : r.status === 'denied' ? 'A guardian said no' : 'Resolved'}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#F7F8FA' },
  container: { flexGrow: 1, backgroundColor: '#F7F8FA', padding: 24, paddingTop: 70, paddingBottom: 40 },
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 34, fontWeight: '700', marginBottom: 8 },
  text: { fontSize: 16, lineHeight: 23, color: '#555', marginBottom: 20 },
  small: { fontSize: 13, color: '#777', textAlign: 'center', marginTop: 12 },
  notice: { fontSize: 15, color: '#1E7A46', marginBottom: 12 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, marginBottom: 18 },
  cardLabel: { fontSize: 12, fontWeight: '700', opacity: 0.6, marginBottom: 4 },
  meta: { fontSize: 13, color: '#666', lineHeight: 19 },
  warn: { fontSize: 13, color: '#A15C07', lineHeight: 19, marginTop: 4 },
  rule: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, marginBottom: 10 },
  badge: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden', marginBottom: 8 },
  deny: { backgroundColor: '#FDECEA', color: '#B42318' },
  approve: { backgroundColor: '#FFF4E0', color: '#A15C07' },
  allow: { backgroundColor: '#E7F6EE', color: '#1E7A46' },
  ruleChild: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  ruleDetail: { fontSize: 13, color: '#666' },
  ruleLink: { fontSize: 13, fontWeight: '600', color: '#111', marginTop: 8 },
  section: { fontSize: 20, fontWeight: '700', marginTop: 18, marginBottom: 10 },
  request: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 8 },
  requestTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  primary: { backgroundColor: '#111', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  primaryText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  secondaryButton: { borderWidth: 1, borderColor: '#DDD', borderRadius: 12, paddingVertical: 11, alignItems: 'center', marginTop: 12 },
  secondaryText: { color: '#111', fontSize: 15, fontWeight: '600' },
});
