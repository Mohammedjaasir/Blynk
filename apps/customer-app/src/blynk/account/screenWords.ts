import { localized } from '@/blynk/i18n/localized';

/*
 * The words of the Profile (account) tab, Help, About you, SMS & offers, Send feedback, About us
 * and the not-found page. Sinhala and Tamil: docs/superpowers/plans/2026-10-25-translations.md.
 * Read them while rendering, never at module load.
 */

/** Words several account screens share. */
export const ACCOUNT_COMMON = localized(
  {
    close: 'Close',
    tryAgain: 'Try again',
    save: 'Save',
    cancel: 'Cancel',
  } as const,
  {
    si: { close: 'වසන්න', tryAgain: 'නැවත උත්සාහ කරන්න', save: 'සුරකින්න', cancel: 'අවලංගු කරන්න' },
    ta: { close: 'மூடு', tryAgain: 'மீண்டும் முயற்சி', save: 'சேமி', cancel: 'ரத்து செய்' },
  },
  'account.ACCOUNT_COMMON',
);

/** The Profile tab (src/app/(tabs)/account.tsx). */
export const ACCOUNT_SCREEN = localized(
  {
    preview: 'Your account opens with ordering. This is a preview.',
    aboutYou: 'About you',
    aboutYouSub: 'Name, email and birthday',
    points: 'Blynk Points',
    refer: 'Refer a friend',
    referSub: 'Invite friends with your code',
    orders: 'Your orders',
    ordersSub: 'Track, reorder or get help',
    addresses: 'Address book',
    addressesSub: 'Home, work and anywhere else',
    sms: 'SMS & offers',
    smsIn: (language: string) => `SMS in ${language}`,
    smsPick: 'Pick a language for your SMS',
    offersOn: 'offers on',
    offersOff: 'offers off',
    smsDefault: 'SMS language and offers',
    doctors: 'Channel doctors',
    doctorsSub: 'Book an appointment with a doctor',
    appointments: 'My appointments',
    updates: 'Order updates',
    updatesAllow: 'Allow',
    updatesOn: 'On for this phone',
    updatesBlocked: 'Blocked in your browser settings',
    updatesAsk: 'Get a note when your order moves',
    updatesBlockedNotice: 'Notifications are blocked. Allow them for Blynk in your browser settings.',
    help: 'Help & support',
    helpSub: 'Call or WhatsApp the store',
    feedback: 'Send feedback',
    feedbackSub: 'Tell us what you think',
    share: 'Share the app',
    shareSub: 'Spread the word',
    shareMessage: (url: string) => `Order groceries on Blynk: ${url}`,
    linkCopied: 'Link copied',
    about: 'About us',
    aboutSub: 'Who we are and what we promise',
    logOut: 'Log out',
    logOutTitle: 'Log out?',
    logOutSub: 'You can browse without an account.',
    danger: 'Danger zone',
    deleteAccount: 'Delete account',
  } as const,
  {
    si: {
      preview: 'ඔබේ ගිණුම ඇණවුම් සමඟ විවෘත වේ. මෙය පෙරදසුනකි.',
      aboutYou: 'ඔබ ගැන',
      aboutYouSub: 'නම, ඊමේල් සහ උපන්දිනය',
      points: 'Blynk ලකුණු',
      refer: 'යාළුවෙකුට යොමු කරන්න',
      referSub: 'ඔබේ කේතයෙන් යාළුවන්ට ආරාධනා කරන්න',
      orders: 'ඔබේ ඇණවුම්',
      ordersSub: 'සොයන්න, නැවත ඇණවුම් කරන්න, උදව් ගන්න',
      addresses: 'ලිපින පොත',
      addressesSub: 'ගෙදර, වැඩ කරන තැන සහ වෙනත් තැන්',
      sms: 'SMS සහ දීමනා',
      smsIn: (language: string) => `SMS ${language} භාෂාවෙන්`,
      smsPick: 'SMS සඳහා භාෂාවක් තෝරන්න',
      offersOn: 'දීමනා ක්‍රියාත්මකයි',
      offersOff: 'දීමනා නැහැ',
      smsDefault: 'SMS භාෂාව සහ දීමනා',
      doctors: 'වෛද්‍යවරුන් හමුවීම',
      doctorsSub: 'වෛද්‍යවරයෙකු හමුවීමට වේලාවක් වෙන් කරගන්න',
      appointments: 'මගේ වේලා වෙන්කිරීම්',
      updates: 'ඇණවුම් යාවත්කාලීන',
      updatesAllow: 'ඉඩ දෙන්න',
      updatesOn: 'මේ දුරකථනයට ක්‍රියාත්මකයි',
      updatesBlocked: 'ඔබේ බ්‍රවුසර සැකසුම්වල අවහිර කර ඇත',
      updatesAsk: 'ඇණවුම ඉදිරියට යන විට දැනුම් දෙනවා',
      updatesBlockedNotice: 'දැනුම්දීම් අවහිර කර ඇත. ඔබේ බ්‍රවුසර සැකසුම්වල Blynk සඳහා ඒවාට ඉඩ දෙන්න.',
      help: 'උදව් සහ සහාය',
      helpSub: 'සාප්පුවට ඇමතුමක් හෝ WhatsApp පණිවිඩයක්',
      feedback: 'ප්‍රතිපෝෂණ එවන්න',
      feedbackSub: 'ඔබට හිතෙන දේ අපට කියන්න',
      share: 'ඇප් එක බෙදාගන්න',
      shareSub: 'අනෙක් අයටත් කියන්න',
      shareMessage: (url: string) => `Blynk හරහා සිල්ලර බඩු ඇණවුම් කරන්න: ${url}`,
      linkCopied: 'ලින්ක් එක පිටපත් කළා',
      about: 'අප ගැන',
      aboutSub: 'අපි කවුද, අපි පොරොන්දු වෙන්නේ මොනවාද',
      logOut: 'ඉවත් වන්න',
      logOutTitle: 'ඉවත් වෙනවාද?',
      logOutSub: 'ගිණුමක් නැතිවත් ඔබට පිරික්සිය හැක.',
      danger: 'අවදානම් කලාපය',
      deleteAccount: 'ගිණුම මකන්න',
    },
    ta: {
      preview: 'உங்கள் கணக்கு ஆர்டர் செய்யும்போது திறக்கும். இது ஒரு முன்னோட்டம்.',
      aboutYou: 'உங்களைப் பற்றி',
      aboutYouSub: 'பெயர், மின்னஞ்சல் மற்றும் பிறந்தநாள்',
      points: 'Blynk புள்ளிகள்',
      refer: 'நண்பரைப் பரிந்துரைக்க',
      referSub: 'உங்கள் குறியீட்டுடன் நண்பர்களை அழையுங்கள்',
      orders: 'உங்கள் ஆர்டர்கள்',
      ordersSub: 'கண்காணிக்க, மீண்டும் ஆர்டர் செய்ய, உதவி பெற',
      addresses: 'முகவரிப் புத்தகம்',
      addressesSub: 'வீடு, வேலை மற்றும் வேறு எங்கும்',
      sms: 'SMS மற்றும் சலுகைகள்',
      smsIn: (language: string) => `SMS ${language} மொழியில்`,
      smsPick: 'SMS க்கு ஒரு மொழியைத் தேர்ந்தெடுங்கள்',
      offersOn: 'சலுகைகள் இயக்கத்தில்',
      offersOff: 'சலுகைகள் இல்லை',
      smsDefault: 'SMS மொழி மற்றும் சலுகைகள்',
      doctors: 'டாக்டர்களைச் சந்திக்க',
      doctorsSub: 'டாக்டரைச் சந்திக்க நேரம் முன்பதிவு செய்யுங்கள்',
      appointments: 'என் முன்பதிவுகள்',
      updates: 'ஆர்டர் அறிவிப்புகள்',
      updatesAllow: 'அனுமதி',
      updatesOn: 'இந்த போனில் இயக்கத்தில்',
      updatesBlocked: 'உங்கள் பிரௌசர் அமைப்புகளில் தடுக்கப்பட்டுள்ளது',
      updatesAsk: 'ஆர்டர் நகரும்போது அறிவிப்பு பெறுங்கள்',
      updatesBlockedNotice: 'அறிவிப்புகள் தடுக்கப்பட்டுள்ளன. உங்கள் பிரௌசர் அமைப்புகளில் Blynk க்கு அனுமதி கொடுங்கள்.',
      help: 'உதவி மற்றும் ஆதரவு',
      helpSub: 'கடைக்கு அழையுங்கள் அல்லது WhatsApp செய்யுங்கள்',
      feedback: 'கருத்து அனுப்புங்கள்',
      feedbackSub: 'உங்கள் எண்ணத்தைச் சொல்லுங்கள்',
      share: 'ஆப்பைப் பகிருங்கள்',
      shareSub: 'மற்றவர்களுக்கும் சொல்லுங்கள்',
      shareMessage: (url: string) => `Blynk இல் மளிகைப் பொருட்களை ஆர்டர் செய்யுங்கள்: ${url}`,
      linkCopied: 'லிங்க் நகலெடுக்கப்பட்டது',
      about: 'எங்களைப் பற்றி',
      aboutSub: 'நாங்கள் யார், என்ன உறுதி அளிக்கிறோம்',
      logOut: 'வெளியேறு',
      logOutTitle: 'வெளியேறவா?',
      logOutSub: 'கணக்கு இல்லாமலும் நீங்கள் பார்வையிடலாம்.',
      danger: 'ஆபத்து பகுதி',
      deleteAccount: 'கணக்கை நீக்கு',
    },
  },
  'account.ACCOUNT_SCREEN',
);

/** The Help tab (src/app/(tabs)/help.tsx). */
export const HELP_SCREEN = localized(
  {
    store: 'Our store',
    deliveries: (hours: string) => `Deliveries go out ${hours}.`,
  } as const,
  {
    si: {
      store: 'අපේ සාප්පුව',
      deliveries: (hours: string) => `බෙදාහැරීම් සිදු කරන්නේ ${hours}.`,
    },
    ta: {
      store: 'எங்கள் கடை',
      deliveries: (hours: string) => `டெலிவரி நடைபெறும் நேரம்: ${hours}.`,
    },
  },
  'account.HELP_SCREEN',
);

/** About us (src/app/about.tsx). */
export const ABOUT_SCREEN = localized(
  {
    title: 'About us',
    version: (v: string) => `Version ${v}`,
    description: (town: string, online: boolean) =>
      `Blynk delivers freshly sourced groceries and quality essentials in ${town}. You place the order in the app and pay in cash when it arrives${online ? ', or online by card or wallet' : ''}.`,
    deliveries: (hours: string) => ` Deliveries go out ${hours}.`,
  } as const,
  {
    si: {
      title: 'අප ගැන',
      version: (v: string) => `අනුවාදය ${v}`,
      description: (town: string, online: boolean) =>
        `Blynk ${town} හි නැවුම් සිල්ලර බඩු සහ ගුණාත්මක අත්‍යවශ්‍ය භාණ්ඩ ඔබේ ගෙදරටම ගෙනැවිත් දෙනවා. ඔබ ඇප් එකෙන් ඇණවුම් කර, ඒවා ලැබෙන විට මුදලින් ගෙවන්න${online ? ', නැත්නම් කාඩ්පතෙන් හෝ පසුම්බියෙන් ඔන්ලයින් ගෙවන්න' : ''}.`,
      deliveries: (hours: string) => ` බෙදාහැරීම් සිදු කරන්නේ ${hours}.`,
    },
    ta: {
      title: 'எங்களைப் பற்றி',
      version: (v: string) => `பதிப்பு ${v}`,
      description: (town: string, online: boolean) =>
        `Blynk ${town} பகுதியில் புதிய மளிகைப் பொருட்களையும் தரமான அத்தியாவசியப் பொருட்களையும் உங்கள் வீட்டுக்கே கொண்டு வருகிறது. ஆப்பில் ஆர்டர் செய்து, பொருட்கள் வந்ததும் பணமாகச் செலுத்துங்கள்${online ? ', அல்லது கார்டு அல்லது வாலெட் மூலம் ஆன்லைனில் செலுத்துங்கள்' : ''}.`,
      deliveries: (hours: string) => ` டெலிவரி நடைபெறும் நேரம்: ${hours}.`,
    },
  },
  'account.ABOUT_SCREEN',
);

/** The page for an address this app has no screen for (src/app/+not-found.tsx). */
export const NOT_FOUND_WORDS = localized(
  {
    title: 'Not found',
    heading: "This page isn't available",
    message: 'It may have moved or no longer exists.',
    action: 'Go to the shop',
  } as const,
  {
    si: {
      title: 'හමු වුණේ නැහැ',
      heading: 'මෙම පිටුව නැහැ',
      message: 'එය වෙනත් තැනකට ගෙන ගොස් හෝ තවදුරටත් නොතිබිය හැක.',
      action: 'සාප්පුවට යන්න',
    },
    ta: {
      title: 'கிடைக்கவில்லை',
      heading: 'இந்தப் பக்கம் கிடைக்கவில்லை',
      message: 'இது இடம் மாறியிருக்கலாம் அல்லது இனி இல்லாமல் இருக்கலாம்.',
      action: 'கடைக்குச் செல்',
    },
  },
  'account.NOT_FOUND_WORDS',
);

/** About you (src/app/profile.tsx). */
export const PROFILE_SCREEN = localized(
  {
    title: 'About you',
    preview: 'Your profile opens with ordering. This is a preview.',
    loadFailed: "We couldn't load your details.",
    intro: 'Everything here is optional, except your name.',
    nameLabel: 'Your name',
    phoneLabel: 'Phone number',
    phoneHint: 'Your number is your account. To use another number, log in with it.',
    emailLabel: 'Email (optional)',
    emailA11y: 'Email',
    emailBad: 'Enter a valid email address.',
    dobLabel: 'Date of birth (optional)',
    dayA11y: 'Day',
    monthA11y: 'Month',
    yearA11y: 'Year',
    dobHint: 'For a birthday gift from Blynk. Leave it empty to remove it.',
    dobBad: 'Enter a real date (day, month, year). You must be 5 or older.',
    saved: 'Saved.',
  } as const,
  {
    si: {
      title: 'ඔබ ගැන',
      preview: 'ඔබේ පැතිකඩ ඇණවුම් සමඟ විවෘත වේ. මෙය පෙරදසුනකි.',
      loadFailed: 'ඔබේ විස්තර පූරණය කළ නොහැකි වුණා.',
      intro: 'ඔබේ නම හැර, මෙහි ඇති සියල්ල අවශ්‍ය නොවේ.',
      nameLabel: 'ඔබේ නම',
      phoneLabel: 'දුරකථන අංකය',
      phoneHint: 'ඔබේ අංකය ඔබේ ගිණුමයි. වෙනත් අංකයක් භාවිත කිරීමට, ඒ අංකයෙන් ඇතුල් වන්න.',
      emailLabel: 'ඊමේල් (අවශ්‍ය නොවේ)',
      emailA11y: 'ඊමේල්',
      emailBad: 'වලංගු ඊමේල් ලිපිනයක් ඇතුළත් කරන්න.',
      dobLabel: 'උපන් දිනය (අවශ්‍ය නොවේ)',
      dayA11y: 'දිනය',
      monthA11y: 'මාසය',
      yearA11y: 'වර්ෂය',
      dobHint: 'Blynk වෙතින් උපන්දින තෑග්ගක් සඳහා. ඉවත් කිරීමට හිස්ව තබන්න.',
      dobBad: 'නිවැරදි දිනයක් ඇතුළත් කරන්න (දිනය, මාසය, වර්ෂය). ඔබට අවුරුදු 5 හෝ ඊට වැඩි විය යුතුයි.',
      saved: 'සුරැකුණා.',
    },
    ta: {
      title: 'உங்களைப் பற்றி',
      preview: 'உங்கள் சுயவிவரம் ஆர்டர் செய்யும்போது திறக்கும். இது ஒரு முன்னோட்டம்.',
      loadFailed: 'உங்கள் விவரங்களை ஏற்ற முடியவில்லை.',
      intro: 'உங்கள் பெயரைத் தவிர, இங்குள்ள அனைத்தும் விருப்பமானவை.',
      nameLabel: 'உங்கள் பெயர்',
      phoneLabel: 'தொலைபேசி எண்',
      phoneHint: 'உங்கள் எண்ணே உங்கள் கணக்கு. வேறு எண்ணைப் பயன்படுத்த, அந்த எண்ணுடன் உள்நுழையுங்கள்.',
      emailLabel: 'மின்னஞ்சல் (விருப்பம்)',
      emailA11y: 'மின்னஞ்சல்',
      emailBad: 'சரியான மின்னஞ்சல் முகவரியை உள்ளிடுங்கள்.',
      dobLabel: 'பிறந்த தேதி (விருப்பம்)',
      dayA11y: 'நாள்',
      monthA11y: 'மாதம்',
      yearA11y: 'வருடம்',
      dobHint: 'Blynk இலிருந்து பிறந்தநாள் பரிசுக்காக. நீக்க, காலியாக விடுங்கள்.',
      dobBad: 'சரியான தேதியை உள்ளிடுங்கள் (நாள், மாதம், வருடம்). உங்களுக்கு 5 வயது அல்லது அதற்கு மேல் இருக்க வேண்டும்.',
      saved: 'சேமிக்கப்பட்டது.',
    },
  },
  'account.PROFILE_SCREEN',
);

/** SMS & offers (src/app/settings.tsx). */
export const SMS_SCREEN = localized(
  {
    title: 'SMS & offers',
    preview: 'SMS settings open with ordering. This is a preview.',
    loadFailed: "We couldn't load your SMS settings.",
    languageTitle: 'SMS language',
    languageNote: 'Order updates, sign-in codes and offers by SMS come in this language when Blynk sends them in yours.',
    languageHint: 'Pick a language for your SMS',
    offersTitle: 'Offers by SMS',
    offersNote: 'Get Blynk offers and discounts by SMS. Order updates still arrive.',
  } as const,
  {
    si: {
      title: 'SMS සහ දීමනා',
      preview: 'SMS සැකසුම් ඇණවුම් සමඟ විවෘත වේ. මෙය පෙරදසුනකි.',
      loadFailed: 'ඔබේ SMS සැකසුම් පූරණය කළ නොහැකි වුණා.',
      languageTitle: 'SMS භාෂාව',
      languageNote: 'ඇණවුම් යාවත්කාලීන, ඇතුල්වීමේ කේත සහ දීමනා SMS මඟින් Blynk ඔබේ භාෂාවෙන් එවන විට ඒවා එන්නේ මෙම භාෂාවෙන්.',
      languageHint: 'SMS සඳහා භාෂාවක් තෝරන්න',
      offersTitle: 'SMS මඟින් දීමනා',
      offersNote: 'Blynk දීමනා සහ වට්ටම් SMS මඟින් ලබාගන්න. ඇණවුම් යාවත්කාලීන තවමත් එනවා.',
    },
    ta: {
      title: 'SMS மற்றும் சலுகைகள்',
      preview: 'SMS அமைப்புகள் ஆர்டர் செய்யும்போது திறக்கும். இது ஒரு முன்னோட்டம்.',
      loadFailed: 'உங்கள் SMS அமைப்புகளை ஏற்ற முடியவில்லை.',
      languageTitle: 'SMS மொழி',
      languageNote: 'ஆர்டர் அறிவிப்புகள், உள்நுழைவு குறியீடுகள் மற்றும் சலுகைகளை Blynk உங்கள் மொழியில் அனுப்பும்போது, அவை SMS ஆக இந்த மொழியில் வரும்.',
      languageHint: 'SMS க்கு ஒரு மொழியைத் தேர்ந்தெடுங்கள்',
      offersTitle: 'SMS மூலம் சலுகைகள்',
      offersNote: 'Blynk சலுகைகளையும் தள்ளுபடிகளையும் SMS மூலம் பெறுங்கள். ஆர்டர் அறிவிப்புகள் தொடர்ந்து வரும்.',
    },
  },
  'account.SMS_SCREEN',
);

/** Send feedback (src/app/feedback.tsx). */
export const FEEDBACK_SCREEN = localized(
  {
    title: 'Send feedback',
    intro: 'Tell us what went well or what we can do better. The Blynk team reads every message.',
    experience: 'How was your experience? (optional)',
    star: (n: number) => `${n} star${n > 1 ? 's' : ''}`,
    about: 'What is it about?',
    categories: { APP: 'App', DELIVERY: 'Delivery', PRODUCTS: 'Products', OTHER: 'Other' } as Record<string, string>,
    messageLabel: 'Your message',
    placeholder: 'Write your feedback here',
    send: 'Send feedback',
    thanks: 'Thanks - your feedback was sent',
    chooseCategory: 'Choose what your feedback is about.',
    writeFirst: 'Write a message first.',
    tooLong: (max: number) => `Keep it to ${max} characters.`,
  } as const,
  {
    si: {
      title: 'ප්‍රතිපෝෂණ එවන්න',
      intro: 'හොඳ වුණේ මොනවාද, අපට වඩා හොඳට කළ හැක්කේ මොනවාද කියා අපට කියන්න. Blynk කණ්ඩායම සෑම පණිවිඩයක්ම කියවනවා.',
      experience: 'ඔබේ අත්දැකීම කොහොමද? (අවශ්‍ය නොවේ)',
      star: (n: number) => `තරු ${n}`,
      about: 'මෙය කුමක් ගැනද?',
      categories: { APP: 'ඇප් එක', DELIVERY: 'බෙදාහැරීම', PRODUCTS: 'භාණ්ඩ', OTHER: 'වෙනත්' },
      messageLabel: 'ඔබේ පණිවිඩය',
      placeholder: 'ඔබේ ප්‍රතිපෝෂණය මෙහි ලියන්න',
      send: 'ප්‍රතිපෝෂණ එවන්න',
      thanks: 'ස්තූතියි - ඔබේ ප්‍රතිපෝෂණය යැවුවා',
      chooseCategory: 'ඔබේ ප්‍රතිපෝෂණය කුමක් ගැනදැයි තෝරන්න.',
      writeFirst: 'මුලින්ම පණිවිඩයක් ලියන්න.',
      tooLong: (max: number) => `අකුරු ${max}ක් ඇතුළත තබාගන්න.`,
    },
    ta: {
      title: 'கருத்து அனுப்புங்கள்',
      intro: 'என்ன நன்றாக இருந்தது, எதை இன்னும் சிறப்பாகச் செய்யலாம் என்று சொல்லுங்கள். Blynk குழு ஒவ்வொரு செய்தியையும் படிக்கிறது.',
      experience: 'உங்கள் அனுபவம் எப்படி இருந்தது? (விருப்பம்)',
      star: (n: number) => `${n} நட்சத்திரம்`,
      about: 'இது எதைப் பற்றியது?',
      categories: { APP: 'ஆப்', DELIVERY: 'டெலிவரி', PRODUCTS: 'பொருட்கள்', OTHER: 'மற்றவை' },
      messageLabel: 'உங்கள் செய்தி',
      placeholder: 'உங்கள் கருத்தை இங்கே எழுதுங்கள்',
      send: 'கருத்து அனுப்பு',
      thanks: 'நன்றி - உங்கள் கருத்து அனுப்பப்பட்டது',
      chooseCategory: 'உங்கள் கருத்து எதைப் பற்றியது என்பதைத் தேர்ந்தெடுங்கள்.',
      writeFirst: 'முதலில் ஒரு செய்தியை எழுதுங்கள்.',
      tooLong: (max: number) => `${max} எழுத்துகளுக்குள் வைத்திருங்கள்.`,
    },
  },
  'account.FEEDBACK_SCREEN',
);

/** The menu-interstitial of the design mock (src/app/opening.tsx); the live app redirects before it shows. */
export const OPENING_WORDS = localized(
  {
    sub: 'Opening aisle to explore...',
    priceList: 'PRICE LIST',
  } as const,
  {
    si: { sub: 'බලන්න ප්‍රවේශය විවෘත කරමින්...', priceList: 'මිල ලැයිස්තුව' },
    ta: { sub: 'பார்வையிட பகுதியைத் திறக்கிறது...', priceList: 'விலைப் பட்டியல்' },
  },
  'account.OPENING_WORDS',
);
