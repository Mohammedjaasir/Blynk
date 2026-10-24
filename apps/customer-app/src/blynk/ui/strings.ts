/*
 * UI wording for the shell, browsing and the small notices (one place per feature, plain
 * constants). A later phase adds Sinhala and Tamil: these objects are what gets translated,
 * so screens read their text from here instead of writing it inline.
 */
import { localized } from '@/blynk/i18n/localized';

export const TABS = localized(
  {
    shop: 'Shop',
    orders: 'Orders',
    help: 'Help',
    profile: 'Profile',
    /** Read after "Orders" by a screen reader while an order is open. */
    openOrderBadge: 'order in progress',
  } as const,
  {
    si: { shop: 'සාප්පුව', orders: 'ඇණවුම්', help: 'උදව්', profile: 'ගිණුම', openOrderBadge: 'ඇණවුමක් ක්‍රියාත්මකයි' },
    ta: { shop: 'கடை', orders: 'ஆர்டர்கள்', help: 'உதவி', profile: 'கணக்கு', openOrderBadge: 'ஆர்டர் நடந்துகொண்டிருக்கிறது' },
  },
  'ui.TABS',
);

export const CATEGORIES = localized(
  {
    title: 'Categories',
    allCategories: 'All categories',
    seeAll: 'See all',
    /** The backend's catch-all group when it is the only one ("More" over a "More" grid reads wrong). */
    onlyGroupTitle: 'Shop by category',
    /** The first sidebar row: everything in the category. */
    all: 'All',
    allIn: (name: string) => `All ${name}`,
    loadFailed: "We couldn't load categories",
    empty: 'No categories yet',
    emptySub: 'Our catalog is being stocked. Please check back shortly.',
    notFound: "This category isn't available",
    goToShop: 'Go to shop',
    noProducts: 'Nothing here right now. Check back shortly.',
    itemCount: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
    soldOut: 'Sold out',
    search: 'Search',
    tryAgain: 'Try again',
  } as const,
  {
    si: {
      title: 'ප්‍රවර්ග',
      allCategories: 'සියලු ප්‍රවර්ග',
      seeAll: 'සියල්ල බලන්න',
      onlyGroupTitle: 'ප්‍රවර්ග අනුව සාප්පු යන්න',
      all: 'සියල්ල',
      allIn: (name: string) => `සියලු ${name}`,
      loadFailed: 'ප්‍රවර්ග පූරණය කළ නොහැකි වුණා',
      empty: 'තවම ප්‍රවර්ග නැත',
      emptySub: 'අපගේ භාණ්ඩ ලැයිස්තුව සකස් වෙමින් පවතී. මඳ වේලාවකින් නැවත බලන්න.',
      notFound: 'මෙම ප්‍රවර්ගය නැත',
      goToShop: 'සාප්පුවට යන්න',
      noProducts: 'දැනට මෙහි කිසිවක් නැත. මඳ වේලාවකින් නැවත බලන්න.',
      itemCount: (n: number) => `භාණ්ඩ ${n}`,
      soldOut: 'අවසන්',
      search: 'සොයන්න',
      tryAgain: 'නැවත උත්සාහ කරන්න',
    },
    ta: {
      title: 'வகைகள்',
      allCategories: 'அனைத்து வகைகளும்',
      seeAll: 'அனைத்தையும் பார்க்க',
      onlyGroupTitle: 'வகை வாரியாக வாங்குங்கள்',
      all: 'அனைத்தும்',
      allIn: (name: string) => `அனைத்து ${name}`,
      loadFailed: 'வகைகளை ஏற்ற முடியவில்லை',
      empty: 'இன்னும் வகைகள் இல்லை',
      emptySub: 'எங்கள் பொருட்கள் பட்டியல் தயாராகி வருகிறது. சிறிது நேரம் கழித்து மீண்டும் பாருங்கள்.',
      notFound: 'இந்த வகை கிடைக்கவில்லை',
      goToShop: 'கடைக்குச் செல்க',
      noProducts: 'இப்போது இங்கே எதுவும் இல்லை. சிறிது நேரம் கழித்து பாருங்கள்.',
      itemCount: (n: number) => `${n} பொருள்`,
      soldOut: 'தீர்ந்துவிட்டது',
      search: 'தேடு',
      tryAgain: 'மீண்டும் முயற்சிக்கவும்',
    },
  },
  'ui.CATEGORIES',
);

export const PROMO = localized(
  {
    /** Accessibility name of the carousel and of a banner without a title. */
    carousel: 'Offers',
    offer: 'Offer',
    slideOf: (i: number, n: number) => `Offer ${i} of ${n}`,
  } as const,
  {
    si: {
      carousel: 'දීමනා',
      offer: 'දීමනාව',
      slideOf: (i: number, n: number) => `දීමනා ${n} න් ${i} වැනි`,
    },
    ta: {
      carousel: 'ஆஃபர்கள்',
      offer: 'ஆஃபர்',
      slideOf: (i: number, n: number) => `${n} இல் ${i}வது ஆஃபர்`,
    },
  },
  'ui.PROMO',
);

export const USUALS = localized(
  {
    title: 'Your usuals',
    addAll: 'Add all',
    fromLast: (orderNumber: string | null) => (orderNumber ? `From your last order, ${orderNumber}` : 'From your last order'),
  } as const,
  {
    si: {
      title: 'ඔබේ සුපුරුදු දේවල්',
      addAll: 'සියල්ල එක් කරන්න',
      fromLast: (orderNumber: string | null) => (orderNumber ? `ඔබේ අවසන් ඇණවුමෙන්, ${orderNumber}` : 'ඔබේ අවසන් ඇණවුමෙන්'),
    },
    ta: {
      title: 'உங்கள் வழக்கமானவை',
      addAll: 'அனைத்தையும் சேர்',
      fromLast: (orderNumber: string | null) => (orderNumber ? `உங்கள் கடைசி ஆர்டரிலிருந்து, ${orderNumber}` : 'உங்கள் கடைசி ஆர்டரிலிருந்து'),
    },
  },
  'ui.USUALS',
);

export const OFFLINE = localized(
  {
    offline: "You're offline. Showing saved items.",
    restored: 'Back online',
    tryAgain: 'Try again',
  } as const,
  {
    si: {
      offline: 'ඔබ ඔෆ්ලයින්. සුරකින ලද භාණ්ඩ පෙන්වමින්.',
      restored: 'නැවත සබැඳියි',
      tryAgain: 'නැවත උත්සාහ කරන්න',
    },
    ta: {
      offline: 'நீங்கள் ஆஃப்லைனில் உள்ளீர்கள். சேமித்த பொருட்கள் காட்டப்படுகின்றன.',
      restored: 'மீண்டும் ஆன்லைனில்',
      tryAgain: 'மீண்டும் முயற்சிக்கவும்',
    },
  },
  'ui.OFFLINE',
);

export const CONFIG = localized(
  {
    title: "This build isn't configured",
    native: 'Install the latest version of Blynk from the store and try again.',
    web: 'Please try again in a little while.',
    code: (code: string) => `Code: ${code}`,
  } as const,
  {
    si: {
      title: 'මෙම ඇප් එක සකසා නැත',
      native: 'ස්ටෝර් එකෙන් Blynk හි නවතම අනුවාදය ස්ථාපනය කර නැවත උත්සාහ කරන්න.',
      web: 'කරුණාකර මඳ වේලාවකින් නැවත උත්සාහ කරන්න.',
      code: (code: string) => `කේතය: ${code}`,
    },
    ta: {
      title: 'இந்த ஆப் அமைக்கப்படவில்லை',
      native: 'ஸ்டோரிலிருந்து Blynk இன் புதிய பதிப்பை நிறுவி மீண்டும் முயற்சிக்கவும்.',
      web: 'தயவுசெய்து சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.',
      code: (code: string) => `குறியீடு: ${code}`,
    },
  },
  'ui.CONFIG',
);

export const CLEAR_CART = localized(
  {
    button: 'Clear cart',
    title: 'Clear cart?',
    message: 'Every item is removed. You can add them again from the shop.',
    cancel: 'Cancel',
    confirm: 'Clear cart',
  } as const,
  {
    si: {
      button: 'කරත්තය හිස් කරන්න',
      title: 'කරත්තය හිස් කරන්නද?',
      message: 'සියලු භාණ්ඩ ඉවත් වේ. ඔබට නැවත සාප්පුවෙන් එක් කළ හැක.',
      cancel: 'අවලංගු කරන්න',
      confirm: 'කරත්තය හිස් කරන්න',
    },
    ta: {
      button: 'கார்ட்டை காலியாக்கு',
      title: 'கார்ட்டை காலியாக்கவா?',
      message: 'அனைத்து பொருட்களும் நீக்கப்படும். கடையிலிருந்து மீண்டும் சேர்க்கலாம்.',
      cancel: 'ரத்து செய்',
      confirm: 'கார்ட்டை காலியாக்கு',
    },
  },
  'ui.CLEAR_CART',
);

export const DOCTORS_OFF = localized(
  {
    title: 'Doctor channelling is not available right now.',
    message: 'Your booked appointments are still in My appointments.',
    myAppointments: 'My appointments',
    goToShop: 'Go to shop',
  } as const,
  {
    si: {
      title: 'වෛද්‍ය වෙන්කිරීම් දැනට ලබා ගත නොහැක.',
      message: 'ඔබ වෙන්කළ හමුවීම් තවමත් "මගේ හමුවීම්" හි ඇත.',
      myAppointments: 'මගේ හමුවීම්',
      goToShop: 'සාප්පුවට යන්න',
    },
    ta: {
      title: 'டாக்டர் சேனலிங் இப்போது கிடைக்கவில்லை.',
      message: 'நீங்கள் பதிவு செய்த அப்பாயிண்ட்மெண்ட்கள் இன்னும் "எனது அப்பாயிண்ட்மெண்ட்கள்" பகுதியில் உள்ளன.',
      myAppointments: 'எனது அப்பாயிண்ட்மெண்ட்கள்',
      goToShop: 'கடைக்குச் செல்க',
    },
  },
  'ui.DOCTORS_OFF',
);

/** The start gate's login (Flutter SessionGate + LoginScreen's Skip, owner 2026-10-14). */
export const LOGIN_GATE = localized(
  {
    skip: 'Skip for now',
    /** Read by a screen reader after the Skip button. */
    skipHint: 'Opens the shop. You can log in later from Profile.',
  } as const,
  {
    si: {
      skip: 'දැනට මඟ හරින්න',
      skipHint: 'සාප්පුව විවෘත කරයි. ඔබට පසුව ගිණුමෙන් ලොග් විය හැක.',
    },
    ta: {
      skip: 'இப்போது தவிர்',
      skipHint: 'கடையைத் திறக்கும். பிறகு கணக்கு பகுதியில் உள்நுழையலாம்.',
    },
  },
  'ui.LOGIN_GATE',
);

/** The phone login's yellow hero (rider mascot). The headlines take turns, about 3 s each. */
export const LOGIN = localized(
  {
    headlines: ['Fresh to your door', 'Delivered in minutes', 'Groceries, delivered fast'],
    /** Read by a screen reader for the (decorative) rider picture. */
    heroLabel: 'The Blynk rider bringing groceries',
  } as const,
  {
    si: {
      headlines: ['ඔබේ දොරටුවටම නැවුම්', 'විනාඩි කිහිපයකින් බෙදාහරී', 'වේගයෙන් ගෙදරටම සිල්ලර බඩු'],
      heroLabel: 'සිල්ලර බඩු ගෙන එන Blynk රයිඩරයා',
    },
    ta: {
      headlines: ['புத்தம் புதியவை உங்கள் வாசலுக்கே', 'நிமிடங்களில் டெலிவரி', 'மளிகைப் பொருட்கள் வேகமாக வீடு தேடி'],
      heroLabel: 'மளிகைப் பொருட்களைக் கொண்டுவரும் Blynk ரைடர்',
    },
  },
  'ui.LOGIN',
);

/** The "Order placed!" screen (src/app/placed.tsx). The stage lines take turns under the headline. */
export const PLACED = localized(
  {
    title: 'Order placed!',
    packing: 'Your Blynk order is being packed',
    scheduled: "We'll deliver at the time you picked",
    basket: '🧺',
    stagesNow: ['Packing your items…', 'A rider will pick it up soon'],
    stagesScheduled: ["We'll pack it fresh before your time", 'A rider will bring it to your door'],
    orderNumber: 'Order number',
    deliveryTime: 'Delivery time',
    forWhom: 'For',
    amount: 'Amount',
    track: 'Track order',
    home: 'Back to home',
  } as const,
  {
    si: {
      title: 'ඇණවුම ලැබුණා!',
      packing: 'ඔබේ Blynk ඇණවුම ඇසුරුම් කරමින්',
      scheduled: 'ඔබ තෝරාගත් වේලාවට අපි බෙදාහරිමු',
      basket: '🧺',
      stagesNow: ['ඔබේ භාණ්ඩ ඇසුරුම් කරමින්…', 'රයිඩර් කෙනෙක් ඉක්මනින් ගෙන යයි'],
      stagesScheduled: ['ඔබේ වේලාවට පෙර අලුතින් ඇසුරුම් කරමු', 'රයිඩර් කෙනෙක් දොරටුවටම ගෙන එයි'],
      orderNumber: 'ඇණවුම් අංකය',
      deliveryTime: 'බෙදාහැරීමේ වේලාව',
      forWhom: 'සඳහා',
      amount: 'මුදල',
      track: 'ඇණවුම සොයා බලන්න',
      home: 'මුල් පිටුවට',
    },
    ta: {
      title: 'ஆர்டர் பெறப்பட்டது!',
      packing: 'உங்கள் Blynk ஆர்டர் பேக் செய்யப்படுகிறது',
      scheduled: 'நீங்கள் தேர்ந்தெடுத்த நேரத்தில் டெலிவரி செய்வோம்',
      basket: '🧺',
      stagesNow: ['உங்கள் பொருட்களை பேக் செய்கிறோம்…', 'ரைடர் விரைவில் எடுத்துச் செல்வார்'],
      stagesScheduled: ['உங்கள் நேரத்துக்கு முன் புதிதாக பேக் செய்வோம்', 'ரைடர் உங்கள் வாசலுக்கே கொண்டு வருவார்'],
      orderNumber: 'ஆர்டர் எண்',
      deliveryTime: 'டெலிவரி நேரம்',
      forWhom: 'பெறுபவர்',
      amount: 'தொகை',
      track: 'ஆர்டரைக் கண்காணி',
      home: 'முகப்புக்குச் செல்',
    },
  },
  'ui.PLACED',
);

/**
 * The one small line under a product tile's price that rolls between the struck reference and
 * the saving (src/components/PriceRoll.tsx, decided in src/blynk/lib/priceRoll.ts). True facts
 * only: the saving against the struck regular price / MRP the tile already shows.
 */
export const PRICE_ROLL = localized(
  {
    save: (amount: string) => `Save ${amount}`,
    /** Added after the saving when the struck reference is the MRP and the tile has room. */
    vsMrp: ' vs MRP',
    /** A category offer's saving ("5% off", as the aisle's "5% off everything here"). */
    pctOff: (pct: number) => `${pct}% off`,
    /** Screen reader: the struck reference. */
    mrp: (amount: string) => `MRP ${amount}`,
    regular: (amount: string) => `Regular price ${amount}`,
  } as const,
  {
    si: {
      save: (amount: string) => `${amount} ඉතිරියි`,
      vsMrp: ' MRP ට වඩා',
      pctOff: (pct: number) => `${pct}% වට්ටම්`,
      mrp: (amount: string) => `උපරිම සිල්ලර මිල ${amount}`,
      regular: (amount: string) => `සාමාන්‍ය මිල ${amount}`,
    },
    ta: {
      save: (amount: string) => `${amount} சேமிப்பு`,
      vsMrp: ' MRP ஐ விட',
      pctOff: (pct: number) => `${pct}% தள்ளுபடி`,
      mrp: (amount: string) => `அதிகபட்ச சில்லறை விலை ${amount}`,
      regular: (amount: string) => `வழக்கமான விலை ${amount}`,
    },
  },
  'ui.PRICE_ROLL',
);

/** The end of Home's list: two quiet lines over the rider bouncing on a trampoline (src/components/HomeFooter.tsx). */
export const HOME_FOOTER = localized(
  {
    small: 'Fresh groceries delivered',
    large: 'to your door',
    /** Read by a screen reader for the (decorative) picture. */
    label: 'Fresh groceries delivered to your door',
  } as const,
  {
    si: {
      small: 'නැවුම් සිල්ලර බඩු බෙදාහරිනවා',
      large: 'ඔබේ දොරටුවටම',
      label: 'නැවුම් සිල්ලර බඩු ඔබේ දොරටුවටම බෙදාහරිනවා',
    },
    ta: {
      small: 'புதிய மளிகைப் பொருட்கள் டெலிவரி',
      large: 'உங்கள் வாசலுக்கே',
      label: 'புதிய மளிகைப் பொருட்கள் உங்கள் வாசலுக்கே டெலிவரி',
    },
  },
  'ui.HOME_FOOTER',
);

/** Profile's hero (src/components/TabHero.tsx ProfileHero): a guest's invitation, or the greeting. */
export const PROFILE_HERO = localized(
  {
    title: 'My account',
    guestSub: 'Log in to see your orders, addresses and points',
    login: 'Log in',
    hi: (first: string) => `Hi, ${first}`,
    hiNoName: 'Hi there',
    /** Screen reader: the (decorative) rider picture is skipped; this reads for the avatar. */
    avatar: (name: string) => `${name}'s account`,
    pointsUnit: (n: number) => (n === 1 ? 'Blynk Point' : 'Blynk Points'),
    /** The quick chips under the greeting. */
    chips: { orders: 'Orders', addresses: 'Addresses', points: 'Points' },
  } as const,
  {
    si: {
      title: 'මගේ ගිණුම',
      guestSub: 'ඔබේ ඇණවුම්, ලිපිනයන් සහ ලකුණු බැලීමට ලොග් වන්න',
      login: 'ලොග් වන්න',
      hi: (first: string) => `ආයුබෝවන්, ${first}`,
      hiNoName: 'ආයුබෝවන්',
      avatar: (name: string) => `${name} ගේ ගිණුම`,
      pointsUnit: (n: number) => (n === 1 ? 'Blynk ලකුණ' : 'Blynk ලකුණු'),
      chips: { orders: 'ඇණවුම්', addresses: 'ලිපිනයන්', points: 'ලකුණු' },
    },
    ta: {
      title: 'எனது கணக்கு',
      guestSub: 'உங்கள் ஆர்டர்கள், முகவரிகள், புள்ளிகளைப் பார்க்க உள்நுழையவும்',
      login: 'உள்நுழை',
      hi: (first: string) => `வணக்கம், ${first}`,
      hiNoName: 'வணக்கம்',
      avatar: (name: string) => `${name} இன் கணக்கு`,
      pointsUnit: (n: number) => (n === 1 ? 'Blynk புள்ளி' : 'Blynk புள்ளிகள்'),
      chips: { orders: 'ஆர்டர்கள்', addresses: 'முகவரிகள்', points: 'புள்ளிகள்' },
    },
  },
  'ui.PROFILE_HERO',
);

/** Help's hero (src/components/TabHero.tsx HelpHero) and its contact rows. */
export const HELP_HERO = localized(
  {
    title: 'Need a hand?',
    sub: 'Answers to the questions we get most.',
    openNow: (hours: string) => `We're open now · ${hours}`,
    openNowShort: "We're open now",
    opensAt: (time: string) => `Opens at ${time}`,
    opensTomorrow: (time: string) => `Opens tomorrow at ${time}`,
    opensOn: (weekday: string, time: string) => `Opens ${weekday} at ${time}`,
    closedNow: 'Closed right now',
    call: 'Call us',
    whatsApp: 'WhatsApp us',
    feedback: 'Send feedback',
    /** Where the dialler cannot open: the number goes to the clipboard, never onto the screen. */
    copied: 'Number copied',
    /** Screen reader: the pulsing dot beside Call / WhatsApp while the store is open. */
    liveHint: 'The store is open now',
  } as const,
  {
    si: {
      title: 'උදව්වක් ඕනෙද?',
      sub: 'අපෙන් බොහෝ විට අසන ප්‍රශ්නවලට පිළිතුරු.',
      openNow: (hours: string) => `අපි දැන් විවෘතයි · ${hours}`,
      openNowShort: 'අපි දැන් විවෘතයි',
      opensAt: (time: string) => `${time} ට විවෘත වේ`,
      opensTomorrow: (time: string) => `හෙට ${time} ට විවෘත වේ`,
      opensOn: (weekday: string, time: string) => `${weekday} ${time} ට විවෘත වේ`,
      closedNow: 'දැන් වසා ඇත',
      call: 'අපට අමතන්න',
      whatsApp: 'WhatsApp කරන්න',
      feedback: 'ප්‍රතිචාර එවන්න',
      copied: 'අංකය පිටපත් කළා',
      liveHint: 'සාප්පුව දැන් විවෘතයි',
    },
    ta: {
      title: 'உதவி வேண்டுமா?',
      sub: 'அடிக்கடி கேட்கப்படும் கேள்விகளுக்கான பதில்கள்.',
      openNow: (hours: string) => `நாங்கள் இப்போது திறந்திருக்கிறோம் · ${hours}`,
      openNowShort: 'நாங்கள் இப்போது திறந்திருக்கிறோம்',
      opensAt: (time: string) => `${time} க்குத் திறக்கும்`,
      opensTomorrow: (time: string) => `நாளை ${time} க்குத் திறக்கும்`,
      opensOn: (weekday: string, time: string) => `${weekday} ${time} க்குத் திறக்கும்`,
      closedNow: 'இப்போது மூடப்பட்டுள்ளது',
      call: 'எங்களை அழையுங்கள்',
      whatsApp: 'WhatsApp செய்யுங்கள்',
      feedback: 'கருத்தை அனுப்புங்கள்',
      copied: 'எண் நகலெடுக்கப்பட்டது',
      liveHint: 'கடை இப்போது திறந்திருக்கிறது',
    },
  },
  'ui.HELP_HERO',
);
