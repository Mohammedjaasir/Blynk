import { logger } from '../../../utils/logger.js';
import { pushServiceAccount, type ServiceAccount } from './push.config.js';

/** Android notification channel the customer app creates for these pushes. */
export const ORDERS_CHANNEL_ID = 'orders';

export interface PushMessage {
  title: string;
  body: string;
  /** FCM data values are strings. */
  data: Record<string, string>;
}

/**
 * Per token: delivered, or why not. UNREGISTERED / INVALID mean the token
 * is dead and is deleted; TRANSIENT is worth retrying; OTHER is not.
 */
export type PushTokenOutcome =
  | { token: string; ok: true; messageId?: string }
  | { token: string; ok: false; error: 'UNREGISTERED' | 'INVALID' | 'TRANSIENT' | 'OTHER'; detail?: string };

/** The seam between the outbox and Google. Tests inject a fake. */
export interface PushSender {
  send(tokens: string[], message: PushMessage): Promise<PushTokenOutcome[]>;
}

const UNREGISTERED = new Set(['messaging/registration-token-not-registered']);
const INVALID = new Set(['messaging/invalid-registration-token']);
const TRANSIENT = new Set([
  'messaging/internal-error',
  'messaging/server-unavailable',
  'messaging/unavailable',
  'messaging/quota-exceeded',
  'messaging/message-rate-exceeded',
  'messaging/device-message-rate-exceeded',
]);

export function classifyFcmError(code: string | undefined, message = ''): 'UNREGISTERED' | 'INVALID' | 'TRANSIENT' | 'OTHER' {
  if (!code) return 'OTHER';
  if (UNREGISTERED.has(code)) return 'UNREGISTERED';
  if (INVALID.has(code)) return 'INVALID';
  // FCM v1 answers a malformed token with INVALID_ARGUMENT naming the token.
  if (code === 'messaging/invalid-argument' && /registration token/i.test(message)) return 'INVALID';
  if (TRANSIENT.has(code)) return 'TRANSIENT';
  return 'OTHER';
}

/** firebase-admin (messaging only), loaded on the first send. */
class FirebasePushSender implements PushSender {
  private messaging: Promise<import('firebase-admin/messaging').Messaging> | null = null;

  constructor(private account: ServiceAccount) {}

  private client() {
    this.messaging ??= (async () => {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app');
      const { getMessaging } = await import('firebase-admin/messaging');
      const name = 'blynk-push';
      const app =
        getApps().find((a) => a.name === name) ??
        initializeApp(
          {
            credential: cert({
              projectId: this.account.project_id,
              clientEmail: this.account.client_email,
              privateKey: this.account.private_key,
            }),
            projectId: this.account.project_id,
          },
          name
        );
      return getMessaging(app);
    })();
    return this.messaging;
  }

  async send(tokens: string[], message: PushMessage): Promise<PushTokenOutcome[]> {
    const messaging = await this.client();
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: { priority: 'high', notification: { channelId: ORDERS_CHANNEL_ID } },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    return res.responses.map((r, i): PushTokenOutcome => {
      const token = tokens[i]!;
      if (r.success) return { token, ok: true, messageId: r.messageId };
      return { token, ok: false, error: classifyFcmError(r.error?.code, r.error?.message), detail: r.error?.code };
    });
  }
}

let override: PushSender | null | undefined;
let firebase: FirebasePushSender | null | undefined;

/**
 * The sender in use, or null when push is disabled (no key configured).
 * Tests replace it with setPushSenderForTests: a fake sender, or null for
 * "not configured"; undefined restores the real configuration.
 */
export function getPushSender(): PushSender | null {
  if (override !== undefined) return override;
  if (firebase === undefined) {
    const account = pushServiceAccount();
    firebase = account ? new FirebasePushSender(account) : null;
  }
  return firebase;
}

export function isPushEnabled(): boolean {
  return getPushSender() !== null;
}

export function setPushSenderForTests(sender: PushSender | null | undefined): void {
  override = sender;
}

/** Logs at startup whether push is on (once per process). */
export function logPushStatus(): void {
  try {
    getPushSender();
  } catch (err) {
    logger.error({ err }, 'Push notification setup failed');
  }
}
