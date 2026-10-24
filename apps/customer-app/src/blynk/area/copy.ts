import { localized } from '@/blynk/i18n/localized';
import { centreName, kmText, placeName, radiusText, type Coverage } from './coverage';
import type { Note } from './flow';

/*
 * Delivery-area words in English, Sinhala and Tamil. Place names (Dharga Town, Aluthgama...) are
 * proper nouns and stay as they are (an address stores the same name); only the Clock Tower
 * landmark is a word (see coverage.ts).
 */
export const AREA = localized(
  {
    title: 'Where should we deliver?',
    pageTitle: 'Where we deliver',
    listTitle: 'Choose your area',
    useGps: 'Use my current location',
    asking: 'Finding you…',
    drag: 'Choose on the map',
    dragSub: 'Move the map so the pin sits on your house',
    list: 'Choose my area from a list',
    listSub: 'Then type your house, street or landmark',
    inside: 'We deliver here',
    outside: "We don't deliver there yet",
    fromStore: 'from Blynk',
    notListed: "Don't see your area? Drag the pin to your house instead.",
    store: 'Blynk',
    sea: 'Indian Ocean',
    galleRoad: 'Galle Rd',
    river: 'Bentota river',
    legendInside: 'Inside: we deliver',
    legendOutside: 'Outside: not yet',
    seeMap: 'See the delivery area',
    setAddress: 'Set my delivery address',
    mapNote: 'Distances are straight-line from the store.',
    /** The small tag after a distance on the map for a place outside the circle. */
    outsideTag: 'outside',
    near: (name: string) => `Near ${name}`,
    radiusLabel: (c: Coverage) => `${radiusText(c.radiusKm)} delivery area`,
    /** Screen-reader name of the map. */
    mapLabel: (c: Coverage) => `${radiusText(c.radiusKm)} delivery area around ${placeName(c)}`,
    within: (c: Coverage) => `We deliver within ${radiusText(c.radiusKm)} of the ${centreName(c)}.`,
    withinShort: (c: Coverage) => `We deliver within ${radiusText(c.radiusKm)} of ${centreName(c)}`,
    farLine: (km: number, c: Coverage) => `This spot is ${kmText(km)} from the store. We deliver within ${radiusText(c.radiusKm)}. Move the pin closer to continue.`,
    farHead: 'Looks outside our delivery area',
    areaLine: (name: string) => `We put the pin in the middle of ${name}. Move the map so the pin sits on your house.`,
  },
  {
    si: {
      title: 'බෙදාහරින්න ඕනේ කොහාටද?',
      pageTitle: 'අපි බෙදාහරින ප්‍රදේශ',
      listTitle: 'ඔබේ ප්‍රදේශය තෝරන්න',
      useGps: 'මගේ දැන් ඉන්න ස්ථානය භාවිතා කරන්න',
      asking: 'ඔබව සොයමින්…',
      drag: 'සිතියමේ තෝරන්න',
      dragSub: 'පින් එක ඔබේ ගෙදර උඩට එන්න සිතියම ගෙන යන්න',
      list: 'ලැයිස්තුවකින් මගේ ප්‍රදේශය තෝරන්න',
      listSub: 'ඉන්පසු ඔබේ ගෙදර, පාර හෝ ළඟ තියෙන ස්ථානය ටයිප් කරන්න',
      inside: 'අපි මෙහි බෙදාහරිනවා',
      outside: 'තවම එතැනට බෙදාහරින්නේ නැහැ',
      fromStore: 'Blynk සිට',
      notListed: 'ඔබේ ප්‍රදේශය නැද්ද? ඒ වෙනුවට පින් එක ඔබේ ගෙදරට ඇදගෙන යන්න.',
      store: 'Blynk',
      sea: 'ඉන්දියන් සාගරය',
      galleRoad: 'ගාල්ල පාර',
      river: 'බෙන්තොට ගඟ',
      legendInside: 'ඇතුළත: අපි බෙදාහරිනවා',
      legendOutside: 'පිටත: තවම නැහැ',
      seeMap: 'බෙදාහරින ප්‍රදේශය බලන්න',
      setAddress: 'මගේ බෙදාහැරීමේ ලිපිනය දමන්න',
      mapNote: 'දුර මැනෙන්නේ සාප්පුවේ සිට සරල රේඛාවකිනි.',
      outsideTag: 'පිටත',
      near: (name: string) => `${name} ළඟ`,
      radiusLabel: (c: Coverage) => `${radiusText(c.radiusKm)} බෙදාහැරීමේ ප්‍රදේශය`,
      mapLabel: (c: Coverage) => `${placeName(c)} වටා ${radiusText(c.radiusKm)} බෙදාහැරීමේ ප්‍රදේශය`,
      within: (c: Coverage) => `අපි ${centreName(c)} සිට ${radiusText(c.radiusKm)} ඇතුළත බෙදාහරිනවා.`,
      withinShort: (c: Coverage) => `අපි ${centreName(c)} සිට ${radiusText(c.radiusKm)} ඇතුළත බෙදාහරිනවා`,
      farLine: (km: number, c: Coverage) => `මෙම ස්ථානය සාප්පුවේ සිට ${kmText(km)} දුරයි. අපි ${radiusText(c.radiusKm)} ඇතුළත බෙදාහරිනවා. ඉදිරියට යාමට පින් එක ළඟට ගෙන එන්න.`,
      farHead: 'අපගේ බෙදාහැරීමේ ප්‍රදේශයෙන් පිටත වගේ',
      areaLine: (name: string) => `අපි පින් එක ${name} මැදට දැම්මා. පින් එක ඔබේ ගෙදර උඩට එන්න සිතියම ගෙන යන්න.`,
    },
    ta: {
      title: 'எங்கே டெலிவரி செய்ய வேண்டும்?',
      pageTitle: 'நாங்கள் டெலிவரி செய்யும் இடங்கள்',
      listTitle: 'உங்கள் பகுதியைத் தேர்ந்தெடுங்கள்',
      useGps: 'என் தற்போதைய இருப்பிடத்தைப் பயன்படுத்து',
      asking: 'உங்களைத் தேடுகிறது…',
      drag: 'வரைபடத்தில் தேர்ந்தெடு',
      dragSub: 'பின் உங்கள் வீட்டின் மேல் வரும்படி வரைபடத்தை நகர்த்துங்கள்',
      list: 'பட்டியலிலிருந்து என் பகுதியைத் தேர்ந்தெடு',
      listSub: 'பிறகு உங்கள் வீடு, தெரு அல்லது அடையாளத்தை எழுதுங்கள்',
      inside: 'இங்கே டெலிவரி செய்கிறோம்',
      outside: 'அங்கே இன்னும் டெலிவரி செய்வதில்லை',
      fromStore: 'Blynk இலிருந்து',
      notListed: 'உங்கள் பகுதி இல்லையா? பின்னை உங்கள் வீட்டுக்கு இழுத்துச் செல்லுங்கள்.',
      store: 'Blynk',
      sea: 'இந்தியப் பெருங்கடல்',
      galleRoad: 'காலி வீதி',
      river: 'பெந்தோட்டை ஆறு',
      legendInside: 'உள்ளே: டெலிவரி உண்டு',
      legendOutside: 'வெளியே: இன்னும் இல்லை',
      seeMap: 'டெலிவரி பகுதியைப் பார்',
      setAddress: 'என் டெலிவரி முகவரியை அமை',
      mapNote: 'தூரம் கடையிலிருந்து நேர்கோட்டில் கணக்கிடப்பட்டது.',
      outsideTag: 'வெளியே',
      near: (name: string) => `${name} அருகில்`,
      radiusLabel: (c: Coverage) => `${radiusText(c.radiusKm)} டெலிவரி பகுதி`,
      mapLabel: (c: Coverage) => `${placeName(c)} சுற்றி ${radiusText(c.radiusKm)} டெலிவரி பகுதி`,
      within: (c: Coverage) => `${centreName(c)} இலிருந்து ${radiusText(c.radiusKm)} தூரத்துக்குள் டெலிவரி செய்கிறோம்.`,
      withinShort: (c: Coverage) => `${centreName(c)} இலிருந்து ${radiusText(c.radiusKm)} தூரத்துக்குள் டெலிவரி செய்கிறோம்`,
      farLine: (km: number, c: Coverage) => `இந்த இடம் கடையிலிருந்து ${kmText(km)} தூரத்தில் உள்ளது. நாங்கள் ${radiusText(c.radiusKm)} தூரத்துக்குள் டெலிவரி செய்கிறோம். தொடர பின்னை அருகில் நகர்த்துங்கள்.`,
      farHead: 'எங்கள் டெலிவரி பகுதிக்கு வெளியே போலத் தெரிகிறது',
      areaLine: (name: string) => `பின்னை ${name} நடுவில் வைத்துள்ளோம். பின் உங்கள் வீட்டின் மேல் வரும்படி வரைபடத்தை நகர்த்துங்கள்.`,
    },
  },
  'area.AREA',
);

const NOTES = localized(
  {
    denied: "Location access is off. That's fine: choose your house on the map.",
    unavailable: "We couldn't get your location. Choose your house on the map.",
    timeout: 'Finding your location took too long. Choose your house on the map.',
    unsupported: "This phone can't share its location here. Choose your house on the map.",
    outsideFix: "You're outside our delivery area right now. If the order is for somewhere inside the circle, set that spot.",
    drag: 'The map starts at the store. Drag it so the pin sits on your house.',
  } as const,
  {
    si: {
      denied: 'ස්ථාන ප්‍රවේශය අක්‍රියයි. කමක් නැහැ, සිතියමේ ඔබේ ගෙදර තෝරන්න.',
      unavailable: 'ඔබේ ස්ථානය ලබාගත නොහැකි විය. සිතියමේ ඔබේ ගෙදර තෝරන්න.',
      timeout: 'ඔබේ ස්ථානය සොයාගැනීමට වැඩි වෙලාවක් ගියා. සිතියමේ ඔබේ ගෙදර තෝරන්න.',
      unsupported: 'මෙම දුරකථනයට මෙහි ස්ථානය බෙදාගත නොහැක. සිතියමේ ඔබේ ගෙදර තෝරන්න.',
      outsideFix: 'ඔබ දැන් අපගේ බෙදාහැරීමේ ප්‍රදේශයෙන් පිටත. ඇණවුම රවුම ඇතුළත ස්ථානයකට නම්, ඒ ස්ථානය දමන්න.',
      drag: 'සිතියම පටන් ගන්නේ සාප්පුවෙන්. පින් එක ඔබේ ගෙදර උඩට එන්න ඇදගෙන යන්න.',
    },
    ta: {
      denied: 'இருப்பிட அனுமதி அணைக்கப்பட்டுள்ளது. பரவாயில்லை, வரைபடத்தில் உங்கள் வீட்டைத் தேர்ந்தெடுங்கள்.',
      unavailable: 'உங்கள் இருப்பிடத்தைப் பெற முடியவில்லை. வரைபடத்தில் உங்கள் வீட்டைத் தேர்ந்தெடுங்கள்.',
      timeout: 'உங்கள் இருப்பிடத்தைக் கண்டறிய அதிக நேரம் ஆனது. வரைபடத்தில் உங்கள் வீட்டைத் தேர்ந்தெடுங்கள்.',
      unsupported: 'இந்த ஃபோன் இங்கே இருப்பிடத்தைப் பகிர முடியாது. வரைபடத்தில் உங்கள் வீட்டைத் தேர்ந்தெடுங்கள்.',
      outsideFix: 'நீங்கள் இப்போது எங்கள் டெலிவரி பகுதிக்கு வெளியே இருக்கிறீர்கள். ஆர்டர் வட்டத்துக்குள் உள்ள இடத்துக்கு என்றால், அந்த இடத்தை அமையுங்கள்.',
      drag: 'வரைபடம் கடையிலிருந்து தொடங்குகிறது. பின் உங்கள் வீட்டின் மேல் வரும்படி இழுங்கள்.',
    },
  },
  'area.NOTES',
);

/** The note above the area map / on the map picker for each situation. */
export function noteText(n: Note): string | null {
  switch (n) {
    case 'denied': return NOTES.denied;
    case 'unavailable': return NOTES.unavailable;
    case 'timeout': return NOTES.timeout;
    case 'unsupported': return NOTES.unsupported;
    case 'outsideFix': return NOTES.outsideFix;
    case 'drag': return NOTES.drag;
    case 'areaPicked': return null;
    default: return null;
  }
}
