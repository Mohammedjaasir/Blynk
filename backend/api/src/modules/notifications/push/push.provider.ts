import { logger } from '../../../utils/logger.js';
import type { NotificationProvider, ProviderSendResult, SendNotificationParams } from '../notification.provider.js';
import { deviceTokenRepository } from './push.repository.js';
import { getPushSender, type PushMessage } from './push.sender.js';

/**
 * The outbox's PUSH channel. A row's recipient is a user id: the push goes to
 * every device that user registered. Tokens FCM reports as unregistered or
 * invalid are deleted. With push disabled every send is a no-op that counts
 * as sent, so nothing piles up in the outbox.
 */
export class PushProvider implements NotificationProvider {
  readonly name = 'fcm';
  readonly channel = 'PUSH' as const;

  async send(params: SendNotificationParams): Promise<ProviderSendResult> {
    const sender = getPushSender();
    if (!sender) {
      return { success: true, providerName: this.name, providerMessageId: 'push-disabled' };
    }

    const payload = (params.metadata ?? {}) as Partial<PushMessage>;
    if (typeof payload.title !== 'string' || typeof payload.body !== 'string') {
      return { success: false, providerName: this.name, errorType: 'PERMANENT', errorMessage: 'Push payload has no title or body' };
    }
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload.data ?? {})) data[k] = String(v);

    const tokens = await deviceTokenRepository.tokensForUser(params.recipient);
    if (tokens.length === 0) {
      return { success: true, providerName: this.name, providerMessageId: 'no-devices' };
    }

    let outcomes;
    try {
      outcomes = await sender.send(tokens, { title: payload.title, body: payload.body, data });
    } catch (err) {
      return {
        success: false,
        providerName: this.name,
        errorType: 'TRANSIENT',
        errorMessage: `FCM request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const dead = outcomes.filter((o) => !o.ok && (o.error === 'UNREGISTERED' || o.error === 'INVALID')).map((o) => o.token);
    if (dead.length) {
      const removed = await deviceTokenRepository.removeTokens(dead);
      logger.info({ notificationId: params.notificationId, removed }, 'Removed device tokens FCM no longer accepts');
    }

    const delivered = outcomes.filter((o) => o.ok);
    if (delivered.length > 0) {
      return {
        success: true,
        providerName: this.name,
        providerMessageId: `${delivered.length}/${outcomes.length} devices`,
      };
    }
    if (outcomes.some((o) => !o.ok && o.error === 'TRANSIENT')) {
      return { success: false, providerName: this.name, errorType: 'TRANSIENT', errorMessage: 'FCM is temporarily unavailable' };
    }
    if (dead.length === outcomes.length) {
      // Every device was gone: nothing left to send to, which is not an error.
      return { success: true, providerName: this.name, providerMessageId: 'no-devices' };
    }
    const codes = [...new Set(outcomes.map((o) => (!o.ok ? o.detail ?? o.error : 'ok')))].join(', ');
    return { success: false, providerName: this.name, errorType: 'PERMANENT', errorMessage: `FCM rejected the push (${codes})` };
  }
}
