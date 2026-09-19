import crypto from 'crypto';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { normalizeSriLankanPhone } from '../../../utils/phone.js';
import {
  NotificationProvider,
  ProviderSendResult,
  SendNotificationParams,
} from '../notification.provider.js';

export class SmsProvider implements NotificationProvider {
  readonly name = 'notifylk';
  readonly channel = 'SMS' as const;

  async send(params: SendNotificationParams): Promise<ProviderSendResult> {
    // 1. Recipient Phone Validation & Normalization
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeSriLankanPhone(params.recipient);
    } catch (err) {
      return {
        success: false,
        providerName: this.name,
        errorType: 'PERMANENT',
        errorMessage: err instanceof Error ? err.message : 'Invalid recipient phone number',
      };
    }

    // 2. Determine Mock vs Real Gateway Dispatch
    if (
      (process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production') &&
      (!env.SMS_API_KEY || env.SMS_API_KEY.startsWith('dev_') || !env.SMS_USER_ID)
    ) {
      return {
        success: false,
        providerName: this.name,
        errorType: 'PERMANENT',
        errorMessage: 'Mock SMS is strictly prohibited in production: valid SMS_API_KEY and SMS_USER_ID required',
      };
    }

    const isMock =
      !env.SMS_API_KEY ||
      env.SMS_API_KEY.startsWith('dev_') ||
      env.NODE_ENV === 'test';

    if (isMock) {
      // Mock / Development dispatch
      logger.info(
        {
          provider: this.name,
          notificationId: params.notificationId,
          recipient: normalizedPhone.slice(0, 6) + '****',
          messageLength: params.message.length,
          mock: true,
        },
        'Simulating SMS delivery via development mock provider'
      );

      // Support deterministic test fault-injection via metadata
      if (params.metadata?.forceError === 'TRANSIENT') {
        return {
          success: false,
          providerName: this.name,
          errorType: 'TRANSIENT',
          errorMessage: 'Simulated temporary SMS gateway timeout',
        };
      }

      if (params.metadata?.forceError === 'PERMANENT') {
        return {
          success: false,
          providerName: this.name,
          errorType: 'PERMANENT',
          errorMessage: 'Simulated permanent SMS delivery rejection (unreachable destination)',
        };
      }

      const mockMessageId = `mock_sms_${crypto.randomUUID()}`;
      return {
        success: true,
        providerName: this.name,
        providerMessageId: mockMessageId,
        rawResponse: { status: 'success', mock: true, id: mockMessageId },
      };
    }

    // 3. Live NotifyLK API HTTP Integration
    try {
      // Format number for NotifyLK (947XXXXXXXX without leading +)
      const toPhone = normalizedPhone.replace(/^\+/, '');
      const response = await fetch('https://app.notifylk.com/api/v1/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: env.SMS_USER_ID,
          api_key: env.SMS_API_KEY,
          sender_id: env.SMS_SENDER_ID || 'Blynk',
          to: toPhone,
          message: params.message,
        }),
        signal: AbortSignal.timeout(10000), // 10-second timeout
      });

      const responseBody = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        // HTTP 429 or 5xx -> Transient failure
        if (response.status === 429 || response.status >= 500) {
          return {
            success: false,
            providerName: this.name,
            errorType: 'TRANSIENT',
            errorMessage: `NotifyLK temporary HTTP error ${response.status}`,
            rawResponse: responseBody,
          };
        }

        // HTTP 4xx -> Permanent client/credential error
        return {
          success: false,
          providerName: this.name,
          errorType: 'PERMANENT',
          errorMessage: `NotifyLK rejected request with HTTP ${response.status}: ${JSON.stringify(responseBody)}`,
          rawResponse: responseBody,
        };
      }

      const messageId =
        (responseBody?.data as Record<string, unknown>)?.message_id?.toString() ||
        (responseBody?.message_id as string) ||
        `notifylk_${Date.now()}`;

      return {
        success: true,
        providerName: this.name,
        providerMessageId: messageId,
        rawResponse: responseBody,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        providerName: this.name,
        errorType: 'TRANSIENT',
        errorMessage: `Network error reaching NotifyLK gateway: ${errorMsg}`,
      };
    }
  }
}
