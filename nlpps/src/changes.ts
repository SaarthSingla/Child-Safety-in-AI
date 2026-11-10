import type { Accounts, Child, Guardian } from './accounts';
import { newId } from './crypto';
import type { Db } from './db';
import { HttpError } from './http';
import {
  DEFAULT_VOCABULARY,
  baselineRules,
  describeRule,
  generate,
  guardianMessage,
  hashOf,
  impactExamples,
  makeBundle,
  notesFor,
  onUnknownFor,
  validateCedar,
  validatePolicy,
  validateRuleForm,
  verifySignature,
  type ApprovedItem,
  type Issue,
  type PolicyBundle,
  type PolicyDocument,
  type Rule,
  type RuleForm,
} from './policy';
import { PolicyStore, VersionConflict, ruleId } from './store';
import type { RuleException, Translator } from './translator';

export type ChangeState = 'clarify' | 'unsupported' | 'preview' | 'live' | 'failed' | 'cancelled';

export type Plan = {
  add: Rule[];
  remove: string[];
  exceptions: RuleException[];
  approve: ApprovedItem[];
  restore?: number;
};

export type Preview = {
  changes: string[];
  notes: string[];
  examples: string[];
  no_effect: boolean;
  rules_after: string[];
};

type ChangeData = {
  answers: string[];
  question?: string;
  options?: string[];
  reason?: string;
  translator?: string;
  plan?: Plan;
  base_version?: number;
  preview?: Preview;
  candidate?: { bundle: PolicyBundle; bundle_hash: string; message: string };
  request_id?: string;
};

type ChangeRow = { id: string; child_id: string; guardian_id: string; kind: string; text: string | null; state: ChangeState; data: string; created_at: string };

export type ChangeView = {
  id: string;
  child_id: string;
  kind: string;
  text: string | null;
  state: ChangeState;
  question?: string;
  options?: string[];
  reason?: string;
  preview?: Preview;
  bundle_hash?: string;
  sign_message?: string;
  result_version?: number;
};

const issueText = (issues: Issue[]) => issues.slice(0, 4).map((issue) => `${issue.path}: ${issue.message}`).join('; ');

function localToday(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Every change, whatever started it, follows the same path: work out what
// should change, build the new policy and its Cedar rules, show the parent,
// and publish only after the parent's device signs.
export class Changes {
  constructor(
    private readonly db: Db,
    private readonly store: PolicyStore,
    private readonly accounts: Accounts,
    private readonly translator: Translator,
  ) {}

  private save(id: string, state: ChangeState, data: ChangeData): void {
    this.db.run('UPDATE changes SET state = ?, data = ?, updated_at = ? WHERE id = ?', state, JSON.stringify(data), new Date().toISOString(), id);
  }

  private row(id: string, guardian: Guardian): ChangeRow {
    const row = this.db.get<ChangeRow>('SELECT * FROM changes WHERE id = ? AND guardian_id = ?', id, guardian.id);
    if (!row) throw new HttpError(404, 'no such change');
    return row;
  }

  view(id: string, guardian: Guardian): ChangeView {
    const row = this.row(id, guardian);
    const data = JSON.parse(row.data) as ChangeData;
    const version = row.state === 'live' ? this.db.get<{ version: number }>('SELECT version FROM policy_versions WHERE change_id = ?', id)?.version : undefined;
    return {
      id: row.id,
      child_id: row.child_id,
      kind: row.kind,
      text: row.text,
      state: row.state,
      question: data.question,
      options: data.options,
      reason: data.reason,
      preview: data.preview,
      bundle_hash: row.state === 'preview' ? data.candidate?.bundle_hash : undefined,
      sign_message: row.state === 'preview' ? data.candidate?.message : undefined,
      result_version: version,
    };
  }

  private open(child: Child, guardian: Guardian, kind: string, text: string | null, data: ChangeData): string {
    const id = newId('chg');
    const now = new Date().toISOString();
    this.db.run('INSERT INTO changes (id, child_id, guardian_id, kind, text, state, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, child.id, guardian.id, kind, text, 'failed', JSON.stringify(data), now, now);
    return id;
  }

  private policyBefore(child: Child): PolicyDocument {
    const active = this.store.active(child.id);
    if (active) return active.bundle.policy;
    return {
      schema: 'nlpps.policy/1',
      child_ref: child.ref,
      version: 0,
      previous_hash: null,
      age_band: child.age_band,
      timezone: child.timezone,
      vocabulary: DEFAULT_VOCABULARY,
      rules: [],
      approved_items: [],
      created_at: new Date().toISOString(),
    };
  }

  private applyPlan(before: PolicyDocument, plan: Plan): PolicyDocument {
    let rules = plan.restore !== undefined ? this.restoredRules(before, plan.restore) : before.rules.filter((rule) => !plan.remove.includes(rule.instruction_id));
    rules = [...rules, ...plan.add];

    for (const { rule_id, clause } of plan.exceptions) {
      rules = rules.map((rule) => (rule.id === rule_id ? { ...rule, except: [...(rule.except ?? []), clause] } : rule));
    }

    const kept = new Map(before.approved_items.map((item) => [item.content_id, item]));
    for (const item of plan.approve) kept.set(item.content_id, item);

    return { ...before, version: before.version + 1, previous_hash: this.currentHash(before), rules, approved_items: [...kept.values()], created_at: new Date().toISOString() };
  }

  private currentHash(before: PolicyDocument): string | null {
    return before.version === 0 ? null : (this.db.get<{ bundle_hash: string }>('SELECT bundle_hash FROM policy_versions WHERE version = ? AND child_id = (SELECT id FROM children WHERE ref = ?)', before.version, before.child_ref)?.bundle_hash ?? null);
  }

  // Going back never touches the fixed protections.
  private restoredRules(before: PolicyDocument, version: number): Rule[] {
    const child = this.db.get<{ id: string }>('SELECT id FROM children WHERE ref = ?', before.child_ref)!;
    const target = this.store.version(child.id, version);
    if (!target) throw new HttpError(404, 'no such version');
    return [...before.rules.filter((rule) => rule.layer !== 'family'), ...target.bundle.policy.rules.filter((rule) => rule.layer === 'family')];
  }

  // Builds the new policy, generates Cedar, has real Cedar check it, and
  // prepares what the parent will see and sign.
  private prepare(child: Child, changeId: string, data: ChangeData, plan: Plan): void {
    const before = this.policyBefore(child);
    const after = this.applyPlan(before, plan);

    const issues = validatePolicy(after);
    if (issues.length > 0) {
      this.save(changeId, 'failed', { ...data, plan, reason: `This change could not be applied (${issueText(issues)}).` });
      return;
    }

    const compiled = generate(after);
    const problems = validateCedar(compiled);
    if (problems.length > 0) {
      this.save(changeId, 'failed', { ...data, plan, reason: `The generated rules failed a safety check (${problems[0].slice(0, 200)}).` });
      return;
    }

    const bundle = makeBundle(after, compiled);
    const bundle_hash = hashOf(bundle);
    const { examples, changed } = impactExamples(before, after);
    const added = new Set(plan.add.map((rule) => rule.id));
    const touched = new Set(plan.exceptions.map((entry) => entry.rule_id));

    const changes = [
      ...after.rules.filter((rule) => added.has(rule.id) || touched.has(rule.id)).map((rule) => describeRule(rule, after)),
      ...before.rules.filter((rule) => plan.remove.includes(rule.instruction_id)).map((rule) => `Remove: ${describeRule(rule, before)}`),
      ...plan.approve.map((item) => `Approve one item${item.until ? ` until ${item.until.replace('T', ' ')}` : ''}.`),
    ];
    if (plan.restore !== undefined) changes.push(`Go back to the family rules in version ${plan.restore}.`);

    const preview: Preview = {
      changes,
      notes: notesFor(after.rules.filter((rule) => added.has(rule.id) || touched.has(rule.id)), after),
      examples: examples.map((example) => example.description),
      no_effect: !changed,
      rules_after: after.rules.map((rule) => describeRule(rule, after)),
    };

    this.save(changeId, 'preview', { ...data, plan, base_version: before.version, preview, candidate: { bundle, bundle_hash, message: guardianMessage(bundle_hash) } });
  }

  async fromText(child: Child, guardian: Guardian, text: string): Promise<ChangeView> {
    const id = this.open(child, guardian, 'text', text, { answers: [] });
    await this.translate(child, id, text, { answers: [] });
    return this.view(id, guardian);
  }

  private async translate(child: Child, id: string, text: string, data: ChangeData): Promise<void> {
    const before = this.policyBefore(child);
    const family = before.rules.filter((rule) => rule.layer === 'family');
    const base = {
      text,
      answers: data.answers,
      rules: family.map(({ id: ruleKey, content, when }) => ({ id: ruleKey, content, when })),
      today: localToday(child.timezone),
    };

    let feedback: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const answer = await this.translator.translate({ ...base, feedback });
      const noted = { ...data, translator: answer.translator };

      if (answer.kind === 'clarify') {
        this.save(id, 'clarify', { ...noted, question: answer.question, options: answer.options });
        return;
      }
      if (answer.kind === 'unsupported') {
        this.save(id, 'unsupported', { ...noted, reason: answer.reason });
        return;
      }
      if (answer.kind === 'error') {
        this.save(id, 'failed', { ...noted, reason: `Could not understand this right now: ${answer.reason}.` });
        return;
      }

      const problems = this.checkTranslation(answer.rules, answer.exceptions, before);
      if (problems.length === 0) {
        const instruction = ruleId('ins');
        const add = answer.rules.map((form) => this.toRule(form, child, instruction, text));
        this.prepare(child, id, noted, { add, remove: [], exceptions: answer.exceptions, approve: [] });
        return;
      }
      feedback = issueText(problems);
    }

    this.save(id, 'failed', { ...data, reason: `The translation did not pass the checks (${feedback}). Try rephrasing it.` });
  }

  private checkTranslation(forms: RuleForm[], exceptions: RuleException[], before: PolicyDocument): Issue[] {
    const issues = forms.flatMap((form, index) => validateRuleForm(form, before.vocabulary, `rules[${index}]`));
    exceptions.forEach((entry, index) => {
      const target = before.rules.find((rule) => rule.id === entry.rule_id);
      if (!target) issues.push({ path: `exceptions[${index}]`, message: 'that rule does not exist' });
      else if (target.layer === 'fixed') issues.push({ path: `exceptions[${index}]`, message: 'fixed protections cannot have exceptions' });
      issues.push(
        ...validateRuleForm({ effect: 'hide', content: {}, when: { days: ['mon'] }, except: [entry.clause], explanation: { child: 'x', guardian: 'x' } }, before.vocabulary, `exceptions[${index}]`),
      );
    });
    return issues;
  }

  private toRule(form: RuleForm, child: Child, instruction: string, text: string): Rule {
    return {
      ...form,
      id: ruleId('r'),
      layer: 'family',
      instruction_id: instruction,
      on_unknown: onUnknownFor('family', child.age_band, form),
      author: `guardian:${child.guardian_id}`,
      source_text: text,
    };
  }

  async clarify(id: string, guardian: Guardian, answer: string): Promise<ChangeView> {
    const row = this.row(id, guardian);
    if (row.state !== 'clarify') throw new HttpError(409, 'this change is not waiting for an answer');
    const data = JSON.parse(row.data) as ChangeData;
    const child = this.accounts.childOf(guardian, row.child_id);
    await this.translate(child, id, row.text ?? '', { ...data, answers: [...data.answers, answer], question: undefined, options: undefined });
    return this.view(id, guardian);
  }

  // A brand new child starts with the protections for their age.
  initial(child: Child, guardian: Guardian): ChangeView {
    const data: ChangeData = { answers: [] };
    const id = this.open(child, guardian, 'create', null, data);
    this.prepare(child, id, data, { add: baselineRules(child.age_band), remove: [], exceptions: [], approve: [] });
    return this.view(id, guardian);
  }

  removeInstruction(child: Child, guardian: Guardian, instructionId: string): ChangeView {
    const before = this.policyBefore(child);
    const rules = before.rules.filter((rule) => rule.instruction_id === instructionId);
    if (rules.length === 0) throw new HttpError(404, 'no such rule');
    if (rules.some((rule) => rule.layer !== 'family')) throw new HttpError(403, 'Built-in protections cannot be removed.');

    const data: ChangeData = { answers: [] };
    const id = this.open(child, guardian, 'remove', null, data);
    this.prepare(child, id, data, { add: [], remove: [instructionId], exceptions: [], approve: [] });
    return this.view(id, guardian);
  }

  rollback(child: Child, guardian: Guardian, version: number): ChangeView {
    if (!this.store.version(child.id, version)) throw new HttpError(404, 'no such version');
    const data: ChangeData = { answers: [] };
    const id = this.open(child, guardian, 'rollback', null, data);
    this.prepare(child, id, data, { add: [], remove: [], exceptions: [], approve: [], restore: version });
    return this.view(id, guardian);
  }

  // Approving what a child asked for. It goes through the same preview and
  // signature as anything else.
  approval(child: Child, guardian: Guardian, requestId: string, exceptions: RuleException[], approve: ApprovedItem[]): ChangeView {
    const data: ChangeData = { answers: [], request_id: requestId };
    const id = this.open(child, guardian, 'approval', null, data);
    this.prepare(child, id, data, { add: [], remove: [], exceptions, approve });
    return this.view(id, guardian);
  }

  cancel(id: string, guardian: Guardian): ChangeView {
    const row = this.row(id, guardian);
    if (row.state === 'live') throw new HttpError(409, 'this change is already live');
    this.save(id, 'cancelled', JSON.parse(row.data) as ChangeData);
    return this.view(id, guardian);
  }

  // The parent's device signs the exact policy. If another change went live
  // first, the preview is rebuilt and the parent is asked again.
  confirm(id: string, guardian: Guardian, kid: string, signature: string): ChangeView {
    const row = this.row(id, guardian);
    if (row.state !== 'preview') throw new HttpError(409, 'this change is not waiting for confirmation');
    const data = JSON.parse(row.data) as ChangeData;
    const child = this.accounts.childOf(guardian, row.child_id);
    const candidate = data.candidate!;

    const jwk = this.accounts.keyOf(guardian.id, kid);
    if (!jwk) throw new HttpError(403, 'this device is not registered');
    if (!verifySignature(signature, candidate.message, jwk)) throw new HttpError(403, 'the signature does not match this change');

    const version = (data.base_version ?? 0) + 1;
    if ((this.store.active(child.id)?.version ?? 0) !== version - 1) {
      this.prepare(child, id, data, data.plan!);
      return this.view(id, guardian);
    }

    try {
      this.store.publish(child.id, { bundle: candidate.bundle, bundle_hash: candidate.bundle_hash, previous_hash: candidate.bundle.policy.previous_hash, guardian_kid: kid, guardian_signature: signature, change_id: id }, version);
    } catch (error) {
      if (error instanceof VersionConflict) {
        this.prepare(child, id, data, data.plan!);
        return this.view(id, guardian);
      }
      throw error;
    }

    this.save(id, 'live', data);
    this.db.audit(child.id, `guardian:${guardian.id}`, 'policy.published', { version, change_id: id, bundle_hash: candidate.bundle_hash });

    if (data.request_id) {
      this.db.run("UPDATE child_requests SET status = 'approved', decided_by = ?, decided_at = ?, change_id = ?, result_version = ? WHERE id = ?", guardian.id, new Date().toISOString(), id, version, data.request_id);
    }
    return this.view(id, guardian);
  }

  list(childId: string): { id: string; text: string | null; kind: string; state: string; created_at: string }[] {
    return this.db.all('SELECT id, text, kind, state, created_at FROM changes WHERE child_id = ? ORDER BY created_at DESC LIMIT 20', childId);
  }
}
