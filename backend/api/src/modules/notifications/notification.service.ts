import { NotificationChannel } from '../../database/types.js';
import { logger } from '../../utils/logger.js';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { DBConnection } from '../orders/order.repository.js';
import {
  ClaimedNotificationJob,
  notificationRepository,
  NotificationRepository,
} from './notification.repository.js';
import { NotificationProvider } from './notification.provider.js';
import { SmsProvider } from './providers/sms.provider.js';
import { WhatsAppProvider } from './providers/whatsapp.provider.js';
import { NotificationTemplates } from './notification.templates.js';

export interface EnqueueOptions {
  user_id?: string | null;
  order_id?: string | null;
  idempotency_key?: string | null;
  channel: NotificationChannel;
  notification_type: string;
  recipient: string;
  payload: Record<string, unknown>;
  max_attempts?: number;
}

export class NotificationService {
  private providers: Map<NotificationChannel, NotificationProvider> = new Map();

  constructor(private repo: NotificationRepository = notificationRepository) {
    // Register Phase 1 channel adapters
    this.registerProvider(new SmsProvider());
    this.registerProvider(new WhatsAppProvider());
  }

  /**
   * Registers or replaces a notification channel provider adapter.
   */
  registerProvider(provider: NotificationProvider) {
    this.providers.set(provider.channel, provider);
  }

  getProvider(channel: NotificationChannel): NotificationProvider | undefined {
    return this.providers.get(channel);
  }

  /**
   * Enqueues an outbox notification transactionally.
   * Sanitizes payload to guarantee no cost or secret leakage.
   */
  async enqueue(options: EnqueueOptions, executor?: DBConnection) {
    // 1. Normalize recipient
    let normalizedRecipient: string;
    try {
      normalizedRecipient = normalizeSriLankanPhone(options.recipient);
    } catch {
      // If normalization fails, keep original for outbox recording, provider will permanently fail it
      normalizedRecipient = options.recipient;
    }

    // 2. Sanitize payload
    const sanitizedPayload = NotificationTemplates.sanitizePayload(options.payload);

    // 3. Insert outbox record
    return await this.repo.enqueueNotification(
      {
        user_id: options.user_id,
        order_id: options.order_id,
        idempotency_key: options.idempotency_key,
        channel: options.channel,
        notification_type: options.notification_type,
        recipient: normalizedRecipient,
        payload: sanitizedPayload,
        max_attempts: options.max_attempts,
      },
      executor
    );
  }

  /**
   * Dispatches a single claimed notification job through the appropriate provider.
   */
  async dispatchJob(job: ClaimedNotificationJob): Promise<{ success: boolean; error?: string }> {
    const provider = this.providers.get(job.channel);

    if (!provider) {
      const errorMsg = `No provider registered for notification channel: ${job.channel}`;
      logger.error({ notificationId: job.id, channel: job.channel }, errorMsg);
      await this.repo.markPermanentFailure(job.id, errorMsg);
      return { success: false, error: errorMsg };
    }

    // 1. Render message template
    const message = NotificationTemplates.render(job.notification_type, job.payload);

    // 2. Dispatch to provider
    try {
      const result = await provider.send({
        notificationId: job.id,
        recipient: job.recipient,
        message,
        idempotencyKey: job.idempotency_key || undefined,
        metadata: typeof job.payload === 'object' && job.payload !== null ? (job.payload as Record<string, unknown>) : undefined,
      });

      if (result.success) {
        await this.repo.markSent(job.id, result.providerName, result.providerMessageId);
        logger.info(
          {
            notificationId: job.id,
            channel: job.channel,
            type: job.notification_type,
            provider: result.providerName,
            providerMessageId: result.providerMessageId,
            attempts: job.attempts,
          },
          'Notification delivered successfully'
        );
        return { success: true };
      }

      // Handle Provider Rejection / Failure
      const errorMsg = result.errorMessage || 'Unknown provider dispatch failure';

      if (result.errorType === 'PERMANENT') {
        logger.warn(
          {
            notificationId: job.id,
            channel: job.channel,
            error: errorMsg,
            attempts: job.attempts,
          },
          'Notification failed permanently (unrecoverable error)'
        );
        await this.repo.markPermanentFailure(job.id, errorMsg);
        return { success: false, error: errorMsg };
      }

      // Transient Failure -> Evaluate retry budget
      if (job.attempts >= job.max_attempts) {
        const exhaustedMsg = `Max retry attempts (${job.max_attempts}) exceeded. Last error: ${errorMsg}`;
        logger.warn({ notificationId: job.id, attempts: job.attempts }, exhaustedMsg);
        await this.repo.markPermanentFailure(job.id, exhaustedMsg);
        return { success: false, error: exhaustedMsg };
      }

      // Schedule exponential backoff retry
      const backoffMs = this.calculateBackoffMs(job.attempts);
      const nextAttemptAt = new Date(Date.now() + backoffMs);

      logger.info(
        {
          notificationId: job.id,
          attempt: job.attempts,
          maxAttempts: job.max_attempts,
          backoffMs,
          nextAttemptAt,
        },
        'Scheduling notification retry with exponential backoff'
      );

      await this.repo.markRetry(job.id, errorMsg, nextAttemptAt);
      return { success: false, error: errorMsg };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ notificationId: job.id, err }, 'Unexpected error during notification dispatch');

      if (job.attempts >= job.max_attempts) {
        await this.repo.markPermanentFailure(job.id, `Crash error after ${job.attempts} attempts: ${errorMsg}`);
      } else {
        const backoffMs = this.calculateBackoffMs(job.attempts);
        await this.repo.markRetry(job.id, `Crash error: ${errorMsg}`, new Date(Date.now() + backoffMs));
      }

      return { success: false, error: errorMsg };
    }
  }

  /**
   * Exponential backoff formula: base 5s * 2^(attempts - 1), capped at 1 hour.
   * Attempt 1: 5s
   * Attempt 2: 10s
   * Attempt 3: 20s
   */
  calculateBackoffMs(attempts: number): number {
    const baseMs = 5000;
    const exponent = Math.max(0, attempts - 1);
    const delay = baseMs * Math.pow(2, exponent);
    return Math.min(delay, 3600000);
  }
}

export const notificationService = new NotificationService();
