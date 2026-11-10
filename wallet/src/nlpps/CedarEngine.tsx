import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { cedarAttributes, type EngineResult, type PolicyEngine } from '@/policy';

import html from './cedarEngineHtml';

const TIMEOUT_MS = 10_000;

type Pending = { resolve: (results: EngineResult[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

const pending = new Map<number, Pending>();
let nextId = 1;
let send: ((script: string) => void) | null = null;
let markReady: () => void = () => undefined;
let ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

function settle(id: number, action: (entry: Pending) => void): void {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(id);
  action(entry);
}

// Real Cedar, inside a hidden WebView that cannot reach the network. If it
// fails or takes too long, the caller's items become "ask".
export const cedarEngine: PolicyEngine = {
  async authorize(policies, requests) {
    await Promise.race([
      ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('The rule engine did not start.')), TIMEOUT_MS)),
    ]);
    if (!send) throw new Error('The rule engine is not running.');

    const id = nextId;
    nextId += 1;
    const input = JSON.stringify({ policies, requests: requests.map(({ record, context }) => ({ attributes: cedarAttributes(record), context })) });

    return new Promise<EngineResult[]>((resolve, reject) => {
      const timer = setTimeout(() => settle(id, (entry) => entry.reject(new Error('The rule engine timed out.'))), TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      send?.(`window.__authorize(${id}, ${JSON.stringify(input)}); true;`);
    });
  },
};

export function CedarEngineHost() {
  const view = useRef<WebView>(null);

  const onMessage = (event: WebViewMessageEvent) => {
    let message: { ready?: boolean; id?: number; results?: EngineResult[]; error?: string };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (message.ready) {
      send = (script) => view.current?.injectJavaScript(script);
      markReady();
    } else if (typeof message.id === 'number') {
      const { results, error } = message;
      settle(message.id, (entry) => (results ? entry.resolve(results) : entry.reject(new Error(error ?? 'rule engine error'))));
    }
  };

  // If the system ever kills the web process, start again.
  const restart = () => {
    send = null;
    ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    view.current?.reload();
  };

  return (
    <View style={styles.hidden} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView
        ref={view}
        source={{ html }}
        originWhitelist={['about:*']}
        onMessage={onMessage}
        onContentProcessDidTerminate={restart}
        onRenderProcessGone={restart}
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        javaScriptEnabled
        domStorageEnabled={false}
        incognito
        allowFileAccess={false}
        setSupportMultipleWindows={false}
        cacheEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
});
