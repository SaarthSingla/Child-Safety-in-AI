import { readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type Request = {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  body: unknown;
  ip: string;
  raw: IncomingMessage;
};

export type Handler = (req: Request) => Promise<unknown> | unknown;

type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler; limit: string };

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler, limit = 'default'): void {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/:([a-zA-Z_]+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      })}$`,
    );
    this.routes.push({ method, pattern, keys, handler, limit });
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(path);
      if (m) {
        const params: Record<string, string> = {};
        route.keys.forEach((key, i) => (params[key] = decodeURIComponent(m[i + 1])));
        return { route, params };
      }
    }
    return null;
  }
}

// Token-bucket rate limiting per client IP and route group.
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private readonly limits: Record<string, number>) {}

  allow(group: string, ip: string): boolean {
    const perMinute = this.limits[group] ?? this.limits.default;
    const key = `${group}:${ip}`;
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: perMinute, at: now };
    bucket.tokens = Math.min(perMinute, bucket.tokens + ((now - bucket.at) / 60_000) * perMinute);
    bucket.at = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    if (this.buckets.size > 10_000) this.buckets.clear();
    return true;
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

const MAX_BODY = 64 * 1024;

export async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') return undefined;
  const type = req.headers['content-type'] ?? '';
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }

  if (size === 0) return {};
  if (!type.includes('application/json')) throw new HttpError(415, 'expected application/json');

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

export function serveStatic(res: ServerResponse, dir: string, path: string): boolean {
  const relative = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
  const file = normalize(join(dir, relative));
  if (!file.startsWith(normalize(dir) + sep)) return false;

  try {
    if (!statSync(file).isFile()) return false;
  } catch {
    return false;
  }

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  res.end(readFileSync(file));
  return true;
}

export function clientIp(req: IncomingMessage): string {
  // cloudflared / reverse proxies set these; fall back to the socket.
  const forwarded = req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return first?.trim() || req.socket.remoteAddress || 'unknown';
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length >= 20 && token.length <= 200 ? token : null;
}

export function publicBaseUrl(req: Request, configured: string | null): string {
  if (configured) return configured;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? 'localhost';
  return `${proto}://${host}`;
}

// Narrow helpers for validating JSON bodies at the boundary.
export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'expected a JSON object');
  return value as Record<string, unknown>;
}

export function str(body: Record<string, unknown>, key: string, opts: { min?: number; max?: number; optional?: boolean } = {}): string {
  const value = body[key];
  if (value === undefined && opts.optional) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${key} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < (opts.min ?? 1) || trimmed.length > (opts.max ?? 200)) {
    throw new HttpError(400, `${key} must be ${opts.min ?? 1}-${opts.max ?? 200} characters`);
  }
  return trimmed;
}
