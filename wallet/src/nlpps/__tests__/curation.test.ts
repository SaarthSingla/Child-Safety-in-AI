import { readFileSync } from 'node:fs';
import { p256 } from '@noble/curves/nist.js';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/config/nlppsConfig', () => ({ MAX_MANIFEST_ITEMS: 100 }));

import { nodeEngine } from '../../../../policy/src/cedar-node';
import { baselineRules, bytesToBase64url, cedarAttributes, contextAt, decideItems, DEFAULT_VOCABULARY, fromYouTube, generate, labelBatchMessage, labelHash, type ContentRecord, type EngineRequest, type EngineResult, type PolicyDocument, type PolicyEngine, type Rule, type Vocabulary } from '@/policy';

import { boundNonce, decodeManifest, encodeResult, resultFrom, toRecords, type Manifest } from '../curation';

const encode = (value: unknown) => bytesToBase64url(new TextEncoder().encode(JSON.stringify(value)));

function family(fields: Partial<Rule>): Rule {
  return { id: 'r1', layer: 'family', instruction_id: 'i', effect: 'hide', content: {}, on_unknown: 'allow', author: 'g', source_text: 's', explanation: { child: 'c', guardian: 'g' }, ...fields };
}

const policy = (rules: Rule[], vocabulary: Vocabulary = DEFAULT_VOCABULARY): PolicyDocument => ({
  schema: 'nlpps.policy/1', child_ref: 'c', version: 1, previous_hash: null, age_band: '12_17', timezone: 'Asia/Kolkata', vocabulary, rules, approved_items: [], created_at: 'now',
});

// Runs the exact page the phone loads, with a stand-in for the WebView bridge.
function pageEngine(): { engine: PolicyEngine; version: string } {
  const source = readFileSync(new URL('../cedarEngineHtml.js', import.meta.url), 'utf8');
  const holder: { exports: string } = { exports: '' };
  vm.runInNewContext(source, { module: holder });
  const script = /<script>([\s\S]*)<\/script>/.exec(holder.exports)![1];
  expect(holder.exports).toContain("default-src 'none'");

  const messages: { ready?: boolean; version?: string; id?: number; results?: EngineResult[]; error?: string }[] = [];
  const window: Record<string, unknown> = { ReactNativeWebView: { postMessage: (text: string) => messages.push(JSON.parse(text)) } };
  vm.runInNewContext(script, { window, atob: (text: string) => Buffer.from(text, 'base64').toString('latin1'), WebAssembly, TextDecoder, TextEncoder, console });

  const ready = messages.find((message) => message.ready);
  expect(ready).toBeTruthy();
  let id = 0;
  return {
    version: ready!.version!,
    engine: {
      async authorize(policies, requests: EngineRequest[]) {
        id += 1;
        (window.__authorize as (id: number, json: string) => void)(id, JSON.stringify({ policies, requests: requests.map(({ record, context }) => ({ attributes: cedarAttributes(record), context })) }));
        const answer = messages.find((message) => message.id === id)!;
        if (!answer.results) throw new Error(answer.error);
        return answer.results;
      },
    },
  };
}

describe('the Cedar page the phone runs', () => {
  it('gives the same answers as Cedar on the server', async () => {
    const { engine, version } = pageEngine();
    expect(version).toMatch(/^\d+\.\d+/);

    const compiled = generate(policy([...baselineRules('12_17'), family({ content: { topics: ['news/war'] }, when: { after: '21:00', before: '06:00' }, except: [{ formats: ['documentary'] }] })]));
    const items: ContentRecord[] = [
      { content_id: 'a', trusted: false, topics: ['news', 'news/war'], rating_age: 7, format: 'video' },
      { content_id: 'b', trusted: true, topics: ['news', 'news/war'], rating_age: 7, format: 'documentary' },
      { content_id: 'c', trusted: false, topics: ['harm', 'harm/hate'], rating_age: 7 },
      { content_id: 'd', trusted: false, rating_age: 18 },
      { content_id: 'e', trusted: false },
      { content_id: 'f', trusted: false, topics: ['science'], rating_age: 7 },
    ];
    const night = contextAt(new Date('2026-11-03T16:30:00Z'), 'Asia/Kolkata');

    const phone = await decideItems(engine, compiled, items, night);
    const server = await decideItems(nodeEngine, compiled, items, night);
    expect(phone).toEqual(server);
    expect(phone.map((item) => item.decision)).toEqual(['hide', 'allow', 'hide', 'hide', 'ask', 'allow']);
  });
});

describe('platform labels', () => {
  const { secretKey } = p256.keygen();
  const point = p256.getPublicKey(secretKey, false);
  const jwk = { kty: 'EC', crv: 'P-256', x: bytesToBase64url(point.slice(1, 33)), y: bytesToBase64url(point.slice(33, 65)) };
  const vocabulary: Vocabulary = { ...DEFAULT_VOCABULARY, labellers: [{ id: 'certifier', jwk }] };

  const item = { content_id: 'doc', topics: ['news/war', 'science'], format: 'video' };
  const hashes = [labelHash(item)];
  const signature = bytesToBase64url(p256.sign(new TextEncoder().encode(labelBatchMessage({ labeller: 'certifier', hashes })), secretKey, { lowS: false }));
  const batch = { labeller: 'certifier', hashes, signature };

  it('trusts only what an approved labeller signed', () => {
    expect(toRecords({ items: [item], batch }, vocabulary)?.[0].trusted).toBe(true);
    expect(toRecords({ items: [item] }, vocabulary)?.[0].trusted).toBe(false);
    expect(toRecords({ items: [{ ...item, topics: ['science'] }], batch }, vocabulary)?.[0].trusted).toBe(false);
    expect(toRecords({ items: [item], batch: { ...batch, signature: signature.replace(/^./, signature[0] === 'A' ? 'B' : 'A') } }, vocabulary)?.[0].trusted).toBe(false);
    expect(toRecords({ items: [item], batch }, DEFAULT_VOCABULARY)?.[0].trusted).toBe(false);
  });

  it('stops a fake "science" label from unlocking an exception', async () => {
    const compiled = generate(policy([family({ content: { topics: ['news/war'] }, except: [{ topics: ['science'] }] })], vocabulary));
    const context = contextAt(new Date('2026-11-03T06:30:00Z'), 'Asia/Kolkata');
    const signed = toRecords({ items: [item], batch }, vocabulary)!;
    const unsigned = toRecords({ items: [item] }, vocabulary)!;
    expect((await decideItems(nodeEngine, compiled, signed, context))[0].decision).toBe('allow');
    expect((await decideItems(nodeEngine, compiled, unsigned, context))[0].decision).toBe('hide');
  });

  it('reads a real YouTube shape, and fills topics from the title without trusting them', () => {
    const raw = fromYouTube({ id: 'abc', snippet: { title: 'Yuddh ki khabar', liveBroadcastContent: 'none' }, contentDetails: { contentRating: {} }, status: { madeForKids: false } });
    const [record] = toRecords({ items: [raw] }, DEFAULT_VOCABULARY)!;
    expect(record).toMatchObject({ content_id: 'youtube:abc', format: 'video', live: false, trusted: false, topics: ['news', 'news/war'] });
    expect(record.rating_age).toBeUndefined();
  });

  it('refuses unreadable, empty and oversized lists', () => {
    expect(decodeManifest(undefined)).toBeNull();
    expect(decodeManifest('!!!')).toBeNull();
    expect(decodeManifest(encode({ items: [] }))).toBeNull();
    expect(decodeManifest(encode({ items: Array.from({ length: 101 }, (_, i) => ({ content_id: `${i}` })) }))).toBeNull();
    const manifest = decodeManifest(encode({ items: [item] })) as Manifest;
    expect(manifest.items).toHaveLength(1);
  });
});

describe('Footube\'s real signed labels', () => {
  const labels = JSON.parse(readFileSync(new URL('../../../../platform/src/family/footubeLabels.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
  const batch = JSON.parse(readFileSync(new URL('../../../../platform/src/family/footubeLabelBatch.json', import.meta.url), 'utf8')) as Manifest['batch'];

  it('are trusted, and a teen\'s rules give the expected feed', async () => {
    const records = toRecords({ items: labels, batch }, DEFAULT_VOCABULARY)!;
    expect(records.every((record) => record.trusted)).toBe(true);

    const compiled = generate(policy([...baselineRules('12_17'), family({ content: { topics: ['health'] } })]));
    const decisions = await decideItems(nodeEngine, compiled, records, contextAt(new Date('2026-11-03T06:30:00Z'), 'Asia/Kolkata'));
    const hidden = decisions.filter((item) => item.decision === 'hide').map((item) => item.content_id);
    expect(hidden.sort()).toEqual(['how-gambling-hooks-the-brain', 'life-under-siege', 'sleep-screens-teen-brain']);
    expect(decisions.every((item) => item.decision !== 'ask')).toBe(true);
  });
});

describe('what the platform gets back', () => {
  it('is only decisions, tied to the request', () => {
    const result = resultFrom({
      requestId: 'req',
      manifestParam: 'abc',
      policy: { version: 3, hash: 'hash' },
      decisions: [{ content_id: 'a', decision: 'hide', reasons: [{ rule_id: 'secret', kind: 'match' }] }],
      now: new Date('2026-11-03T10:07:00Z'),
      validUntil: new Date('2026-11-03T10:15:00Z'),
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.decisions).toEqual([{ content_id: 'a', decision: 'hide' }]);
    expect(result.manifest_hash).toBeTruthy();
    const encoded = encodeResult(result);
    expect(boundNonce('n', encoded)).not.toBe(boundNonce('n', `${encoded}x`));
  });
});
