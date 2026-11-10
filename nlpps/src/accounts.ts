import { HttpError } from './http';
import { hashPassword, newId, randomToken, sha256, verifyPassword } from './crypto';
import type { Db } from './db';
import { AGE_BANDS, keyId, type AgeBand, type PublicJwk } from './policy';

const SESSION_DAYS = 30;

export type Guardian = { id: string; email: string; name: string };

export type Child = { id: string; ref: string; name: string; timezone: string; age_band: AgeBand; guardian_id: string };

export class Accounts {
  constructor(private readonly db: Db) {}

  async register(email: string, password: string, name: string): Promise<{ token: string; guardian: Guardian }> {
    const normalised = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) throw new HttpError(400, 'enter a valid email address');
    if (password.length < 10) throw new HttpError(400, 'use a password of at least 10 characters');
    if (this.db.get('SELECT id FROM guardians WHERE email = ?', normalised)) throw new HttpError(409, 'an account with that email already exists');

    const guardian: Guardian = { id: newId('g'), email: normalised, name: name.trim() };
    this.db.run('INSERT INTO guardians (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', guardian.id, guardian.email, guardian.name, await hashPassword(password), new Date().toISOString());
    this.db.audit(null, `guardian:${guardian.id}`, 'guardian.registered', {});
    return { token: this.createSession(guardian.id), guardian };
  }

  async login(email: string, password: string): Promise<{ token: string; guardian: Guardian }> {
    const row = this.db.get<Guardian & { password_hash: string }>('SELECT id, email, name, password_hash FROM guardians WHERE email = ?', email.trim().toLowerCase());
    // Same work and same error whether or not the account exists.
    const ok = row ? await verifyPassword(password, row.password_hash) : (await hashPassword(password), false);
    if (!row || !ok) throw new HttpError(401, 'wrong email or password');
    return { token: this.createSession(row.id), guardian: { id: row.id, email: row.email, name: row.name } };
  }

  logout(token: string): void {
    this.db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  }

  guardianForToken(token: string | null): Guardian | null {
    if (!token) return null;
    const row = this.db.get<Guardian & { expires_at: string }>('SELECT g.id, g.email, g.name, s.expires_at FROM sessions s JOIN guardians g ON g.id = s.guardian_id WHERE s.token_hash = ?', sha256(token));
    if (!row || row.expires_at < new Date().toISOString()) return null;
    return { id: row.id, email: row.email, name: row.name };
  }

  private createSession(guardianId: string): string {
    const token = randomToken();
    const now = new Date();
    this.db.run('INSERT INTO sessions (token_hash, guardian_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha256(token), guardianId, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString());
    return token;
  }

  // The parent's phone keeps the private half and only ever sends this public
  // half. The wallet learns these keys once, when it pairs.
  registerKey(guardian: Guardian, jwk: PublicJwk): { kid: string } {
    if (jwk?.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') throw new HttpError(400, 'expected a P-256 public key');
    const clean = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
    const kid = keyId(clean);
    const existing = this.db.get<{ guardian_id: string }>('SELECT guardian_id FROM guardian_keys WHERE kid = ?', kid);
    if (existing && existing.guardian_id !== guardian.id) throw new HttpError(409, 'this key belongs to another account');
    if (!existing) {
      this.db.run('INSERT INTO guardian_keys (kid, guardian_id, jwk, created_at) VALUES (?, ?, ?, ?)', kid, guardian.id, JSON.stringify(clean), new Date().toISOString());
      this.db.audit(null, `guardian:${guardian.id}`, 'guardian.key_added', { kid });
    }
    return { kid };
  }

  keyOf(guardianId: string, kid: string): PublicJwk | null {
    const row = this.db.get<{ jwk: string }>('SELECT jwk FROM guardian_keys WHERE kid = ? AND guardian_id = ?', kid, guardianId);
    return row ? (JSON.parse(row.jwk) as PublicJwk) : null;
  }

  keysOf(guardianId: string): PublicJwk[] {
    return this.db.all<{ jwk: string }>('SELECT jwk FROM guardian_keys WHERE guardian_id = ?', guardianId).map((row) => JSON.parse(row.jwk) as PublicJwk);
  }

  createChild(guardian: Guardian, name: string, timezone: string, ageBand: string): Child {
    if (!AGE_BANDS.includes(ageBand as AgeBand)) throw new HttpError(400, 'choose an age group');
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw new HttpError(400, 'unknown time zone');
    }
    const child: Child = { id: newId('c'), ref: newId('child'), name: name.trim(), timezone, age_band: ageBand as AgeBand, guardian_id: guardian.id };
    this.db.run('INSERT INTO children (id, ref, name, timezone, age_band, guardian_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', child.id, child.ref, child.name, child.timezone, child.age_band, child.guardian_id, new Date().toISOString());
    this.db.audit(child.id, `guardian:${guardian.id}`, 'child.created', {});
    return child;
  }

  children(guardian: Guardian): Child[] {
    return this.db.all<Child>('SELECT id, ref, name, timezone, age_band, guardian_id FROM children WHERE guardian_id = ? ORDER BY created_at', guardian.id);
  }

  childOf(guardian: Guardian, childId: string): Child {
    const child = this.db.get<Child>('SELECT id, ref, name, timezone, age_band, guardian_id FROM children WHERE id = ? AND guardian_id = ?', childId, guardian.id);
    if (!child) throw new HttpError(404, 'no such child');
    return child;
  }
}
