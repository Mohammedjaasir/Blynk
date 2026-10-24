import { localized } from '@/blynk/i18n/localized';

/*
 * The words of the browse screens that were written inline (categories, a category, search, the
 * product page, the old aisle screen) in English, Sinhala and Tamil. Screens read them while
 * rendering (never at module load): the language can change while the app is open.
 */

/** Errors the catalogue code writes itself (a server's own message stays as the server sent it). */
export const BROWSE_ERRORS = localized(
  {
    generic: 'Something went wrong. Please try again.',
    malformed: 'Malformed product response',
  } as const,
  {
    si: {
      generic: 'යම් දෙයක් වැරදුණා. කරුණාකර නැවත උත්සාහ කරන්න.',
      malformed: 'භාණ්ඩයේ තොරතුරු කියවීමට නොහැකි විය',
    },
    ta: {
      generic: 'ஏதோ தவறு நடந்துவிட்டது. மீண்டும் முயற்சிக்கவும்.',
      malformed: 'பொருளின் தகவலைப் படிக்க முடியவில்லை',
    },
  },
  'catalog.BROWSE_ERRORS',
);

/** The categories list and a category's own screen. */
export const CATEGORY_SCREEN = localized(
  {
    back: 'Back',
    offerLine: (percent: number | string) => `${percent}% off everything here`,
    /** "3 items in Milk": the count of the open sub-category. */
    countIn: (n: number, name: string) => `${n} item${n === 1 ? '' : 's'} in ${name}`,
    /** Screen-reader name of a sub-category chip. */
    subIn: (sub: string, category: string) => `${sub}, in ${category}`,
    preview: 'Categories open with the live shop. This is a preview.',
  } as const,
  {
    si: {
      back: 'ආපසු',
      offerLine: (percent: number | string) => `මෙහි සියල්ලටම ${percent}% වට්ටමක්`,
      countIn: (n: number, name: string) => `${name} හි භාණ්ඩ ${n}ක්`,
      subIn: (sub: string, category: string) => `${category} හි ${sub}`,
      preview: 'සජීවී සාප්පුව සමඟ කාණ්ඩ විවෘත වේ. මෙය පෙරදසුනකි.',
    },
    ta: {
      back: 'பின்',
      offerLine: (percent: number | string) => `இங்கே எல்லாவற்றிலும் ${percent}% தள்ளுபடி`,
      countIn: (n: number, name: string) => `${name} இல் ${n} பொருட்கள்`,
      subIn: (sub: string, category: string) => `${category} இல் ${sub}`,
      preview: 'கடை இயங்கத் தொடங்கியதும் வகைகள் திறக்கும். இது ஒரு முன்னோட்டம்.',
    },
  },
  'catalog.CATEGORY_SCREEN',
);

/** Search. */
export const SEARCH = localized(
  {
    searchIn: (name: string) => `Search in ${name}`,
    /** "Search for '" + the rolling product name + "'" (two parts: the verb may come last). */
    forOpen: "Search for '",
    forClose: "'",
    hint: 'Search groceries & essentials',
    a11yDefault: 'Search groceries and essentials',
    clear: 'Clear search',
    all: 'All',
    searchFor: (term: string) => `Search for ${term}`,
    recent: 'Recent searches',
    clearRecent: 'Clear',
    browse: 'Browse categories',
    whatLooking: 'What are you looking for?',
    demoSub: 'Search opens here once the shop is live.',
    emptySub: 'Search for groceries, snacks and everyday essentials.',
    soonTitle: 'Search opens soon',
    soonSub: 'This is a preview.',
    failedTitle: "Couldn't load results",
    tryAgain: 'Try again',
    failed: 'Search failed. Please try again.',
    /** `aisle` is the category the search is limited to, or null. */
    noResults: (term: string, aisle: string | null) => `No results for "${term}"${aisle ? ` in ${aisle}` : ''}`,
    checkSpelling: 'Check the spelling or browse categories.',
    resultsCount: (total: number, aisle: string | null) => `Search results · ${total} ${total === 1 ? 'item' : 'items'}${aisle ? ` in ${aisle}` : ''}`,
    loading: 'Loading…',
    more: 'Show more results',
  } as const,
  {
    si: {
      searchIn: (name: string) => `${name} තුළ සොයන්න`,
      forOpen: "'",
      forClose: "' සොයන්න",
      hint: 'සිල්ලර බඩු සහ අත්‍යවශ්‍ය දේ සොයන්න',
      a11yDefault: 'සිල්ලර බඩු සහ අත්‍යවශ්‍ය දේ සොයන්න',
      clear: 'සෙවුම මකන්න',
      all: 'සියල්ල',
      searchFor: (term: string) => `${term} සොයන්න`,
      recent: 'මෑත සෙවුම්',
      clearRecent: 'මකන්න',
      browse: 'කාණ්ඩ බලන්න',
      whatLooking: 'ඔබ සොයන්නේ මොනවාද?',
      demoSub: 'සාප්පුව සජීවී වූ පසු සෙවුම මෙහි විවෘත වේ.',
      emptySub: 'සිල්ලර බඩු, කෙටි කෑම සහ එදිනෙදා අවශ්‍ය දේ සොයන්න.',
      soonTitle: 'සෙවුම ඉක්මනින් විවෘත වේ',
      soonSub: 'මෙය පෙරදසුනකි.',
      failedTitle: 'ප්‍රතිඵල පූරණය කළ නොහැකි විය',
      tryAgain: 'නැවත උත්සාහ කරන්න',
      failed: 'සෙවුම අසාර්ථක විය. කරුණාකර නැවත උත්සාහ කරන්න.',
      noResults: (term: string, aisle: string | null) => `"${term}" සඳහා ප්‍රතිඵල නැහැ${aisle ? ` (${aisle} තුළ)` : ''}`,
      checkSpelling: 'අකුරු නිවැරදිදැයි බලන්න, නැත්නම් කාණ්ඩ බලන්න.',
      resultsCount: (total: number, aisle: string | null) => `සෙවුම් ප්‍රතිඵල · භාණ්ඩ ${total}ක්${aisle ? ` (${aisle} තුළ)` : ''}`,
      loading: 'පූරණය වෙමින්…',
      more: 'තවත් ප්‍රතිඵල පෙන්වන්න',
    },
    ta: {
      searchIn: (name: string) => `${name} இல் தேடு`,
      forOpen: "'",
      forClose: "' தேடுங்கள்",
      hint: 'மளிகை மற்றும் அத்தியாவசியப் பொருட்களைத் தேடுங்கள்',
      a11yDefault: 'மளிகை மற்றும் அத்தியாவசியப் பொருட்களைத் தேடுங்கள்',
      clear: 'தேடலை அழி',
      all: 'அனைத்தும்',
      searchFor: (term: string) => `${term} தேடு`,
      recent: 'சமீபத்திய தேடல்கள்',
      clearRecent: 'அழி',
      browse: 'வகைகளைப் பாருங்கள்',
      whatLooking: 'நீங்கள் எதைத் தேடுகிறீர்கள்?',
      demoSub: 'கடை இயங்கத் தொடங்கியதும் தேடல் இங்கே திறக்கும்.',
      emptySub: 'மளிகை, தின்பண்டங்கள், அன்றாடத் தேவைப் பொருட்களைத் தேடுங்கள்.',
      soonTitle: 'தேடல் விரைவில் திறக்கும்',
      soonSub: 'இது ஒரு முன்னோட்டம்.',
      failedTitle: 'முடிவுகளை ஏற்ற முடியவில்லை',
      tryAgain: 'மீண்டும் முயற்சிக்கவும்',
      failed: 'தேடல் தோல்வியடைந்தது. மீண்டும் முயற்சிக்கவும்.',
      noResults: (term: string, aisle: string | null) => `"${term}" க்கு முடிவுகள் இல்லை${aisle ? ` (${aisle} இல்)` : ''}`,
      checkSpelling: 'எழுத்துப்பிழை உள்ளதா எனப் பாருங்கள், அல்லது வகைகளைப் பாருங்கள்.',
      resultsCount: (total: number, aisle: string | null) => `தேடல் முடிவுகள் · ${total} பொருட்கள்${aisle ? ` (${aisle} இல்)` : ''}`,
      loading: 'ஏற்றப்படுகிறது…',
      more: 'மேலும் முடிவுகளைக் காட்டு',
    },
  },
  'catalog.SEARCH',
);

/** The product page. */
export const PRODUCT_PAGE = localized(
  {
    shareA11y: 'Share this product',
    linkCopied: 'Link copied',
    goneTitle: 'Product no longer available',
    goneMessage: 'This item has been removed from the store.',
    goBack: 'Go back',
    couldntLoad: "Couldn't load this product",
    tryAgain: 'Try again',
    previewTitle: 'Product preview',
    previewMessage: 'Products open here once the shop is live.',
    loading: 'Loading product',
    save: (amount: string) => `Save ${amount}`,
    available: 'Available',
    offerEnds: (when: string) => `Offer ends ${when}`,
    about: 'About this product',
    details: 'Product details',
    combos: 'Combo packs with this item',
    loadingSizes: 'Loading sizes',
    /** `what` is the quantity, or "2 × 100 g" for a size. */
    inCart: (what: number | string) => `✓ ${what} in cart`,
    removeOne: 'Remove one',
    addOne: 'Add one',
    viewCart: 'View cart',
  } as const,
  {
    si: {
      shareA11y: 'මෙම භාණ්ඩය බෙදාගන්න',
      linkCopied: 'සබැඳිය පිටපත් කළා',
      goneTitle: 'භාණ්ඩය තවදුරටත් නැහැ',
      goneMessage: 'මෙම භාණ්ඩය සාප්පුවෙන් ඉවත් කර ඇත.',
      goBack: 'ආපසු යන්න',
      couldntLoad: 'මෙම භාණ්ඩය පූරණය කළ නොහැකි විය',
      tryAgain: 'නැවත උත්සාහ කරන්න',
      previewTitle: 'භාණ්ඩ පෙරදසුන',
      previewMessage: 'සාප්පුව සජීවී වූ පසු භාණ්ඩ මෙහි විවෘත වේ.',
      loading: 'භාණ්ඩය පූරණය වෙමින්',
      save: (amount: string) => `${amount} ඉතිරියි`,
      available: 'ලබාගත හැක',
      offerEnds: (when: string) => `දීමනාව අවසන් වන්නේ ${when}`,
      about: 'මෙම භාණ්ඩය ගැන',
      details: 'භාණ්ඩ විස්තර',
      combos: 'මෙම භාණ්ඩය අඩංගු කොම්බෝ ඇසුරුම්',
      loadingSizes: 'ප්‍රමාණ පූරණය වෙමින්',
      inCart: (what: number | string) => `✓ කරත්තයේ ${what}`,
      removeOne: 'එකක් අඩු කරන්න',
      addOne: 'එකක් එකතු කරන්න',
      viewCart: 'කරත්තය බලන්න',
    },
    ta: {
      shareA11y: 'இந்தப் பொருளைப் பகிருங்கள்',
      linkCopied: 'இணைப்பு நகலெடுக்கப்பட்டது',
      goneTitle: 'பொருள் இனி கிடைக்காது',
      goneMessage: 'இந்தப் பொருள் கடையிலிருந்து நீக்கப்பட்டுள்ளது.',
      goBack: 'திரும்பிச் செல்',
      couldntLoad: 'இந்தப் பொருளை ஏற்ற முடியவில்லை',
      tryAgain: 'மீண்டும் முயற்சிக்கவும்',
      previewTitle: 'பொருள் முன்னோட்டம்',
      previewMessage: 'கடை இயங்கத் தொடங்கியதும் பொருட்கள் இங்கே திறக்கும்.',
      loading: 'பொருள் ஏற்றப்படுகிறது',
      save: (amount: string) => `${amount} சேமிப்பு`,
      available: 'கிடைக்கும்',
      offerEnds: (when: string) => `ஆஃபர் ${when} முடிகிறது`,
      about: 'இந்தப் பொருளைப் பற்றி',
      details: 'பொருள் விவரங்கள்',
      combos: 'இந்தப் பொருள் உள்ள காம்போ பேக்குகள்',
      loadingSizes: 'அளவுகள் ஏற்றப்படுகின்றன',
      inCart: (what: number | string) => `✓ கார்ட்டில் ${what}`,
      removeOne: 'ஒன்றைக் குறை',
      addOne: 'ஒன்றைக் கூட்டு',
      viewCart: 'கார்ட்டைப் பார்',
    },
  },
  'catalog.PRODUCT_PAGE',
);

/** The "Product details" row names. */
export const DETAIL_LABELS = localized(
  { unit: 'Unit', pack: 'Pack', category: 'Category' } as const,
  {
    si: { unit: 'ඒකකය', pack: 'ඇසුරුම', category: 'කාණ්ඩය' },
    ta: { unit: 'அலகு', pack: 'பேக்', category: 'வகை' },
  },
  'catalog.DETAIL_LABELS',
);

/** The "Notify me" button and its hint (back-in-stock alert). */
export const NOTIFY_ME = localized(
  {
    label: "Notify me when it's back",
    onLabel: "We'll tell you when it's back",
    onHint: 'Tap again if you no longer want the alert.',
  } as const,
  {
    si: {
      label: 'නැවත ලැබුණාම මට දන්වන්න',
      onLabel: 'නැවත ලැබුණාම අපි දන්වන්නම්',
      onHint: 'ඇඟවීම අවශ්‍ය නැත්නම් නැවත ඔබන්න.',
    },
    ta: {
      label: 'மீண்டும் வந்ததும் எனக்குத் தெரிவியுங்கள்',
      onLabel: 'மீண்டும் வந்ததும் நாங்கள் தெரிவிப்போம்',
      onHint: 'அறிவிப்பு வேண்டாம் என்றால் மீண்டும் தட்டுங்கள்.',
    },
  },
  'catalog.NOTIFY_ME',
);

/** "Sold by <shop>" under a seller's product. */
export const SOLD_BY = localized(
  { by: (shop: string) => `Sold by ${shop}` } as const,
  {
    si: { by: (shop: string) => `විකුණන්නේ ${shop}` },
    ta: { by: (shop: string) => `${shop} விற்பனை செய்கிறது` },
  },
  'catalog.SOLD_BY',
);

/** The old aisle ("store") screen. */
export const AISLE = localized(
  {
    notAvailable: "This aisle isn't available",
    goToShop: 'Go to shop',
    tryAgain: 'Try again',
    searchProducts: 'Search for products',
    noMatch: 'Nothing here matches these filters.',
    stocking: "We're stocking this aisle. Check back shortly.",
    searchIn: (name: string) => `Search in ${name}`,
    moreFrom: (name: string) => `More from ${name}`,
    shareMessage: (name: string) => `${name} on Blynk`,
  } as const,
  {
    si: {
      notAvailable: 'මෙම අංශය දැනට නැහැ',
      goToShop: 'සාප්පුවට යන්න',
      tryAgain: 'නැවත උත්සාහ කරන්න',
      searchProducts: 'භාණ්ඩ සොයන්න',
      noMatch: 'මෙම පෙරහන්වලට ගැළපෙන කිසිවක් නැහැ.',
      stocking: 'අපි මෙම අංශයට බඩු තොග කරමින් සිටිනවා. ටික වෙලාවකින් නැවත බලන්න.',
      searchIn: (name: string) => `${name} තුළ සොයන්න`,
      moreFrom: (name: string) => `${name} වෙතින් තවත්`,
      shareMessage: (name: string) => `Blynk හි ${name}`,
    },
    ta: {
      notAvailable: 'இந்தப் பிரிவு தற்போது இல்லை',
      goToShop: 'கடைக்குச் செல்',
      tryAgain: 'மீண்டும் முயற்சிக்கவும்',
      searchProducts: 'பொருட்களைத் தேடு',
      noMatch: 'இந்த வடிகட்டிகளுக்குப் பொருந்தும் எதுவும் இல்லை.',
      stocking: 'இந்தப் பிரிவுக்குப் பொருட்களை நிரப்பிக் கொண்டிருக்கிறோம். சிறிது நேரத்தில் மீண்டும் பாருங்கள்.',
      searchIn: (name: string) => `${name} இல் தேடு`,
      moreFrom: (name: string) => `${name} இலிருந்து மேலும்`,
      shareMessage: (name: string) => `Blynk இல் ${name}`,
    },
  },
  'catalog.AISLE',
);
