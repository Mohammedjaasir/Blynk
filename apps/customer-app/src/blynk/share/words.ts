import { localized } from '@/blynk/i18n/localized';

/*
 * The messages the share sheet sends (a product, a referral), in the language the customer chose.
 * Read them while sharing (never at module load). The links themselves are built in links.ts.
 */

export const SHARE_WORDS = localized(
  {
    product: (name: string) => `${name} on Blynk`,
    referralWithLink: (code: string) => `Join me on Blynk and get a reward on your first order. Use my code ${code} or this link:`,
    referralNoLink: (code: string) => `Join me on Blynk and get a reward on your first order. Use my code ${code} when you sign up.`,
  } as const,
  {
    si: {
      product: (name: string) => `Blynk හි ${name}`,
      referralWithLink: (code: string) => `මා සමඟ Blynk හි එකතු වී ඔබේ පළමු ඇණවුමට ත්‍යාගයක් ලබාගන්න. මගේ කේතය ${code} හෝ මේ ලින්ක් එක පාවිච්චි කරන්න:`,
      referralNoLink: (code: string) => `මා සමඟ Blynk හි එකතු වී ඔබේ පළමු ඇණවුමට ත්‍යාගයක් ලබාගන්න. ලියාපදිංචි වෙන විට මගේ කේතය ${code} පාවිච්චි කරන්න.`,
    },
    ta: {
      product: (name: string) => `Blynk-ல் ${name}`,
      referralWithLink: (code: string) => `என்னுடன் Blynk-ல் சேர்ந்து உங்கள் முதல் ஆர்டருக்கு வெகுமதி பெறுங்கள். என் குறியீடு ${code} அல்லது இந்த லிங்க்கைப் பயன்படுத்துங்கள்:`,
      referralNoLink: (code: string) => `என்னுடன் Blynk-ல் சேர்ந்து உங்கள் முதல் ஆர்டருக்கு வெகுமதி பெறுங்கள். பதிவு செய்யும்போது என் குறியீடு ${code} பயன்படுத்துங்கள்.`,
    },
  },
  'share.SHARE_WORDS',
);
