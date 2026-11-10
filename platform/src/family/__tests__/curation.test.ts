import { createHash, webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// expo-crypto is a native module; only startCuration uses it.
vi.mock('expo-crypto', () => ({ getRandomBytesAsync: async (n: number) => new Uint8Array(n) }));

import { decideArticleAccess } from '@/content/authorization';
import { CATALOG, getArticleById } from '@/content/catalog';
import { NOW_MS, NOW_S, encodeJson, generateKeyPair, issueCredential, present, verifierConfigFor } from '@/verifier/__tests__/testKit';
import { bytesToBase64url } from '@/verifier/encoding';
import { verifyHolderPresentation } from '@/verifier/verifyPresentation';

import {
  CURATION_RESULT_SCHEMA,
  boundNonce,
  buildCurationUrl,
  handleCurationResponse,
  registerCurationRequest,
  resetCurationStore,
  type CurationRequest,
} from '../curation';
import { familyCheck, getFamilyState, resetFamilyState } from '../familyState';
import { DEFAULT_VOCABULARY, labelHash, normalizeRecord, verifyLabelBatch } from '../../../../policy/src/index';
import { manifestFor } from '../labels';

const issuer = generateKeyPair();
const holder = generateKeyPair();
const config = verifierConfigFor(issuer);
const issued = issueCredential({ issuer, holder });

let counter = 0;
function newRequest(): CurationRequest {
  counter += 1;
  const request: CurationRequest = {
    requestId: `req-${counter}`,
    nonce: `nonce-${counter}`,
    verifierId: config.verifierId,
    callbackUrl: 'footube://curate-callback',
    createdAt: NOW_MS - 1000,
    expiresAt: NOW_MS + 5 * 60_000,
    contentIds: CATALOG.map((a) => a.id),
  };
  registerCurationRequest(request);
  return request;
}

function result(request: CurationRequest, overrides: Record<string, unknown> = {}) {
  return encodeJson({
    schema: CURATION_RESULT_SCHEMA,
    request_id: request.requestId,
    status: 'active',
    policy_version: 7,
    decisions: [
      { content_id: 'life-under-siege', decision: 'hide' },
      { content_id: 'how-gambling-hooks-the-brain', decision: 'ask' },
      { content_id: 'why-the-sky-is-blue', decision: 'allow' },
      { content_id: 'not-in-the-request', decision: 'allow' },
    ],
    valid_until: new Date(NOW_MS + 30 * 60_000).toISOString(),
    evaluated_at: new Date(NOW_MS).toISOString(),
    ...overrides,
  });
}

function respond(request: CurationRequest, resultParam: string, presentOverrides: Record<string, unknown> = {}) {
  const presentation = present(issued, {
    holderSecretKey: holder.secretKey,
    nonce: boundNonce(request.nonce, resultParam),
    disclose: [],
    ...presentOverrides,
  });
  return handleCurationResponse({ requestId: request.requestId, result: resultParam, presentation }, { nowMs: NOW_MS, config });
}

beforeEach(() => {
  resetCurationStore();
  resetFamilyState();
});

describe('labels', () => {
  it('cover every article, and carry a signature the wallet accepts', () => {
    const { items, batch } = manifestFor(CATALOG);

    expect(items.every((item) => item.topics && item.rating_age !== undefined)).toBe(true);
    expect(verifyLabelBatch(batch, DEFAULT_VOCABULARY.labellers)).toBe(true);
    expect(items.every((item) => batch.hashes.includes(labelHash(item)))).toBe(true);

    const records = items.map((item) => normalizeRecord(item, DEFAULT_VOCABULARY, true));
    expect(records.every((record) => record !== null && record.topics!.length > 0 && record.format === 'article')).toBe(true);
  });

  it('stop matching the signature if they are changed', () => {
    const { items, batch } = manifestFor(CATALOG);
    expect(batch.hashes.includes(labelHash({ ...items[0], rating_age: 0, topics: ['science'] }))).toBe(false);
  });

  it('go to the wallet as a manifest in the curation link', () => {
    const request = newRequest();
    const url = new URL(buildCurationUrl(request, CATALOG));
    const manifest = JSON.parse(Buffer.from(url.searchParams.get('manifest')!, 'base64url').toString());
    expect(manifest.items).toHaveLength(CATALOG.length);
    expect(url.protocol).toBe('childsafewallet:');
  });
});

describe('a verified curation answer', () => {
  it('becomes family state, and only for the items Footube asked about', () => {
    const request = newRequest();
    const outcome = respond(request, result(request));
    expect(outcome).toEqual({ type: 'applied', status: 'active', version: 7, hidden: 2 });

    const state = getFamilyState();
    expect(state.status === 'active' && state.decisions.has('not-in-the-request')).toBe(false);
    expect(familyCheck('life-under-siege', NOW_MS)).toEqual({ kind: 'blocked', decision: 'hide' });
    expect(familyCheck('why-the-sky-is-blue', NOW_MS)).toEqual({ kind: 'allowed' });
    // Items the wallet did not decide on are not silently allowed.
    expect(familyCheck('your-first-loop', NOW_MS)).toEqual({ kind: 'blocked', decision: 'ask' });
  });

  it('hides even an open (Everyone) article through the single access decision', () => {
    const request = newRequest();
    respond(request, result(request, { decisions: [{ content_id: 'how-bees-build-a-hive', decision: 'hide' }] }));
    const bees = getArticleById('how-bees-build-a-hive')!;
    expect(decideArticleAccess(bees, NOW_MS)).toEqual({ allowed: false, reason: 'family_rules', familyDecision: 'hide' });
  });

  it('expires, after which the reader must refresh', () => {
    const request = newRequest();
    respond(request, result(request));
    const later = NOW_MS + 31 * 60_000;
    expect(familyCheck('why-the-sky-is-blue', later)).toEqual({ kind: 'stale' });
    expect(decideArticleAccess(getArticleById('why-the-sky-is-blue')!, later)).toEqual({ allowed: false, reason: 'family_rules_refresh' });
  });

  it('records "no family rules" when the wallet proves it has no guardian link', () => {
    const request = newRequest();
    expect(respond(request, result(request, { status: 'none', decisions: [], policy_version: null }))).toMatchObject({
      type: 'applied',
      status: 'none',
    });
    expect(getFamilyState().status).toBe('none');
  });
});

describe('answers that change nothing', () => {
  it('a tampered result (e.g. a hand-made footube:// link) fails the bound nonce', () => {
    const request = newRequest();
    const genuine = result(request);
    const presentation = present(issued, { holderSecretKey: holder.secretKey, nonce: boundNonce(request.nonce, genuine), disclose: [] });
    const forged = result(request, { decisions: [{ content_id: 'life-under-siege', decision: 'allow' }] });

    const outcome = handleCurationResponse({ requestId: request.requestId, result: forged, presentation }, { nowMs: NOW_MS, config });
    expect(outcome).toEqual({ type: 'not_applied', reason: 'nonce_mismatch' });
    expect(getFamilyState().status).toBe('unknown');
  });

  it('a result without a proof, an error, a replay or the wrong audience', () => {
    const r1 = newRequest();
    expect(handleCurationResponse({ requestId: r1.requestId, result: result(r1) }, { nowMs: NOW_MS, config }).type).toBe('not_applied');

    const r2 = newRequest();
    expect(handleCurationResponse({ requestId: r2.requestId, error: 'declined' }, { nowMs: NOW_MS, config })).toEqual({
      type: 'not_applied',
      reason: 'wallet: declined',
    });

    const r3 = newRequest();
    expect(respond(r3, result(r3)).type).toBe('applied');
    expect(respond(r3, result(r3))).toEqual({ type: 'not_applied', reason: 'request_replayed' });

    const r4 = newRequest();
    expect(respond(r4, result(r4), { audience: 'did:example:other' })).toEqual({ type: 'not_applied', reason: 'audience_mismatch' });

    const r5 = newRequest();
    expect(respond(r5, result(r5, { request_id: 'someone-else' }))).toEqual({ type: 'not_applied', reason: 'result_mismatch' });
  });

  it('a holder proof never yields an age credential', () => {
    const presentation = present(issued, { holderSecretKey: holder.secretKey, nonce: 'n', disclose: [] });
    const proof = verifyHolderPresentation(presentation, { nonce: 'n', audience: config.verifierId, requestCreatedAtMs: NOW_MS - 1000, nowMs: NOW_MS }, config);
    expect(proof.verified).toBe(true);
    expect(proof.credential).toBeUndefined();
    expect(proof.ageRequirementSatisfied).toBe(false);
  });
});

// The wallet's real builder (Secure Enclave stand-in) against this handler.
const walletKeyBinding = fileURLToPath(new URL('../../../../wallet/src/crypto/keyBinding.ts', import.meta.url));

describe.skipIf(!existsSync(walletKeyBinding))('wallet <-> Footube curation interop', () => {
  it('accepts a zero-disclosure proof built by the wallet', async () => {
    const { buildPresentation } = await import(/* @vite-ignore */ walletKeyBinding);
    const key = await webcrypto.subtle.importKey(
      'jwk',
      { ...holder.jwk, d: bytesToBase64url(holder.secretKey) },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    const request = newRequest();
    const resultParam = result(request);
    // Same construction as the wallet's boundNonce.
    expect(boundNonce(request.nonce, resultParam)).toBe(createHash('sha256').update(`${request.nonce}.${resultParam}`).digest('base64url'));

    const presentation = await buildPresentation({
      credential: issued.credential,
      signWithHolderKey: async (input: string) =>
        new Uint8Array(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input))),
      audience: config.verifierId,
      nonce: boundNonce(request.nonce, resultParam),
      disclose: [],
      nowSeconds: NOW_S,
    });

    // Nothing disclosed: just the issuer JWT and the KB-JWT.
    expect(presentation.split('~')).toHaveLength(2);
    expect(handleCurationResponse({ requestId: request.requestId, result: resultParam, presentation }, { nowMs: NOW_MS, config })).toMatchObject({
      type: 'applied',
    });
  });
});
