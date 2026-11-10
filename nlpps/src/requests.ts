import type { Accounts, Child, Guardian } from './accounts';
import type { ChangeView, Changes } from './changes';
import { newId } from './crypto';
import type { Db } from './db';
import { HttpError, asRecord } from './http';
import type { ApprovedItem, PolicyDocument, Reason } from './policy';
import type { PolicyStore } from './store';
import type { RuleException } from './translator';

export type Duration = '1h' | 'today' | 'week' | 'always';

type RequestRow = { id: string; child_id: string; device_id: string | null; content: string; reasons: string; note: string | null; status: string; created_at: string; decided_at: string | null; duration: string | null; result_version: number | null };

function until(duration: Duration, timezone: string, now = new Date()): string | undefined {
  if (duration === 'always') return undefined;
  const hours = duration === '1h' ? 1 : duration === 'today' ? 24 : 24 * 7;
  const later = new Date(now.getTime() + hours * 3_600_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(later)
      .map((part) => [part.type, part.value]),
  );
  return duration === '1h' ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` : `${parts.year}-${parts.month}-${parts.day}T00:00`;
}

// "Ask a guardian". The request carries only the item and why it was stopped.
export class ChildRequests {
  constructor(
    private readonly db: Db,
    private readonly store: PolicyStore,
    private readonly accounts: Accounts,
    private readonly changes: Changes,
  ) {}

  create(childId: string, deviceId: string, body: Record<string, unknown>) {
    const raw = asRecord(body.content);
    if (typeof raw.content_id !== 'string' || !raw.content_id || raw.content_id.length > 200) throw new HttpError(400, 'content_id is required');
    const content = { content_id: raw.content_id, title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : undefined, platform: typeof raw.platform === 'string' ? raw.platform.slice(0, 100) : undefined };
    const reasons = (Array.isArray(body.reasons) ? body.reasons : []).filter((r): r is Reason => typeof r?.rule_id === 'string' && (r.kind === 'match' || r.kind === 'unknown')).slice(0, 50);
    const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null;

    const pending = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM child_requests WHERE child_id = ? AND status = 'pending'", childId)!.n;
    if (pending >= 50) throw new HttpError(429, 'there are too many requests waiting');

    const id = newId('req');
    this.db.run("INSERT INTO child_requests (id, child_id, device_id, content, reasons, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)", id, childId, deviceId, JSON.stringify(content), JSON.stringify(reasons), note, new Date().toISOString());
    this.db.audit(childId, `device:${deviceId}`, 'request.created', { request_id: id });
    return { request_id: id, status: 'pending' };
  }

  private view(row: RequestRow) {
    return { id: row.id, content: JSON.parse(row.content), reasons: JSON.parse(row.reasons), note: row.note, status: row.status, created_at: row.created_at, decided_at: row.decided_at, duration: row.duration, result_version: row.result_version };
  }

  listForDevice(deviceId: string) {
    return this.db.all<RequestRow>('SELECT * FROM child_requests WHERE device_id = ? ORDER BY created_at DESC LIMIT 20', deviceId).map((row) => this.view(row));
  }

  listForChild(childId: string) {
    return this.db.all<RequestRow>("SELECT * FROM child_requests WHERE child_id = ? ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 50", childId).map((row) => this.view(row));
  }

  // A real match on a family or age rule becomes an exception on that rule. A
  // missing label becomes an approved item. A real match on a fixed protection
  // cannot be approved at all.
  private planFor(policy: PolicyDocument, contentId: string, reasons: Reason[], end: string | undefined) {
    const exceptions: RuleException[] = [];
    const approve: ApprovedItem[] = [];

    for (const reason of reasons) {
      const rule = policy.rules.find((candidate) => candidate.id === reason.rule_id);
      if (!rule) continue;
      if (reason.kind === 'match') {
        if (rule.layer === 'fixed') throw new HttpError(403, 'This item is stopped by a built-in protection, which cannot be approved.');
        exceptions.push({ rule_id: rule.id, clause: { content_ids: [contentId], ...(end ? { until: end } : {}) } });
      }
    }

    if (reasons.some((reason) => reason.kind === 'unknown')) approve.push({ content_id: contentId, ...(end ? { until: end } : {}) });
    return { exceptions, approve };
  }

  deny(child: Child, guardian: Guardian, requestId: string) {
    const row = this.pending(child, requestId);
    this.db.run("UPDATE child_requests SET status = 'denied', decided_by = ?, decided_at = ? WHERE id = ?", guardian.id, new Date().toISOString(), row.id);
    this.db.audit(child.id, `guardian:${guardian.id}`, 'request.denied', { request_id: row.id });
    return { status: 'denied' };
  }

  approve(child: Child, guardian: Guardian, requestId: string, duration: Duration): ChangeView {
    const row = this.pending(child, requestId);
    const active = this.store.active(child.id);
    if (!active) throw new HttpError(409, 'no policy');

    const content = JSON.parse(row.content) as { content_id: string };
    const { exceptions, approve } = this.planFor(active.bundle.policy, content.content_id, JSON.parse(row.reasons) as Reason[], until(duration, child.timezone));
    if (exceptions.length === 0 && approve.length === 0) throw new HttpError(409, 'The rules that stopped this have already changed.');

    this.db.run('UPDATE child_requests SET duration = ? WHERE id = ?', duration, row.id);
    return this.changes.approval(child, guardian, row.id, exceptions, approve);
  }

  private pending(child: Child, requestId: string): RequestRow {
    const row = this.db.get<RequestRow>('SELECT * FROM child_requests WHERE id = ? AND child_id = ?', requestId, child.id);
    if (!row) throw new HttpError(404, 'no such request');
    if (row.status !== 'pending') throw new HttpError(409, `this request is already ${row.status}`);
    return row;
  }
}
