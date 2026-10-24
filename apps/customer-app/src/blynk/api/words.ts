/*
 * The words the app itself writes in the API layer: the error text for a failed connection, a server
 * fault and a bad feedback form. A message the server sends (`error.message`) stays as it is.
 */
import { localized } from '../i18n/localized';

export const API_WORDS = localized(
  {
    timeout: 'This is taking too long. Check your connection and try again.',
    network: "We couldn't reach Blynk. Check your connection and try again.",
    server: 'Something went wrong on our side. Please try again.',
    failed: 'Request failed.',
    feedbackCategory: 'Choose what your feedback is about.',
    feedbackEmpty: 'Write a message first.',
    feedbackLong: (max: number) => `Keep it to ${max} characters.`,
  } as const,
  {
    si: {
      timeout: 'මෙයට වැඩි වේලාවක් ගත වෙනවා. ඔබේ සම්බන්ධතාවය පරීක්ෂා කර නැවත උත්සාහ කරන්න.',
      network: 'Blynk වෙත සම්බන්ධ විය නොහැකි වුණා. ඔබේ සම්බන්ධතාවය පරීක්ෂා කර නැවත උත්සාහ කරන්න.',
      server: 'අපේ පැත්තෙන් යම් දෝෂයක් සිදු වුණා. කරුණාකර නැවත උත්සාහ කරන්න.',
      failed: 'ඉල්ලීම අසාර්ථකයි.',
      feedbackCategory: 'ඔබේ ප්‍රතිචාරය කුමක් ගැනද යන්න තෝරන්න.',
      feedbackEmpty: 'මුලින්ම පණිවිඩයක් ලියන්න.',
      feedbackLong: (max: number) => `අකුරු ${max} ට සීමා කරන්න.`,
    },
    ta: {
      timeout: 'இதற்கு அதிக நேரம் ஆகிறது. உங்கள் இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',
      network: 'Blynk ஐ அடைய முடியவில்லை. உங்கள் இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',
      server: 'எங்கள் பக்கத்தில் ஏதோ தவறு ஏற்பட்டது. தயவுசெய்து மீண்டும் முயற்சிக்கவும்.',
      failed: 'கோரிக்கை தோல்வியடைந்தது.',
      feedbackCategory: 'உங்கள் கருத்து எதைப் பற்றியது என்பதைத் தேர்ந்தெடுங்கள்.',
      feedbackEmpty: 'முதலில் ஒரு செய்தியை எழுதுங்கள்.',
      feedbackLong: (max: number) => `${max} எழுத்துகளுக்குள் வைத்திருங்கள்.`,
    },
  },
  'api.API_WORDS',
);
