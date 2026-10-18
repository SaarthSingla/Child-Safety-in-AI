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
import { evaluatePolicies } from '@/policy/evaluate';
import { loadPolicies } from '@/policy/store';
import type { PolicyDecision } from '@/policy/types';

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
  // Label of the content being opened; the guardian policy is checked
  // against it. Optional: unlabelled content matches every category rule.
  contentCategory?: string;
};

async function checkGuardianPolicy(category: string | undefined): Promise<PolicyDecision> {
  return evaluatePolicies(await loadPolicies(), { category, now: new Date() });
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
  const [policy, setPolicy] = useState<PolicyDecision | null>(null);

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

  useEffect(() => {
    let active = true;

    checkGuardianPolicy(params.contentCategory)
      .then((decision) => active && setPolicy(decision))
      // Fail closed: if the policy cannot be read, nothing is presented.
      .catch(() => active && setPolicy({
        decision: 'BLOCK',
        rule: {
          id: 'unreadable',
          category: '*',
          action: 'BLOCK',
          explanation: 'Guardian policies could not be read on this device.',
          createdAt: 0,
        },
      }));

    return () => {
      active = false;
    };
  }, [params.contentCategory]);

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
      const decision = await checkGuardianPolicy(params.contentCategory);

      if (decision.decision === 'BLOCK') {
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

  if (policy?.decision === 'BLOCK') {
    return (
      <View style={styles.container}>
        <Text style={styles.eyebrow}>Guardian policy</Text>

        <Text style={styles.title}>Blocked on this device</Text>

        <Text style={styles.text}>
          {verifier.displayName} allows this content
          {params.contentCategory ? ` (${params.contentCategory})` : ''}, but a
          guardian policy in this wallet blocks it.
        </Text>

        <View style={[styles.card, styles.blockedCard]}>
          <Text style={styles.cardLabel}>POLICY</Text>
          <Text style={styles.blockedReason}>{policy.rule.explanation}</Text>
          <Text style={styles.note}>
            No age proof is shared. {verifier.displayName} is only told that a
            guardian policy blocked this.
          </Text>
        </View>

        <Pressable style={styles.approveButton} onPress={handlePolicyBlocked}>
          <Text style={styles.approveButtonText}>Back to {verifier.displayName}</Text>
        </Pressable>
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
