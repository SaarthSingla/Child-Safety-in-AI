import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import {
  bandSatisfies,
  getRequirementInfo,
  parseAgeRequirement,
} from '@/config/ageRequirements';
import { findTrustedVerifier } from '@/config/verifierRegistry';
import { getOrCreateHolderKey, signWithHolderKey } from '@/crypto/holderKey';
import { getCredential } from '@/crypto/credentialStore';
import { buildPresentation } from '@/crypto/keyBinding';
import { verifySdJwtCredential } from '@/crypto/sdJwt';
import { AskGuardianPanel } from '@/nlpps/AskGuardianPanel';
import { cedarEngine } from '@/nlpps/CedarEngine';
import { decodeManifest } from '@/nlpps/curation';
import { decideContent, type WalletDecision } from '@/nlpps/decide';

// Transport-level types for the demo Footube <-> wallet handoff. The
// cryptographic semantics live entirely in sdJwt.ts; this is only the
// envelope carried over the deep link.
type IncomingParams = {
  requestId: string;
  requestedAgeBand: string;
  verifierId: string;
  callbackUrl: string;
  nonce: string;
  createdAt: string;
  expiresAt: string;
  // The content's labels. Missing labels count as "not checked".
  labels?: string;
};

// Blocks unless the guardian policy (if any) allows this content. A linked
// wallet whose policy cannot be verified fails closed.
function isBlocked(decision: WalletDecision | null): boolean {
  if (!decision) return true;
  if (decision.kind === 'no_policy') return false;
  if (decision.kind === 'unavailable') return true;
  return decision.result.decision !== 'allow';
}

function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

type Status = 'reviewing' | 'checking' | 'done';

export default function VerifyRequestScreen() {
  const params = useLocalSearchParams<IncomingParams>();
  const [status, setStatus] = useState<Status>('reviewing');
  const [error, setError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<WalletDecision | null>(null);

  const expiresAt = Number(params.expiresAt);
  const createdAt = Number(params.createdAt);

  const requirement = parseAgeRequirement(params.requestedAgeBand);

  const malformed =
    !requirement ||
    !params.requestId ||
    !params.callbackUrl ||
    !params.verifierId ||
    !params.nonce ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(createdAt);

  const expired = !malformed && Date.now() > expiresAt;

  // Only verifiers on the wallet's allowlist, and only their registered
  // callback, are ever presented to.
  const verifier = malformed
    ? undefined
    : findTrustedVerifier(params.verifierId, params.callbackUrl);

  const manifest = decodeManifest(params.labels);
  const fallbackId = `${params.verifierId}:${params.requestId}`;

  useEffect(() => {
    let active = true;

    decideContent(cedarEngine, manifest, fallbackId)
      .then((decision) => active && setPolicy(decision))
      // Fail closed: if the policy cannot be evaluated, nothing is presented.
      .catch((err) => active && setPolicy({ kind: 'unavailable', reason: err instanceof Error ? err.message : 'evaluation failed', record: null }));

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.labels]);

  async function respond(extra: Record<string, string>) {
    if (!verifier) {
      return;
    }

    const query = toQueryString({ requestId: params.requestId, ...extra });

    try {
      await Linking.openURL(`${verifier.callbackUrl}?${query}`);
    } catch (err) {
      console.error('Failed to return to verifier:', err);
    }

    router.replace('/');
  }

  const handleDeny = () => {
    respond({ denied: 'true', reason: 'user_denied' });
  };

  // The platform is told only that a policy blocked this, never which rule.
  const handlePolicyBlocked = () => {
    respond({ denied: 'true', reason: 'policy_blocked' });
  };

  const handleApprove = async () => {
    if (!requirement) {
      return;
    }

    setStatus('checking');
    setError(null);

    try {
      // Re-checked at approval time: a time-window rule may have started
      // since the screen opened.
      const decision = await decideContent(cedarEngine, manifest, fallbackId);

      if (isBlocked(decision)) {
        setPolicy(decision);
        setStatus('reviewing');
        return;
      }

      const holderKey = await getOrCreateHolderKey();
      const stored = await getCredential();

      if (!stored) {
        setStatus('done');
        await respond({ denied: 'true', reason: 'no_credential' });
        return;
      }

      const verification = verifySdJwtCredential(
        stored.credential,
        holderKey.publicJwk,
      );

      const satisfiesAgeRequirement =
        verification.verified && bandSatisfies(stored.ageBand, requirement);

      if (!satisfiesAgeRequirement) {
        setStatus('done');
        await respond({
          denied: 'true',
          reason: verification.verified
            ? 'age_requirement_not_met'
            : 'credential_invalid',
        });
        return;
      }

      // SD-JWT + Key Binding JWT. Only age_band is disclosed (not
      // prediction_confidence or assurance_method), and the KB-JWT is signed
      // inside the Secure Enclave over the verifier's nonce and audience.
      const presentation = await buildPresentation({
        credential: stored.credential,
        signWithHolderKey,
        audience: params.verifierId,
        nonce: params.nonce,
        disclose: ['age_band'],
      });

      setStatus('done');
      await respond({ presentation });
    } catch (err) {
      console.error('Approval failed:', err);
      setStatus('reviewing');
      setError(
        err instanceof Error ? err.message : 'Could not process this request.',
      );
    }
  };

  if (malformed || expired) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>
          {expired ? 'Request expired' : 'Invalid request'}
        </Text>

        <Text style={styles.text}>
          {expired
            ? 'This verification request has expired. Go back to the app and try again.'
            : 'This verification request is malformed and cannot be processed.'}
        </Text>

        <Pressable style={styles.secondaryButton} onPress={() => router.replace('/')}>
          <Text style={styles.secondaryButtonText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  if (!verifier) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Unknown verifier</Text>

        <Text style={styles.text}>
          This wallet only shares proofs with verifiers it recognises, and this
          request came from one it does not.
        </Text>

        <Pressable style={styles.secondaryButton} onPress={() => router.replace('/')}>
          <Text style={styles.secondaryButtonText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  if (policy && policy.kind === 'unavailable') {
    return (
      <View style={styles.container}>
        <Text style={styles.eyebrow}>Family rules</Text>
        <Text style={styles.title}>Can’t check your family rules</Text>
        <Text style={styles.text}>
          This wallet is linked to a guardian, but it doesn’t have a verified copy of
          their rules right now ({policy.reason}). Open the Policies tab and tap Sync,
          then try again.
        </Text>
        <Pressable style={styles.approveButton} onPress={handlePolicyBlocked}>
          <Text style={styles.approveButtonText}>Back to {verifier.displayName}</Text>
        </Pressable>
      </View>
    );
  }

  if (policy && policy.kind === 'decided' && policy.result.decision !== 'allow') {
    return (
      <View style={styles.container}>
        <AskGuardianPanel
          record={policy.record}
          decision={policy.result}
          message={policy.message}
          platformName={verifier.displayName}
          onDone={handlePolicyBlocked}
          doneLabel={`Back to ${verifier.displayName}`}
        />
      </View>
    );
  }

  if (status === 'checking' || policy === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#111" />

        <Text style={[styles.text, styles.checkingText]}>
          Checking your credential…
        </Text>
      </View>
    );
  }

  const requirementInfo = getRequirementInfo(requirement);

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Age verification request</Text>

      <Text style={styles.title}>{verifier.displayName}</Text>

      <Text style={styles.text}>
        is requesting proof that you are {requirementInfo.descriptor}.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>REQUESTED</Text>
        <Text style={styles.cardValue}>{requirementInfo.label}</Text>

        <Text style={styles.note}>{requirementInfo.disclosureNote}</Text>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <Pressable style={styles.approveButton} onPress={handleApprove}>
        <Text style={styles.approveButtonText}>Approve</Text>
      </Pressable>

      <Pressable style={styles.denyButton} onPress={handleDeny}>
        <Text style={styles.denyButtonText}>Deny</Text>
      </Pressable>

      <Text style={styles.demoNote}>
        Demo verifier identifier: {params.verifierId}. This is a prototype
        deep-link transport, not a full OID4VP deployment.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    padding: 24,
    paddingTop: 48,
  },

  eyebrow: {
    fontSize: 13,
    fontWeight: '700',
    color: '#777',
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 10,
  },

  text: {
    fontSize: 16,
    lineHeight: 23,
    color: '#555',
    marginBottom: 24,
  },

  checkingText: {
    textAlign: 'center',
    marginTop: 16,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },

  blockedCard: {
    borderWidth: 1,
    borderColor: '#F3C9A6',
  },

  blockedReason: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },

  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    opacity: 0.55,
    marginBottom: 6,
  },

  cardValue: {
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 14,
  },

  note: {
    fontSize: 13,
    lineHeight: 19,
    color: '#555',
  },

  errorText: {
    color: '#C62828',
    fontSize: 14,
    marginBottom: 16,
  },

  approveButton: {
    backgroundColor: '#111',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },

  approveButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '600',
  },

  denyButton: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },

  denyButtonText: {
    color: '#C62828',
    fontSize: 16,
    fontWeight: '600',
  },

  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 16,
  },

  secondaryButtonText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '600',
  },

  demoNote: {
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 16,
    color: '#999',
    marginTop: 20,
  },
});
