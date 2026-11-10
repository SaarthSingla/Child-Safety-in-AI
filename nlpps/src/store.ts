import { randomBytes } from 'node:crypto';

import type { SigningKey } from './crypto';
import { signText } from './crypto';
import type { Db } from './db';
import { signingInput, type PolicyBundle, type PolicyEnvelope, type SignedEnvelope } from './policy';

export type StoredVersion = {
  version: number;
  bundle: PolicyBundle;
  bundle_hash: string;
  previous_hash: string | null;
  guardian_kid: string;
  guardian_signature: string;
  change_id: string;
  created_at: string;
};

type Row = Omit<StoredVersion, 'bundle'> & { bundle: string };

export class VersionConflict extends Error {}

// Every version is kept and each records the hash of the one before, so the
// history cannot be rewritten quietly.
export class PolicyStore {
  constructor(
    private readonly db: Db,
    private readonly key: SigningKey,
    private readonly policyDays: number,
  ) {}

  active(childId: string): StoredVersion | null {
    const row = this.db.get<Row>('SELECT * FROM policy_versions WHERE child_id = ? ORDER BY version DESC LIMIT 1', childId);
    return row ? { ...row, bundle: JSON.parse(row.bundle) as PolicyBundle } : null;
  }

  version(childId: string, version: number): StoredVersion | null {
    const row = this.db.get<Row>('SELECT * FROM policy_versions WHERE child_id = ? AND version = ?', childId, version);
    return row ? { ...row, bundle: JSON.parse(row.bundle) as PolicyBundle } : null;
  }

  history(childId: string) {
    return this.db.all<Omit<Row, 'bundle'>>('SELECT version, bundle_hash, previous_hash, guardian_kid, change_id, created_at FROM policy_versions WHERE child_id = ? ORDER BY version DESC', childId);
  }

  publish(childId: string, entry: Omit<StoredVersion, 'version' | 'created_at'>, version: number): void {
    this.db.transaction(() => {
      if ((this.active(childId)?.version ?? 0) !== version - 1) throw new VersionConflict();
      this.db.run(
        'INSERT INTO policy_versions (child_id, version, bundle, bundle_hash, previous_hash, guardian_kid, guardian_signature, change_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        childId,
        version,
        JSON.stringify(entry.bundle),
        entry.bundle_hash,
        entry.previous_hash,
        entry.guardian_kid,
        entry.guardian_signature,
        entry.change_id,
        new Date().toISOString(),
      );
    });
  }

  // Fresh dates each time, around the same parent-approved bundle.
  seal(stored: StoredVersion, now = new Date()): SignedEnvelope {
    const envelope: PolicyEnvelope = {
      schema: 'nlpps.envelope/1',
      bundle: stored.bundle,
      bundle_hash: stored.bundle_hash,
      guardian: { kid: stored.guardian_kid, signature: stored.guardian_signature },
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + this.policyDays * 86_400_000).toISOString(),
    };
    return { envelope, signature: signText(this.key, signingInput(envelope)), kid: this.key.kid };
  }
}

export function ruleId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}
