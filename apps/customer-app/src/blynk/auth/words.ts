import { localized } from '@/blynk/i18n/localized';

/*
 * The words of the sign-in, one-time code, registration and birthday screens, and what the
 * sign-in calls say when they fail (Sinhala and Tamil: see docs/superpowers/plans/2026-10-25-translations.md).
 * Read them while rendering, never at module load.
 */

/** The date fields' placeholders stay Latin in every language (they are a format, and the input length depends on them). */
export const DATE_PARTS = { day: 'DD', month: 'MM', year: 'YYYY' } as const;

export const LOGIN_WORDS = localized(
  {
    title: 'Login',
    sub: 'Enter your phone number to proceed',
    mobileLabel: 'Mobile Number',
    continue: 'Continue',
    back: 'Back',
    sending: 'Sending code…',
    note: 'We send a 6-digit code by SMS to sign you in.',
  } as const,
  {
    si: {
      title: 'ඇතුල් වන්න',
      sub: 'ඉදිරියට යාමට ඔබේ දුරකථන අංකය ඇතුළත් කරන්න',
      mobileLabel: 'ජංගම දුරකථන අංකය',
      continue: 'ඉදිරියට',
      back: 'ආපසු',
      sending: 'කේතය යවමින්…',
      note: 'ඔබව ඇතුල් කරවීමට අපි SMS මඟින් ඉලක්කම් 6ක කේතයක් එවන්නෙමු.',
    },
    ta: {
      title: 'உள்நுழைக',
      sub: 'தொடர உங்கள் தொலைபேசி எண்ணை உள்ளிடுங்கள்',
      mobileLabel: 'மொபைல் எண்',
      continue: 'தொடரவும்',
      back: 'பின்செல்',
      sending: 'குறியீடு அனுப்பப்படுகிறது…',
      note: 'உங்களை உள்நுழைய வைக்க SMS மூலம் 6 இலக்க குறியீடு அனுப்புவோம்.',
    },
  },
  'auth.LOGIN_WORDS',
);

export const OTP_WORDS = localized(
  {
    title: 'Verify Details',
    sentTo: (phone: string) => `OTP sent to ${phone}`,
    enter: 'Enter OTP',
    verify: 'Verify And Proceed',
    verifying: 'Verifying…',
    resendIn: (s: number) => `Resend OTP in ${s} s`,
    resend: 'Resend OTP',
    resending: 'Sending a new code…',
    resent: 'A new code is on its way.',
  } as const,
  {
    si: {
      title: 'විස්තර තහවුරු කරන්න',
      sentTo: (phone: string) => `OTP එක ${phone} වෙත යවන ලදී`,
      enter: 'OTP ඇතුළත් කරන්න',
      verify: 'තහවුරු කර ඉදිරියට',
      verifying: 'තහවුරු කරමින්…',
      resendIn: (s: number) => `තත්පර ${s}කින් OTP නැවත යවන්න`,
      resend: 'OTP නැවත යවන්න',
      resending: 'අලුත් කේතයක් යවමින්…',
      resent: 'අලුත් කේතයක් එවා ඇත.',
    },
    ta: {
      title: 'விவரங்களை உறுதிசெய்க',
      sentTo: (phone: string) => `${phone} எண்ணுக்கு OTP அனுப்பப்பட்டது`,
      enter: 'OTP ஐ உள்ளிடுக',
      verify: 'உறுதிசெய்து தொடரவும்',
      verifying: 'உறுதிசெய்கிறது…',
      resendIn: (s: number) => `${s} வினாடியில் OTP மீண்டும் அனுப்பலாம்`,
      resend: 'OTP ஐ மீண்டும் அனுப்பு',
      resending: 'புதிய குறியீடு அனுப்பப்படுகிறது…',
      resent: 'புதிய குறியீடு அனுப்பப்பட்டுள்ளது.',
    },
  },
  'auth.OTP_WORDS',
);

export const REGISTER_WORDS = localized(
  {
    title: 'Welcome to Blynk',
    signedInAs: (phone: string) => `Signed in with ${phone}`,
    heading: "What's your name?",
    sub: 'So your rider knows who to hand your order to.',
    nameLabel: 'Your name',
    nameHint: 'e.g. Nimal Perera',
    referralLabel: 'Referral code (optional)',
    referralHelp: "Got a friend's code? Enter it for a reward on your first order.",
    referralBad: 'Referral codes are 3 to 32 letters and numbers.',
    cta: 'Continue',
    saving: 'Saving…',
  } as const,
  {
    si: {
      title: 'Blynk වෙත සාදරයෙන් පිළිගනිමු',
      signedInAs: (phone: string) => `${phone} මඟින් ඇතුල් වී ඇත`,
      heading: 'ඔබේ නම මොකක්ද?',
      sub: 'ඔබේ ඇණවුම කාට භාර දිය යුතුදැයි රයිඩර්ට දැනගැනීමට.',
      nameLabel: 'ඔබේ නම',
      nameHint: 'උදා: නිමල් පෙරේරා',
      referralLabel: 'යොමු කේතය (අවශ්‍ය නොවේ)',
      referralHelp: 'යාළුවෙකුගේ කේතයක් තියෙනවාද? ඔබේ පළමු ඇණවුමට ත්‍යාගයක් ලබාගැනීමට එය ඇතුළත් කරන්න.',
      referralBad: 'යොමු කේතවල අකුරු සහ ඉලක්කම් 3 සිට 32 දක්වා ඇත.',
      cta: 'ඉදිරියට',
      saving: 'සුරකිමින්…',
    },
    ta: {
      title: 'Blynk-க்கு வரவேற்கிறோம்',
      signedInAs: (phone: string) => `${phone} மூலம் உள்நுழைந்துள்ளீர்கள்`,
      heading: 'உங்கள் பெயர் என்ன?',
      sub: 'உங்கள் ஆர்டரை யாரிடம் கொடுப்பது என்று ரைடருக்குத் தெரிவதற்காக.',
      nameLabel: 'உங்கள் பெயர்',
      nameHint: 'எ.கா: நிமல் பெரேரா',
      referralLabel: 'பரிந்துரை குறியீடு (விருப்பம்)',
      referralHelp: 'நண்பரின் குறியீடு இருக்கிறதா? முதல் ஆர்டருக்குப் பரிசு பெற அதை உள்ளிடுங்கள்.',
      referralBad: 'பரிந்துரை குறியீடுகள் 3 முதல் 32 எழுத்துகள் மற்றும் எண்கள் கொண்டவை.',
      cta: 'தொடரவும்',
      saving: 'சேமிக்கிறது…',
    },
  },
  'auth.REGISTER_WORDS',
);

export const BIRTHDAY_WORDS = localized(
  {
    title: 'Tell us your birthday for a gift',
    body: "Get a little something off one order in your birthday week. It's optional, and you can change it any time in Profile.",
    bad: 'Enter a real date of birth.',
    save: 'Save birthday',
    saving: 'Saving…',
    skip: 'Skip',
  } as const,
  {
    si: {
      title: 'තෑග්ගක් සඳහා ඔබේ උපන්දිනය අපට කියන්න',
      body: 'ඔබේ උපන්දින සතියේ එක් ඇණවුමකට සුළු වට්ටමක් ලබාගන්න. මෙය අවශ්‍ය නොවේ, ගිණුම තුළින් ඕනෑම වෙලාවක වෙනස් කළ හැක.',
      bad: 'නිවැරදි උපන් දිනයක් ඇතුළත් කරන්න.',
      save: 'උපන්දිනය සුරකින්න',
      saving: 'සුරකිමින්…',
      skip: 'මඟ හරින්න',
    },
    ta: {
      title: 'பரிசுக்காக உங்கள் பிறந்தநாளைச் சொல்லுங்கள்',
      body: 'உங்கள் பிறந்தநாள் வாரத்தில் ஒரு ஆர்டருக்குச் சிறிய தள்ளுபடி பெறுங்கள். இது விருப்பம்தான்; கணக்கு பகுதியில் எப்போது வேண்டுமானாலும் மாற்றலாம்.',
      bad: 'சரியான பிறந்த தேதியை உள்ளிடுங்கள்.',
      save: 'பிறந்தநாளைச் சேமி',
      saving: 'சேமிக்கிறது…',
      skip: 'தவிர்',
    },
  },
  'auth.BIRTHDAY_WORDS',
);

/** What a failed sign-in or registration call says (the server's own words win where it sends them). */
export const AUTH_ERRORS = localized(
  {
    generic: 'Something went wrong. Please try again.',
    nameError: 'Enter your name (at least 2 letters).',
    invalidPhone: 'Enter a valid Sri Lankan mobile number.',
    tooManyCodesIn: (min: number) => `Too many codes requested. Try again in ${min} min.`,
    tooManyCodes: 'Too many codes requested. Please try again later.',
    smsFailed: 'We could not send the code by SMS. Please try again.',
    wrongCode: (left: number) => `Wrong code. ${left} attempt${left === 1 ? '' : 's'} left.`,
    codeInvalid: 'This code is no longer valid. Tap Resend OTP for a new one.',
    codeExpired: 'This code has expired. Tap Resend OTP for a new one.',
    codeMaxAttempts: 'Too many wrong codes. Tap Resend OTP for a new one.',
    deactivated: 'This account has been deactivated. Please contact Blynk support.',
    signInExpired: 'Your sign-in has expired. Please sign in again.',
    referralDisabled: 'Referral codes are not available right now.',
    referralNotFound: 'We could not find that referral code.',
    referralSelf: 'You cannot use your own referral code.',
    referralApplied: 'A referral code is already on your account.',
    referralNotNew: 'Referral codes are for new customers only.',
  } as const,
  {
    si: {
      generic: 'යම් දෙයක් වැරදුණා. කරුණාකර නැවත උත්සාහ කරන්න.',
      nameError: 'ඔබේ නම ඇතුළත් කරන්න (අකුරු 2ක් හෝ වැඩි).',
      invalidPhone: 'වලංගු ශ්‍රී ලංකා ජංගම දුරකථන අංකයක් ඇතුළත් කරන්න.',
      tooManyCodesIn: (min: number) => `කේත ඉල්ලීම් වැඩියි. විනාඩි ${min}කින් නැවත උත්සාහ කරන්න.`,
      tooManyCodes: 'කේත ඉල්ලීම් වැඩියි. පසුව නැවත උත්සාහ කරන්න.',
      smsFailed: 'SMS මඟින් කේතය යැවීමට නොහැකි වුණා. කරුණාකර නැවත උත්සාහ කරන්න.',
      wrongCode: (left: number) => `වැරදි කේතයක්. තව උත්සාහ ${left}ක් ඉතිරියි.`,
      codeInvalid: 'මෙම කේතය තවදුරටත් වලංගු නැහැ. අලුත් එකක් සඳහා OTP නැවත යවන්න ඔබන්න.',
      codeExpired: 'මෙම කේතයේ කාලය ඉකුත් වී ඇත. අලුත් එකක් සඳහා OTP නැවත යවන්න ඔබන්න.',
      codeMaxAttempts: 'වැරදි කේත වැඩියි. අලුත් එකක් සඳහා OTP නැවත යවන්න ඔබන්න.',
      deactivated: 'මෙම ගිණුම අක්‍රිය කර ඇත. කරුණාකර Blynk සහාය අමතන්න.',
      signInExpired: 'ඔබේ ඇතුල්වීමේ කාලය ඉකුත් වී ඇත. කරුණාකර නැවත ඇතුල් වන්න.',
      referralDisabled: 'යොමු කේත දැන් ලබා ගත නොහැක.',
      referralNotFound: 'ඒ යොමු කේතය අපට සොයාගත නොහැකි වුණා.',
      referralSelf: 'ඔබට ඔබේම යොමු කේතය භාවිත කළ නොහැක.',
      referralApplied: 'ඔබේ ගිණුමට දැනටමත් යොමු කේතයක් යොදා ඇත.',
      referralNotNew: 'යොමු කේත අලුත් ගනුදෙනුකරුවන්ට පමණයි.',
    },
    ta: {
      generic: 'ஏதோ தவறாகிவிட்டது. மீண்டும் முயற்சிக்கவும்.',
      nameError: 'உங்கள் பெயரை உள்ளிடுங்கள் (குறைந்தது 2 எழுத்துகள்).',
      invalidPhone: 'சரியான இலங்கை மொபைல் எண்ணை உள்ளிடுங்கள்.',
      tooManyCodesIn: (min: number) => `அதிக குறியீடுகள் கேட்கப்பட்டன. ${min} நிமிடத்தில் மீண்டும் முயற்சிக்கவும்.`,
      tooManyCodes: 'அதிக குறியீடுகள் கேட்கப்பட்டன. பிறகு மீண்டும் முயற்சிக்கவும்.',
      smsFailed: 'SMS மூலம் குறியீட்டை அனுப்ப முடியவில்லை. மீண்டும் முயற்சிக்கவும்.',
      wrongCode: (left: number) => `தவறான குறியீடு. இன்னும் ${left} முயற்சி மீதம் உள்ளது.`,
      codeInvalid: 'இந்தக் குறியீடு இனி செல்லாது. புதியதற்கு OTP ஐ மீண்டும் அனுப்பு என்பதைத் தட்டுங்கள்.',
      codeExpired: 'இந்தக் குறியீட்டின் நேரம் முடிந்துவிட்டது. புதியதற்கு OTP ஐ மீண்டும் அனுப்பு என்பதைத் தட்டுங்கள்.',
      codeMaxAttempts: 'அதிக தவறான குறியீடுகள். புதியதற்கு OTP ஐ மீண்டும் அனுப்பு என்பதைத் தட்டுங்கள்.',
      deactivated: 'இந்தக் கணக்கு முடக்கப்பட்டுள்ளது. Blynk உதவியைத் தொடர்புகொள்ளவும்.',
      signInExpired: 'உங்கள் உள்நுழைவு காலாவதியாகிவிட்டது. மீண்டும் உள்நுழையுங்கள்.',
      referralDisabled: 'பரிந்துரை குறியீடுகள் இப்போது கிடைக்காது.',
      referralNotFound: 'அந்தப் பரிந்துரை குறியீட்டைக் கண்டுபிடிக்க முடியவில்லை.',
      referralSelf: 'உங்கள் சொந்தப் பரிந்துரை குறியீட்டைப் பயன்படுத்த முடியாது.',
      referralApplied: 'உங்கள் கணக்கில் ஏற்கெனவே பரிந்துரை குறியீடு உள்ளது.',
      referralNotNew: 'பரிந்துரை குறியீடுகள் புதிய வாடிக்கையாளர்களுக்கு மட்டுமே.',
    },
  },
  'auth.AUTH_ERRORS',
);
