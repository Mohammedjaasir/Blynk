import type { SmsLanguage } from '../../database/types.js';
import { smsParts } from '../sms-offers/sms-offers.service.js';
import { NotificationTemplates } from './notification.templates.js';
import { langPayload, type CustomerSmsLanguageSetting } from './sms-language.js';

/** A sample order, so staff see the "on the way" text with the delivery code in each language. */
const SAMPLE = { order_number: 'BL-20261012-1234', total_amount: 2450, delivery_code: '4821' };

/**
 * The setting plus the "on the way" SMS as it goes out in each language and
 * how many SMS parts it costs (Sinhala / Tamil are Unicode: 70 characters in
 * one part), for the Admin and Operations settings screens.
 */
export function smsLanguagePreview(setting: CustomerSmsLanguageSetting & { updated_at: Date | null }) {
  const samples = (['en', 'si', 'ta'] as SmsLanguage[]).map((lang) => {
    const text = NotificationTemplates.render('OUT_FOR_DELIVERY', { ...SAMPLE, ...langPayload(lang) });
    return { lang, text, parts: smsParts(text) };
  });
  return { mode: setting.mode, fallback: setting.fallback, updated_at: setting.updated_at, samples };
}
