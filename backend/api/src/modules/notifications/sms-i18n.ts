import type { SmsLanguage } from '../../database/types.js';

/**
 * Sinhala and Tamil versions of the customer-facing transactional SMS
 * (owner, 2026-10-12; the language is picked by the "Customer SMS language"
 * setting, sms-language.ts). English stays in notification.templates.ts.
 *
 * NATIVE SPEAKER REVIEW NEEDED: the Sinhala and Tamil wording below was
 * written by the developer, not a native speaker. Have a native Sinhala and a
 * native Tamil speaker read every line before switching the setting away from
 * "English only".
 *
 * Rules every line keeps:
 *  - Short: Sinhala / Tamil make an SMS Unicode, 70 characters in one part and
 *    67 per part after that, so each text is as short as it can be while
 *    still clear (tests/sms-language.test.ts checks the part counts).
 *  - Dynamic values are exactly the English ones: order number, delivery
 *    code, LKR amounts (2 decimals), the clinic date/time and names.
 *  - No customer-written text, ever: the recipient phone may be a number the
 *    customer typed and never proved (security audit 2026-10). Only staff
 *    reasons (store cancellation, clinic cancellation, rider rejection) and
 *    catalogue names (item, clinic, doctor) are filled in, as in English.
 *  - The sign-in code SMS carries only the code, the brand and how long it is
 *    valid - nothing else.
 */

export type LocalLanguage = Exclude<SmsLanguage, 'en'>;

export interface LocalizedTexts {
  orderPlaced(n: string, total: string): string;
  orderPlacedScheduled(n: string, total: string, time: string): string;
  /** reason: a staff-written reason, or null (cancelled by the customer). */
  orderCancelled(n: string, reason: string | null): string;
  itemUnavailable(n: string, item: string, newTotal: string): string;
  riderAssigned(n: string, rider: string | null, vehicle: string | null): string;
  /** The most sent text: kept to one Unicode part (70) for a typical total. */
  outForDelivery(n: string, total: string, code: string | null): string;
  /** The buyer's copy of an order placed for someone else. */
  outForDeliveryToBuyer(n: string, code: string | null): string;
  delivered(n: string): string;
  codConfirmed(n: string, amount: string): string;
  dentalConfirmed(doctor: string, clinic: string, when: string): string;
  /** reason: the clinic's reason, or null. */
  dentalCancelled(doctor: string, clinic: string, when: string, byClinic: boolean, reason: string | null): string;
  dentalReminder(doctor: string, clinic: string, when: string): string;
  riderApproved(): string;
  /** reason: the staff reason, already shortened. */
  riderRejected(reason: string): string;
  otp(code: string, minutes: number): string;
}

const si: LocalizedTexts = {
  orderPlaced: (n, total) => `Blynk: ඇණවුම #${n} ලැබුණා. මුළු මුදල LKR ${total}.`,
  orderPlacedScheduled: (n, total, time) => `Blynk: ඇණවුම #${n} ලැබුණා, LKR ${total}. බෙදාහැරීම ${time}.`,
  orderCancelled: (n, reason) =>
    reason
      ? `Blynk: ඇණවුම #${n} අවලංගු කළා (${reason}).`
      : `Blynk: ඇණවුම #${n} අවලංගු කළා. ඔබ ඉල්ලුවේ නැත්නම් අපිට කතා කරන්න.`,
  itemUnavailable: (n, item, newTotal) => `Blynk: #${n} - ${item} නැති නිසා ඉවත් කළා. නව මුදල LKR ${newTotal}.`,
  riderAssigned: (n, rider, vehicle) =>
    `Blynk: ${rider ?? 'රයිඩර්'}${vehicle ? ` (${vehicle})` : ''} ඇණවුම #${n} ගෙන එයි.`,
  outForDelivery: (n, total, code) =>
    code
      ? `Blynk: ඇණවුම #${n} එනවා. කේතය ${code}. ගෙවීම LKR ${total}.`
      : `Blynk: ඇණවුම #${n} එනවා. ගෙවීම LKR ${total}.`,
  outForDeliveryToBuyer: (n, code) =>
    code ? `Blynk: ඇණවුම #${n} ලබන්නා වෙත එනවා. කේතය ${code}.` : `Blynk: ඇණවුම #${n} ලබන්නා වෙත එනවා.`,
  delivered: (n) => `Blynk: ඇණවුම #${n} භාර දුන්නා. ස්තූතියි!`,
  codConfirmed: (n, amount) => `Blynk: ඇණවුම #${n} සඳහා LKR ${amount} ලැබුණා. ස්තූතියි!`,
  dentalConfirmed: (doctor, clinic, when) => `Blynk Dental: Dr. ${doctor}, ${clinic} - ${when} වෙන්කිරීම තහවුරුයි. ගාස්තුව සායනයේ ගෙවන්න.`,
  dentalCancelled: (doctor, clinic, when, byClinic, reason) =>
    `Blynk Dental: Dr. ${doctor}, ${clinic} - ${when} වෙන්කිරීම ${byClinic ? 'සායනය' : 'ඔබ'} අවලංගු කළා.${reason ? ` හේතුව: ${reason}.` : ''}`,
  dentalReminder: (doctor, clinic, when) => `Blynk Dental: හෙට Dr. ${doctor}, ${clinic} - ${when}.`,
  riderApproved: () => 'Blynk: ඔබ රයිඩර් ලෙස අනුමතයි. මෙම අංකයෙන් Blynk Rider app එකට එන්න.',
  riderRejected: (reason) => `Blynk: ඔබේ රයිඩර් ඉල්ලීම අනුමත නොවුණා. හේතුව: ${reason}`,
  otp: (code, minutes) => `${code} ඔබේ Blynk කේතයයි. මිනි. ${minutes}යි. කාටවත් දෙන්න එපා.`,
};

const ta: LocalizedTexts = {
  orderPlaced: (n, total) => `Blynk: ஆர்டர் #${n} பெறப்பட்டது. மொத்தம் LKR ${total}.`,
  orderPlacedScheduled: (n, total, time) => `Blynk: ஆர்டர் #${n} பெறப்பட்டது, LKR ${total}. டெலிவரி ${time}.`,
  orderCancelled: (n, reason) =>
    reason
      ? `Blynk: ஆர்டர் #${n} ரத்து செய்யப்பட்டது (${reason}).`
      : `Blynk: ஆர்டர் #${n} ரத்து செய்யப்பட்டது. நீங்கள் கேட்கவில்லை எனில் அழைக்கவும்.`,
  itemUnavailable: (n, item, newTotal) => `Blynk: #${n} - ${item} இல்லாததால் நீக்கப்பட்டது. புதிய தொகை LKR ${newTotal}.`,
  riderAssigned: (n, rider, vehicle) =>
    `Blynk: ${rider ?? 'ரைடர்'}${vehicle ? ` (${vehicle})` : ''} ஆர்டர் #${n} கொண்டு வருவார்.`,
  outForDelivery: (n, total, code) =>
    code
      ? `Blynk: #${n} வருகிறது. குறியீடு ${code}. கட்டணம் LKR ${total}.`
      : `Blynk: ஆர்டர் #${n} வருகிறது. கட்டணம் LKR ${total}.`,
  outForDeliveryToBuyer: (n, code) =>
    code ? `Blynk: ஆர்டர் #${n} பெறுநரிடம் வருகிறது. குறியீடு ${code}.` : `Blynk: ஆர்டர் #${n} பெறுநரிடம் வருகிறது.`,
  delivered: (n) => `Blynk: ஆர்டர் #${n} வழங்கப்பட்டது. நன்றி!`,
  codConfirmed: (n, amount) => `Blynk: ஆர்டர் #${n} க்கு LKR ${amount} பெறப்பட்டது. நன்றி!`,
  dentalConfirmed: (doctor, clinic, when) => `Blynk Dental: Dr. ${doctor}, ${clinic} - ${when} சந்திப்பு உறுதி. கட்டணம் கிளினிக்கில்.`,
  dentalCancelled: (doctor, clinic, when, byClinic, reason) =>
    `Blynk Dental: Dr. ${doctor}, ${clinic} - ${when} சந்திப்பு ${byClinic ? 'கிளினிக்கால்' : 'உங்களால்'} ரத்து.${reason ? ` காரணம்: ${reason}.` : ''}`,
  dentalReminder: (doctor, clinic, when) => `Blynk Dental: நாளை Dr. ${doctor}, ${clinic} - ${when}.`,
  riderApproved: () => 'Blynk: நீங்கள் ரைடராக ஏற்கப்பட்டீர்கள். இந்த எண்ணுடன் Blynk Rider app-இல் நுழையவும்.',
  riderRejected: (reason) => `Blynk: உங்கள் ரைடர் விண்ணப்பம் ஏற்கப்படவில்லை. காரணம்: ${reason}`,
  otp: (code, minutes) => `${code} உங்கள் Blynk குறியீடு. ${minutes} நிமி. செல்லும். பகிர வேண்டாம்.`,
};

export const LOCALIZED_SMS: Record<LocalLanguage, LocalizedTexts> = { si, ta };

/** The Sinhala/Tamil texts for a payload's `lang`, or null for English (or anything unknown). */
export function localizedTexts(lang: unknown): LocalizedTexts | null {
  return lang === 'si' || lang === 'ta' ? LOCALIZED_SMS[lang] : null;
}
