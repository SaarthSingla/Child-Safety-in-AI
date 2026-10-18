import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { handlePresentationResponse } from '@/verifier/responseHandler';

export default function VerifyCallbackScreen() {
  const params = useLocalSearchParams<{
    requestId: string;
    presentation?: string;
    denied?: string;
    reason?: string;
  }>();

  // A challenge is single use, so the response must be processed exactly
  // once even if this effect were to run again.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) {
      return;
    }

    handled.current = true;

    if (!params.requestId) {
      router.replace('/');
      return;
    }

    const { outcome, contentId } = handlePresentationResponse({
      requestId: params.requestId,
      presentation: params.presentation,
      denied: params.denied === 'true',
      denialReason: params.reason,
    });

    if (__DEV__ && outcome.type === 'rejected') {
      console.log('[footube verifier] rejected:', outcome.reason);
    }

    // Prefer popping back to the exact article screen that started this
    // request (still mounted lower in the stack in the common case where
    // Footube was only backgrounded while the wallet was open). Fall back
    // to a fresh route if there is nothing to go back to -- e.g. iOS
    // terminated Footube in the background, in which case the in-memory
    // challenge store is empty too and the request is rejected as unknown.
    if (router.canGoBack()) {
      router.back();
    } else if (contentId) {
      router.replace(`/article/${contentId}`);
    } else {
      router.replace('/');
    }
  }, [params.requestId, params.presentation, params.denied, params.reason]);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Verifying your credential…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    alignItems: 'center',
    justifyContent: 'center',
  },

  text: {
    fontSize: 16,
    color: '#555',
  },
});
