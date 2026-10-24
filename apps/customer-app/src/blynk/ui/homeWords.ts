/*
 * The words written inline on Home (src/app/(tabs)/home.tsx) and the app-written lines of the live
 * Home content (src/demo/homeLive.ts). Sinhala and Tamil are read while rendering (see localized.ts).
 */
import { localized } from '@/blynk/i18n/localized';

export const HOME = localized(
  {
    locating: 'Locating ...',
    /** Said before the quoted product name that slides up in the search bar. */
    searchFor: 'Search for ',
    under: (amount: string) => `Under ${amount}`,
    seeAll: 'See all',
    exploreAisles: 'Explore all aisles',
    noMatch: 'Nothing matches these filters right now.',
    stocking: "We're stocking the shelves. Check back shortly.",
    search: 'Search',
    close: 'Close',
    tryAgain: 'Try again',
  } as const,
  {
    si: {
      locating: 'ස්ථානය සොයමින් ...',
      searchFor: 'සොයන්න ',
      under: (amount: string) => `${amount} ට අඩු`,
      seeAll: 'සියල්ල බලන්න',
      exploreAisles: 'සියලු අංශ බලන්න',
      noMatch: 'මෙම පෙරහන්වලට ගැළපෙන කිසිවක් දැනට නැත.',
      stocking: 'අපි රාක්ක පුරවමින් සිටිමු. මඳ වේලාවකින් නැවත බලන්න.',
      search: 'සොයන්න',
      close: 'වසන්න',
      tryAgain: 'නැවත උත්සාහ කරන්න',
    },
    ta: {
      locating: 'இடத்தைத் தேடுகிறது ...',
      searchFor: 'தேடுங்கள் ',
      under: (amount: string) => `${amount} க்கு கீழ்`,
      seeAll: 'அனைத்தையும் பார்க்க',
      exploreAisles: 'அனைத்து பிரிவுகளையும் பாருங்கள்',
      noMatch: 'இந்த வடிகட்டிகளுக்குப் பொருந்தும் எதுவும் இப்போது இல்லை.',
      stocking: 'நாங்கள் அலமாரிகளை நிரப்பிக் கொண்டிருக்கிறோம். சிறிது நேரம் கழித்து பாருங்கள்.',
      search: 'தேடு',
      close: 'மூடு',
      tryAgain: 'மீண்டும் முயற்சிக்கவும்',
    },
  },
  'ui.HOME',
);

/** The first-launch "location is off" bar (its owner of use is address/homeLocation.ts). */
export const LIVE_LOCATION_SHEET = localized(
  {
    title: 'Location Permission is Off',
    sub: 'Lets the app find your delivery spot. Your location stays on this device.',
    cta: 'GRANT',
    manual: 'Enter Location Manually',
  } as const,
  {
    si: {
      title: 'ස්ථාන අවසරය අක්‍රියයි',
      sub: 'ඔබේ බෙදාහැරීමේ ස්ථානය සොයා ගැනීමට ඇප් එකට ඉඩ දෙයි. ඔබේ ස්ථානය මෙම උපාංගයේම පමණක් රැඳේ.',
      cta: 'ඉඩ දෙන්න',
      manual: 'ස්ථානය අතින් ඇතුළත් කරන්න',
    },
    ta: {
      title: 'இருப்பிட அனுமதி முடக்கப்பட்டுள்ளது',
      sub: 'உங்கள் டெலிவரி இடத்தைக் கண்டறிய ஆப்புக்கு உதவும். உங்கள் இருப்பிடம் இந்த சாதனத்திலேயே இருக்கும்.',
      cta: 'அனுமதி',
      manual: 'இடத்தை கைமுறையாக உள்ளிடுங்கள்',
    },
  },
  'ui.LIVE_LOCATION_SHEET',
);

export const HOME_LIVE = localized(
  {
    /**
     * Catchy line pairs for the aisle cards, picked by position so a scroll of cards does not repeat
     * the same words (owner, 2026-10-18).
     */
    aisleLines: [
      ['Freshly stocked, daily', 'Great quality, honest prices'],
      ['Carefully selected items', 'Shop with confidence'],
      ['Trusted local favourites', 'Handpicked, every time'],
      ['Picked for your kitchen', 'Quality you can taste'],
    ] as [string, string][],
    /** "5% off everything here" (the {percent} token is filled in; Admin / Ops may set their own). */
    aisleOffer: '{percent}% off everything here',
    deliveryFee: (amount: string) => `Delivery ${amount}`,
    deliveryAtCheckout: 'Delivery fee at checkout',
    now: 'NOW',
    items: 'ITEMS',
    from: (amount: string) => `FROM ${amount}`,
    youSave: (amount: string) => `You save ${amount}`,
    itemCount: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
    titleOffers: 'OFFER PRICES TODAY',
    titleAisles: 'SHOP BY AISLE',
    promoLine: 'Handpicked fresh, every single day',
    promoTicks: ['Quality checked', 'Local favourites'] as string[],
    packagingFee: 'Packaging fee',
    platformFee: 'Platform fee',
    feeAtCheckout: 'Fee at checkout',
    allAisles: 'All',
  },
  {
    si: {
      aisleLines: [
        ['දිනපතා අලුතින් තොග', 'විශිෂ්ට ගුණාත්මකභාවය, අවංක මිල'],
        ['පරෙස්සමින් තෝරාගත් භාණ්ඩ', 'විශ්වාසයෙන් සාප්පු යන්න'],
        ['විශ්වාසවන්ත දේශීය ප්‍රියතම දේ', 'සෑම වාරයකම අතින් තෝරාගත්'],
        ['ඔබේ මුළුතැන්ගෙය සඳහා තෝරාගත්', 'රසයෙන්ම දැනෙන ගුණාත්මකභාවය'],
      ],
      aisleOffer: 'මෙහි සියල්ලටම {percent}% වට්ටමක්',
      deliveryFee: (amount: string) => `බෙදාහැරීම ${amount}`,
      deliveryAtCheckout: 'ඇණවුම් කරන විට බෙදාහැරීමේ ගාස්තුව',
      now: 'දැන්',
      items: 'භාණ්ඩ',
      from: (amount: string) => `${amount} සිට`,
      youSave: (amount: string) => `ඔබට ${amount} ඉතිරියි`,
      itemCount: (n: number) => `භාණ්ඩ ${n}`,
      titleOffers: 'අද දීමනා මිල',
      titleAisles: 'අංශ අනුව සාප්පු යන්න',
      promoLine: 'සෑම දිනකම අතින් තෝරාගත් නැවුම් බඩු',
      promoTicks: ['ගුණාත්මකභාවය පරීක්ෂා කළ', 'දේශීය ප්‍රියතම'],
      packagingFee: 'ඇසුරුම් ගාස්තුව',
      platformFee: 'වේදිකා ගාස්තුව',
      feeAtCheckout: 'ගාස්තුව ගෙවීමේදී',
      allAisles: 'සියල්ල',
    },
    ta: {
      aisleLines: [
        ['தினமும் புதிதாக நிரப்பப்படுகிறது', 'சிறந்த தரம், நேர்மையான விலை'],
        ['கவனமாகத் தேர்ந்தெடுத்த பொருட்கள்', 'நம்பிக்கையுடன் வாங்குங்கள்'],
        ['நம்பகமான உள்ளூர் விருப்பங்கள்', 'ஒவ்வொரு முறையும் கையால் தேர்ந்தெடுத்தவை'],
        ['உங்கள் சமையலறைக்காகத் தேர்ந்தெடுத்தவை', 'சுவையில் தெரியும் தரம்'],
      ],
      aisleOffer: 'இங்கே எல்லாவற்றிலும் {percent}% தள்ளுபடி',
      deliveryFee: (amount: string) => `டெலிவரி ${amount}`,
      deliveryAtCheckout: 'ஆர்டர் செய்யும்போது டெலிவரி கட்டணம்',
      now: 'இப்போது',
      items: 'பொருட்கள்',
      from: (amount: string) => `${amount} முதல்`,
      youSave: (amount: string) => `நீங்கள் ${amount} சேமிக்கிறீர்கள்`,
      itemCount: (n: number) => `${n} பொருள்`,
      titleOffers: 'இன்றைய ஆஃபர் விலைகள்',
      titleAisles: 'பிரிவு வாரியாக வாங்குங்கள்',
      promoLine: 'தினமும் கையால் தேர்ந்தெடுத்த புதியவை',
      promoTicks: ['தரம் சரிபார்க்கப்பட்டவை', 'உள்ளூர் விருப்பங்கள்'],
      packagingFee: 'பேக்கேஜிங் கட்டணம்',
      platformFee: 'பிளாட்ஃபார்ம் கட்டணம்',
      feeAtCheckout: 'ஆர்டர் செய்யும்போது கட்டணம்',
      allAisles: 'அனைத்தும்',
    },
  },
  'ui.HOME_LIVE',
);
