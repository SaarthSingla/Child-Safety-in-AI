import type { Accounts } from './accounts';
import { humanCode, newId, normaliseCode, randomToken, sha256, signText, type SigningKey } from './crypto';
import type { Db } from './db';
import { HttpError } from './http';
import { canonicalize } from './policy';
import type { PolicyStore } from './store';

const PAIRING_MINUTES = 10;

type DeviceRow = { id: string; child_id: string; label: string | null; created_at: string; last_seen: string | null; revoked_at: string | null };

export class Devices {
  constructor(
    private readonly db: Db,
    private readonly store: PolicyStore,
    private readonly accounts: Accounts,
    private readonly key: SigningKey,
  ) {}

  createPairingCode(childId: string, guardianId: string) {
    if (!this.store.active(childId)) throw new HttpError(409, 'confirm the first policy before linking a phone');
    const code = humanCode();
    const expires = new Date(Date.now() + PAIRING_MINUTES * 60_000).toISOString();
    this.db.run('INSERT INTO pairing_codes (code_hash, child_id, created_by, expires_at) VALUES (?, ?, ?, ?)', sha256(code), childId, guardianId, expires);
    this.db.audit(childId, `guardian:${guardianId}`, 'device.pairing_code', {});
    return { code, expires_at: expires };
  }

  // The wallet learns the parent's public keys here, once. After this, a
  // policy needs a signature from one of these keys as well as the server's.
  pair(rawCode: string, label: string) {
    const codeHash = sha256(normaliseCode(rawCode));
    const pairing = this.db.get<{ child_id: string; expires_at: string; used_at: string | null }>('SELECT child_id, expires_at, used_at FROM pairing_codes WHERE code_hash = ?', codeHash);
    if (!pairing || pairing.used_at || pairing.expires_at < new Date().toISOString()) {
      throw new HttpError(400, 'This pairing code is invalid or has expired. Ask your guardian for a new one.');
    }

    const child = this.db.get<{ ref: string; name: string; guardian_id: string }>('SELECT ref, name, guardian_id FROM children WHERE id = ?', pairing.child_id)!;
    const deviceId = newId('dev');
    const token = randomToken();
    const now = new Date().toISOString();

    this.db.transaction(() => {
      this.db.run('UPDATE pairing_codes SET used_at = ? WHERE code_hash = ?', now, codeHash);
      this.db.run('INSERT INTO devices (id, child_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)', deviceId, pairing.child_id, sha256(token), label, now);
    });
    this.db.audit(pairing.child_id, `device:${deviceId}`, 'device.paired', { label });

    return { device_id: deviceId, device_token: token, child_ref: child.ref, child_name: child.name, guardian_keys: this.accounts.keysOf(child.guardian_id) };
  }

  authenticate(token: string | null): (DeviceRow & { child_ref: string }) | null {
    if (!token) return null;
    return this.db.get<DeviceRow & { child_ref: string }>('SELECT d.*, c.ref AS child_ref FROM devices d JOIN children c ON c.id = d.child_id WHERE d.token_hash = ?', sha256(token)) ?? null;
  }

  // An unlinked device gets a signed statement, so the wallet can tell a real
  // unlink from an outage.
  policyFor(device: DeviceRow & { child_ref: string }) {
    this.db.run('UPDATE devices SET last_seen = ? WHERE id = ?', new Date().toISOString(), device.id);

    if (device.revoked_at) {
      const statement = { schema: 'nlpps.unlink/1', child_ref: device.child_ref, device_id: device.id, issued_at: new Date().toISOString() };
      throw new HttpError(410, 'unlinked', { statement, signature: signText(this.key, canonicalize(statement)) });
    }

    const active = this.store.active(device.child_id);
    if (!active) throw new HttpError(404, 'no policy');
    return this.store.seal(active);
  }

  list(childId: string) {
    return this.db.all<DeviceRow>('SELECT id, child_id, label, created_at, last_seen, revoked_at FROM devices WHERE child_id = ? ORDER BY created_at DESC', childId);
  }

  unlink(childId: string, deviceId: string, guardianId: string) {
    const result = this.db.run('UPDATE devices SET revoked_at = ? WHERE id = ? AND child_id = ? AND revoked_at IS NULL', new Date().toISOString(), deviceId, childId);
    if (!result.changes) throw new HttpError(404, 'no such linked device');
    this.db.audit(childId, `guardian:${guardianId}`, 'device.unlinked', { device_id: deviceId });
  }
}
