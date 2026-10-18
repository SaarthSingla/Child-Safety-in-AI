import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { describeRule, isValidTime } from '@/policy/evaluate';
import {
  addPolicy,
  checkGuardianPin,
  hasGuardianPin,
  loadPolicies,
  removePolicy,
  setGuardianPin,
} from '@/policy/store';
import { POLICY_TEMPLATES, type PolicyTemplate } from '@/policy/templates';
import { ANY_CATEGORY, CONTENT_CATEGORIES, type PolicyRule } from '@/policy/types';

type Gate = 'loading' | 'create-pin' | 'enter-pin' | 'open';

const PIN_PATTERN = /^\d{4,6}$/;

export default function GuardianPolicyScreen() {
  const [gate, setGate] = useState<Gate>('loading');
  const [pin, setPin] = useState('');
  const [rules, setRules] = useState<PolicyRule[]>([]);

  const [category, setCategory] = useState<string>(ANY_CATEGORY);
  const [timed, setTimed] = useState(false);
  const [after, setAfter] = useState('21:00');
  const [before, setBefore] = useState('06:00');
  const [explanation, setExplanation] = useState('');

  // A tab stays mounted, so lock again whenever the guardian leaves it.
  useFocusEffect(
    useCallback(() => {
      hasGuardianPin().then((exists) => setGate(exists ? 'enter-pin' : 'create-pin'));

      return () => {
        setPin('');
        setGate('loading');
      };
    }, []),
  );

  const open = async () => {
    setRules(await loadPolicies());
    setPin('');
    setGate('open');
  };

  const submitPin = async () => {
    if (!PIN_PATTERN.test(pin)) {
      Alert.alert('Guardian PIN', 'Use 4 to 6 digits.');
      return;
    }

    if (gate === 'create-pin') {
      await setGuardianPin(pin);
      await open();
      return;
    }

    if (await checkGuardianPin(pin)) {
      await open();
    } else {
      setPin('');
      Alert.alert('Guardian PIN', 'That PIN is not correct.');
    }
  };

  const addTemplate = async (template: PolicyTemplate) => {
    setRules(await addPolicy(template.rule));
  };

  const addCustom = async () => {
    if (timed && (!isValidTime(after) || !isValidTime(before))) {
      Alert.alert('Time window', 'Enter times as HH:MM, for example 21:00.');
      return;
    }

    const what = category === ANY_CATEGORY ? 'All content' : category;

    setRules(
      await addPolicy({
        category,
        condition: timed ? { time: { after, before } } : undefined,
        explanation:
          explanation.trim() || (timed ? `${what} blocked ${after}–${before}` : `${what} blocked`),
      }),
    );
    setExplanation('');
  };

  const remove = (rule: PolicyRule) => {
    Alert.alert('Remove policy', rule.explanation, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => setRules(await removePolicy(rule.id)),
      },
    ]);
  };

  if (gate === 'loading') {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#111" />
      </View>
    );
  }

  if (gate !== 'open') {
    const creating = gate === 'create-pin';

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Guardian controls</Text>
        <Text style={styles.text}>
          {creating
            ? 'Set a guardian PIN. Only someone with this PIN can change the content policies on this device.'
            : 'Enter the guardian PIN to view or change content policies.'}
        </Text>

        <TextInput
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
          placeholder={creating ? 'New PIN (4–6 digits)' : 'Guardian PIN'}
          style={styles.input}
          onSubmitEditing={submitPin}
        />

        <Pressable style={styles.primaryButton} onPress={submitPin}>
          <Text style={styles.primaryButtonText}>{creating ? 'Set PIN' : 'Unlock'}</Text>
        </Pressable>
      </View>
    );
  }

  const activeTemplates = new Set(rules.map((rule) => rule.explanation));

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.title}>Guardian controls</Text>
      <Text style={styles.text}>
        These rules are checked in the wallet every time an app asks for an age
        proof. A platform may allow content, and the wallet can still block it
        here.
      </Text>

      <Text style={styles.sectionTitle}>Active policies</Text>
      {rules.length === 0 ? (
        <Text style={styles.muted}>No policies yet.</Text>
      ) : (
        rules.map((rule) => (
          <View key={rule.id} style={styles.ruleCard}>
            <View style={styles.ruleBody}>
              <Text style={styles.ruleTitle}>{rule.explanation}</Text>
              <Text style={styles.ruleMeta}>{describeRule(rule)}</Text>
            </View>
            <Pressable onPress={() => remove(rule)} hitSlop={8}>
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>Quick policies</Text>
      {POLICY_TEMPLATES.map((template) => {
        const added = activeTemplates.has(template.rule.explanation);

        return (
          <Pressable
            key={template.key}
            disabled={added}
            onPress={() => addTemplate(template)}
            style={[styles.templateRow, added && styles.dimmed]}
          >
            <Text style={styles.templateText}>{template.label}</Text>
            <Text style={styles.templateAction}>{added ? 'Added' : 'Add'}</Text>
          </Pressable>
        );
      })}

      <Text style={styles.sectionTitle}>Custom policy</Text>
      <View style={styles.formCard}>
        <Text style={styles.label}>Block</Text>
        <View style={styles.chips}>
          {[ANY_CATEGORY, ...CONTENT_CATEGORIES].map((value) => (
            <Pressable
              key={value}
              onPress={() => setCategory(value)}
              style={[styles.chip, category === value && styles.chipSelected]}
            >
              <Text style={[styles.chipText, category === value && styles.chipTextSelected]}>
                {value === ANY_CATEGORY ? 'All content' : value}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>When</Text>
        <View style={styles.chips}>
          {[false, true].map((value) => (
            <Pressable
              key={String(value)}
              onPress={() => setTimed(value)}
              style={[styles.chip, timed === value && styles.chipSelected]}
            >
              <Text style={[styles.chipText, timed === value && styles.chipTextSelected]}>
                {value ? 'Between times' : 'Always'}
              </Text>
            </Pressable>
          ))}
        </View>

        {timed && (
          <View style={styles.timeRow}>
            <TextInput value={after} onChangeText={setAfter} placeholder="21:00" style={[styles.input, styles.timeInput]} />
            <Text style={styles.muted}>to</Text>
            <TextInput value={before} onChangeText={setBefore} placeholder="06:00" style={[styles.input, styles.timeInput]} />
          </View>
        )}

        <Text style={styles.label}>Message shown to the child (optional)</Text>
        <TextInput
          value={explanation}
          onChangeText={setExplanation}
          placeholder="e.g. Not on school nights"
          style={styles.input}
        />

        <Pressable style={styles.primaryButton} onPress={addCustom}>
          <Text style={styles.primaryButtonText}>Add policy</Text>
        </Pressable>
      </View>

      <Text style={styles.demoNote}>
        Demo: guardian authority is a PIN on this device, and policies are not
        signed. In CHAISE, the relationship graph (CRGS) authorises the
        guardian and the policy service (NLPPS) signs each policy.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA', padding: 24, paddingTop: 24 },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1, backgroundColor: '#F7F8FA' },
  scrollContent: { padding: 24, paddingTop: 24, paddingBottom: 60 },
  title: { fontSize: 30, fontWeight: '700', marginBottom: 10 },
  text: { fontSize: 15, lineHeight: 22, color: '#555', marginBottom: 22 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 8, marginBottom: 12 },
  muted: { color: '#888', fontSize: 14, marginBottom: 12 },
  ruleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  ruleBody: { flex: 1, marginRight: 12 },
  ruleTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  ruleMeta: { fontSize: 13, color: '#777' },
  removeText: { color: '#C62828', fontSize: 14, fontWeight: '600' },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  templateText: { fontSize: 15, flex: 1, marginRight: 12 },
  templateAction: { fontSize: 14, fontWeight: '700', color: '#111' },
  dimmed: { opacity: 0.5 },
  formCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 18, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { borderWidth: 1, borderColor: '#DDD', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipSelected: { backgroundColor: '#111', borderColor: '#111' },
  chipText: { fontSize: 13, color: '#333' },
  chipTextSelected: { color: '#FFF', fontWeight: '600' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  timeInput: { flex: 1, marginBottom: 0 },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    backgroundColor: '#FFF',
    marginBottom: 14,
  },
  primaryButton: { backgroundColor: '#111', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  primaryButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  demoNote: { fontSize: 12, lineHeight: 18, color: '#999', textAlign: 'center' },
});
