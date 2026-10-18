import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  isLivenessSupported,
  LivenessView,
  type LivenessViewHandle,
} from '../../modules/liveness';

import {
  createChallenge,
  currentPrompt,
  failureMessage,
  MIN_RELIEF_MM,
  progress,
  stepFace,
  tick,
} from './challenge';
import { secureRandomInt } from './secureRandom';

type Props = {
  // Called with a frame captured from the live session after the challenge passed.
  onCaptured: (uri: string) => void;
};

function newChallenge() {
  return createChallenge(Date.now(), secureRandomInt);
}

export function LivenessCapture({ onCaptured }: Props) {
  const viewRef = useRef<LivenessViewHandle>(null);
  const capturing = useRef(false);
  const [state, setState] = useState(newChallenge);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setState((s) => tick(s, Date.now())), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (state.status !== 'ready_to_capture' || capturing.current) {
      return;
    }
    capturing.current = true;

    viewRef.current
      ?.captureFrame()
      .then((frame) => onCaptured(frame.uri))
      .catch(() => {
        capturing.current = false;
        setNotice('The selfie could not be taken. Please try again.');
        setState(newChallenge());
      });
  }, [state.status, onCaptured]);

  const restart = () => {
    capturing.current = false;
    setNotice(null);
    setState(newChallenge());
  };

  if (!isLivenessSupported) {
    return (
      <View style={styles.message}>
        <Text style={styles.messageTitle}>Device not supported</Text>
        <Text style={styles.messageText}>
          The liveness check needs an iPhone with Face ID. A selfie cannot be
          taken on this device.
        </Text>
      </View>
    );
  }

  if (sessionError) {
    return (
      <View style={styles.message}>
        <Text style={styles.messageTitle}>Camera unavailable</Text>
        <Text style={styles.messageText}>{sessionError}</Text>
      </View>
    );
  }

  const { done, total } = progress(state);
  const depthOk = state.lastReliefMm >= MIN_RELIEF_MM;

  return (
    <View style={styles.container}>
      <LivenessView
        ref={viewRef}
        style={StyleSheet.absoluteFill}
        onFaceUpdate={(event) => {
          const sample = event.nativeEvent;
          setState((s) => stepFace(s, sample));
        }}
        onSessionError={(event) => setSessionError(event.nativeEvent.message)}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.title}>Liveness check</Text>

        {state.status === 'failed' && state.failure ? (
          <View style={styles.failureCard}>
            <Text style={styles.failureText}>
              {failureMessage(state.failure)}
            </Text>
            <Pressable style={styles.button} onPress={restart}>
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.step}>
              {state.status === 'ready_to_capture'
                ? 'Taking your selfie…'
                : `Step ${Math.min(done + 1, total)} of ${total}`}
            </Text>
            <Text style={styles.prompt}>
              {state.status === 'ready_to_capture' ? 'Hold still' : currentPrompt(state)}
            </Text>
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          </>
        )}

        <View style={styles.faceGuide} />

        <Text style={styles.depth}>
          3D face check: {depthOk ? 'passed' : 'waiting'}
          {state.lastReliefMm >= 0 ? ` (${state.lastReliefMm.toFixed(0)} mm)` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 24,
    paddingHorizontal: 24,
  },
  title: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '700',
  },
  step: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    marginTop: 10,
  },
  prompt: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
  },
  notice: {
    color: '#FFD27A',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  faceGuide: {
    width: 260,
    height: 340,
    borderWidth: 3,
    borderColor: '#FFF',
    borderRadius: 140,
    marginTop: 30,
  },
  depth: {
    position: 'absolute',
    bottom: 50,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
  },
  failureCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignSelf: 'stretch',
  },
  failureText: {
    color: '#FFF',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  buttonText: {
    color: '#111',
    fontSize: 17,
    fontWeight: '600',
  },
  message: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    padding: 24,
    justifyContent: 'center',
  },
  messageTitle: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 14,
  },
  messageText: {
    fontSize: 17,
    lineHeight: 25,
    color: '#555',
  },
});
