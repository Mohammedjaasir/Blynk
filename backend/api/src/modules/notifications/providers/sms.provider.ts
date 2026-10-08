import crypto from 'crypto';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { normalizeSriLankanPhone } from '../../../utils/phone.js';
import {
  NotificationProvider,
  ProviderSendResult,
  SendNotificationParams,
} from '../notification.provider.js';

/** SBS Telecom's API (portal.sbstelecom.net/api/v1, docs read 2026-10-05). */
export const SBS_SMS_URL = 'https://portal.sbstelecom.net/api/v1/sms';

const isSbs = () => env.SMS_PROVIDER === 'sbs';

/**
 * SMS through the gateway SMS_PROVIDER names: 'notifylk' (default) or 'sbs'
 * (SBS Telecom, every Sri Lankan network). Both take the number as
 * 947XXXXXXXX and the approved sender ID from SMS_SENDER_ID.
 */
/** SBS refuses an Idempotency-Key longer than this (HTTP 400). */
export const SBS_IDEMPOTENCY_KEY_MAX = 80;

/**
 * The Idempotency-Key sent to SBS. Short keys go as they are; a longer one
 * (an offer's "sms-offer:<offer id>:<customer id>" is 83 characters, which
 * SBS refused, 2026-10-08) becomes a hash of itself: still the same key on
 * every retry, so a retry still never texts twice.
 */
export function sbsIdempotencyKey(key: string): string {
  const plain = `blynk-${key}`;
  if (plain.length <= SBS_IDEMPOTENCY_KEY_MAX) return plain;
  return `blynk-${crypto.createHash('sha256').update(key).digest('hex')}`;
}

export class SmsProvider implements NotificationProvider {
  readonly channel = 'SMS' as const;

  get name(): string {
    return isSbs() ? 'sbstelecom' : 'notifylk';
  }

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
      (!env.SMS_API_KEY || env.SMS_API_KEY.startsWith('dev_') || !(isSbs() ? env.SMS_API_SECRET : env.SMS_USER_ID))
    ) {
      return {
        success: false,
        providerName: this.name,
        errorType: 'PERMANENT',
        errorMessage: isSbs()
          ? 'Mock SMS is strictly prohibited in production: valid SMS_API_KEY and SMS_API_SECRET required'
          : 'Mock SMS is strictly prohibited in production: valid SMS_API_KEY and SMS_USER_ID required',
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

    if (isSbs()) return this.sendViaSbs(normalizedPhone.replace(/^\+/, ''), params);

    // 3. Live NotifyLK API HTTP Integration
    try {
      // Format number for NotifyLK (947XXXXXXXX without leading +)
      const toPhone = normalizedPhone.replace(/^\+/, '');
      // Notify.lk's documented endpoint is app.notify.lk (the old
      // app.notifylk.com host does not exist), and it takes form/query
      // fields, not a JSON body.
      const response = await fetch('https://app.notify.lk/api/v1/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          user_id: env.SMS_USER_ID ?? '',
          api_key: env.SMS_API_KEY ?? '',
          sender_id: env.SMS_SENDER_ID || 'NotifyDEMO',
          to: toPhone,
          message: params.message,
        }).toString(),
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

      // Notify.lk answers HTTP 200 with {"status":"error", ...} for bad
      // credentials or an unapproved sender ID - that is not a delivery.
      if (responseBody && responseBody.status && responseBody.status !== 'success') {
        return {
          success: false,
          providerName: this.name,
          errorType: 'PERMANENT',
          errorMessage: `NotifyLK rejected the message: ${JSON.stringify(responseBody)}`,
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
  /**
   * SBS Telecom: POST /sms with HTTP Basic key:secret and JSON
   * {to, text, from}. 202 = accepted and charged (delivery is asynchronous);
   * 200 with duplicate:true = this Idempotency-Key was already sent, so a
   * retry of the same notification never texts the customer twice.
   */
  private async sendViaSbs(to: string, params: SendNotificationParams): Promise<ProviderSendResult> {
    const name = this.name;
    try {
      const auth = Buffer.from(`${env.SMS_API_KEY ?? ''}:${env.SMS_API_SECRET ?? ''}`).toString('base64');
      const response = await fetch(SBS_SMS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': sbsIdempotencyKey(params.idempotencyKey ?? params.notificationId),
        },
        body: JSON.stringify({ to, text: params.message, from: env.SMS_SENDER_ID || 'Blynk' }),
        signal: AbortSignal.timeout(10000),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (response.status === 202 || (response.status === 200 && body?.duplicate === true)) {
        return {
          success: true,
          providerName: name,
          providerMessageId: typeof body?.message_id === 'string' ? body.message_id : `sbs_${Date.now()}`,
          rawResponse: body,
        };
      }
      // 429 and 5xx may pass on a retry; anything else (bad key, blocked IP,
      // unapproved sender, no balance, bad number) will not.
      const transient = response.status === 429 || response.status >= 500;
      return {
        success: false,
        providerName: name,
        errorType: transient ? 'TRANSIENT' : 'PERMANENT',
        errorMessage: `SBS Telecom answered HTTP ${response.status}: ${JSON.stringify(body)}`,
        rawResponse: body,
      };
    } catch (err: unknown) {
      return {
        success: false,
        providerName: name,
        errorType: 'TRANSIENT',
        errorMessage: `Network error reaching SBS Telecom: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
