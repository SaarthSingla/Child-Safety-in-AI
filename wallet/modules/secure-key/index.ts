import { requireNativeModule } from 'expo-modules-core';

type SecureKeyNative = {
  isAvailable: boolean;
  getOrCreatePublicJwk(): Promise<{ kty: string; crv: string; x: string; y: string }>;
  // Raw r||s ES256 signature, base64url.
  sign(signingInput: string): Promise<string>;
  deleteKey(): Promise<void>;
};

export default requireNativeModule<SecureKeyNative>('SecureKey');
