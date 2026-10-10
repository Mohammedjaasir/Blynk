import { errorMessage } from './apiErrors';
import { ApiError } from '../api/client';
import type { SmsLanguage, SmsOfferAudience, SmsOfferInput } from '../api/types';

/**
 * SMS offers (backend migration 027). The counting rules mirror
 * backend/api/src/modules/sms-offers/sms-offers.service.ts so the page can
 * show the cost while typing; the API counts again when the offer is sent.
 */

export const SMS_LANGUAGES: readonly SmsLanguage[] = ['si', 'ta', 'en'];

export const LANGUAGE_LABEL: Record<SmsLanguage, string> = {
  si: 'Sinhala',
  ta: 'Tamil',
  en: 'English',
};

export const AUDIENCE_LABEL: Record<SmsOfferAudience, string> = {
  ALL: 'All customers',
  ORDERED_30D: 'Ordered in last 30 days',
  ORDERED_90D: 'Ordered in last 90 days',
  NEVER_ORDERED: 'Signed up, never ordered',
};

export const MAX_OFFER_TEXT = 480;

/** A customer's SMS language for tables: "Sinhala" or "—" when never picked. */
export const smsLanguageLabel = (language: SmsLanguage | null | undefined) => (language ? LANGUAGE_LABEL[language] : '—');

/** The backend appends this to every offer SMS, in the SMS's language. */
export const OPT_OUT_LINE: Record<SmsLanguage, string> = {
  en: 'Stop offers: Blynk app > Profile > SMS & offers',
  si: 'දීමනා නවත්වන්න: Blynk app > Profile > SMS & offers',
  ta: 'சலுகைகளை நிறுத்த: Blynk app > Profile > SMS & offers',
};

/** The SMS exactly as a customer receives it. */
// The owner dropped the opt-out line (owner, 2026-10-09: "No need"): offers go out exactly as written.
export const withOptOut = (text: string, _language: SmsLanguage) => text.trim();

// GSM 03.38: the basic set, and the extension set whose characters take two.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€\f';

/**
 * How many SMS parts a text costs. Plain Latin text: 160 characters in one
 * SMS, 153 per part when split. Sinhala, Tamil or any other non-GSM
 * character makes it Unicode: 70 in one SMS, 67 per part.
 */
export function smsParts(text: string): number {
  let gsmLength = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) gsmLength += 1;
    else if (GSM_EXTENDED.includes(ch)) gsmLength += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) return gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153);
  const units = text.length; // UTF-16 code units, which is what UCS-2 SMS counts
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

/** Parts one recipient costs for this text, opt-out line included; 0 when empty. */
export const offerParts = (text: string, language: SmsLanguage) => (text.trim() ? smsParts(withOptOut(text, language)) : 0);

/** Languages assumed before the first estimate says which are switched on. */
export const LAUNCH_LANGUAGES: readonly SmsLanguage[] = ['en'];

/**
 * The request body: only enabled languages that have text. The fallback
 * must be an enabled language; with one language on, it is that language.
 */
export function offerInput(
  audience: SmsOfferAudience,
  fallback: SmsLanguage,
  texts: Record<SmsLanguage, string>,
  enabled: readonly SmsLanguage[] = SMS_LANGUAGES
): SmsOfferInput {
  const messages: SmsOfferInput['messages'] = {};
  for (const lang of SMS_LANGUAGES) {
    if (!enabled.includes(lang)) continue;
    const text = texts[lang].trim();
    if (text) messages[lang] = text;
  }
  const fallbackLanguage = enabled.includes(fallback) ? fallback : (enabled[0] ?? fallback);
  return { audience, fallback_language: fallbackLanguage, messages };
}

/** "Sinhala", "Sinhala and Tamil", "Sinhala, Tamil and English". */
export function languageList(languages: readonly SmsLanguage[]): string {
  const names = languages.map((l) => LANGUAGE_LABEL[l]);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export const partsLabel = (n: number) => `${n} SMS ${n === 1 ? 'part' : 'parts'}`;

/** Plain words for the offer endpoints' error codes. */
export function smsOfferErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'OUTSIDE_SENDING_HOURS':
        // The window is the opening hours Ops and Admin set (owner, 2026-10-10); the server names it.
        return err.message || 'Offers can be sent during opening hours only.';
      case 'OFFER_TEXT_MISSING': {
        const missing = (err.details as { missing_languages?: SmsLanguage[] } | undefined)?.missing_languages ?? [];
        return missing.length ? `Write the ${languageList(missing)} text too.` : err.message;
      }
      case 'OFFER_NO_RECIPIENTS':
        return 'No customer in this audience can receive offers.';
      case 'NO_TEST_PHONE':
        return 'Enter the number to send the test to.';
      case 'VALIDATION_ERROR':
        if ((err.details as Array<{ field?: string }> | null | undefined)?.some?.((d) => d.field === 'phone')) {
          return 'Enter a Sri Lankan mobile number, e.g. 077 123 4567.';
        }
        return `Check the texts: each can be up to ${MAX_OFFER_TEXT} characters.`;
      default:
        return err.message;
    }
  }
  return errorMessage(err, fallback);
}
