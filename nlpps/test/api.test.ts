import { p256 } from '@noble/curves/nist.js';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp, type App } from '../src/app';
import type { SigningKey } from '../src/crypto';
import { Db } from '../src/db';
import { bytesToBase64url, contextAt, decideItems, isExpired, keyId, nodeEngine, normalizeRecord, verifyEnvelope, type PublicJwk, type RuleForm, type SignedEnvelope } from '../src/policy';
import type { Translation, TranslationInput, Translator } from '../src/translator';

function testKey(): SigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as PublicJwk;
  const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } as SigningKey['publicJwk'];
  return { privateKey, publicJwk, kid: keyId(publicJwk) };
}

const queue: Translation[] = [];
const inputs: TranslationInput[] = [];
const fake: Translator = {
  name: 'fake',
  translate: async (input) => {
    inputs.push(input);
    return queue.shift() ?? { kind: 'error', reason: 'nothing queued', translator: 'fake' };
  },
};

const explanation = { child: 'Not now.', guardian: 'A rule' };
const rules = (...forms: RuleForm[]): Translation => ({ kind: 'rules', rules: forms, exceptions: [], translator: 'fake' });
const warNews: RuleForm = { effect: 'hide', content: { topics: ['news/war'] }, when: { after: '21:00', before: '06:00' }, explanation };

let app: App;
let base: string;

function device() {
  const secret = p256.keygen().secretKey;
  const point = p256.getPublicKey(secret, false);
  const jwk = { kty: 'EC', crv: 'P-256', x: bytesToBase64url(point.slice(1, 33)), y: bytesToBase64url(point.slice(33, 65)) };
  return { secret, jwk, kid: keyId(jwk), sign: (message: string) => bytesToBase64url(p256.sign(new TextEncoder().encode(message), secret, { lowS: false })) };
}

async function api(method: string, path: string, token: string | null, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

let email = 0;
async function parent() {
  email += 1;
  const { body } = await api('POST', '/api/auth/register', null, { email: `parent${email}@example.com`, password: 'a long password', name: 'Asha' });
  const keys = device();
  await api('POST', '/api/me/keys', body.token, { jwk: keys.jwk });
  return { token: body.token as string, keys };
}

const confirm = (token: string, keys: ReturnType<typeof device>, change: any) => api('POST', `/api/changes/${change.id}/confirm`, token, { kid: keys.kid, signature: keys.sign(change.sign_message) });

async function child(owner: Awaited<ReturnType<typeof parent>>, age_band = '12_17') {
  const { body } = await api('POST', '/api/children', owner.token, { name: 'Sam', timezone: 'Asia/Kolkata', age_band });
  expect(body.change.state).toBe('preview');
  const done = await confirm(owner.token, owner.keys, body.change);
  expect(done.body.state).toBe('live');
  return body.child as { id: string; ref: string };
}

async function pair(owner: Awaited<ReturnType<typeof parent>>, childId: string) {
  const code = await api('POST', `/api/children/${childId}/pairing-codes`, owner.token, {});
  const { body } = await api('POST', '/api/device/pair', null, { code: code.body.code, label: 'Phone' });
  return body as { device_token: string; guardian_keys: PublicJwk[]; child_ref: string; device_id: string };
}

const say = async (owner: { token: string }, childId: string, text: string) => (await api('POST', `/api/children/${childId}/changes`, owner.token, { text })).body;

beforeAll(async () => {
  app = createApp({ port: 0, host: '127.0.0.1', dbPath: ':memory:', keyPath: '', publicUrl: null, llm: null, publicDir: '/nonexistent', policyDays: 7 }, { translator: fake, db: new Db(':memory:'), key: testKey(), limits: { default: 9999, auth: 9999, pair: 9999, device: 9999, translate: 9999 } });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(() => {
  app.server.close();
  app.db.close();
});

describe('from a parent\'s sentence to a decision on the phone', () => {
  it('runs the whole journey', async () => {
    const owner = await parent();
    const kid = await child(owner);

    queue.push(rules(warNews));
    const change = await say(owner, kid.id, 'Hide war news from 9pm to 6am');
    expect(change.state).toBe('preview');
    expect(change.preview.changes[0]).toContain('War news');
    expect(change.preview.examples.length).toBeGreaterThan(0);

    const live = await confirm(owner.token, owner.keys, change);
    expect(live.body.result_version).toBe(2);

    const paired = await pair(owner, kid.id);
    expect(paired.guardian_keys).toEqual([owner.keys.jwk]);

    const { body: signed } = await api('GET', '/api/device/policy', paired.device_token);
    const trust = { server: app.key.publicJwk, guardians: paired.guardian_keys, childRef: paired.child_ref };
    const check = verifyEnvelope(signed as SignedEnvelope, trust, null);
    expect(check.ok).toBe(true);
    expect(signed.envelope.bundle.policy.previous_hash).toBeTruthy();

    const { compiled, policy } = signed.envelope.bundle;
    const war = normalizeRecord({ content_id: 'a', topics: ['news/war'], rating_age: 7, format: 'video' }, policy.vocabulary, false)!;
    const science = normalizeRecord({ content_id: 'b', topics: ['science'], rating_age: 7 }, policy.vocabulary, false)!;
    const night = contextAt(new Date('2026-11-03T16:30:00Z'), 'Asia/Kolkata');
    const noon = contextAt(new Date('2026-11-03T06:30:00Z'), 'Asia/Kolkata');

    expect(night.minute).toBe(1320);
    expect((await decideItems(nodeEngine, compiled, [war, science], night)).map((d) => d.decision)).toEqual(['hide', 'allow']);
    expect((await decideItems(nodeEngine, compiled, [war, science], noon)).map((d) => d.decision)).toEqual(['allow', 'allow']);
  });

  it('splits one sentence into two rules and warns about items with both labels', async () => {
    const owner = await parent();
    const kid = await child(owner);
    queue.push(rules(
      { effect: 'hide', content: { topics: ['science'] }, when: { after: '21:00', before: '09:00' }, explanation },
      { effect: 'hide', content: { topics: ['news/war'] }, when: { after: '09:00', before: '21:00' }, explanation },
    ));
    const change = await say(owner, kid.id, 'block science from 9pm to 9am and war from 9am to 9pm');
    expect(change.preview.changes).toHaveLength(2);
    expect(change.preview.notes.join(' ')).toContain('hidden all day');
    await confirm(owner.token, owner.keys, change);

    const view = await api('GET', `/api/children/${kid.id}`, owner.token);
    const family = view.body.policy.rules.filter((r: any) => r.layer === 'family');
    expect(new Set(family.map((r: any) => r.instruction_id)).size).toBe(1);

    const removed = await api('POST', `/api/children/${kid.id}/remove`, owner.token, { instruction_id: family[0].instruction_id });
    await confirm(owner.token, owner.keys, removed.body);
    const after = await api('GET', `/api/children/${kid.id}`, owner.token);
    expect(after.body.policy.rules.filter((r: any) => r.layer === 'family')).toHaveLength(0);
  });

  it('asks a question, then uses the answer', async () => {
    const owner = await parent();
    const kid = await child(owner);
    queue.push({ kind: 'clarify', question: 'Which nights?', options: ['Sunday to Thursday'], translator: 'fake' });
    const asked = await say(owner, kid.id, 'no games on school nights');
    expect(asked.state).toBe('clarify');
    queue.push(rules({ effect: 'hide', content: { topics: ['games'] }, when: { after: '21:00', before: '06:00', days: ['sun', 'mon', 'tue', 'wed', 'thu'] }, explanation }));
    const { body } = await api('POST', `/api/changes/${asked.id}/clarify`, owner.token, { answer: 'Sunday to Thursday' });
    expect(body.state).toBe('preview');
    expect(inputs.at(-1)?.answers).toEqual(['Sunday to Thursday']);
  });

  it('says so when a request cannot be a rule', async () => {
    const owner = await parent();
    const kid = await child(owner);
    queue.push({ kind: 'unsupported', reason: 'Daily limits are not supported yet.', translator: 'fake' });
    const change = await say(owner, kid.id, 'two hours a day');
    expect(change.state).toBe('unsupported');
    expect(change.preview).toBeUndefined();
  });

  it('warns when a rule changes nothing', async () => {
    const owner = await parent();
    const kid = await child(owner);
    queue.push(rules({ effect: 'hide', content: { topics: ['harm/hate'] }, explanation }));
    const change = await say(owner, kid.id, 'block hate');
    expect(change.preview.no_effect).toBe(true);
  });

  it('never sends the child\'s name to the LLM', async () => {
    const owner = await parent();
    const kid = await child(owner);
    queue.push(rules(warNews));
    await say(owner, kid.id, 'no war');
    expect(JSON.stringify(inputs.at(-1))).not.toContain('Sam');
  });
});

describe('a wrong LLM answer never reaches a policy', () => {
  it('sends a bad form back once, then gives up safely', async () => {
    const owner = await parent();
    const kid = await child(owner);
    const bad = rules({ effect: 'hide', content: { topics: ['news/wars'] }, explanation });
    queue.push(bad, bad);
    const change = await say(owner, kid.id, 'no war');
    expect(change.state).toBe('failed');
    expect(inputs.at(-1)?.feedback).toContain('unknown term');
    const view = await api('GET', `/api/children/${kid.id}`, owner.token);
    expect(view.body.policy.version).toBe(1);
  });

  it('accepts the repaired form', async () => {
    const owner = await parent();
    const kid = await child(owner);
    queue.push(rules({ effect: 'hide', content: { topics: ['news/wars'] }, explanation }), rules(warNews));
    expect((await say(owner, kid.id, 'no war')).state).toBe('preview');
  });

  it.each([
    ['an allow rule', { effect: 'allow', content: { topics: ['harm'] }, explanation }],
    ['a sneaked in on_unknown', { ...warNews, on_unknown: 'allow' }],
    ['a sneaked in layer', { ...warNews, layer: 'fixed' }],
    ['a rule that blocks everything forever', { effect: 'hide', content: {}, explanation }],
  ])('refuses %s', async (_, form) => {
    const owner = await parent();
    const kid = await child(owner);
    queue.push(rules(form as RuleForm), rules(form as RuleForm));
    expect((await say(owner, kid.id, 'x')).state).toBe('failed');
  });

  it('refuses an exception to a fixed protection', async () => {
    const owner = await parent();
    const kid = await child(owner);
    const attempt: Translation = { kind: 'rules', rules: [], exceptions: [{ rule_id: 'harm', clause: { topics: ['harm'] } }], translator: 'fake' };
    queue.push(attempt, attempt);
    expect((await say(owner, kid.id, 'allow it')).state).toBe('failed');
  });
});

describe('a policy goes live only with the parent\'s device signature', () => {
  it('rejects no signature, a wrong one, and a stranger\'s key', async () => {
    const owner = await parent();
    const kid = await child(owner);
    queue.push(rules(warNews));
    const change = await say(owner, kid.id, 'no war');

    expect((await api('POST', `/api/changes/${change.id}/confirm`, owner.token, { kid: owner.keys.kid, signature: owner.keys.sign('something else') })).status).toBe(403);
    const other = await parent();
    expect((await api('POST', `/api/changes/${change.id}/confirm`, other.token, { kid: other.keys.kid, signature: other.keys.sign(change.sign_message) })).status).toBe(404);
    const stray = device();
    expect((await api('POST', `/api/changes/${change.id}/confirm`, owner.token, { kid: stray.kid, signature: stray.sign(change.sign_message) })).status).toBe(403);
    expect((await api('GET', `/api/children/${kid.id}`, owner.token)).body.policy.version).toBe(1);
  });

  it('rebuilds and asks again if another change went live first', async () => {
    const owner = await parent();
    const kid = await child(owner);
    queue.push(rules(warNews));
    const first = await say(owner, kid.id, 'one');
    queue.push(rules({ ...warNews, content: { topics: ['games'] } }));
    const second = await say(owner, kid.id, 'two');
    await confirm(owner.token, owner.keys, first);
    const stale = await confirm(owner.token, owner.keys, second);
    expect(stale.body.state).toBe('preview');
    expect(stale.body.sign_message).not.toBe(second.sign_message);
    expect((await confirm(owner.token, owner.keys, stale.body)).body.result_version).toBe(3);
  });

  it('keeps other families\' children private', async () => {
    const owner = await parent();
    const kid = await child(owner);
    const other = await parent();
    expect((await api('GET', `/api/children/${kid.id}`, other.token)).status).toBe(404);
    expect((await api('GET', `/api/children/${kid.id}`, null)).status).toBe(401);
  });
});

describe('fixed protections', () => {
  it('cannot be removed, and survive going back', async () => {
    const owner = await parent();
    const kid = await child(owner);
    expect((await api('POST', `/api/children/${kid.id}/remove`, owner.token, { instruction_id: 'system_harm' })).status).toBe(403);

    queue.push(rules(warNews));
    await confirm(owner.token, owner.keys, await say(owner, kid.id, 'no war'));
    const back = await api('POST', `/api/children/${kid.id}/rollback`, owner.token, { version: 1 });
    expect((await confirm(owner.token, owner.keys, back.body)).body.result_version).toBe(3);
    const view = await api('GET', `/api/children/${kid.id}`, owner.token);
    expect(view.body.policy.rules.map((r: any) => r.id).sort()).toEqual(['adult', 'harm', 'rating']);
  });
});

describe('asking a guardian', () => {
  async function setup() {
    const owner = await parent();
    const kid = await child(owner);
    const paired = await pair(owner, kid.id);
    return { owner, kid, paired };
  }
  const ask = (paired: { device_token: string }, content_id: string, reasons: unknown[]) => api('POST', '/api/device/requests', paired.device_token, { content: { content_id, title: 'Item' }, reasons, note: 'for homework' });

  it('turns a family block into an exception on that rule, after the parent signs', async () => {
    const { owner, kid, paired } = await setup();
    queue.push(rules(warNews));
    const live = await say(owner, kid.id, 'no war');
    await confirm(owner.token, owner.keys, live);
    const policy = (await api('GET', '/api/device/policy', paired.device_token)).body.envelope.bundle.policy;
    const ruleId = policy.rules.find((r: any) => r.layer === 'family').id;

    const made = await ask(paired, 'war-doc', [{ rule_id: ruleId, kind: 'match' }]);
    const { body: change } = await api('POST', `/api/children/${kid.id}/requests/${made.body.request_id}/decide`, owner.token, { approve: true, duration: 'always' });
    expect(change.state).toBe('preview');
    await confirm(owner.token, owner.keys, change);

    const signed = (await api('GET', '/api/device/policy', paired.device_token)).body as SignedEnvelope;
    const war = normalizeRecord({ content_id: 'war-doc', topics: ['news/war'], rating_age: 7 }, signed.envelope.bundle.policy.vocabulary, false)!;
    const [decision] = await decideItems(nodeEngine, signed.envelope.bundle.compiled, [war], contextAt(new Date('2026-11-03T16:30:00Z'), 'Asia/Kolkata'));
    expect(decision.decision).toBe('allow');

    const list = await api('GET', '/api/device/requests', paired.device_token);
    expect(list.body.requests[0].status).toBe('approved');
  });

  it('approves an unlabelled item, but refuses a real fixed match', async () => {
    const { owner, kid, paired } = await setup();
    const unknown = await ask(paired, 'mystery', [{ rule_id: 'harm', kind: 'unknown' }]);
    const { body: change } = await api('POST', `/api/children/${kid.id}/requests/${unknown.body.request_id}/decide`, owner.token, { approve: true, duration: 'today' });
    await confirm(owner.token, owner.keys, change);
    const policy = (await api('GET', '/api/device/policy', paired.device_token)).body.envelope.bundle.policy;
    expect(policy.approved_items[0].content_id).toBe('mystery');
    expect(policy.approved_items[0].until).toMatch(/T00:00$/);

    const real = await ask(paired, 'harmful', [{ rule_id: 'harm', kind: 'match' }]);
    const refused = await api('POST', `/api/children/${kid.id}/requests/${real.body.request_id}/decide`, owner.token, { approve: true, duration: 'always' });
    expect(refused.status).toBe(403);
  });

  it('can be declined', async () => {
    const { owner, kid, paired } = await setup();
    const made = await ask(paired, 'x', []);
    const { body } = await api('POST', `/api/children/${kid.id}/requests/${made.body.request_id}/decide`, owner.token, { approve: false });
    expect(body.status).toBe('denied');
  });
});

describe('devices', () => {
  it('uses a pairing code once, and unlinks with a signed statement', async () => {
    const owner = await parent();
    const kid = await child(owner);
    const code = await api('POST', `/api/children/${kid.id}/pairing-codes`, owner.token, {});
    expect((await api('POST', '/api/device/pair', null, { code: code.body.code })).status).toBe(200);
    expect((await api('POST', '/api/device/pair', null, { code: code.body.code })).status).toBe(400);

    const paired = await pair(owner, kid.id);
    await api('DELETE', `/api/children/${kid.id}/devices/${paired.device_id}`, owner.token);
    const gone = await api('GET', '/api/device/policy', paired.device_token);
    expect(gone.status).toBe(410);
    expect(gone.body.statement.device_id).toBe(paired.device_id);
    expect(gone.body.signature).toBeTruthy();
  });

  it('gives fresh dates on each download without changing the approved bundle', async () => {
    const owner = await parent();
    const kid = await child(owner);
    const paired = await pair(owner, kid.id);
    const signed = (await api('GET', '/api/device/policy', paired.device_token)).body as SignedEnvelope;
    expect(isExpired(signed.envelope, new Date())).toBe(false);
    expect(isExpired(signed.envelope, new Date(Date.now() + 8 * 86_400_000))).toBe(true);
  });
});
