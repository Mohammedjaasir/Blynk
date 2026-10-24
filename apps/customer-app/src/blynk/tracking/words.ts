import { localized } from '@/blynk/i18n/localized';

/*
 * The words on the live tracking map and under it, in English, Sinhala and Tamil. Read them while
 * rendering (never at module load).
 */

export const TRACKING_WORDS = localized(
  {
    sectionTitle: 'Live tracking',
    fullMap: 'Full map',
    closed: 'Your order is no longer on the road.',
    yourRider: 'Your rider',
    onTheWay: (name: string) => `${name} is on the way`,
    live: 'Live',
    lastSeenNow: 'Last seen just now',
    lastSeenSeconds: (n: number) => `Last seen ${n} ${n === 1 ? 'second' : 'seconds'} ago`,
    lastSeenMinutes: (n: number) => `Last seen ${n} ${n === 1 ? 'minute' : 'minutes'} ago`,
    arriving: (minutes: number) => `Arriving in ~${minutes} min`,
    unavailable: 'Live location unavailable right now.',
    mapOnWeb: 'The live map opens in the Blynk web app.',
    mapFailed: 'The map could not load.',
    tryAgain: 'Try again',
    recenter: 'Show the rider and your address',
    doorLabel: 'Delivery address',
    riderLabel: 'Your rider',
  } as const,
  {
    si: {
      sectionTitle: 'සජීවී ලුහුබැඳීම',
      fullMap: 'සම්පූර්ණ සිතියම',
      closed: 'ඔබේ ඇණවුම තවදුරටත් පාරේ නැහැ.',
      yourRider: 'ඔබේ රයිඩර්',
      onTheWay: (name: string) => `${name} එනවා`,
      live: 'සජීවී',
      lastSeenNow: 'මේ දැන් දැක්කා',
      lastSeenSeconds: (n: number) => `තත්පර ${n}කට පෙර දැක්කා`,
      lastSeenMinutes: (n: number) => `මිනිත්තු ${n}කට පෙර දැක්කා`,
      arriving: (minutes: number) => `මිනිත්තු ~${minutes}කින් ළඟා වෙනවා`,
      unavailable: 'සජීවී ස්ථානය දැන් නැහැ.',
      mapOnWeb: 'සජීවී සිතියම Blynk වෙබ් ඇප් එකේ විවෘත වෙනවා.',
      mapFailed: 'සිතියම පූරණය කරන්න බැරි වුණා.',
      tryAgain: 'නැවත උත්සාහ කරන්න',
      recenter: 'රයිඩර් සහ ඔබේ ලිපිනය පෙන්වන්න',
      doorLabel: 'බෙදාහැරීමේ ලිපිනය',
      riderLabel: 'ඔබේ රයිඩර්',
    },
    ta: {
      sectionTitle: 'நேரலை கண்காணிப்பு',
      fullMap: 'முழு வரைபடம்',
      closed: 'உங்கள் ஆர்டர் இனி வழியில் இல்லை.',
      yourRider: 'உங்கள் ரைடர்',
      onTheWay: (name: string) => `${name} வந்துகொண்டிருக்கிறார்`,
      live: 'நேரலை',
      lastSeenNow: 'இப்போதுதான் பார்க்கப்பட்டது',
      lastSeenSeconds: (n: number) => `${n} வினாடிகளுக்கு முன் பார்க்கப்பட்டது`,
      lastSeenMinutes: (n: number) => `${n} நிமிடங்களுக்கு முன் பார்க்கப்பட்டது`,
      arriving: (minutes: number) => `~${minutes} நிமிடத்தில் வந்துவிடுவார்`,
      unavailable: 'நேரலை இருப்பிடம் இப்போது கிடைக்கவில்லை.',
      mapOnWeb: 'நேரலை வரைபடம் Blynk வெப் ஆப்பில் திறக்கும்.',
      mapFailed: 'வரைபடத்தை ஏற்ற முடியவில்லை.',
      tryAgain: 'மீண்டும் முயற்சிக்கவும்',
      recenter: 'ரைடரையும் உங்கள் முகவரியையும் காட்டு',
      doorLabel: 'டெலிவரி முகவரி',
      riderLabel: 'உங்கள் ரைடர்',
    },
  },
  'tracking.TRACKING_WORDS',
);
