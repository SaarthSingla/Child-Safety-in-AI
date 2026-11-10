import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { findTrustedCurationVerifier } from '@/config/verifierRegistry';
import { getCredential } from '@/crypto/credentialStore';
import { getOrCreateHolderKey, signWithHolderKey } from '@/crypto/holderKey';
import { buildPresentation } from '@/crypto/keyBinding';
import { verifySdJwtCredential } from '@/crypto/sdJwt';
import { cedarEngine } from '@/nlpps/CedarEngine';
import { boundNonce, decodeManifest, encodeResult, resultFrom } from '@/nlpps/curation';
import { curateManifest } from '@/nlpps/decide';
import { allowCuration, grantCurationConsent, hasCurationConsent } from '@/nlpps/store';

type Params = {
  requestId: string;
  verifierId: string;
  callbackUrl: string;
  nonce: string;
  createdAt: string;
  expiresAt: string;
  manifest: string;
};

function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

type Phase = 'checking' | 'consent' | 'working' | 'error';

// A platform asks the wallet to apply the family's rules to a list of items
// (its feed). The wallet evaluates each item against the signed guardian
// policy and returns only a decision per item, bound to the platform's
// challenge with a Key Binding proof that discloses no claims at all.
export default function CurateRequestScreen() {
  const params = useLocalSearchParams<Params>();
  const [phase, setPhase] = useState<Phase>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  const verifier = findTrustedCurationVerifier(params.verifierId, params.callbackUrl);
  const manifest = decodeManifest(params.manifest);
  const expiresAt = Number(params.expiresAt);
  const malformed = !params.requestId || !params.nonce || !manifest || !Number.isFinite(expiresAt);
  const expired = !malformed && Date.now() > expiresAt;

  const respond = useCallback(
    async (extra: Record<string, string>) => {
      if (!verifier) return;
      try {
        await Linking.openURL(`${verifier.curationCallbackUrl}?${toQueryString({ requestId: params.requestId, ...extra })}`);
      } catch (err) {
        console.error('Failed to return to platform:', err);
      }
      router.replace('/');
    },
    [verifier, params.requestId],
  );

  const run = useCallback(async () => {
    if (!verifier || !manifest) return;
    setPhase('working');

    try {
      if (!(await allowCuration(verifier.verifierId))) {
        await respond({ error: 'too_many_requests' });
        return;
      }

      const curated = await curateManifest(cedarEngine, manifest);

      if (curated.kind === 'unavailable') {
        await respond({ error: 'family_rules_unavailable' });
        return;
      }

      const stored = await getCredential();
      const holder = await getOrCreateHolderKey();

      if (!stored || !verifySdJwtCredential(stored.credential, holder.publicJwk).verified) {
        // Without a valid credential the wallet cannot prove the decisions
        // came from it, so the platform must not rely on them.
        await respond({ error: 'no_credential' });
        return;
      }

      const resultParam = encodeResult(
        resultFrom({
          requestId: params.requestId,
          manifestParam: params.manifest,
          policy: curated.kind === 'decided' ? curated.policy : null,
          decisions: curated.kind === 'decided' ? curated.decisions : [],
          now: curated.now,
          validUntil: curated.validUntil,
        }),
      );
      const presentation = await buildPresentation({
        credential: stored.credential,
        signWithHolderKey,
        audience: verifier.verifierId,
        nonce: boundNonce(params.nonce, resultParam),
        // Nothing is disclosed: the proof only shows this wallet holds a
        // valid credential and signed these exact decisions.
        disclose: [],
      });

      await respond({ result: resultParam, presentation });
    } catch (err) {
      console.error('Curation failed:', err);
      setPhase('error');
      setMessage(err instanceof Error ? err.message : 'Could not apply your family rules.');
    }
  }, [verifier, manifest, params.manifest, params.requestId, params.nonce, respond]);

  useEffect(() => {
    if (started.current || malformed || expired || !verifier) return;
    started.current = true;

    hasCurationConsent(verifier.verifierId).then((ok) => (ok ? run() : setPhase('consent')));
  }, [malformed, expired, verifier, run]);

  if (malformed || expired || !verifier) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{!verifier ? 'Unknown app' : expired ? 'Request expired' : 'Invalid request'}</Text>
        <Text style={styles.text}>
          {!verifier
            ? 'This wallet only applies family rules for apps it recognises.'
            : 'Go back to the app and try again.'}
        </Text>
        <Pressable style={styles.secondary} onPress={() => router.replace('/')}>
          <Text style={styles.secondaryText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'consent') {
    return (
      <View style={styles.container}>
        <Text style={styles.eyebrow}>Family rules</Text>
        <Text style={styles.title}>{verifier.displayName} wants to apply your family’s rules</Text>
        <Text style={styles.text}>
          Your wallet will check {manifest!.items.length} items from {verifier.displayName} against your
          family’s rules and tell {verifier.displayName} which ones to hide or ask a guardian
          about.
        </Text>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>{verifier.displayName.toUpperCase()} WILL LEARN</Text>
          <Text style={styles.note}>Which of its items are allowed, hidden or need a guardian’s OK.</Text>
          <Text style={[styles.cardLabel, styles.spaced]}>IT WILL NOT LEARN</Text>
          <Text style={styles.note}>Your family’s rules, your age, your name or your selfie.</Text>
        </View>
        <Pressable
          style={styles.primary}
          onPress={async () => {
            await grantCurationConsent(verifier.verifierId);
            run();
          }}
        >
          <Text style={styles.primaryText}>Allow</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => respond({ error: 'declined' })}>
          <Text style={styles.secondaryText}>Not now</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Couldn’t apply family rules</Text>
        <Text style={styles.text}>{message}</Text>
        <Pressable style={styles.primary} onPress={() => respond({ error: 'failed' })}>
          <Text style={styles.primaryText}>Back to {verifier.displayName}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.center]}>
      <ActivityIndicator size="large" color="#111" />
      <Text style={[styles.text, styles.centerText]}>Applying your family’s rules…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA', padding: 24, paddingTop: 48 },
  center: { justifyContent: 'center', alignItems: 'center' },
  centerText: { textAlign: 'center', marginTop: 16 },
  eyebrow: { fontSize: 13, fontWeight: '700', color: '#777', textTransform: 'uppercase', marginBottom: 10 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 10 },
  text: { fontSize: 16, lineHeight: 23, color: '#555', marginBottom: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginBottom: 24 },
  cardLabel: { fontSize: 11, fontWeight: '700', opacity: 0.55, marginBottom: 6 },
  spaced: { marginTop: 14 },
  note: { fontSize: 14, lineHeight: 20, color: '#333' },
  primary: { backgroundColor: '#111', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  primaryText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  secondary: { alignItems: 'center', paddingVertical: 14 },
  secondaryText: { color: '#111', fontSize: 16, fontWeight: '600' },
});
