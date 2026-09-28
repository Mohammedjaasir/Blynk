import type { Request, Response } from 'express';
import pg from 'pg';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Live catalog updates (2026-09-26).
 *
 * A change in Blynk Ops used to reach a customer only on the app's next
 * periodic refresh. Migration 011 makes Postgres NOTIFY `catalog_changed`
 * on every write to products, categories and promotions; this module LISTENs
 * on one dedicated connection and pushes a tiny Server-Sent Event to every
 * open customer app (`GET /catalog/events`), which re-reads the catalog.
 *
 * - The event carries only which tables changed, never data: the app still
 *   reads the catalog through the normal endpoints.
 * - Bursts are coalesced: an operator saving a form (several statements)
 *   sends one event.
 * - LISTEN needs a direct session connection. Behind a transaction-mode
 *   pooler set CATALOG_EVENTS_DATABASE_URL to a direct connection. If the
 *   listener cannot connect, streams still open and customers fall back to
 *   the app's periodic refresh - nothing breaks.
 */

const CHANNEL = 'catalog_changed';
const HEARTBEAT_MS = 25_000;
const COALESCE_MS = 250;

const subscribers = new Set<Response>();
let client: pg.Client | null = null;
let stopped = true;
let retryMs = 1_000;
let pending = new Set<string>();
let flushTimer: NodeJS.Timeout | null = null;

function broadcast(tables: string[]) {
  const frame = `event: catalog\ndata: ${JSON.stringify({ tables, at: new Date().toISOString() })}\n\n`;
  for (const res of subscribers) {
    try {
      res.write(frame);
    } catch (err) {
      logger.warn({ err }, 'Catalog event write failed; dropping subscriber');
      subscribers.delete(res);
    }
  }
}

/** Queue a change and flush once the burst has settled. Exported for tests. */
export function notifyCatalogChanged(table: string) {
  pending.add(table);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const tables = [...pending];
    pending = new Set();
    broadcast(tables);
  }, COALESCE_MS);
}

async function connect() {
  if (stopped) return;
  const c = new pg.Client({
    connectionString: process.env.CATALOG_EVENTS_DATABASE_URL || env.DATABASE_URL,
  });
  c.on('notification', (msg) => {
    if (msg.channel === CHANNEL) notifyCatalogChanged(msg.payload ?? 'unknown');
  });
  c.on('error', (err) => {
    logger.warn({ err }, 'Catalog change listener lost its connection; reconnecting');
    scheduleReconnect(c);
  });
  c.on('end', () => scheduleReconnect(c));
  try {
    await c.connect();
    await c.query(`LISTEN ${CHANNEL}`);
    client = c;
    retryMs = 1_000;
    logger.info('Listening for catalog changes (live customer updates enabled)');
  } catch (err) {
    logger.warn({ err }, 'Catalog change listener could not start; customers fall back to periodic refresh');
    scheduleReconnect(c);
  }
}

let reconnecting = false;

function scheduleReconnect(c: pg.Client) {
  if (stopped || reconnecting) return;
  reconnecting = true;
  if (client === c) client = null;
  c.removeAllListeners();
  c.end().catch(() => undefined);
  const wait = retryMs;
  retryMs = Math.min(retryMs * 2, 30_000);
  setTimeout(() => {
    reconnecting = false;
    void connect();
  }, wait).unref();
}

export function startCatalogEvents() {
  if (!stopped) return;
  stopped = false;
  void connect();
}

export async function stopCatalogEvents() {
  stopped = true;
  for (const res of subscribers) {
    try {
      res.end();
    } catch {
      /* already gone */
    }
  }
  subscribers.clear();
  const c = client;
  client = null;
  if (c) {
    c.removeAllListeners();
    await c.end().catch(() => undefined);
  }
}

/** GET /catalog/events - public, like the catalog itself. */
export function streamCatalogEvents(req: Request, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // How soon an EventSource-style client should come back if the line drops.
  res.write('retry: 3000\n: connected\n\n');
  subscribers.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      /* cleaned up on close */
    }
  }, HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    subscribers.delete(res);
  });
}

/** For tests and metrics. */
export function catalogSubscriberCount() {
  return subscribers.size;
}
