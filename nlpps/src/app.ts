import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import { Accounts, type Guardian } from './accounts';
import { Changes } from './changes';
import type { Config } from './config';
import { loadOrCreateSigningKey, type SigningKey } from './crypto';
import { Db } from './db';
import { Devices } from './devices';
import { HttpError, RateLimiter, Router, asRecord, bearerToken, clientIp, publicBaseUrl, readJson, sendJson, serveStatic, str, type Request } from './http';
import { describeRule, type PublicJwk } from './policy';
import { ChildRequests, type Duration } from './requests';
import { PolicyStore } from './store';
import { createTranslator, type Translator } from './translator';

export type App = { server: Server; db: Db; key: SigningKey; translator: Translator };

export function createApp(config: Config, overrides: { translator?: Translator; db?: Db; key?: SigningKey; limits?: Record<string, number> } = {}): App {
  const db = overrides.db ?? new Db(config.dbPath);
  const key = overrides.key ?? loadOrCreateSigningKey(config.keyPath);
  const translator = overrides.translator ?? createTranslator(config.llm);

  const store = new PolicyStore(db, key, config.policyDays);
  const accounts = new Accounts(db);
  const changes = new Changes(db, store, accounts, translator);
  const devices = new Devices(db, store, accounts, key);
  const requests = new ChildRequests(db, store, accounts, changes);
  const limiter = new RateLimiter(overrides.limits ?? { default: 300, auth: 20, pair: 20, device: 240, translate: 30 });
  const router = new Router();

  const guardianOf = (req: Request): Guardian => {
    const guardian = accounts.guardianForToken(bearerToken(req));
    if (!guardian) throw new HttpError(401, 'sign in first');
    return guardian;
  };

  const deviceOf = (req: Request) => {
    const device = devices.authenticate(bearerToken(req));
    if (!device) throw new HttpError(401, 'unknown device');
    return device;
  };

  router.add('GET', '/api/health', () => ({ status: 'ok', translator: translator.name }));
  router.add('GET', '/.well-known/nlpps', () => ({ kid: key.kid, jwk: key.publicJwk }));

  router.add('POST', '/api/auth/register', async (req) => {
    const body = asRecord(req.body);
    return accounts.register(str(body, 'email', { max: 200 }), str(body, 'password', { min: 10, max: 200 }), str(body, 'name', { max: 80 }));
  }, 'auth');

  router.add('POST', '/api/auth/login', async (req) => {
    const body = asRecord(req.body);
    return accounts.login(str(body, 'email', { max: 200 }), str(body, 'password', { max: 200 }));
  }, 'auth');

  router.add('POST', '/api/auth/logout', (req) => {
    const token = bearerToken(req);
    if (token) accounts.logout(token);
    return { ok: true };
  });

  router.add('GET', '/api/me', (req) => {
    const guardian = guardianOf(req);
    return { guardian, children: accounts.children(guardian) };
  });

  router.add('POST', '/api/me/keys', (req) => accounts.registerKey(guardianOf(req), asRecord(req.body).jwk as PublicJwk));

  router.add('POST', '/api/children', (req) => {
    const guardian = guardianOf(req);
    const body = asRecord(req.body);
    const child = accounts.createChild(guardian, str(body, 'name', { max: 60 }), str(body, 'timezone', { max: 60 }), str(body, 'age_band', { max: 10 }));
    return { child, change: changes.initial(child, guardian) };
  });

  router.add('GET', '/api/children/:cid', (req) => {
    const guardian = guardianOf(req);
    const child = accounts.childOf(guardian, req.params.cid);
    const active = store.active(child.id);
    const policy = active?.bundle.policy;
    return {
      child,
      policy: policy && {
        version: policy.version,
        bundle_hash: active!.bundle_hash,
        rules: policy.rules.map((rule) => ({ id: rule.id, instruction_id: rule.instruction_id, layer: rule.layer, text: describeRule(rule, policy), said: rule.source_text })),
        approved_items: policy.approved_items,
      },
      devices: devices.list(child.id),
      pending_requests: requests.listForChild(child.id).filter((r) => r.status === 'pending').length,
      recent_changes: changes.list(child.id),
    };
  });

  router.add('GET', '/api/children/:cid/versions', (req) => {
    const child = accounts.childOf(guardianOf(req), req.params.cid);
    return { versions: store.history(child.id) };
  });

  router.add('GET', '/api/children/:cid/audit', (req) => {
    const child = accounts.childOf(guardianOf(req), req.params.cid);
    return { events: db.all<{ actor: string; kind: string; detail: string; at: string }>('SELECT actor, kind, detail, at FROM audit WHERE child_id = ? ORDER BY id DESC LIMIT 100', child.id).map((event) => ({ ...event, detail: JSON.parse(event.detail) })) };
  });

  router.add('POST', '/api/children/:cid/changes', async (req) => {
    const guardian = guardianOf(req);
    return changes.fromText(accounts.childOf(guardian, req.params.cid), guardian, str(asRecord(req.body), 'text', { max: 1000 }));
  }, 'translate');

  router.add('POST', '/api/children/:cid/remove', (req) => {
    const guardian = guardianOf(req);
    return changes.removeInstruction(accounts.childOf(guardian, req.params.cid), guardian, str(asRecord(req.body), 'instruction_id', { max: 60 }));
  });

  router.add('POST', '/api/children/:cid/rollback', (req) => {
    const guardian = guardianOf(req);
    return changes.rollback(accounts.childOf(guardian, req.params.cid), guardian, Number(asRecord(req.body).version));
  });

  router.add('GET', '/api/changes/:id', (req) => changes.view(req.params.id, guardianOf(req)));
  router.add('POST', '/api/changes/:id/clarify', async (req) => changes.clarify(req.params.id, guardianOf(req), str(asRecord(req.body), 'answer', { max: 1000 })), 'translate');
  router.add('POST', '/api/changes/:id/cancel', (req) => changes.cancel(req.params.id, guardianOf(req)));
  router.add('POST', '/api/changes/:id/confirm', (req) => {
    const body = asRecord(req.body);
    return changes.confirm(req.params.id, guardianOf(req), str(body, 'kid', { max: 100 }), str(body, 'signature', { max: 200 }));
  });

  router.add('POST', '/api/children/:cid/pairing-codes', (req) => {
    const guardian = guardianOf(req);
    const child = accounts.childOf(guardian, req.params.cid);
    const { code, expires_at } = devices.createPairingCode(child.id, guardian.id);
    const server = publicBaseUrl(req, config.publicUrl);
    return { code, expires_at, server, pair_url: `childsafewallet://pair?server=${encodeURIComponent(server)}&code=${encodeURIComponent(code)}` };
  }, 'pair');

  router.add('DELETE', '/api/children/:cid/devices/:did', (req) => {
    const guardian = guardianOf(req);
    const child = accounts.childOf(guardian, req.params.cid);
    devices.unlink(child.id, req.params.did, guardian.id);
    return { ok: true };
  });

  router.add('GET', '/api/children/:cid/requests', (req) => {
    const child = accounts.childOf(guardianOf(req), req.params.cid);
    return { requests: requests.listForChild(child.id) };
  });

  router.add('POST', '/api/children/:cid/requests/:rid/decide', (req) => {
    const guardian = guardianOf(req);
    const child = accounts.childOf(guardian, req.params.cid);
    const body = asRecord(req.body);
    if (body.approve !== true) return requests.deny(child, guardian, req.params.rid);
    const duration = (typeof body.duration === 'string' ? body.duration : '1h') as Duration;
    if (!['1h', 'today', 'week', 'always'].includes(duration)) throw new HttpError(400, 'duration must be 1h, today, week or always');
    return requests.approve(child, guardian, req.params.rid, duration);
  });

  router.add('POST', '/api/device/pair', (req) => {
    const body = asRecord(req.body);
    return devices.pair(str(body, 'code', { max: 20 }), str(body, 'label', { optional: true, max: 60 }) || 'Wallet');
  }, 'pair');

  router.add('GET', '/api/device/policy', (req) => devices.policyFor(deviceOf(req)), 'device');

  router.add('POST', '/api/device/requests', (req) => {
    const device = deviceOf(req);
    if (device.revoked_at) throw new HttpError(410, 'unlinked');
    return requests.create(device.child_id, device.id, asRecord(req.body));
  }, 'device');

  router.add('GET', '/api/device/requests', (req) => ({ requests: requests.listForDevice(deviceOf(req).id) }), 'device');

  const handle = async (raw: IncomingMessage, res: ServerResponse) => {
    const url = new URL(raw.url ?? '/', 'http://localhost');
    const method = raw.method ?? 'GET';

    try {
      const matched = router.match(method, url.pathname);

      if (!matched) {
        if (method === 'GET' && !url.pathname.startsWith('/api/')) {
          if (url.pathname === '/vendor/qrcode.js') {
            res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
            res.end(readFileSync(join(config.publicDir, '..', 'node_modules', 'qrcode-generator', 'qrcode.js')));
            return;
          }
          if (serveStatic(res, config.publicDir, url.pathname)) return;
          if (serveStatic(res, config.publicDir, '/')) return;
        }
        throw new HttpError(404, 'not found');
      }

      const ip = clientIp(raw);
      if (!limiter.allow(matched.route.limit, ip)) throw new HttpError(429, 'too many requests, slow down');

      const req: Request = { method, path: url.pathname, query: url.searchParams, params: matched.params, headers: raw.headers, body: await readJson(raw), ip, raw };
      const result = await matched.route.handler(req);
      sendJson(res, 200, result ?? { ok: true });
    } catch (error) {
      if (error instanceof HttpError) sendJson(res, error.status, { error: error.message, ...(error.body ?? {}) });
      else {
        console.error('[nlpps] unexpected error', error);
        sendJson(res, 500, { error: 'internal error' });
      }
    }
  };

  const server = createServer((req, res) => void handle(req, res));
  return { server, db, key, translator };
}
