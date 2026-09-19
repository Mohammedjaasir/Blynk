import { NotificationChannel } from '../../database/types.js';

export type ProviderErrorType = 'TRANSIENT' | 'PERMANENT';

export interface SendNotificationParams {
  notificationId: string;
  recipient: string;
  message: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderSendResult {
  success: boolean;
  providerName: string;
  providerMessageId?: string;
  errorType?: ProviderErrorType;
  errorMessage?: string;
  rawResponse?: unknown;
}

export interface NotificationProvider {
  readonly name: string;
  readonly channel: NotificationChannel;
  send(params: SendNotificationParams): Promise<ProviderSendResult>;
}
