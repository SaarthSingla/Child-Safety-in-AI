import { NLPPS_SERVER_KEY, SYNC_EVERY_MS, SYNC_TIMEOUT_MS } from '@/config/nlppsConfig';
import { canonicalize, verifyEnvelope, verifySignature } from '@/policy';

import { fetchPolicy } from './client';
import { clearGuardianLink, getLink, getPolicyMeta, savePolicy, savePolicyMeta } from './store';

export type SyncResult =
  | { status: 'not_linked' }
  | { status: 'updated'; version: number }
  | { status: 'unchanged'; version: number }
  | { status: 'unlinked' }
  | { status: 'rejected'; reason: string }
  | { status: 'offline'; reason: string };

let inFlight: Promise<SyncResult> | null = null;

// Downloads the latest policy. On any failure the wallet keeps the one it has.
export function syncPolicy(timeoutMs = SYNC_TIMEOUT_MS): Promise<SyncResult> {
  inFlight ??= doSync(timeoutMs).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

// Checks in the background now and then. A sync before every decision would
// tell the server exactly when the child is using other apps.
export async function syncIfDue(): Promise<void> {
  const meta = await getPolicyMeta();
  if (!meta || Date.now() - (meta.lastAttemptAt ?? 0) > SYNC_EVERY_MS) syncPolicy().catch(() => undefined);
}

async function doSync(timeoutMs: number): Promise<SyncResult> {
  const link = await getLink();
  if (!link) return { status: 'not_linked' };

  const meta = await getPolicyMeta();
  const failed = async (reason: string) => {
    if (meta) await savePolicyMeta({ ...meta, lastAttemptAt: Date.now(), lastError: reason });
  };

  let response;
  try {
    response = await fetchPolicy(link, timeoutMs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'network error';
    await failed(reason);
    return { status: 'offline', reason };
  }

  if (response.kind === 'unlinked') {
    const { statement, signature } = response;
    const genuine = statement?.device_id === link.deviceId && statement?.child_ref === link.childRef && verifySignature(signature, canonicalize(statement), NLPPS_SERVER_KEY);
    if (genuine) {
      await clearGuardianLink();
      return { status: 'unlinked' };
    }
    await failed('unverifiable unlink statement ignored');
    return { status: 'rejected', reason: 'unverifiable unlink statement' };
  }

  const check = verifyEnvelope(response.signed, { server: NLPPS_SERVER_KEY, guardians: link.guardianKeys, childRef: link.childRef }, meta ? { version: meta.version, bundleHash: meta.bundleHash } : null);
  if (!check.ok) {
    await failed(`refused a policy: ${check.reason}`);
    return { status: 'rejected', reason: check.reason };
  }

  const { envelope } = check;
  const same = meta?.bundleHash === envelope.bundle_hash;

  // Never go backwards in time, even with the same policy.
  if (!same || !meta || Date.parse(envelope.issued_at) > Date.parse(meta.lastSignedTime)) await savePolicy(response.signed);

  return same ? { status: 'unchanged', version: envelope.bundle.policy.version } : { status: 'updated', version: envelope.bundle.policy.version };
}
