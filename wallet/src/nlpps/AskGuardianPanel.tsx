import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ContentRecord, ItemDecision } from '@/policy';

import { askGuardian } from './client';
import { getLink } from './store';

type Props = {
  record: ContentRecord;
  decision: ItemDecision;
  message: string;
  platformName: string;
  onDone: () => void;
  doneLabel: string;
};

// Shown when a family rule stops something. The child sees a simple reason and
// can ask a guardian. The request carries only the item and why it stopped.
export function AskGuardianPanel({ record, decision, message, platformName, onDone, doneLabel }: Props) {
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const needsOk = decision.decision === 'ask';

  const send = async () => {
    setState('sending');
    setError(null);
    try {
      const link = await getLink();
      if (!link) throw new Error('This wallet is not linked to a guardian.');
      await askGuardian(link, { record, reasons: decision.reasons, note: note.trim() || undefined });
      setState('sent');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Could not reach your guardian’s server.');
    }
  };

  return (
    <View>
      <Text style={styles.eyebrow}>Family rules</Text>
      <Text style={styles.title}>{needsOk ? 'Needs a guardian’s OK' : 'Not right now'}</Text>
      {record.title ? <Text style={styles.item}>{record.title}</Text> : null}

      <View style={[styles.card, needsOk ? styles.cardApprove : styles.cardDeny]}>
        <Text style={styles.reason}>{message}</Text>
        <Text style={styles.note}>{platformName} is only told that a family rule applies, not which one.</Text>
      </View>

      {state === 'sent' ? (
        <View style={[styles.card, styles.cardSent]}>
          <Text style={styles.sentTitle}>Request sent</Text>
          <Text style={styles.note}>When a guardian says yes, this will open. Check back in a little while.</Text>
        </View>
      ) : decision.reasons.length > 0 ? (
        <View>
          <Text style={styles.label}>Want to ask a guardian? (optional note)</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="For example: it’s for my history homework" style={styles.input} maxLength={300} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.primary} onPress={send} disabled={state === 'sending'}>
            {state === 'sending' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Ask a guardian</Text>}
          </Pressable>
        </View>
      ) : null}

      <Pressable style={styles.secondary} onPress={onDone}>
        <Text style={styles.secondaryText}>{doneLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 13, fontWeight: '700', color: '#777', textTransform: 'uppercase', marginBottom: 10 },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 6 },
  item: { fontSize: 16, color: '#555', marginBottom: 16 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginBottom: 20, borderWidth: 1 },
  cardDeny: { borderColor: '#F3C9A6' },
  cardApprove: { borderColor: '#F4DDA0' },
  cardSent: { borderColor: '#B9E2C8' },
  reason: { fontSize: 19, fontWeight: '700', marginBottom: 10 },
  note: { fontSize: 13, lineHeight: 19, color: '#555' },
  sentTitle: { fontSize: 18, fontWeight: '700', marginBottom: 6, color: '#1E7A46' },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8, color: '#333' },
  input: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#DDD', borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 12 },
  error: { color: '#C62828', fontSize: 14, marginBottom: 12 },
  primary: { backgroundColor: '#111', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  primaryText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  secondary: { alignItems: 'center', paddingVertical: 14 },
  secondaryText: { color: '#111', fontSize: 16, fontWeight: '600' },
});
