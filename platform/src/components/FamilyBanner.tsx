import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getFamilyState } from '@/family/familyState';
import { requestFamilyRules } from '@/family/openWallet';
import { colors, radii } from '@/theme';

function minutesUntil(ms: number): string {
  const minutes = Math.max(0, Math.round((ms - Date.now()) / 60000));
  return minutes >= 60 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;
}

// Shows whether the family's rules (from ChildSafe Wallet) are applied to
// the feed, and lets the reader apply or refresh them.
export function FamilyBanner() {
  const state = getFamilyState();
  const now = Date.now();

  let title: string;
  let body: string;
  let action: string | null;

  if (state.status === 'active' && now < state.validUntilMs) {
    const hidden = [...state.decisions.values()].filter((d) => d !== 'allow').length;
    title = `Family rules on · version ${state.version}`;
    body = `${hidden} article${hidden === 1 ? '' : 's'} hidden or waiting for a guardian’s OK. Rechecks in ${minutesUntil(state.validUntilMs)}.`;
    action = 'Refresh';
  } else if (state.status === 'active') {
    title = 'Family rules need a refresh';
    body = 'Your wallet’s decisions have expired (rules can depend on the time of day).';
    action = 'Refresh family rules';
  } else if (state.status === 'none') {
    title = 'No family rules';
    body = 'Your wallet isn’t linked to a guardian, so nothing extra is hidden.';
    action = null;
  } else {
    title = 'Family rules';
    body = 'If your family uses ChildSafe, your wallet can hide what your guardians’ rules don’t allow. Footube never sees the rules.';
    action = 'Apply family rules';
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.icon}>👪</Text>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {action ? (
          <Pressable onPress={() => requestFamilyRules()} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <Text style={styles.buttonText}>{action}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginTop: 12,
  },
  icon: { fontSize: 16, marginRight: 10 },
  text: { flex: 1 },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 2 },
  body: { fontSize: 13, lineHeight: 19, color: colors.body },
  button: {
    alignSelf: 'flex-start',
    marginTop: 10,
    backgroundColor: colors.ink,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pressed: { opacity: 0.8 },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
});
