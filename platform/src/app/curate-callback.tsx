import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { handleCurationResponse } from '@/family/curation';

// Receives the wallet's curation answer (footube://curate-callback?...).
export default function CurateCallbackScreen() {
  const params = useLocalSearchParams<{ requestId?: string; result?: string; presentation?: string; error?: string }>();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const outcome = handleCurationResponse({
      requestId: params.requestId,
      result: params.result,
      presentation: params.presentation,
      error: params.error,
    });

    if (__DEV__) console.log('[footube family rules]', outcome);

    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [params.requestId, params.result, params.presentation, params.error]);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Applying family rules…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA', alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 16, color: '#555' },
});
