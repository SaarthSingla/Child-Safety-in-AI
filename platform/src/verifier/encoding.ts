const BASE64URL = /^[A-Za-z0-9_-]*$/;

// Strict on purpose: anything outside the base64url alphabet (padding,
// whitespace, standard-base64 characters) is rejected rather than tolerated.
export function base64urlToBytes(value: string): Uint8Array {
  if (!BASE64URL.test(value) || value.length % 4 === 1) {
    throw new Error('invalid base64url');
  }

  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function decodeJsonSegment(segment: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64urlToBytes(segment)));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
