import crypto from 'crypto';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { normalizeSriLankanPhone } from '../../../utils/phone.js';
import {
  NotificationProvider,
  ProviderSendResult,
  SendNotificationParams,
} from '../notification.provider.js';

export class WhatsAppProvider implements NotificationProvider {
  readonly name = 'whatsapp_cloud_api';
  readonly channel = 'WHATSAPP' as const;

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

    // 2. Determine Mock vs Real WhatsApp Cloud API
    if (
      (process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production') &&
      (!env.WHATSAPP_API_TOKEN || env.WHATSAPP_API_TOKEN.startsWith('dev_'))
    ) {
      return {
        success: false,
        providerName: this.name,
        errorType: 'PERMANENT',
        errorMessage: 'Mock WhatsApp is strictly prohibited in production: valid WHATSAPP_API_TOKEN required',
      };
    }

    const isMock =
      !env.WHATSAPP_API_TOKEN ||
      env.WHATSAPP_API_TOKEN.startsWith('dev_') ||
      env.NODE_ENV === 'test';

    if (isMock) {
      logger.info(
        {
          provider: this.name,
          notificationId: params.notificationId,
          recipient: normalizedPhone.slice(0, 6) + '****',
          messageLength: params.message.length,
          mock: true,
        },
        'Simulating WhatsApp delivery via development mock provider'
      );

      // Support deterministic test fault-injection via metadata
      if (params.metadata?.forceError === 'TRANSIENT') {
        return {
          success: false,
          providerName: this.name,
          errorType: 'TRANSIENT',
          errorMessage: 'Simulated temporary WhatsApp API gateway timeout',
        };
      }

      if (params.metadata?.forceError === 'PERMANENT') {
        return {
          success: false,
          providerName: this.name,
          errorType: 'PERMANENT',
          errorMessage: 'Simulated permanent WhatsApp rejection (invalid/unregistered phone number)',
        };
      }

      const mockMessageId = `mock_wamid_${crypto.randomUUID()}`;
      return {
        success: true,
        providerName: this.name,
        providerMessageId: mockMessageId,
        rawResponse: { status: 'success', mock: true, id: mockMessageId },
      };
    }

    // 3. Live Meta WhatsApp Cloud API HTTP Integration
    try {
      const recipientDigits = normalizedPhone.replace(/^\+/, '');
      const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID || 'default';
      const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipientDigits,
          type: 'text',
          text: { body: params.message },
        }),
        signal: AbortSignal.timeout(10000),
      });

      const responseBody = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          return {
            success: false,
            providerName: this.name,
            errorType: 'TRANSIENT',
            errorMessage: `WhatsApp temporary HTTP error ${response.status}`,
            rawResponse: responseBody,
          };
        }

        return {
          success: false,
          providerName: this.name,
          errorType: 'PERMANENT',
          errorMessage: `WhatsApp rejected request with HTTP ${response.status}: ${JSON.stringify(responseBody)}`,
          rawResponse: responseBody,
        };
      }

      const messages = responseBody?.messages as Array<Record<string, unknown>> | undefined;
      const messageId = (messages?.[0]?.id as string) || `wamid_${Date.now()}`;

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
        errorMessage: `Network error reaching WhatsApp Cloud API: ${errorMsg}`,
      };
    }
  }
}
