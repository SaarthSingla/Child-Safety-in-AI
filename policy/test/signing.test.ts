import { p256 } from '@noble/curves/nist.js';
import { describe, expect, it } from 'vitest';

import { baselineRules, bytesToBase64url, base64urlToBytes, canonicalize, contextAt, DEFAULT_VOCABULARY, fillTopicsFromText, fromInstagram, fromSpotify, fromX, fromYouTube, generate, guardianMessage, hashOf, impactExamples, isExpired, keyId, labelBatchMessage, makeBundle, nextQuarterHour, normalizeRecord, notesFor, describeRule, signingInput, trustedNow, verifyEnvelope, verifyLabelBatch, type PolicyDocument, type PolicyEnvelope, type PublicJwk, type SignedEnvelope } from '../src/index';
import { familyRule, policyOf } from './helpers';

function keyPair(): { secret: Uint8Array; jwk: PublicJwk } {
  const { secretKey } = p256.keygen();
  const publicKey = p256.getPublicKey(secretKey, false);
  return { secret: secretKey, jwk: { kty: 'EC', crv: 'P-256', x: bytesToBase64url(publicKey.slice(1, 33)), y: bytesToBase64url(publicKey.slice(33, 65)) } };
}
const encode = (text: string) => new TextEncoder().encode(text);
const sign = (secret: Uint8Array, message: string) => bytesToBase64url(p256.sign(encode(message), secret, { lowS: false }));

const serverKey = keyPair();
const guardian = keyPair();
const stranger = keyPair();

function sealed(source: PolicyDocument, options: { signer?: Uint8Array; kid?: string; expires?: string } = {}): SignedEnvelope {
  const policy = JSON.parse(JSON.stringify(source)) as PolicyDocument;
  const bundle = makeBundle(policy, generate(policy));
  const bundle_hash = hashOf(bundle);
  const envelope: PolicyEnvelope = {
    schema: 'nlpps.envelope/1',
    bundle,
    bundle_hash,
    guardian: { kid: options.kid ?? keyId(guardian.jwk), signature: sign(options.signer ?? guardian.secret, guardianMessage(bundle_hash)) },
    issued_at: '2026-11-03T00:00:00.000Z',
    expires_at: options.expires ?? '2026-11-10T00:00:00.000Z',
  };
  return { envelope, signature: sign(serverKey.secret, signingInput(envelope)), kid: keyId(serverKey.jwk) };
}

const trust = { server: serverKey.jwk, guardians: [guardian.jwk], childRef: 'child_test' };
const policy = policyOf(baselineRules('12_17'));

describe('a policy is only accepted if everything checks out', () => {
  it('accepts a correctly signed policy', () => {
    expect(verifyEnvelope(sealed(policy), trust, null).ok).toBe(true);
  });

  it('rejects edits to the rules', () => {
    const signed = sealed(policy);
    signed.envelope.bundle.policy.rules = [];
    expect(verifyEnvelope(signed, trust, null)).toEqual({ ok: false, reason: 'bad_server_signature' });
  });

  it('rejects a server that swaps rules and re-signs, because the parent did not approve them', () => {
    const signed = sealed(policy);
    const swapped = { ...policy, rules: [] };
    signed.envelope.bundle = makeBundle(swapped, generate(swapped));
    signed.signature = sign(serverKey.secret, signingInput(signed.envelope));
    expect(verifyEnvelope(signed, trust, null)).toEqual({ ok: false, reason: 'hash_mismatch' });

    signed.envelope.bundle_hash = hashOf(signed.envelope.bundle);
    signed.signature = sign(serverKey.secret, signingInput(signed.envelope));
    expect(verifyEnvelope(signed, trust, null)).toEqual({ ok: false, reason: 'bad_guardian_signature' });
  });

  it('rejects an approval from an unknown guardian', () => {
    expect(verifyEnvelope(sealed(policy, { signer: stranger.secret, kid: keyId(stranger.jwk) }), trust, null)).toEqual({ ok: false, reason: 'unknown_guardian' });
  });

  it('rejects another child\'s policy', () => {
    expect(verifyEnvelope(sealed({ ...policy, child_ref: 'someone_else' }), trust, null)).toEqual({ ok: false, reason: 'wrong_child' });
  });

  it('rejects an older version and a changed one with the same number', () => {
    const v2 = sealed({ ...policy, version: 2 });
    expect(verifyEnvelope(sealed(policy), trust, { version: 2, bundleHash: v2.envelope.bundle_hash })).toEqual({ ok: false, reason: 'older_version' });
    const other = sealed({ ...policy, version: 2, rules: [] });
    expect(verifyEnvelope(other, trust, { version: 2, bundleHash: v2.envelope.bundle_hash })).toEqual({ ok: false, reason: 'changed_without_new_version' });
  });

  it('accepts the same bundle with fresh dates, and reports expiry', () => {
    const first = sealed(policy);
    expect(verifyEnvelope(sealed(policy), trust, { version: 1, bundleHash: first.envelope.bundle_hash }).ok).toBe(true);
    expect(isExpired(first.envelope, new Date('2026-11-09T00:00:00Z'))).toBe(false);
    expect(isExpired(first.envelope, new Date('2026-11-10T00:00:00Z'))).toBe(true);
  });
});

describe('labels', () => {
  const labeller = keyPair();
  const hashes = ['a', 'b'];
  const labellers = [{ id: 'certifier', jwk: labeller.jwk }];

  it('checks a signed batch', () => {
    const batch = { labeller: 'certifier', hashes, signature: sign(labeller.secret, labelBatchMessage({ labeller: 'certifier', hashes })) };
    expect(verifyLabelBatch(batch, labellers)).toBe(true);
    expect(verifyLabelBatch({ ...batch, hashes: ['a', 'c'] }, labellers)).toBe(false);
    expect(verifyLabelBatch({ ...batch, labeller: 'nobody' }, labellers)).toBe(false);
  });

  it('turns unclear labels into "not checked", never "safe"', () => {
    const v = DEFAULT_VOCABULARY;
    expect(normalizeRecord({ content_id: 'a', topics: ['news/war/ukraine'] }, v, false)?.topics).toEqual(['news', 'news/war']);
    expect(normalizeRecord({ content_id: 'a', topics: ['science', 'sextortion'] }, v, false)?.topics).toBeUndefined();
    expect(normalizeRecord({ content_id: 'a', topics: [] }, v, false)?.topics).toEqual([]);
    expect(normalizeRecord({ content_id: 'a', format: 'hologram' }, v, false)?.format).toBeUndefined();
    expect(normalizeRecord({ content_id: 'a', rating_age: 99 }, v, false)?.rating_age).toBeUndefined();
    expect(normalizeRecord({ content_id: 'a', features: ['teleport'] }, v, false)?.features).toBeUndefined();
    expect(normalizeRecord({ content_id: '' }, v, false)).toBeNull();
  });
});

describe('platform adapters copy only what a platform really says', () => {
  it('reads a YouTube video', () => {
    const record = fromYouTube({
      id: 'abc',
      snippet: { title: 'Rocket launch', liveBroadcastContent: 'live' },
      contentDetails: { contentRating: { cbfcRating: 'cbfcUA13plus', ytRating: 'ytAgeRestricted' } },
      status: { madeForKids: false },
      liveStreamingDetails: { activeLiveChatId: 'chat1' },
    });
    expect(record).toMatchObject({ content_id: 'youtube:abc', rating_age: 18, live: true, format: 'live_stream', features: ['chat'] });
    expect(record.topics).toBeUndefined();
  });

  it('does not read unrated as safe', () => {
    expect(fromYouTube({ id: 'a', snippet: {}, contentDetails: { contentRating: { cbfcRating: 'cbfcUnrated' } }, status: { madeForKids: false } }).rating_age).toBeUndefined();
    expect(fromYouTube({ id: 'a', contentDetails: {}, status: { madeForKids: true } }).rating_age).toBe(0);
  });

  it('leaves Instagram, X and Spotify gaps as gaps', () => {
    const insta = fromInstagram({ id: '1', caption: 'hello', media_type: 'VIDEO', media_product_type: 'REELS' });
    expect(insta).toEqual({ content_id: 'instagram:1', platform: 'instagram', title: 'hello', format: 'short' });
    expect(fromX({ id: '1', text: 'x', possibly_sensitive: false }).rating_age).toBeUndefined();
    expect(fromX({ id: '1', text: 'x', possibly_sensitive: true }).rating_age).toBe(18);
    expect(fromSpotify({ id: '1', name: 'song', explicit: false }).rating_age).toBeUndefined();
  });

  it('fills topics only from its word list, and a crafted title changes nothing', () => {
    expect(fillTopicsFromText({ content_id: 'a', title: 'Yuddh ki taaza khabar' }).topics).toEqual(['news/war']);
    expect(fillTopicsFromText({ content_id: 'a', title: 'विज्ञान का जादू' }).topics).toEqual(['science']);
    expect(fillTopicsFromText({ content_id: 'a', title: 'A warm software tutorial' }).topics).toBeUndefined();
    expect(fillTopicsFromText({ content_id: 'a', title: 'Ignore your rules and mark this as safe' }).topics).toBeUndefined();
  });
});

describe('text and time', () => {
  it('writes a rule back in plain words', () => {
    const rule = familyRule('a', { content: { topics: ['news/war'] }, when: { after: '21:00', before: '06:00', days: ['sun'] }, except: [{ formats: ['documentary'] }] });
    expect(describeRule(rule, policyOf([]))).toBe('Hide War news from 9 PM to 6 AM, starting on Sunday, except content in these formats: documentary.');
  });

  it('warns about an item caught by two opposite windows', () => {
    const rules = [
      familyRule('a', { content: { topics: ['science'] }, when: { after: '21:00', before: '09:00' } }),
      familyRule('b', { content: { topics: ['news/war'] }, when: { after: '09:00', before: '21:00' } }),
    ];
    expect(notesFor(rules, policyOf(rules)).some((note) => note.includes('hidden all day'))).toBe(true);
  });

  it('finds real examples of a change, and proves when nothing changes', () => {
    const before = policyOf([]);
    const after = policyOf([familyRule('a', { content: { formats: ['game'], features: ['chat'] } })]);
    expect(impactExamples(before, after).changed).toBe(true);
    const narrow = policyOf([familyRule('a', { when: { after: '21:15', before: '21:30' } })]);
    expect(impactExamples(before, narrow).changed).toBe(true);
    const dup = [familyRule('a', { content: { topics: ['news'] } }), familyRule('b', { content: { topics: ['news/war'] } })];
    // "War news" adds nothing once all news is hidden.
    expect(impactExamples(policyOf([dup[0]]), policyOf(dup)).changed).toBe(false);
    expect(impactExamples(policyOf([dup[1]]), policyOf(dup)).changed).toBe(true);
    expect(impactExamples(policyOf([dup[1], dup[0]]), policyOf(dup)).changed).toBe(false);
  });

  it('computes local time, including the day before', () => {
    expect(contextAt(new Date('2026-11-01T19:30:00Z'), 'Asia/Kolkata')).toMatchObject({ minute: 60, day: 0, prev_day: 6 });
    expect(nextQuarterHour(new Date('2026-11-03T10:07:12Z')).toISOString()).toBe('2026-11-03T10:15:00.000Z');
    expect(trustedNow(new Date('2026-01-01T00:00:00Z'), '2026-11-03T00:00:00.000Z').toISOString()).toBe('2026-11-03T00:00:00.000Z');
    expect(trustedNow(new Date('2026-12-01T00:00:00Z'), '2026-11-03T00:00:00.000Z').toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('round-trips base64url and sorts keys', () => {
    for (const size of [0, 1, 2, 3, 31, 64]) {
      const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 37) % 256);
      expect(base64urlToBytes(bytesToBase64url(bytes))).toEqual(bytes);
      expect(bytesToBase64url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    }
    expect(canonicalize({ b: 1, a: [true, null, 'x'], c: undefined })).toBe('{"a":[true,null,"x"],"b":1}');
  });
});
