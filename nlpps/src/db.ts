import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS guardians (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  guardian_id TEXT NOT NULL REFERENCES guardians(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guardian_keys (
  kid TEXT PRIMARY KEY,
  guardian_id TEXT NOT NULL REFERENCES guardians(id),
  jwk TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  age_band TEXT NOT NULL,
  guardian_id TEXT NOT NULL REFERENCES guardians(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_versions (
  child_id TEXT NOT NULL REFERENCES children(id),
  version INTEGER NOT NULL,
  bundle TEXT NOT NULL,
  bundle_hash TEXT NOT NULL,
  previous_hash TEXT,
  guardian_kid TEXT NOT NULL,
  guardian_signature TEXT NOT NULL,
  change_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (child_id, version)
);

CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  guardian_id TEXT NOT NULL REFERENCES guardians(id),
  kind TEXT NOT NULL,
  text TEXT,
  state TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TEXT NOT NULL,
  last_seen TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code_hash TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS child_requests (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  device_id TEXT,
  content TEXT NOT NULL,
  reasons TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  duration TEXT,
  change_id TEXT,
  result_version INTEGER
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id TEXT,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_changes_child ON changes(child_id, created_at);
CREATE INDEX IF NOT EXISTS idx_requests_child ON child_requests(child_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_child ON audit(child_id, id);
`;

export type Row = Record<string, SQLInputValue>;

export class Db {
  readonly sql: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec(SCHEMA);
  }

  get<T>(query: string, ...params: SQLInputValue[]): T | undefined {
    return this.sql.prepare(query).get(...params) as T | undefined;
  }

  all<T>(query: string, ...params: SQLInputValue[]): T[] {
    return this.sql.prepare(query).all(...params) as T[];
  }

  run(query: string, ...params: SQLInputValue[]): { changes: number | bigint } {
    return this.sql.prepare(query).run(...params);
  }

  // BEGIN IMMEDIATE takes the write lock up front, so a read-check-write
  // sequence (e.g. "is the active revision still N?") cannot interleave
  // with another writer.
  transaction<T>(fn: () => T): T {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.sql.exec('COMMIT');
      return result;
    } catch (error) {
      this.sql.exec('ROLLBACK');
      throw error;
    }
  }

  audit(childId: string | null, actor: string, kind: string, detail: unknown): void {
    this.run(
      'INSERT INTO audit (child_id, actor, kind, detail, at) VALUES (?, ?, ?, ?, ?)',
      childId,
      actor,
      kind,
      JSON.stringify(detail),
      new Date().toISOString(),
    );
  }

  close(): void {
    this.sql.close();
  }
}
