import { localized } from '@/blynk/i18n/localized';

/*
 * Customer support and the help answers (Flutter: Services/store_info.dart, Screens/help_screen.dart,
 * owner 2026-10-08). The delivery fee is never quoted: the cart shows the one that applies.
 */
export const SUPPORT = {
  phone: '+94717107374',
  phoneLabel: '+94 71 710 7374',
  whatsAppUrl: 'https://wa.me/94717107374',
  hubName: 'Dharga Town',
  country: 'Sri Lanka',
  serviceRadiusKm: 4,
  paymentMethodLabel: 'Cash on delivery',
} as const;

/** Stands for the store's live week of hours in an answer. */
export const HOURS_TOKEN = '{hours}';

export const SUPPORT_WORDS = localized(
  {
    hubName: SUPPORT.hubName as string,
    country: SUPPORT.country as string,
    /** "📍 Dharga Town, Sri Lanka" on the Help screen. */
    place: (hub: string, country: string) => `${hub}, ${country}`,
    /** Stands in for the hours when the store has none to show. */
    hoursFallback: 'during our opening hours',
    payment: SUPPORT.paymentMethodLabel as string,
    faqs: (hub: string, km: number, pay: string) => [
      {
        q: 'Where do you deliver?',
        a: `We deliver within ${km} km of our ${hub} hub. If your address falls outside that range, checkout will let you know before your order is placed.`,
      },
      { q: 'What are your delivery hours?', a: `We take orders and deliver ${HOURS_TOKEN}. Orders can't be placed outside those hours.` },
      { q: 'How much is delivery?', a: 'The delivery fee is shown in your cart before you place your order.' },
      {
        q: 'How can I pay?',
        a: `${pay}. Pay the rider when your groceries arrive - no card or online payment needed.`,
      },
      {
        q: 'Can I cancel my order?',
        a: 'Yes, while your order is still Placed or Packed. Once it is out for delivery we can no longer cancel it. Open the order from Orders to cancel.',
      },
      { q: 'Something was missing or wrong', a: 'Open the order from the Orders tab and check the item list first.' },
    ],
  },
  {
    si: {
      hubName: 'දර්ගා ටවුන්',
      country: 'ශ්‍රී ලංකාව',
      place: (hub: string, country: string) => `${hub}, ${country}`,
      hoursFallback: 'අපේ විවෘත වේලාවන් තුළ',
      payment: 'භාණ්ඩ ලැබෙන විට මුදල් ගෙවීම',
      faqs: (hub: string, km: number, pay: string) => [
        {
          q: 'ඔබ බෙදාහරින්නේ කොහේටද?',
          a: `අපේ ${hub} කේන්ද්‍රයේ සිට කිලෝමීටර් ${km} ඇතුළත අපි බෙදාහරිනවා. ඔබේ ලිපිනය ඒ සීමාවෙන් පිටත නම්, ඇණවුම තැබීමට පෙර චෙක්අවුට් එකේදී දන්වනවා.`,
        },
        { q: 'ඔබේ බෙදාහැරීමේ වේලාවන් මොනවාද?', a: `අපි ඇණවුම් භාරගෙන බෙදාහරින්නේ ${HOURS_TOKEN}. ඒ වේලාවන්ට පිටතින් ඇණවුම් කළ නොහැක.` },
        { q: 'බෙදාහැරීමේ ගාස්තුව කීයද?', a: 'ඇණවුම තැබීමට පෙර බෙදාහැරීමේ ගාස්තුව ඔබේ කරත්තයේ පෙන්වනවා.' },
        {
          q: 'මම ගෙවන්නේ කොහොමද?',
          a: `${pay}. ඔබේ බඩු ලැබෙන විට රයිඩර්ට ගෙවන්න - කාඩ්පතක් හෝ ඔන්ලයින් ගෙවීමක් අවශ්‍ය නැහැ.`,
        },
        {
          q: 'මගේ ඇණවුම අවලංගු කළ හැකිද?',
          a: 'ඔව්, ඔබේ ඇණවුම තවම "තැබුවා" හෝ "ඇසුරුම් කළා" තත්ත්වයේ ඇති විට. බෙදාහැරීමට පිටත් වූ පසු අපට එය අවලංගු කළ නොහැක. අවලංගු කිරීමට ඇණවුම් වෙතින් ඇණවුම විවෘත කරන්න.',
        },
        { q: 'යමක් අඩුයි, නැත්නම් වැරදියි', a: 'ඇණවුම් ටැබ් එකෙන් ඇණවුම විවෘත කර මුලින්ම භාණ්ඩ ලැයිස්තුව පරීක්ෂා කරන්න.' },
      ],
    },
    ta: {
      hubName: 'தர்கா டவுன்',
      country: 'இலங்கை',
      place: (hub: string, country: string) => `${hub}, ${country}`,
      hoursFallback: 'எங்கள் திறந்திருக்கும் நேரங்களில்',
      payment: 'டெலிவரியின் போது பணம் செலுத்தல்',
      faqs: (hub: string, km: number, pay: string) => [
        {
          q: 'எங்கெல்லாம் டெலிவரி செய்கிறீர்கள்?',
          a: `எங்கள் ${hub} மையத்திலிருந்து ${km} கி.மீ.க்குள் டெலிவரி செய்கிறோம். உங்கள் முகவரி அந்த எல்லைக்கு வெளியே இருந்தால், ஆர்டர் செய்வதற்கு முன் செக்அவுட்டில் தெரிவிக்கப்படும்.`,
        },
        { q: 'டெலிவரி நேரங்கள் என்ன?', a: `நாங்கள் ஆர்டர்களை ஏற்று டெலிவரி செய்வது ${HOURS_TOKEN}. அந்த நேரங்களுக்கு வெளியே ஆர்டர் செய்ய முடியாது.` },
        { q: 'டெலிவரி கட்டணம் எவ்வளவு?', a: 'ஆர்டர் செய்வதற்கு முன் டெலிவரி கட்டணம் உங்கள் கார்ட்டில் காட்டப்படும்.' },
        {
          q: 'எப்படிப் பணம் செலுத்துவது?',
          a: `${pay}. உங்கள் பொருட்கள் வந்ததும் ரைடரிடம் செலுத்துங்கள் - கார்டு அல்லது ஆன்லைன் கட்டணம் தேவையில்லை.`,
        },
        {
          q: 'என் ஆர்டரை ரத்து செய்யலாமா?',
          a: 'ஆம், உங்கள் ஆர்டர் இன்னும் "ஆர்டர் செய்யப்பட்டது" அல்லது "பேக் செய்யப்பட்டது" நிலையில் இருக்கும்போது. டெலிவரிக்குப் புறப்பட்ட பிறகு ரத்து செய்ய முடியாது. ரத்து செய்ய ஆர்டர்கள் பகுதியிலிருந்து ஆர்டரைத் திறக்கவும்.',
        },
        { q: 'ஏதோ குறைவாக அல்லது தவறாக இருந்தது', a: 'ஆர்டர்கள் தாவலில் இருந்து ஆர்டரைத் திறந்து முதலில் பொருட்களின் பட்டியலைச் சரிபார்க்கவும்.' },
      ],
    },
  },
  'account.SUPPORT_WORDS',
);

/** The FAQ answers with the hours filled in. */
export const faqsWithHours = (hours: string) =>
  SUPPORT_WORDS.faqs(SUPPORT_WORDS.hubName, SUPPORT.serviceRadiusKm, SUPPORT_WORDS.payment).map((f) => ({
    q: f.q,
    a: f.a.split(HOURS_TOKEN).join(hours),
  }));
