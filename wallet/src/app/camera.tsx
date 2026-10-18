import { useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  getOrCreateHolderKey,
} from '@/crypto/holderKey';
import { LivenessCapture } from '@/liveness/LivenessCapture';

import {
  issueCredential,
  startIssuance,
  type HolderJWK,
  type IssuanceSession,
} from '@/api/issuer';

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [holderPublicJwk, setHolderPublicJwk] =
    useState<HolderJWK | null>(null);
  const [session, setSession] =
    useState<IssuanceSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setPhotoUri(null);
      setError(null);
      setCameraKey((key) => key + 1);

      return () => {};
    }, []),
  );

  useEffect(() => {
    async function prepareIssuance() {
      try {
        setLoading(true);
        setError(null);

        const { publicJwk } = await getOrCreateHolderKey();

        const issuanceSession = await startIssuance(publicJwk);

        setHolderPublicJwk(publicJwk);
        setSession(issuanceSession);
      } catch (err) {
        console.error('Issuance preparation failed:', err);

        setError(
          err instanceof Error
            ? err.message
            : 'Unable to contact the age verification service.',
        );
      } finally {
        setLoading(false);
      }
    }

    prepareIssuance();
  }, []);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.title}>Camera Access</Text>

        <Text style={styles.text}>
          ChildSafe needs camera access to capture a selfie for age
          verification.
        </Text>

        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Allow Camera</Text>
        </Pressable>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingTitle}>
          Preparing verification
        </Text>

        <Text style={styles.loadingText}>
          Securely preparing your age credential session…
        </Text>
      </View>
    );
  }

  if (error || !session || !holderPublicJwk) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.title}>Unable to verify</Text>

        <Text style={styles.text}>
          {error ?? 'The verification session could not be created.'}
        </Text>

        <Pressable
          style={styles.button}
          onPress={() => router.back()}
        >
          <Text style={styles.buttonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  if (photoUri) {
    return (
      <View style={styles.previewContainer}>
        <Image source={{ uri: photoUri }} style={styles.preview} />

        <View style={styles.previewOverlay}>
          <Text style={styles.previewTitle}>
            Review your selfie
          </Text>

          <Text style={styles.previewText}>
            Make sure your face is clearly visible.
          </Text>

          <Pressable
            style={styles.button}
            onPress={() => {
              router.push({
                pathname: '/verification',
                params: {
                  imageUri: photoUri,
                  sessionId: session.session_id,
                  nonce: session.nonce,
                  issuedAt: String(session.issued_at),
                  expiresAt: String(session.expires_at),
                  holderThumbprint:
                    session.holder_key_thumbprint,
                  holderPublicJwk:
                    JSON.stringify(holderPublicJwk),
                },
              });
            }}
          >
            <Text style={styles.buttonText}>
              Use This Photo
            </Text>
          </Pressable>

          <Pressable
            style={styles.retakeButton}
            onPress={() => setPhotoUri(null)}
          >
            <Text style={styles.retakeText}>Retake</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // The selfie is a frame from the live challenge itself; there is no
  // separate shutter, so a different photo cannot be swapped in afterwards.
  return <LivenessCapture key={cameraKey} onCaptured={setPhotoUri} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },

  permissionContainer: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    padding: 24,
    justifyContent: 'center',
  },

  title: {
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 16,
  },

  text: {
    fontSize: 17,
    lineHeight: 25,
    color: '#555',
    marginBottom: 28,
  },

  button: {
    backgroundColor: '#111',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },

  buttonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '600',
  },

  loadingContainer: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },

  loadingTitle: {
    fontSize: 27,
    fontWeight: '700',
  },

  loadingText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
    textAlign: 'center',
  },

  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },

  preview: {
    flex: 1,
    width: '100%',
  },

  previewOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    paddingBottom: 40,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },

  previewTitle: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: '700',
  },

  previewText: {
    color: '#FFF',
    fontSize: 16,
    marginTop: 8,
  },

  retakeButton: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },

  retakeText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
