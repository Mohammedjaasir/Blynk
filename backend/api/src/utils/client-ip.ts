import { isIP } from 'node:net';
import type { Request } from 'express';
import { env } from '../config/env.js';

/**
 * Express `trust proxy` from TRUST_PROXY (security audit 2026-10). The
 * default trusts only loopback, link-local and private (RFC 1918 / ULA)
 * hops - the reverse proxy in front of the API (Coolify/Traefik, nginx) -
 * so req.ip is the first address added by a hop outside those ranges.
 * "true"/"false" and a hop count ("1") are accepted too.
 */
export function trustProxySetting(raw: string = env.TRUST_PROXY): boolean | number | string {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false' || value === '') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * The caller's address for rate limits and audit/session records: req.ip,
 * which Express derives from X-Forwarded-For only through trusted hops.
 * The raw X-Forwarded-For header is never used - any client can write it.
 *
 * CF-Connecting-IP is preferred only when TRUST_CLOUDFLARE_HEADER=true. Turn
 * that on ONLY when the origin is reachable solely through Cloudflare
 * (firewalled to Cloudflare's ranges or a Cloudflare Tunnel); otherwise
 * anyone reaching the origin directly could set the header.
 */
export function clientIp(req: Request): string | null {
  if (env.TRUST_CLOUDFLARE_HEADER) {
    const cf = req.get('cf-connecting-ip')?.trim();
    if (cf && isIP(cf)) return cf;
  }
  return req.ip || req.socket?.remoteAddress || null;
}
