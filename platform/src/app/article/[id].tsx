import { useCallback, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArticleCover } from '@/components/ArticleCover';
import { RatingPill } from '@/components/RatingPill';
import {
  clearVerifiedSession,
  decideArticleAccess,
  getVerifiedSession,
} from '@/content/authorization';
import { getArticleById, isRestricted, requirementFor } from '@/content/catalog';
import { manifestFor } from '@/family/labels';
import { askGuardianInWallet, requestFamilyRules } from '@/family/openWallet';
import { isRequestExpired, takeOutcome } from '@/verifier/challengeStore';
import {
  EXPIRED_SESSION_MESSAGE,
  VERIFIED_MESSAGE,
  userMessageForDenial,
  userMessageForFailure,
} from '@/verifier/messages';
import { buildWalletUrl, startVerification } from '@/verifier/presentation';
import type { AgeVerificationState, VerificationRequest } from '@/verifier/types';
import { colors, radii, shadow } from '@/theme';

export default function ArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const [verificationState, setVerificationState] =
    useState<AgeVerificationState>(() =>
      getVerifiedSession() ? 'verified' : 'not_verified',
    );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const pendingRequestRef = useRef<VerificationRequest | null>(null);

  const article = getArticleById(id);

  // Runs whenever this screen regains focus, e.g. after the wallet hands
  // control back through verify-callback. It only updates display state;
  // whether the article is actually readable is decided by decideArticleAccess().
  // Family-rule decisions live outside React and change when the wallet
  // answers, so re-render whenever the screen regains focus.
  const [, setFocusTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setFocusTick((n) => n + 1);
      const session = getVerifiedSession();

      if (session && session.expiresAt * 1000 <= Date.now()) {
        clearVerifiedSession();
        setVerificationState('expired');
        setStatusMessage(EXPIRED_SESSION_MESSAGE);
      }

      const pending = pendingRequestRef.current;

      if (!pending) {
        return;
      }

      const requirement = pending.requestedAgeBand;
      const outcome = takeOutcome(pending.requestId);

      if (!outcome) {
        if (isRequestExpired(pending)) {
          pendingRequestRef.current = null;
          setVerificationState('expired');
          setStatusMessage(userMessageForFailure('request_expired', requirement));
        }

        return;
      }

      pendingRequestRef.current = null;

      switch (outcome.type) {
        case 'verified':
          setVerificationState('verified');
          setStatusMessage(null);
          return;

        case 'denied':
          setVerificationState('rejected');
          setStatusMessage(userMessageForDenial(outcome.reason, requirement));
          return;

        case 'rejected':
          setVerificationState(
            outcome.reason === 'request_expired' ||
              outcome.reason === 'credential_expired'
              ? 'expired'
              : 'rejected',
          );
          setStatusMessage(userMessageForFailure(outcome.reason, requirement));
          return;
      }
    }, []),
  );

  if (!article) {
    return (
      <View style={[styles.missing, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.missingTitle}>Article not found</Text>

        <Pressable style={styles.primaryButton} onPress={() => router.back()}>
          <Text style={styles.primaryButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const requirement = requirementFor(article);
  const restricted = isRestricted(article);

  // Access comes only from a credential the verifier accepted plus the
  // wallet's approval of this article (see content/authorization.ts).
  // verificationState is display-only.
  const decision = decideArticleAccess(article);

  const waiting = verificationState === 'verification_requested';

  const message =
    statusMessage ??
    (!decision.allowed && decision.reason === 'insufficient_age_band' && requirement
      ? userMessageForFailure('age_requirement_not_met', requirement)
      : !decision.allowed && decision.reason === 'wallet_approval_required'
        ? 'Each article is checked against your guardian policy in the wallet.'
        : null);

  const handleVerify = async () => {
    if (!requirement) {
      return;
    }

    try {
      setVerificationState('verification_requested');
      setStatusMessage(null);

      const request = await startVerification(article.id, requirement, manifestFor([article]));
      const walletUrl = buildWalletUrl(request);

      const canOpen = await Linking.canOpenURL(walletUrl);

      if (!canOpen) {
        setVerificationState('not_verified');
        Alert.alert(
          'ChildSafeWallet not found',
          'Install and set up ChildSafeWallet on this device to verify your age.',
        );
        return;
      }

      pendingRequestRef.current = request;

      await Linking.openURL(walletUrl);
    } catch (err) {
      console.error('Failed to start age verification:', err);
      pendingRequestRef.current = null;
      setVerificationState('not_verified');
      Alert.alert('Error', 'Could not start age verification. Please try again.');
    }
  };

  const lockTitle =
    requirement === '12plus' ? 'For readers 12 and over' : 'Age-restricted article';

  const lockText =
    requirement === '12plus'
      ? 'This article is written for readers aged 12 and above. Verify your age range with ChildSafe Wallet to read it.'
      : 'This article requires proof that you are 18 or older.';

  const privacyNote =
    requirement === '12plus'
      ? 'Footube will learn whether you are 12–17 or 18+. Your exact age and selfie are never shared.'
      : 'Only proof that you meet the 18+ requirement is requested.';

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        <ArticleCover
          accent={article.accent}
          category={article.category}
          height={210 + insets.top}
          categoryBottom={42}
        >
          <Pressable
            onPress={() => router.back()}
            style={[styles.back, { top: insets.top + 10 }]}
            hitSlop={8}
          >
            <Text style={styles.backText}>‹  Back</Text>
          </Pressable>
        </ArticleCover>

        <View style={styles.sheet}>
          <View style={styles.metaRow}>
            <RatingPill rating={article.rating} unlocked={restricted && decision.allowed} />
            <Text style={styles.metaText}>{article.readMinutes} min read</Text>
          </View>

          <Text style={styles.title}>{article.title}</Text>
          <Text style={styles.summary}>{article.summary}</Text>

          {decision.allowed ? (
            <View>
              {restricted && (
                <View style={styles.verifiedBanner}>
                  <Text style={styles.verifiedTitle}>{VERIFIED_MESSAGE}</Text>
                  <Text style={styles.verifiedText}>
                    Verified with ChildSafe Wallet. Your exact age was not shared.
                  </Text>
                </View>
              )}

              {article.body.map((paragraph, index) => (
                <Text key={index} style={styles.paragraph}>
                  {paragraph}
                </Text>
              ))}

              <Text style={styles.footer}>Sample article for demonstration only.</Text>
            </View>
          ) : decision.reason === 'family_rules' || decision.reason === 'family_rules_refresh' ? (
            <View style={styles.lockCard}>
              <View style={styles.lockIconWrap}>
                <Text style={styles.lockIcon}>👪</Text>
              </View>

              <Text style={styles.lockTitle}>
                {decision.reason === 'family_rules_refresh'
                  ? 'Family rules need a refresh'
                  : decision.familyDecision === 'ask'
                    ? 'Needs a guardian’s OK'
                    : 'Hidden by your family’s rules'}
              </Text>
              <Text style={styles.lockText}>
                {decision.reason === 'family_rules_refresh'
                  ? 'Your family’s rules can change with the time of day. Ask your wallet to check again.'
                  : 'Your ChildSafe wallet applies your guardians’ rules. Footube doesn’t know what the rules are, only that this article isn’t available right now.'}
              </Text>

              <Pressable
                onPress={() => (decision.reason === 'family_rules_refresh' ? requestFamilyRules() : askGuardianInWallet(article))}
                style={({ pressed }) => [styles.primaryButton, styles.fullWidth, pressed && styles.primaryButtonDim]}
              >
                <Text style={styles.primaryButtonText}>
                  {decision.reason === 'family_rules_refresh' ? 'Refresh family rules' : 'Ask a guardian in ChildSafe'}
                </Text>
              </Pressable>

              {decision.reason === 'family_rules' ? (
                <Pressable onPress={() => requestFamilyRules()} style={styles.secondaryLink}>
                  <Text style={styles.secondaryLinkText}>A guardian said yes? Refresh family rules</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.lockCard}>
              <View style={styles.lockIconWrap}>
                <Text style={styles.lockIcon}>🔒</Text>
              </View>

              <Text style={styles.lockTitle}>{lockTitle}</Text>
              <Text style={styles.lockText}>{lockText}</Text>

              {message && <Text style={styles.statusText}>{message}</Text>}

              <Pressable
                disabled={waiting}
                onPress={handleVerify}
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.fullWidth,
                  (waiting || pressed) && styles.primaryButtonDim,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {waiting ? 'Waiting for wallet…' : 'Verify with ChildSafe Wallet'}
                </Text>
              </Pressable>

              <Text style={styles.privacyNote}>{privacyNote}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  secondaryLink: {
    marginTop: 14,
    alignItems: 'center',
  },

  secondaryLinkText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },

  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },

  missing: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
  },

  missingTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 20,
  },

  back: {
    position: 'absolute',
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },

  backText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  sheet: {
    backgroundColor: colors.background,
    marginTop: -26,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 24,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },

  metaText: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: '500',
    marginLeft: 12,
  },

  title: {
    fontSize: 29,
    lineHeight: 35,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: colors.ink,
  },

  summary: {
    fontSize: 17,
    lineHeight: 26,
    color: colors.muted,
    marginTop: 12,
    marginBottom: 24,
  },

  paragraph: {
    fontSize: 17,
    lineHeight: 29,
    color: colors.body,
    marginBottom: 20,
  },

  footer: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
  },

  verifiedBanner: {
    backgroundColor: colors.successBg,
    borderRadius: radii.control,
    padding: 16,
    marginBottom: 24,
  },

  verifiedTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.success,
  },

  verifiedText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.success,
    marginTop: 4,
  },

  lockCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: 24,
    alignItems: 'center',
    ...shadow,
  },

  lockIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },

  lockIcon: {
    fontSize: 26,
  },

  lockTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.ink,
    marginBottom: 8,
  },

  lockText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.body,
    textAlign: 'center',
    marginBottom: 18,
  },

  statusText: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.notice,
    backgroundColor: colors.noticeBg,
    borderRadius: radii.control,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 10,
    textAlign: 'center',
    marginBottom: 18,
    alignSelf: 'stretch',
  },

  primaryButton: {
    backgroundColor: colors.brand,
    borderRadius: radii.control,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
  },

  primaryButtonDim: {
    opacity: 0.6,
  },

  fullWidth: {
    alignSelf: 'stretch',
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },

  privacyNote: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 14,
  },
});
