import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

/**
 * The Firebase service-account key for push (FCM), read from
 * FIREBASE_SERVICE_ACCOUNT_JSON. Accepted as the raw JSON
 * (`{"type":"service_account",...}`) or as base64 of that JSON.
 *
 * Missing or unreadable, push is disabled: this logs once per process and
 * every send is a no-op. The key's contents are never logged.
 */
export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  const text = raw?.trim();
  if (!text) return null;
  const json = text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is neither JSON nor base64-encoded JSON');
  }
  const sa = parsed as Partial<ServiceAccount> | null;
  if (!sa || typeof sa.project_id !== 'string' || typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string') {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id, client_email or private_key');
  }
  return { project_id: sa.project_id, client_email: sa.client_email, private_key: sa.private_key };
}

let loaded = false;
let cached: ServiceAccount | null = null;

/** The configured key, or null when push is disabled. Logs the outcome once. */
export function pushServiceAccount(): ServiceAccount | null {
  if (loaded) return cached;
  loaded = true;
  try {
    cached = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (cached) {
      logger.info({ firebaseProject: cached.project_id }, 'Push notifications enabled (Firebase Cloud Messaging)');
    } else {
      logger.warn('Push notifications disabled: FIREBASE_SERVICE_ACCOUNT_JSON is not set. Every push is a no-op.');
    }
  } catch (err) {
    cached = null;
    logger.error(
      { reason: err instanceof Error ? err.message : String(err) },
      'Push notifications disabled: FIREBASE_SERVICE_ACCOUNT_JSON could not be read. Every push is a no-op.'
    );
  }
  return cached;
}
