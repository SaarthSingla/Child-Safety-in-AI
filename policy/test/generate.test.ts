import { describe, expect, it } from 'vitest';

import { nodeEngine, validateCedar } from '../src/cedar-node';
import { baselineRules, decideItems, DEFAULT_VOCABULARY, DAYS, generate, normalizeRecord, referenceDecision, type ContentMatch, type ContentRecord, type DecisionContext, type Exception, type PolicyDocument, type Rule } from '../src/index';
import { familyRule, policyOf } from './helpers';

let seed = 20261103;
const R = (n: number) => {
  seed = (seed * 48271) % 2147483647;
  return seed % n;
};
const pick = <T,>(items: readonly T[], most: number): T[] => {
  const out = new Set<T>();
  const count = 1 + R(most);
  while (out.size < Math.min(count, items.length)) out.add(items[R(items.length)]);
  return [...out];
};
const topics = Object.keys(DEFAULT_VOCABULARY.topics);
const TIMES = ['00:00', '05:00', '06:00', '07:00', '09:00', '15:00', '18:00', '20:00', '21:00', '21:15', '22:00', '23:45'];

const match = (): ContentMatch => {
  const m: ContentMatch = {};
  if (R(2)) m.topics = pick(topics, 2);
  if (!R(3)) m.features = pick(DEFAULT_VOCABULARY.features, 2);
  if (!R(3)) m.formats = pick(DEFAULT_VOCABULARY.formats, 2);
  if (!R(3)) m.min_rating_age = [7, 13, 16, 18][R(4)];
  if (!R(5)) m.live = !!R(2);
  return m;
};
const exception = (): Exception => {
  const clause: Exception = R(3) ? match() : {};
  if (!Object.keys(clause).length || !R(4)) clause.content_ids = [`item${R(4)}`];
  if (!R(3)) clause.until = `2026-${10 + R(3)}-1${R(9)}T0${R(9)}:15`;
  return clause;
};
const randomRule = (i: number): Rule => {
  const r = familyRule(`r${i}`, {
    layer: ['fixed', 'age', 'family'][R(3)] as Rule['layer'],
    effect: R(2) ? 'hide' : 'ask',
    content: match(),
    on_unknown: ['hide', 'ask', 'allow'][R(3)] as Rule['on_unknown'],
  });
  if (r.layer === 'fixed' && r.on_unknown === 'allow') r.on_unknown = 'ask';
  if (R(2) || !Object.keys(r.content).length) {
    r.when = {};
    if (R(3) || !Object.keys(r.content).length) {
      const a = TIMES[R(TIMES.length)];
      let b = TIMES[R(TIMES.length)];
      if (a === b) b = a === '09:00' ? '10:00' : '09:00';
      r.when = { after: a, before: b };
    }
    if (R(2)) r.when.days = pick(DAYS, 5);
  }
  if (r.layer !== 'fixed' && !R(3)) r.except = Array.from({ length: 1 + R(2) }, exception);
  if (r.layer !== 'fixed' && !R(5)) r.expires = `2026-11-0${1 + R(8)}T12:00`;
  return r;
};
const randomItem = (): ContentRecord => {
  const raw: Record<string, unknown> = { content_id: `item${R(6)}` };
  if (R(4)) raw.topics = R(5) ? pick(topics, 3) : [];
  if (R(3)) raw.features = R(3) ? pick(DEFAULT_VOCABULARY.features, 2) : [];
  if (R(4)) raw.format = DEFAULT_VOCABULARY.formats[R(9)];
  if (R(4)) raw.rating_age = [0, 7, 13, 16, 18][R(5)];
  if (R(3)) raw.live = !!R(2);
  return normalizeRecord(raw, DEFAULT_VOCABULARY, !!R(2))!;
};
const randomContext = (): DecisionContext => {
  const day = R(7);
  const minute = [0, 299, 300, 360, 540, 900, 1259, 1260, 1275, 1320, 1425, 1439][R(12)];
  return { minute, day, prev_day: (day + 6) % 7, now: 29_370_000 + R(40_000) };
};

describe('generated Cedar means exactly what the policy says', () => {
  it('matches the separate reference on random policies', async () => {
    let compared = 0;
    const seen = { allow: 0, ask: 0, hide: 0 };

    for (let i = 0; i < 1000; i += 1) {
      const policy: PolicyDocument = policyOf([...(R(2) ? baselineRules(['0_5', '6_11', '12_17'][R(3)] as '12_17') : []), ...Array.from({ length: 1 + R(8) }, (_, j) => randomRule(j))]);
      if (R(2)) policy.approved_items = [{ content_id: `item${R(6)}`, ...(R(2) ? { until: `2026-11-0${1 + R(8)}T12:00` } : {}) }];
      const compiled = generate(policy);
      expect(validateCedar(compiled)).toEqual([]);

      const items = Array.from({ length: 6 }, randomItem);
      for (const context of [randomContext(), randomContext()]) {
        const decisions = await decideItems(nodeEngine, compiled, items, context);
        decisions.forEach((decision, index) => {
          const expected = referenceDecision(policy, items[index], context);
          if (decision.decision !== expected) throw new Error(JSON.stringify({ policy: policy.rules, item: items[index], context, got: decision, expected }));
          seen[expected] += 1;
          compared += 1;
        });
      }
    }

    console.log(`compared ${compared} decisions`, seen);
    expect(compared).toBe(12000);
    expect(Math.min(seen.allow, seen.ask, seen.hide)).toBeGreaterThan(300);
  });

  it('notices a broken generator', async () => {
    const policy = policyOf([familyRule('a', { content: { topics: ['news/war'] }, on_unknown: 'ask' })]);
    const compiled = generate(policy);
    delete compiled.ask.family__a__unknown;
    const item = normalizeRecord({ content_id: 'x' }, DEFAULT_VOCABULARY, false)!;
    const context = { minute: 0, day: 0, prev_day: 6, now: 0 };
    const [decision] = await decideItems(nodeEngine, compiled, [item], context);
    expect(decision.decision).not.toBe(referenceDecision(policy, item, context));
  });
});

describe('the framework examples', () => {
  const context = (day: number, hour: number): DecisionContext => ({ minute: hour * 60, day, prev_day: (day + 6) % 7, now: 29_400_000 });
  const war = normalizeRecord({ content_id: 'w', topics: ['news/war'], format: 'video' }, DEFAULT_VOCABULARY, false)!;
  const unlabelled = normalizeRecord({ content_id: 'u', format: 'video' }, DEFAULT_VOCABULARY, false)!;

  it('treats 01:00 Monday as Sunday night and leaves Friday alone', async () => {
    const policy = policyOf([familyRule('n', { content: { topics: ['news/war'] }, when: { after: '21:00', before: '06:00', days: ['sun', 'mon', 'tue', 'wed', 'thu'] } })]);
    const compiled = generate(policy);
    const run = async (day: number, hour: number) => (await decideItems(nodeEngine, compiled, [war], context(day, hour)))[0].decision;
    expect(await run(6, 22)).toBe('hide');
    expect(await run(0, 1)).toBe('hide');
    expect(await run(0, 7)).toBe('allow');
    expect(await run(4, 22)).toBe('allow');
    expect(await run(5, 1)).toBe('allow');
  });

  it('keeps a family rule off unlabelled items unless the parent asked', async () => {
    const plain = generate(policyOf([familyRule('p', { content: { topics: ['news/war'] } })]));
    const strict = generate(policyOf([familyRule('p', { content: { topics: ['news/war'] }, on_unknown: 'ask' })]));
    expect((await decideItems(nodeEngine, plain, [unlabelled], context(0, 12)))[0].decision).toBe('allow');
    expect((await decideItems(nodeEngine, strict, [unlabelled], context(0, 12)))[0].decision).toBe('ask');
  });

  it('does not let an unsigned label unlock an exception', async () => {
    const compiled = generate(policyOf([familyRule('e', { content: { topics: ['news/war'] }, except: [{ topics: ['science'] }] })]));
    const faked = normalizeRecord({ content_id: 'f', topics: ['news/war', 'science'] }, DEFAULT_VOCABULARY, false)!;
    const signed = normalizeRecord({ content_id: 'f', topics: ['news/war', 'science'] }, DEFAULT_VOCABULARY, true)!;
    expect((await decideItems(nodeEngine, compiled, [faked], context(0, 12)))[0].decision).toBe('hide');
    expect((await decideItems(nodeEngine, compiled, [signed], context(0, 12)))[0].decision).toBe('allow');
  });

  it('applies the unknown-label table by age', async () => {
    const young = generate(policyOf(baselineRules('6_11'), '6_11'));
    const teen = generate(policyOf(baselineRules('12_17')));
    expect((await decideItems(nodeEngine, young, [unlabelled], context(0, 12)))[0].decision).toBe('hide');
    expect((await decideItems(nodeEngine, teen, [unlabelled], context(0, 12)))[0].decision).toBe('ask');
  });
});

describe('approving an item with missing labels', () => {
  const context = { minute: 720, day: 0, prev_day: 6, now: 29_400_000 };
  const policy = policyOf(baselineRules('12_17'));
  policy.approved_items = [{ content_id: 'video1' }];
  const compiled = generate(policy);

  it('settles the unknown case, even for fixed protections', async () => {
    const unlabelled = normalizeRecord({ content_id: 'video1' }, DEFAULT_VOCABULARY, false)!;
    const other = normalizeRecord({ content_id: 'video2' }, DEFAULT_VOCABULARY, false)!;
    const [a, b] = await decideItems(nodeEngine, compiled, [unlabelled, other], context);
    expect(a.decision).toBe('allow');
    expect(b.decision).toBe('ask');
    expect(b.reasons.every((reason) => reason.kind === 'unknown')).toBe(true);
  });

  it('never overrides a real match', async () => {
    const harmful = normalizeRecord({ content_id: 'video1', topics: ['harm/hate'] }, DEFAULT_VOCABULARY, false)!;
    const [decision] = await decideItems(nodeEngine, compiled, [harmful], context);
    expect(decision.decision).toBe('hide');
    expect(decision.reasons).toContainEqual({ rule_id: 'harm', kind: 'match' });
  });
});

describe('failing safely', () => {
  const item = normalizeRecord({ content_id: 'x', topics: ['science'], rating_age: 0 }, DEFAULT_VOCABULARY, false)!;
  const context = { minute: 720, day: 0, prev_day: 6, now: 0 };
  const compiled = generate(policyOf(baselineRules('12_17')));

  it('asks when a rule reports an error', async () => {
    const [decision] = await decideItems({ authorize: async (_, requests) => requests.map(() => ({ denied: false, reasons: [], errors: 1 })) }, compiled, [item], context);
    expect(decision.decision).toBe('ask');
  });

  it('asks when the engine fails or returns too little', async () => {
    const thrown = await decideItems({ authorize: async () => { throw new Error('engine down'); } }, compiled, [item], context);
    const short = await decideItems({ authorize: async () => [] }, compiled, [item], context);
    expect(thrown[0].decision).toBe('ask');
    expect(short[0].decision).toBe('ask');
  });

  it('runs only fixed protections, then asks, once a policy has expired', async () => {
    const withFamily = generate(policyOf([...baselineRules('12_17'), familyRule('f', { content: { topics: ['science'] } })]));
    const harmful = normalizeRecord({ content_id: 'h', topics: ['harm/hate'], rating_age: 0 }, DEFAULT_VOCABULARY, false)!;
    const results = await decideItems(nodeEngine, withFamily, [item, harmful], context, { expired: true });
    expect(results.map((r) => r.decision)).toEqual(['ask', 'hide']);
  });
});

describe('the generator refuses bad input', () => {
  const bad = (fields: Partial<Rule>) => () => generate(policyOf([familyRule('b', fields)]));
  it.each([
    ['injection through a term', { content: { topics: ['news"); permit('] } }],
    ['a misspelt topic', { content: { topics: ['news/wars'] } }],
    ['an unknown field', { content: { topicz: ['news'] } as never }],
    ['a time off the quarter hour', { content: { topics: ['news'] }, when: { after: '21:10', before: '06:00' } }],
    ['a window that starts and ends together', { content: { topics: ['news'] }, when: { after: '21:00', before: '21:00' } }],
    ['half a window', { content: { topics: ['news'] }, when: { after: '21:00' } }],
    ['a rule with no content or time', { content: {} }],
    ['an empty exception', { content: { topics: ['news'] }, except: [{}] }],
    ['a fixed rule that allows unknowns', { layer: 'fixed' as const, content: { topics: ['news'] }, on_unknown: 'allow' as const }],
    ['a fixed rule with an exception', { layer: 'fixed' as const, on_unknown: 'ask' as const, content: { topics: ['news'] }, except: [{ topics: ['science'] }] }],
    ['an allow effect', { effect: 'allow' as never, content: { topics: ['news'] } }],
    ['a bad rule id', { id: 'x"; drop' , content: { topics: ['news'] } }],
  ])('%s', (_, fields) => {
    expect(bad(fields)).toThrow();
  });
});
