import type { ContentRecord, PublicJwk, Reason, SignedEnvelope } from '@/policy';

import type { GuardianLink } from './store';

export class NlppsHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function normaliseServer(server: string): string {
  let trimmed = server.trim().replace(/\/+$/, '');
  // A bare address typed by hand, such as 192.168.1.5:8787 on home Wi-Fi.
  if (!/^[a-z]+:\/\//i.test(trimmed)) trimmed = `http://${trimmed}`;
  if (!/^https?:\/\/[^\s/]+$/i.test(trimmed)) throw new Error('That server address does not look right. It should look like https://example.com or 192.168.1.5:8787.');
  return trimmed;
}

// The pairing QR holds childsafewallet://pair?server=…&code=…. A parent may
// paste that whole link instead of scanning it.
export function parsePairLink(text: string): { server: string; code: string } | null {
  const match = /^childsafewallet:\/\/pair\?(.*)$/i.exec(text.trim());
  if (!match) return null;
  const params: Record<string, string> = {};
  for (const part of match[1].split('&')) {
    const [key, value = ''] = part.split('=');
    try {
      params[key] = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      return null;
    }
  }
  return params.server && params.code ? { server: params.server, code: params.code } : null;
}

async function request(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10_000);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // not JSON
    }
    if (!res.ok) throw new NlppsHttpError(res.status, typeof body.error === 'string' ? body.error : `Server error ${res.status}`, body);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export type PairResult = { server: string; deviceId: string; deviceToken: string; childRef: string; childName: string; guardianKeys: PublicJwk[] };

export async function pairDevice(server: string, code: string, label: string): Promise<PairResult> {
  const base = normaliseServer(server);
  let body: Record<string, unknown>;
  try {
    body = await request(`${base}/api/device/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim(), label }),
    });
  } catch (error) {
    if (error instanceof NlppsHttpError) throw error;
    throw new Error(
      `Could not reach ${base}. Check that this phone is on the same Wi-Fi as the server, that the network lets devices talk to each other, and that Local Network is allowed for this app in Settings › Privacy & Security.`,
    );
  }

  return {
    server: base,
    deviceId: String(body.device_id),
    deviceToken: String(body.device_token),
    childRef: String(body.child_ref),
    childName: String(body.child_name),
    guardianKeys: body.guardian_keys as PublicJwk[],
  };
}

// A linked wallet may move to a new server address (say, a new tunnel), but
// only for the same child and guardians: otherwise a child could swap their
// guardian's rules for another family's.
export function isSameFamily(link: Pick<GuardianLink, 'childRef' | 'guardianKeys'>, paired: Pick<PairResult, 'childRef' | 'guardianKeys'>): boolean {
  const known = new Set(link.guardianKeys.map((key) => `${key.x}.${key.y}`));
  return paired.childRef === link.childRef && paired.guardianKeys.some((key) => known.has(`${key.x}.${key.y}`));
}

export type UnlinkStatement ={ schema: string; child_ref: string; device_id: string; issued_at: string };

export type PolicyResponse = { kind: 'policy'; signed: SignedEnvelope } | { kind: 'unlinked'; statement: UnlinkStatement; signature: string };

export async function fetchPolicy(link: GuardianLink, timeoutMs?: number): Promise<PolicyResponse> {
  try {
    const body = await request(`${link.server}/api/device/policy`, { headers: { Authorization: `Bearer ${link.deviceToken}` }, timeoutMs });
    return { kind: 'policy', signed: body as unknown as SignedEnvelope };
  } catch (error) {
    if (error instanceof NlppsHttpError && error.status === 410 && typeof error.body.signature === 'string') {
      return { kind: 'unlinked', statement: error.body.statement as UnlinkStatement, signature: error.body.signature };
    }
    throw error;
  }
}

export type ChildRequestStatus = {
  id: string;
  content: { content_id: string; title?: string };
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  decided_at: string | null;
  note: string | null;
};

// Only what a guardian needs to decide: which item, and why it was stopped.
export async function askGuardian(link: GuardianLink, input: { record: ContentRecord; reasons: Reason[]; note?: string }): Promise<{ requestId: string }> {
  const { content_id, title, platform } = input.record;
  const body = await request(`${link.server}/api/device/requests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${link.deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: { content_id, title, platform }, reasons: input.reasons, note: input.note }),
  });
  return { requestId: String(body.request_id) };
}

export async function listMyRequests(link: GuardianLink): Promise<ChildRequestStatus[]> {
  const body = await request(`${link.server}/api/device/requests`, { headers: { Authorization: `Bearer ${link.deviceToken}` } });
  return (body.requests as ChildRequestStatus[]) ?? [];
}
