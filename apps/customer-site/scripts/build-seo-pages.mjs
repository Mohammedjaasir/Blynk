#!/usr/bin/env node
// Blynk website SEO pages (owner's "Tracking & SEO brief", 2026-10-15).
//
// Writes apps/customer-site/pages/, which the Dockerfile copies to the site
// root as it is (COPY apps/customer-site/pages/ /usr/share/nginx/html/):
//   /dharga-town /aluthgama /bentota /kaluwamodara /moragalla   area pages
//   /baby-diapers-delivery-aluthgama ...                          category pages
//   /si/ /ta/ and /si/<area> /ta/<area>                           Sinhala and Tamil
//   /sitemap.xml /robots.txt /pages.css (pages.css is hand-written, not generated)
//
// The English home page (index.html) is hand-written and the legal pages are
// built by build-legal-pages.mjs; this script only lists them in the sitemap.
//
//   node apps/customer-site/scripts/build-seo-pages.mjs          write the pages
//   node apps/customer-site/scripts/build-seo-pages.mjs --check  fail if a page is out of date
//
// Rules from the owner (do not break them when editing the copy):
// - Never promise free delivery. The promise is Blynk Points: 1 point for every LKR 100.
// - Never show the per-km delivery fee tiers on the website. "The app shows the
//   delivery fee for your address before you order" is the most we say.
// - No claims Blynk cannot back: fastest, cheapest, delivery in N minutes.
// - Every page carries the GTM markers (gtm-inject.sh fills them in at build time)
//   and analytics.js (page_view, the same way as the home page).
// - The Sinhala and Tamil copy is machine-written: every translated page starts
//   with a comment saying it needs a native speaker's review.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(siteDir, 'pages');

export const SITE = 'https://blynk.lk';
export const LASTMOD = '2026-10-15';
const YEAR = '2026';
const PHONE = '+94717107374';
const WHATSAPP = 'https://wa.me/94717107374';
const OG_IMAGE = `${SITE}/assets/og-image.jpg`;
const CSS = '/styles.css?v=20261014b';
const PAGES_CSS = '/pages.css?v=20261015c';
const ANALYTICS = '/analytics.js?v=20261015a';
const LANGS = ['en', 'si', 'ta'];

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
const orderUrl = (medium, campaign, lang) =>
  `/app/?utm_source=blynk.lk&utm_medium=${medium}&utm_campaign=${campaign}${lang && lang !== 'en' ? `&utm_content=${lang}` : ''}`;

/** The GTM head and body blocks, copied from the home page so every page loads the container the same way. */
function gtmBlocks() {
  // (\r: a Windows checkout may have given index.html CRLF line endings)
  const home = readFileSync(join(siteDir, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const head = home.match(/[ \t]*<!-- GTM-HEAD-START -->[\s\S]*?<!-- GTM-HEAD-END -->/);
  const body = home.match(/[ \t]*<!-- GTM-BODY-START -->[\s\S]*?<!-- GTM-BODY-END -->/);
  if (!head || !body) throw new Error('index.html lost its GTM markers');
  return { head: head[0].trim(), body: body[0].trim() };
}

const ICON = {
  arrow: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  phone: '<svg class="cta__icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
  cart: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM3 2h2.2l.9 2H21a1 1 0 0 1 .96 1.27l-2.2 8A1 1 0 0 1 18.8 14H8.1l-1 2H19v2H5.6a1 1 0 0 1-.9-1.45L6.1 13.9 3.5 4H3z"/></svg>',
  pin: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>',
  shield: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.8-4.8 1.4 1.4z"/></svg>',
  star: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="m12 2 3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21l1.4-7L2 9.3l7-.8z"/></svg>',
  // The home page's product tiles.
  rice: '<svg class="bento__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16a8 8 0 0 1-16 0zM8 11c0-3 1.5-5 4-6M12 11c0-2.5 1-4.5 3-5.5"/></svg>',
  drinks: '<svg class="bento__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10l-1 18H8zM7.5 8h9M12 3V1"/></svg>',
  snacks: '<svg class="bento__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l-1 4 1 4-1 4 1 4-1 2H7l-1-2 1-4-1-4 1-4zM10 10h4"/></svg>',
  bottle: '<svg class="bento__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2h8M9 2v3l-2 3v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8l-2-3V2M7 12h10"/></svg>',
  care: '<svg class="bento__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2h4v3h-4zM8 5h8l1 4v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9z"/></svg>',
  home: '<svg class="bento__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v4l3 3v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9l3-3zM9 13h6"/></svg>',
  soap: '<svg class="bento__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM9 5a1.5 1.5 0 1 0 0-.01M15 4a1 1 0 1 0 0-.01"/></svg>',
};

// ---------------------------------------------------------------- the owner's categories
// Names exactly as in Ops → Catalog (OWNER_CATEGORY_SETUP). Product and brand
// names stay in English on every language version, as they appear in the app.
const CATEGORIES = [
  { main: 'Grocery', items: ['Rice & Flour (Rice, Flour, Dhal & Grams)', 'Oil, Sugar & Salt', 'Spices', 'Vegetables', 'Dry Fish & Tin Fish', 'Noodles & Soup'] },
  { main: 'Breakfast & Drinks', items: ['Milk Powder & Eggs', 'Jam, Butter & Cereal', 'Tea & Coffee', 'Drinks (Milo & Nestomalt, Soft Drinks, Water & Juice)'] },
  { main: 'Snacks', items: ['Biscuits', 'Chips & Bites', 'Chocolates & Sweets', 'Dates & Nuts'] },
  { main: 'Baby Items', items: ['Diapers & Wipes', 'Baby Soap & Powder', 'Baby Food & Bottles'] },
  { main: 'Ladies Items', items: ['Sanitary Pads', 'Hair Oil & Shampoo', 'Creams & Beauty', 'Clips, Bands & Pins'] },
  { main: 'Personal Care', items: ['Soap & Toothpaste', 'Shaving Items', 'First Aid', 'Adult Diapers'] },
  { main: 'Household', items: ['Washing Powder & Dishwash', 'Cleaning Items', 'Tissue, Foil & Lunch Sheets', 'Batteries, Bulbs & Candles', 'Mosquito Coils & Sprays'] },
];

// ---------------------------------------------------------------- words per language
// si and ta: MACHINE-WRITTEN, to be reviewed by a native speaker before promotion.
const T = {
  en: {
    locale: 'en_LK', langName: 'English',
    home: 'Home', order: 'Order now', orderShort: 'Order now', orderSmall: 'Opens the Blynk shop',
    kicker: 'Grocery delivery',
    areaTitle: 'Grocery delivery in {area} | Blynk',
    areaDesc: 'Order groceries and daily essentials from Blynk in {area}. Delivered from near the Dharga Town Clock Tower, 8 AM to 9 PM every day. Pay cash on delivery.',
    areaH1: 'Grocery delivery in {area}',
    factHours: 'Every day 8 AM – 9 PM', factCash: 'Cash on delivery', factRange: 'Within 4 km of the Dharga Town Clock Tower',
    catsKicker: 'What you can order', catsH2: 'Everything for the home, in one order.',
    catsNote: 'Shop by the same categories you see in the app. What is in stock and today’s prices are shown in the app.',
    howKicker: 'How it works', howH2: 'Three steps to your door.',
    how1: 'Pin your location', how1t: 'Open Blynk and set your address in {area} on the map.',
    how2: 'Fill your basket', how2t: 'Choose groceries and daily essentials. The app shows the delivery fee for your address before you order.',
    how3: 'Pay at your door', how3t: 'Your rider brings the order. Pay in cash when it arrives.',
    delKicker: 'Delivery', delH2: 'Local delivery, kept simple.',
    stHours: 'Order every day', stHoursT: '8 AM to 9 PM',
    stArea: 'Delivery area', stAreaT: 'from the Dharga Town Clock Tower',
    stPay: 'Payment', stPayB: 'Cash', stPayT: 'at your door',
    stPts: 'Blynk Points', stPtsT: 'point for every LKR 100 you spend',
    areasH2: 'Other areas we deliver to', popularH2: 'Popular in {area}',
    bandKicker: 'Blynk', bandH2: 'Ready when you are.', bandP: 'Open Blynk, fill your basket and pay at your door.',
    help: 'Need help?', call: 'Call us', wa: 'WhatsApp us',
    areasNav: 'Areas we deliver to', langNav: 'Language', legalNav: 'Legal',
    privacy: 'Privacy Policy', terms: 'Terms and Conditions', refunds: 'Return, Refund and Cancellation Policy',
    footerPlace: 'Dharga Town & Aluthgama, Sri Lanka',
  },
  si: {
    locale: 'si_LK', langName: 'සිංහල',
    home: 'මුල් පිටුව', order: 'දැන් ඇණවුම් කරන්න', orderShort: 'ඇණවුම් කරන්න', orderSmall: 'Blynk සාප්පුව විවෘත වේ',
    kicker: 'සිල්ලර බඩු බෙදාහැරීම',
    areaTitle: '{areaTo} සිල්ලර බඩු බෙදාහැරීම | Blynk',
    areaDesc: 'Blynk වෙතින් {areaTo} සිල්ලර බඩු සහ දෛනික අත්‍යවශ්‍ය දෑ ඇණවුම් කරන්න. සෑම දිනකම පෙ.ව. 8 සිට ප.ව. 9 දක්වා. භාණ්ඩ ලැබුණු විට මුදලින් ගෙවන්න.',
    areaH1: '{areaTo} සිල්ලර බඩු බෙදාහැරීම',
    factHours: 'සෑම දිනකම පෙ.ව. 8 – ප.ව. 9', factCash: 'භාණ්ඩ ලැබුණු විට මුදලින් ගෙවන්න', factRange: 'දර්ගා නගරයේ ඔරලෝසු කණුවේ සිට කි.මී. 4ක් ඇතුළත',
    catsKicker: 'ඔබට ඇණවුම් කළ හැකි දේ', catsH2: 'නිවසට අවශ්‍ය සියල්ල, එකම ඇණවුමකින්.',
    catsNote: 'ඇප් එකේ ඇති කාණ්ඩ අනුවම මිලදී ගන්න. තොගයේ ඇති දේ සහ අද මිල ගණන් ඇප් එකේ පෙන්වයි.',
    howKicker: 'එය ක්‍රියා කරන ආකාරය', howH2: 'ඔබේ දොරකඩට පියවර තුනයි.',
    how1: 'ඔබේ ස්ථානය සලකුණු කරන්න', how1t: 'Blynk විවෘත කර, සිතියමේ {areaIn} ඔබේ ලිපිනය සකසන්න.',
    how2: 'ඔබේ කූඩය පුරවන්න', how2t: 'සිල්ලර බඩු සහ දෛනික අත්‍යවශ්‍ය දෑ තෝරන්න. ඇණවුම් කිරීමට පෙර ඔබේ ලිපිනයට අදාළ බෙදාහැරීමේ ගාස්තුව ඇප් එකේ පෙන්වයි.',
    how3: 'දොරකඩදී ගෙවන්න', how3t: 'ඔබේ රයිඩර් ඇණවුම රැගෙන එයි. එය ලැබුණු විට මුදලින් ගෙවන්න.',
    delKicker: 'බෙදාහැරීම', delH2: 'සරල, ප්‍රාදේශීය බෙදාහැරීම.',
    stHours: 'සෑම දිනකම ඇණවුම් කරන්න', stHoursT: 'පෙ.ව. 8 සිට ප.ව. 9 දක්වා',
    stArea: 'බෙදාහැරීමේ ප්‍රදේශය', stAreaT: 'දර්ගා නගරයේ ඔරලෝසු කණුවේ සිට',
    stPay: 'ගෙවීම', stPayB: 'මුදල්', stPayT: 'ඔබේ දොරකඩදී',
    stPts: 'Blynk Points', stPtsT: 'ඔබ වියදම් කරන සෑම LKR 100කටම ලකුණු',
    areasH2: 'අප බෙදාහරින අනෙක් ප්‍රදේශ', popularH2: '',
    bandKicker: 'Blynk', bandH2: 'ඔබ සූදානම් නම්, අපිත් සූදානම්.', bandP: 'Blynk විවෘත කර, කූඩය පුරවා, දොරකඩදී ගෙවන්න.',
    help: 'උදව් අවශ්‍යද?', call: 'අපට අමතන්න', wa: 'WhatsApp කරන්න',
    areasNav: 'බෙදාහැරීමේ ප්‍රදේශ', langNav: 'භාෂාව', legalNav: 'නීතිමය',
    privacy: 'රහස්‍යතා ප්‍රතිපත්තිය (English)', terms: 'නියම සහ කොන්දේසි (English)', refunds: 'ආපසු භාරදීම්, මුදල් ආපසු ගෙවීම් සහ අවලංගු කිරීමේ ප්‍රතිපත්තිය (English)',
    footerPlace: 'දර්ගා නගරය සහ අළුත්ගම, ශ්‍රී ලංකාව',
  },
  ta: {
    locale: 'ta_LK', langName: 'தமிழ்',
    home: 'முகப்பு', order: 'இப்போதே ஆர்டர் செய்யுங்கள்', orderShort: 'ஆர்டர் செய்ய', orderSmall: 'Blynk கடை திறக்கும்',
    kicker: 'மளிகைப் பொருள் டெலிவரி',
    areaTitle: '{area} பகுதியில் மளிகைப் பொருள் டெலிவரி | Blynk',
    areaDesc: 'Blynk மூலம் {area} பகுதிக்கு மளிகைப் பொருட்களையும் அன்றாடத் தேவைகளையும் ஆர்டர் செய்யுங்கள். தினமும் காலை 8 முதல் இரவு 9 வரை. பொருள் கிடைத்ததும் பணமாகச் செலுத்துங்கள்.',
    areaH1: '{area} பகுதியில் மளிகைப் பொருள் டெலிவரி',
    factHours: 'தினமும் காலை 8 – இரவு 9', factCash: 'பொருள் கிடைத்ததும் பணம் செலுத்தலாம்', factRange: 'தர்கா நகர் மணிக்கூட்டுக் கோபுரத்திலிருந்து 4 கி.மீ.க்குள்',
    catsKicker: 'நீங்கள் ஆர்டர் செய்யக்கூடியவை', catsH2: 'வீட்டுக்குத் தேவையான அனைத்தும், ஒரே ஆர்டரில்.',
    catsNote: 'ஆப்பில் உள்ள அதே வகைகளின்படி வாங்குங்கள். கையிருப்பில் உள்ளவையும் இன்றைய விலைகளும் ஆப்பில் காட்டப்படும்.',
    howKicker: 'எப்படி வேலை செய்கிறது', howH2: 'உங்கள் வாசலுக்கு மூன்று படிகள்.',
    how1: 'உங்கள் இருப்பிடத்தைக் குறியுங்கள்', how1t: 'Blynk-ஐத் திறந்து, வரைபடத்தில் {area} பகுதியில் உள்ள உங்கள் முகவரியை அமைக்கவும்.',
    how2: 'உங்கள் கூடையை நிரப்புங்கள்', how2t: 'மளிகைப் பொருட்களையும் அன்றாடத் தேவைகளையும் தேர்ந்தெடுங்கள். ஆர்டர் செய்வதற்கு முன் உங்கள் முகவரிக்கான டெலிவரி கட்டணத்தை ஆப் காட்டும்.',
    how3: 'வாசலில் பணம் செலுத்துங்கள்', how3t: 'உங்கள் ரைடர் ஆர்டரைக் கொண்டு வருவார். அது வந்ததும் பணமாகச் செலுத்துங்கள்.',
    delKicker: 'டெலிவரி', delH2: 'எளிமையான உள்ளூர் டெலிவரி.',
    stHours: 'தினமும் ஆர்டர் செய்யலாம்', stHoursT: 'காலை 8 முதல் இரவு 9 வரை',
    stArea: 'டெலிவரி பகுதி', stAreaT: 'தர்கா நகர் மணிக்கூட்டுக் கோபுரத்திலிருந்து',
    stPay: 'கட்டணம்', stPayB: 'பணம்', stPayT: 'உங்கள் வாசலில்',
    stPts: 'Blynk Points', stPtsT: 'நீங்கள் செலவிடும் ஒவ்வொரு LKR 100க்கும் புள்ளி',
    areasH2: 'நாங்கள் டெலிவரி செய்யும் பிற பகுதிகள்', popularH2: '',
    bandKicker: 'Blynk', bandH2: 'நீங்கள் தயாரானதும் நாங்களும் தயார்.', bandP: 'Blynk-ஐத் திறந்து, கூடையை நிரப்பி, வாசலில் பணம் செலுத்துங்கள்.',
    help: 'உதவி தேவையா?', call: 'எங்களை அழையுங்கள்', wa: 'WhatsApp செய்யுங்கள்',
    areasNav: 'டெலிவரி பகுதிகள்', langNav: 'மொழி', legalNav: 'சட்டம்',
    privacy: 'தனியுரிமைக் கொள்கை (English)', terms: 'விதிமுறைகள் மற்றும் நிபந்தனைகள் (English)', refunds: 'திருப்பி அனுப்புதல், பணத்திருப்பம் மற்றும் ரத்துக் கொள்கை (English)',
    footerPlace: 'தர்கா நகர் மற்றும் அளுத்கம, இலங்கை',
  },
};

// ---------------------------------------------------------------- areas
// Every area is within about 4 km of the Clock Tower (6.441268, 80.011437);
// the app checks each address, so the copy never promises a whole town.
export const AREAS = [
  {
    slug: 'dharga-town',
    name: { en: 'Dharga Town', si: 'දර්ගා නගරය', ta: 'தர்கா நகர்' },
    to: { si: 'දර්ගා නගරයට' }, in: { si: 'දර්ගා නගරයේ' },
    lead: {
      en: 'Blynk is a Dharga Town shop. We pack your order near the Clock Tower and bring it to your door: rice and dhal, milk powder, baby items, ladies’ items and household needs, all in one order.',
      si: 'Blynk යනු දර්ගා නගරයේම වෙළඳසැලකි. අපි ඔබේ ඇණවුම ඔරලෝසු කණුව අසලදී ඇසුරුම් කර ඔබේ දොරකඩටම ගෙනෙමු: සහල් සහ පරිප්පු, කිරිපිටි, ළදරු භාණ්ඩ, කාන්තා භාණ්ඩ සහ ගෘහ අවශ්‍යතා, සියල්ල එකම ඇණවුමකින්.',
      ta: 'Blynk தர்கா நகரிலேயே உள்ள ஒரு கடை. மணிக்கூட்டுக் கோபுரத்துக்கு அருகில் உங்கள் ஆர்டரைப் பொதி செய்து உங்கள் வாசலுக்கே கொண்டு வருகிறோம்: அரிசி, பருப்பு, பால் மா, குழந்தைப் பொருட்கள், பெண்களுக்கான பொருட்கள், வீட்டுத் தேவைகள் என அனைத்தும் ஒரே ஆர்டரில்.',
    },
    localH2: { en: 'Right here in Dharga Town', si: 'මෙන්න, දර්ගා නගරයේම', ta: 'இங்கேயே, தர்கா நகரில்' },
    local: {
      en: 'We are based in the town itself, so Dharga Town is the heart of our delivery area. Homes on the main road and down the smaller lanes are covered. Set your pin on the map in the app and it confirms your address before you place an order.',
      si: 'අප පිහිටා ඇත්තේ නගරය තුළම නිසා දර්ගා නගරය අපේ බෙදාහැරීමේ ප්‍රදේශයේ හදවතයි. ප්‍රධාන මාර්ගයේ මෙන්ම කුඩා පටු මාවත්වල නිවාසද ආවරණය වේ. ඇප් එකේ සිතියමේ ඔබේ ස්ථානය සලකුණු කළ විට, ඇණවුම් කිරීමට පෙර එය ඔබේ ලිපිනය තහවුරු කරයි.',
      ta: 'நாங்கள் நகருக்குள்ளேயே இருப்பதால், தர்கா நகர் எங்கள் டெலிவரி பகுதியின் மையம். பிரதான வீதியிலும் சிறிய ஒழுங்கைகளிலும் உள்ள வீடுகள் இதில் அடங்கும். ஆப்பில் உள்ள வரைபடத்தில் உங்கள் இருப்பிடத்தைக் குறித்தால், ஆர்டர் செய்வதற்கு முன்பே அது உங்கள் முகவரியை உறுதிப்படுத்தும்.',
    },
    popular: ['rice-and-dhal-delivery-dharga-town', 'sanitary-pads-home-delivery', 'baby-diapers-delivery-aluthgama'],
  },
  {
    slug: 'aluthgama',
    name: { en: 'Aluthgama', si: 'අළුත්ගම', ta: 'அளுத்கம' },
    to: { si: 'අළුත්ගමට' }, in: { si: 'අළුත්ගමේ' },
    lead: {
      en: 'Blynk delivers groceries and household essentials across Aluthgama, from our shop near the Dharga Town Clock Tower. Order on your phone and pay in cash at the door.',
      si: 'Blynk, දර්ගා නගරයේ ඔරලෝසු කණුව අසල පිහිටි අපේ වෙළඳසැලේ සිට අළුත්ගම පුරා සිල්ලර බඩු සහ ගෘහ අත්‍යවශ්‍ය දෑ බෙදාහරියි. ඔබේ දුරකථනයෙන් ඇණවුම් කර, දොරකඩදී මුදලින් ගෙවන්න.',
      ta: 'தர்கா நகர் மணிக்கூட்டுக் கோபுரத்துக்கு அருகிலுள்ள எங்கள் கடையிலிருந்து Blynk அளுத்கம முழுவதும் மளிகைப் பொருட்களையும் வீட்டுத் தேவைகளையும் டெலிவரி செய்கிறது. உங்கள் போனில் ஆர்டர் செய்து, வாசலில் பணமாகச் செலுத்துங்கள்.',
    },
    localH2: { en: 'Aluthgama, close to home', si: 'අළුත්ගම, ඔබේ නිවසට ළඟින්', ta: 'அளுத்கம, உங்கள் வீட்டுக்கு அருகில்' },
    local: {
      en: 'Aluthgama is next door to Dharga Town and well inside our 4 km delivery area. Whether you live near the town, the railway station or the river, pin your home in the app and it shows that we deliver there before you order.',
      si: 'අළුත්ගම දර්ගා නගරයට යාබදව පිහිටා ඇති අතර අපේ කි.මී. 4ක බෙදාහැරීමේ ප්‍රදේශය තුළ හොඳින්ම පිහිටයි. ඔබ නගරය, දුම්රිය ස්ථානය හෝ ගඟ අසල ජීවත් වුවද, ඇප් එකේ ඔබේ නිවස සලකුණු කරන්න; ඇණවුම් කිරීමට පෙර අප එහි බෙදාහරින බව එය පෙන්වයි.',
      ta: 'அளுத்கம தர்கா நகருக்கு அடுத்ததாக உள்ளது; எங்கள் 4 கி.மீ. டெலிவரி பகுதிக்குள் நன்றாகவே அடங்குகிறது. நீங்கள் நகருக்கு அருகிலோ, ரயில் நிலையத்துக்கு அருகிலோ, ஆற்றங்கரையிலோ வசித்தாலும், ஆப்பில் உங்கள் வீட்டைக் குறியுங்கள்; ஆர்டர் செய்வதற்கு முன்பே நாங்கள் அங்கு டெலிவரி செய்கிறோமா என்பதை அது காட்டும்.',
    },
    popular: ['baby-diapers-delivery-aluthgama', 'milk-powder-delivery-aluthgama', 'sanitary-pads-home-delivery'],
  },
  {
    slug: 'bentota',
    name: { en: 'Bentota', si: 'බෙන්තොට', ta: 'பெந்தோட்டை' },
    to: { si: 'බෙන්තොටට' }, in: { si: 'බෙන්තොට' },
    lead: {
      en: 'Blynk delivers groceries and daily essentials to homes, guest houses and villas in Bentota that are within 4 km of the Dharga Town Clock Tower.',
      si: 'දර්ගා නගරයේ ඔරලෝසු කණුවේ සිට කි.මී. 4ක් ඇතුළත පිහිටි බෙන්තොට නිවාස, ආගන්තුක නිවාස සහ විලා වෙත Blynk සිල්ලර බඩු සහ දෛනික අත්‍යවශ්‍ය දෑ බෙදාහරියි.',
      ta: 'தர்கா நகர் மணிக்கூட்டுக் கோபுரத்திலிருந்து 4 கி.மீ.க்குள் உள்ள பெந்தோட்டை வீடுகள், விருந்தினர் இல்லங்கள், வில்லாக்களுக்கு Blynk மளிகைப் பொருட்களையும் அன்றாடத் தேவைகளையும் டெலிவரி செய்கிறது.',
    },
    localH2: { en: 'Which parts of Bentota we reach', si: 'අප ළඟා වන බෙන්තොට ප්‍රදේශ', ta: 'பெந்தோட்டையின் எந்தப் பகுதிகளுக்கு வருகிறோம்' },
    local: {
      en: 'Bentota is just across the river from Aluthgama. We deliver to the parts of Bentota within 4 km of the Clock Tower. The app checks your pin as soon as you set it, so if your address is further out you will know before you order anything.',
      si: 'බෙන්තොට පිහිටා ඇත්තේ අළුත්ගමට ගඟෙන් එගොඩය. ඔරලෝසු කණුවේ සිට කි.මී. 4ක් ඇතුළත බෙන්තොට ප්‍රදේශවලට අපි බෙදාහරිමු. ඔබ ස්ථානය සලකුණු කළ වහාම ඇප් එක එය පරීක්ෂා කරයි, එබැවින් ඔබේ ලිපිනය ඊට වඩා දුර නම් කිසිවක් ඇණවුම් කිරීමට පෙර ඔබට දැනගත හැකිය.',
      ta: 'பெந்தோட்டை அளுத்கமவுக்கு ஆற்றின் மறுகரையில் உள்ளது. மணிக்கூட்டுக் கோபுரத்திலிருந்து 4 கி.மீ.க்குள் உள்ள பெந்தோட்டைப் பகுதிகளுக்கு நாங்கள் டெலிவரி செய்கிறோம். நீங்கள் இருப்பிடத்தைக் குறித்தவுடன் ஆப் அதைச் சரிபார்க்கும்; உங்கள் முகவரி அதைவிடத் தொலைவில் இருந்தால், எதையும் ஆர்டர் செய்வதற்கு முன்பே உங்களுக்குத் தெரிந்துவிடும்.',
    },
    popular: ['milk-powder-delivery-aluthgama', 'baby-diapers-delivery-aluthgama', 'rice-and-dhal-delivery-dharga-town'],
  },
  {
    slug: 'kaluwamodara',
    name: { en: 'Kaluwamodara', si: 'කළුවාමෝදර', ta: 'களுவாமோதரை' },
    to: { si: 'කළුවාමෝදරට' }, in: { si: 'කළුවාමෝදර' },
    lead: {
      en: 'Blynk brings groceries and household needs to Kaluwamodara from our shop near the Dharga Town Clock Tower. Fill your basket in the app and pay in cash when it arrives.',
      si: 'දර්ගා නගරයේ ඔරලෝසු කණුව අසල අපේ වෙළඳසැලේ සිට Blynk කළුවාමෝදරට සිල්ලර බඩු සහ ගෘහ අවශ්‍යතා ගෙනෙයි. ඇප් එකේ ඔබේ කූඩය පුරවා, එය ලැබුණු විට මුදලින් ගෙවන්න.',
      ta: 'தர்கா நகர் மணிக்கூட்டுக் கோபுரத்துக்கு அருகிலுள்ள எங்கள் கடையிலிருந்து Blynk களுவாமோதரைக்கு மளிகைப் பொருட்களையும் வீட்டுத் தேவைகளையும் கொண்டு வருகிறது. ஆப்பில் கூடையை நிரப்பி, அது வந்ததும் பணமாகச் செலுத்துங்கள்.',
    },
    localH2: { en: 'Kaluwamodara is in range', si: 'කළුවාමෝදර අපේ ප්‍රදේශය තුළයි', ta: 'களுவாமோதரை எங்கள் பகுதிக்குள்' },
    local: {
      en: 'Kaluwamodara is close to Dharga Town and well within our 4 km delivery area. Drop your pin exactly on your house and add directions if the road is hard to find; the rider uses both to reach you.',
      si: 'කළුවාමෝදර දර්ගා නගරයට ආසන්නව, අපේ කි.මී. 4ක බෙදාහැරීමේ ප්‍රදේශය තුළ හොඳින්ම පිහිටයි. ඔබේ නිවස මතම ස්ථානය සලකුණු කරන්න, මාර්ගය සොයාගැනීමට අපහසු නම් මඟ පෙන්වීම්ද එක් කරන්න; රයිඩර් ඔබ වෙත ළඟා වීමට ඒ දෙකම භාවිත කරයි.',
      ta: 'களுவாமோதரை தர்கா நகருக்கு அருகில், எங்கள் 4 கி.மீ. டெலிவரி பகுதிக்குள் நன்றாகவே உள்ளது. உங்கள் வீட்டின் மீதே இருப்பிடத்தைக் குறியுங்கள்; வழி கண்டுபிடிக்கச் சிரமமாக இருந்தால் வழிகாட்டுதல்களையும் சேருங்கள். ரைடர் உங்களை அடைய இரண்டையும் பயன்படுத்துவார்.',
    },
    popular: ['rice-and-dhal-delivery-dharga-town', 'baby-diapers-delivery-aluthgama', 'milk-powder-delivery-aluthgama'],
  },
  {
    slug: 'moragalla',
    name: { en: 'Moragalla', si: 'මොරගල්ල', ta: 'மொரகல்ல' },
    to: { si: 'මොරගල්ලට' }, in: { si: 'මොරගල්ලේ' },
    lead: {
      en: 'Blynk delivers groceries and daily essentials to Moragalla homes within 4 km of the Dharga Town Clock Tower. Order from 8 AM to 9 PM and pay at your door.',
      si: 'දර්ගා නගරයේ ඔරලෝසු කණුවේ සිට කි.මී. 4ක් ඇතුළත මොරගල්ල නිවාසවලට Blynk සිල්ලර බඩු සහ දෛනික අත්‍යවශ්‍ය දෑ බෙදාහරියි. පෙ.ව. 8 සිට ප.ව. 9 දක්වා ඇණවුම් කර, දොරකඩදී ගෙවන්න.',
      ta: 'தர்கா நகர் மணிக்கூட்டுக் கோபுரத்திலிருந்து 4 கி.மீ.க்குள் உள்ள மொரகல்ல வீடுகளுக்கு Blynk மளிகைப் பொருட்களையும் அன்றாடத் தேவைகளையும் டெலிவரி செய்கிறது. காலை 8 முதல் இரவு 9 வரை ஆர்டர் செய்து, வாசலில் பணம் செலுத்துங்கள்.',
    },
    localH2: { en: 'Moragalla, by the coast', si: 'මොරගල්ල, මුහුදු තීරය අසල', ta: 'மொரகல்ல, கடற்கரையோரம்' },
    local: {
      en: 'Moragalla lies on the coast north of Aluthgama, inside our delivery area for addresses within 4 km of the Clock Tower. Set your pin in the app and it tells you straight away whether your home is covered.',
      si: 'මොරගල්ල පිහිටා ඇත්තේ අළුත්ගමට උතුරින්, මුහුදු තීරයේය; ඔරලෝසු කණුවේ සිට කි.මී. 4ක් ඇතුළත ලිපින සඳහා එය අපේ බෙදාහැරීමේ ප්‍රදේශය තුළ වේ. ඇප් එකේ ඔබේ ස්ථානය සලකුණු කරන්න, ඔබේ නිවස ආවරණය වේදැයි එය වහාම පවසයි.',
      ta: 'மொரகல்ல அளுத்கமவுக்கு வடக்கே கடற்கரையோரம் உள்ளது; மணிக்கூட்டுக் கோபுரத்திலிருந்து 4 கி.மீ.க்குள் உள்ள முகவரிகளுக்கு இது எங்கள் டெலிவரி பகுதிக்குள் அடங்கும். ஆப்பில் உங்கள் இருப்பிடத்தைக் குறியுங்கள்; உங்கள் வீடு இதில் அடங்குமா என்பதை அது உடனே சொல்லும்.',
    },
    popular: ['milk-powder-delivery-aluthgama', 'sanitary-pads-home-delivery', 'rice-and-dhal-delivery-dharga-town'],
  },
];

// ---------------------------------------------------------------- category pages (English)
export const CATEGORY_PAGES = [
  {
    slug: 'baby-diapers-delivery-aluthgama',
    crumb: 'Baby diapers & wipes',
    title: 'Baby diapers & wipes delivery in Aluthgama | Blynk',
    description: 'Order baby diapers, wipes, baby soap, powder and baby food from Blynk, delivered to your door in Aluthgama and Dharga Town. Pay cash on delivery.',
    h1: 'Baby diapers and wipes, delivered in Aluthgama',
    lead: 'Running low on diapers? Order them from your phone with the rest of the shopping and pay in cash when the rider arrives. We deliver across Aluthgama and everywhere within 4 km of the Dharga Town Clock Tower.',
    groups: [
      { main: 'Baby Items › Diapers & Wipes', items: ['Diapers', 'Wipes'] },
      { main: 'Baby Items', items: ['Baby Soap & Powder', 'Baby Food & Bottles'] },
      { main: 'Often added with them', items: ['Milk Powder & Eggs', 'Soap & Toothpaste', 'Tissue, Foil & Lunch Sheets'] },
    ],
    areas: ['aluthgama', 'dharga-town', 'bentota', 'kaluwamodara', 'moragalla'],
  },
  {
    slug: 'sanitary-pads-home-delivery',
    crumb: 'Sanitary pads',
    title: 'Sanitary pads home delivery in Dharga Town & Aluthgama | Blynk',
    description: 'Get sanitary pads and ladies’ items delivered to your home in Dharga Town, Aluthgama and nearby areas within 4 km. Order 8 AM to 9 PM, pay cash on delivery.',
    h1: 'Sanitary pads, delivered to your home',
    lead: 'Order sanitary pads and other ladies’ items from your phone, without a trip to the shop. Blynk delivers to homes within 4 km of the Dharga Town Clock Tower, including Aluthgama, Bentota, Kaluwamodara and Moragalla.',
    groups: [
      { main: 'Ladies Items', items: ['Sanitary Pads', 'Hair Oil & Shampoo', 'Creams & Beauty', 'Clips, Bands & Pins'] },
      { main: 'Personal Care', items: ['Soap & Toothpaste', 'First Aid'] },
    ],
    areas: ['dharga-town', 'aluthgama', 'bentota', 'kaluwamodara', 'moragalla'],
  },
  {
    slug: 'rice-and-dhal-delivery-dharga-town',
    crumb: 'Rice & dhal',
    title: 'Rice & dhal delivery in Dharga Town | Blynk',
    description: 'Order rice, flour, dhal and grams, oil, sugar and spices from Blynk and have them brought to your door in Dharga Town. Order 8 AM to 9 PM, pay cash on delivery.',
    h1: 'Rice and dhal, delivered in Dharga Town',
    lead: 'Rice and dhal are heavy to carry home. Add them to your Blynk basket with the rest of your groceries and the rider brings everything to your door in Dharga Town.',
    groups: [
      { main: 'Grocery › Rice & Flour', items: ['Rice', 'Flour', 'Dhal & Grams'] },
      { main: 'Grocery › Oil, Sugar & Salt', items: ['Oil', 'Sugar & Salt', 'Coconut & Coconut Milk', 'Sauces'] },
      { main: 'Grocery › Spices', items: ['Chilli & Curry Powder', 'Whole Spices', 'Curry Mixes', 'Goraka & Tamarind'] },
    ],
    areas: ['dharga-town', 'aluthgama', 'kaluwamodara', 'bentota', 'moragalla'],
  },
  {
    slug: 'milk-powder-delivery-aluthgama',
    crumb: 'Milk powder',
    title: 'Milk powder delivery in Aluthgama | Blynk',
    description: 'Order milk powder, eggs, tea, coffee and breakfast items from Blynk for delivery to your door in Aluthgama and Dharga Town. Pay cash on delivery.',
    h1: 'Milk powder and breakfast items, delivered in Aluthgama',
    lead: 'Keep the milk powder tin full without a trip to town. Order milk powder, eggs, tea and the rest of the breakfast shopping in the Blynk app and pay in cash at your door in Aluthgama.',
    groups: [
      { main: 'Breakfast & Drinks', items: ['Milk Powder & Eggs', 'Jam, Butter & Cereal', 'Tea & Coffee'] },
      { main: 'Breakfast & Drinks › Drinks', items: ['Milo & Nestomalt', 'Soft Drinks', 'Water & Juice'] },
    ],
    areas: ['aluthgama', 'dharga-town', 'bentota', 'moragalla', 'kaluwamodara'],
  },
];

// ---------------------------------------------------------------- translated home pages
const HOME = {
  si: {
    title: 'Blynk — දර්ගා නගරයට සහ අළුත්ගමට සිල්ලර බඩු නිවසටම',
    description: 'නැවුම් සිල්ලර බඩු සහ ගුණාත්මක අත්‍යවශ්‍ය දෑ දර්ගා නගරයේ සහ අළුත්ගම ඇතුළු අවට කි.මී. 4ක ප්‍රදේශයේ ඔබේ දොරකඩටම. සෑම දිනකම පෙ.ව. 8 – ප.ව. 9. භාණ්ඩ ලැබුණු විට ගෙවන්න.',
    chip: 'දර්ගා නගරය සහ අළුත්ගම', chip2: 'නැවුම් • ප්‍රාදේශීය',
    h1a: 'ඔබට අවශ්‍ය සියල්ල,', h1b: 'ඔබ ළඟටම.',
    lead: 'නැවුම්ව තෝරාගත් සිල්ලර බඩු සහ ගුණාත්මක අත්‍යවශ්‍ය දෑ — දර්ගා නගරයේ සහ අළුත්ගම ඇතුළු අවට කි.මී. 4ක ප්‍රදේශයේ ඔබේ දොරකඩටම.',
    perks: ['පුළුල් භාණ්ඩ<br>පරාසයක්', 'කි.මී. 4ක<br>ප්‍රදේශය', 'භාණ්ඩ ලැබුණු<br>විට ගෙවීම', 'Blynk<br>Points'],
    ctaSmall: 'iPhone සහ Android සඳහා',
    assure: 'Play Store හෝ App Store අවශ්‍ය නැත — ඔබේ දුරකථනයේ බ්‍රවුසරයෙන්ම ඇණවුම් කරන්න.',
    phonesAlt: 'Blynk ඇප් එක: කාණ්ඩ සහ ජනප්‍රිය භාණ්ඩ සහිත මුල් තිරය, සහ පිළිගැනීමේ තිරය',
    nav: ['මුල් පිටුව', 'ක්‍රියා කරන ආකාරය', 'භාණ්ඩ', 'බෙදාහැරීම', 'අප ගැන'],
    howArea: 'දර්ගා නගරයේ, අළුත්ගමේ හෝ කි.මී. 4ක් ඇතුළත ඕනෑම තැනක',
    prodKicker: 'භාණ්ඩ', prodH2: 'නැවුම්ව තෝරාගත් ගුණාත්මක අත්‍යවශ්‍ය දෑ.', more: 'සියල්ල බැලීමට Blynk විවෘත කරන්න',
    delLead: 'පෙ.ව. 8 සිට ප.ව. 9 දක්වා ඇණවුම්, සතියේ සෑම දිනකම, ඔබේ දොරකඩදී ගෙවීම.',
    stAreaT: 'දර්ගා නගරය සහ අවට, අළුත්ගම ද ඇතුළුව',
    aboutKicker: 'Blynk ගැන', aboutH2: 'ගුණාත්මක සිල්ලර බඩු, නැවුම්ව ඔබ වෙත.',
    aboutP: 'Blynk දර්ගා නගරයේ සහ අළුත්ගම ඇතුළු අවට කි.මී. 4ක ප්‍රදේශයේ ඔබේ දොරකඩට නැවුම් සිල්ලර බඩු සහ ගුණාත්මක අත්‍යවශ්‍ය දෑ ගෙනෙයි. ස්පර්ශ කිහිපයකින් ඇණවුම් කර, සිතියමේ ඔබේ රයිඩර් අනුගමනය කර, ඇණවුම ලැබුණු විට මුදලින් ගෙවන්න. සෑම ඇණවුමකින්ම Blynk Points උපයන්න: වියදම් කරන සෑම LKR 100කටම ලකුණු 1ක්.',
    areasH2: 'අප බෙදාහරින ප්‍රදේශ',
  },
  ta: {
    title: 'Blynk — தர்கா நகர், அளுத்கம பகுதிகளுக்கு மளிகைப் பொருள் டெலிவரி',
    description: 'புதிதாகத் தேர்ந்தெடுத்த மளிகைப் பொருட்களும் தரமான அன்றாடத் தேவைகளும் தர்கா நகர், அளுத்கம உட்பட சுற்றியுள்ள 4 கி.மீ. பகுதிகளில் உங்கள் வாசலுக்கே. தினமும் காலை 8 – இரவு 9. பொருள் கிடைத்ததும் பணம் செலுத்துங்கள்.',
    chip: 'தர்கா நகர் & அளுத்கம', chip2: 'புதியது • உள்ளூர்',
    h1a: 'உங்களுக்குத் தேவையான அனைத்தும்,', h1b: 'உங்கள் அருகிலேயே.',
    lead: 'புதிதாகத் தேர்ந்தெடுத்த மளிகைப் பொருட்களும் தரமான அன்றாடத் தேவைகளும் — தர்கா நகர், அளுத்கம உட்பட சுற்றியுள்ள 4 கி.மீ. பகுதிகளில் உங்கள் வாசலுக்கே.',
    perks: ['பலவகைப்<br>பொருட்கள்', '4 கி.மீ.<br>சுற்றளவு', 'கிடைத்ததும்<br>பணம்', 'Blynk<br>Points'],
    ctaSmall: 'iPhone & Android இரண்டிலும்',
    assure: 'Play Store அல்லது App Store தேவையில்லை — உங்கள் போனின் பிரவுசரிலேயே ஆர்டர் செய்யுங்கள்.',
    phonesAlt: 'Blynk ஆப்: வகைகளும் பிரபலமான பொருட்களும் உள்ள முகப்புத் திரை, வரவேற்புத் திரை',
    nav: ['முகப்பு', 'எப்படி வேலை செய்கிறது', 'பொருட்கள்', 'டெலிவரி', 'எங்களைப் பற்றி'],
    howArea: 'தர்கா நகர், அளுத்கம அல்லது 4 கி.மீ.க்குள் உள்ள ஏதேனும் ஒரு',
    prodKicker: 'பொருட்கள்', prodH2: 'புதிதாகத் தேர்ந்தெடுத்த தரமான தேவைகள்.', more: 'அனைத்தையும் பார்க்க Blynk-ஐத் திறங்கள்',
    delLead: 'காலை 8 முதல் இரவு 9 வரை ஆர்டர் செய்யலாம், வாரத்தின் ஒவ்வொரு நாளும், வாசலில் பணம் செலுத்தலாம்.',
    stAreaT: 'தர்கா நகரும் சுற்றுப்புறமும், அளுத்கம உட்பட',
    aboutKicker: 'Blynk பற்றி', aboutH2: 'தரமான மளிகைப் பொருட்கள், புதிதாக உங்களிடம்.',
    aboutP: 'தர்கா நகர், அளுத்கம உட்பட சுற்றியுள்ள 4 கி.மீ. பகுதிகளில் உங்கள் வாசலுக்கு Blynk புதிய மளிகைப் பொருட்களையும் தரமான அன்றாடத் தேவைகளையும் கொண்டு வருகிறது. சில தட்டல்களில் ஆர்டர் செய்து, வரைபடத்தில் உங்கள் ரைடரைப் பின்தொடர்ந்து, ஆர்டர் வந்ததும் பணமாகச் செலுத்துங்கள். ஒவ்வொரு ஆர்டரிலும் Blynk Points பெறுங்கள்: செலவிடும் ஒவ்வொரு LKR 100க்கும் 1 புள்ளி.',
    areasH2: 'நாங்கள் டெலிவரி செய்யும் பகுதிகள்',
  },
};

// ---------------------------------------------------------------- URLs
const url = (path) => `${SITE}${path}`;
const areaPath = (slug, lang) => (lang === 'en' ? `/${slug}` : `/${lang}/${slug}`);
const homePath = (lang) => (lang === 'en' ? '/' : `/${lang}/`);
const areaName = (a, lang) => a.name[lang];

// ---------------------------------------------------------------- page parts
function head({ lang, title, description, path, alternates, ld }) {
  const t = T[lang];
  const alt = alternates
    ? [...LANGS.map((l) => `  <link rel="alternate" hreflang="${l}" href="${url(alternates[l])}">`),
      `  <link rel="alternate" hreflang="x-default" href="${url(alternates.en)}">`].join('\n') + '\n'
    : '';
  const altLocales = alternates ? LANGS.filter((l) => l !== lang).map((l) => `  <meta property="og:locale:alternate" content="${T[l].locale}">\n`).join('') : '';
  const fonts = lang === 'si' ? '&family=Noto+Sans+Sinhala:wght@400;600;700;800'
    : lang === 'ta' ? '&family=Noto+Sans+Tamil:wght@400;600;700;800' : '';
  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  ${GTM.head}
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${url(path)}">
${alt}  <meta name="theme-color" content="#FFE141">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
  <link rel="apple-touch-icon" href="/assets/icon-192.png">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Blynk">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url(path)}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Blynk: groceries delivered in Dharga Town and Aluthgama">
  <meta property="og:locale" content="${t.locale}">
${altLocales}  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${OG_IMAGE}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900${fonts}&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${CSS}">
  <link rel="stylesheet" href="${PAGES_CSS}">
${(ld || []).map((d) => `  ${jsonLd(d)}`).join('\n')}
</head>`;
}

function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: url(it.path) })),
  };
}

function langSwitch(lang, alternates) {
  return `<nav class="lang" aria-label="${esc(T[lang].langNav)}">${LANGS.map((l) =>
    `<a href="${alternates[l]}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="page"' : ''}>${esc(T[l].langName)}</a>`).join('')}</nav>`;
}

function nav(lang, order) {
  return `  <header class="nav">
    <a class="nav__brand" href="${homePath(lang)}" aria-label="Blynk home">
      <img src="/assets/logo-mark.png" alt="" width="50" height="60">
      <span>blynk</span>
    </a>
    <a class="btn btn--yellow btn--pill nav__order" href="${order}" data-order="header">${esc(T[lang].orderShort)} ${ICON.arrow}</a>
  </header>`;
}

function footer(lang, alternates) {
  const t = T[lang];
  const areas = AREAS.map((a) => `<a href="${areaPath(a.slug, lang)}">${esc(areaName(a, lang))}</a>`).join('\n        ');
  const langs = LANGS.map((l) => {
    const href = alternates ? alternates[l] : homePath(l);
    const current = alternates && l === lang ? ' aria-current="page"' : '';
    return `<a href="${href}" hreflang="${l}" lang="${l}"${current}>${esc(T[l].langName)}</a>`;
  }).join('\n        ');
  return `  <footer class="footer">
    <div class="wrap footer__inner">
      <a class="footer__brand" href="${homePath(lang)}"><img src="/assets/logo-mark.png" alt="" width="28" height="34" loading="lazy"> blynk</a>
      <nav aria-label="${esc(t.areasNav)}">
        ${areas}
      </nav>
      <p class="footer__help">${esc(t.help)} <a href="tel:${PHONE}">${esc(t.call)}</a>
        <a href="${WHATSAPP}" target="_blank" rel="noopener">${esc(t.wa)}</a></p>
      <small>© ${YEAR} Blynk · ${esc(t.footerPlace)}</small>
      <nav class="footer__legal" aria-label="${esc(t.legalNav)}">
        <a href="/privacy">${esc(t.privacy)}</a>
        <a href="/terms">${esc(t.terms)}</a>
        <a href="/refunds">${esc(t.refunds)}</a>
      </nav>
      <nav class="footer__legal" aria-label="${esc(t.langNav)}">
        ${langs}
      </nav>
    </div>
  </footer>`;
}

const scripts = (extra = '') => `  <script src="${ANALYTICS}" defer></script>${extra}`;

function ctaButton(lang, href, where) {
  const t = T[lang];
  return `<a class="cta cta--primary" href="${href}" data-order="${where}">
            ${ICON.phone}
            <span class="cta__text"><strong>${esc(t.order)}</strong><small>${esc(t.orderSmall)}</small></span>
            <svg class="i cta__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </a>`;
}

function catsSection(lang, groups, id = 'products') {
  const t = T[lang];
  const cards = groups.map((g) => `
          <li><h3>${esc(g.main)}</h3><p>${g.items.map(esc).join(' · ')}</p></li>`).join('');
  return `    <section class="section section--tint" id="${id}" aria-labelledby="${id}-title">
      <div class="wrap">
        <div class="head">
          <p class="kicker">${esc(t.catsKicker)}</p>
          <h2 id="${id}-title">${esc(t.catsH2)}</h2>
          <p class="lead">${esc(t.catsNote)}</p>
        </div>
        <ul class="cats">${cards}
        </ul>
      </div>
    </section>`;
}

function howSection(lang, vars) {
  const t = T[lang];
  return `    <section class="section" id="how" aria-labelledby="how-title">
      <div class="wrap">
        <div class="head">
          <p class="kicker">${esc(t.howKicker)}</p>
          <h2 id="how-title">${esc(t.howH2)}</h2>
        </div>
        <ol class="how">
          <li><span class="how__n">01</span><strong>${esc(t.how1)}</strong><span>${esc(fill(t.how1t, vars))}</span></li>
          <li><span class="how__n">02</span><strong>${esc(t.how2)}</strong><span>${esc(t.how2t)}</span></li>
          <li><span class="how__n">03</span><strong>${esc(t.how3)}</strong><span>${esc(t.how3t)}</span></li>
        </ol>
      </div>
    </section>`;
}

function statsSection(lang, { lead = '', areaText } = {}) {
  const t = T[lang];
  return `    <section class="section" id="delivery" aria-labelledby="delivery-title">
      <div class="wrap delivery">
        <div class="head">
          <p class="kicker">${esc(t.delKicker)}</p>
          <h2 id="delivery-title">${esc(t.delH2)}</h2>${lead ? `\n          <p class="lead">${esc(lead)}</p>` : ''}
        </div>
        <dl class="stats">
          <div><dt>${esc(t.stArea)}</dt><dd><b>4<small>KM</small></b><span>${esc(areaText || t.stAreaT)}</span></dd></div>
          <div><dt>${esc(t.stHours)}</dt><dd><b>8–9</b><span>${esc(t.stHoursT)}</span></dd></div>
          <div><dt>${esc(t.stPay)}</dt><dd><b class="stats__words">${esc(t.stPayB)}</b><span>${esc(t.stPayT)}</span></dd></div>
          <div><dt>${esc(t.stPts)}</dt><dd><b>1</b><span>${esc(t.stPtsT)}</span></dd></div>
        </dl>
      </div>
    </section>`;
}

function band(lang, href) {
  const t = T[lang];
  return `    <section class="band" id="about" aria-labelledby="band-title">
      <div class="wrap band__inner">
        <div>
          <p class="kicker kicker--ink">${esc(t.bandKicker)}</p>
          <h2 id="band-title">${esc(t.bandH2)}</h2>
          <p>${esc(t.bandP)}</p>
        </div>
        <div class="band__actions">
          <a class="btn btn--ink btn--pill" href="${href}" data-order="band">${esc(t.order)} ${ICON.arrow}</a>
        </div>
      </div>
    </section>`;
}

function factsLine(lang) {
  const t = T[lang];
  return `<ul class="facts-line">
            <li>${ICON.star}${esc(t.factHours)}</li>
            <li>${ICON.shield}${esc(t.factCash)}</li>
            <li>${ICON.pin}${esc(t.factRange)}</li>
          </ul>`;
}

const reviewComment = (lang) => {
  const name = lang === 'si' ? 'Sinhala' : 'Tamil';
  return `<!-- MACHINE-WRITTEN ${name.toUpperCase()} TRANSLATION (${LASTMOD}). It has not been checked by a person:
     a native ${name} speaker must review this page before it is promoted (ads, posts, links).
     Product, category and brand names stay in English, as in the app.
     Generated by apps/customer-site/scripts/build-seo-pages.mjs: edit the copy there, not here. -->\n`;
};
const generatedComment = '<!-- Generated by apps/customer-site/scripts/build-seo-pages.mjs: edit the copy there, not here. -->\n';

function page({ lang, headHtml, body }) {
  const top = lang === 'en' ? generatedComment : reviewComment(lang);
  return `<!doctype html>\n${top}<html lang="${lang}">\n${headHtml}\n<body class="seo-page">\n  ${GTM.body}\n${body}\n</body>\n</html>\n`;
}

// ---------------------------------------------------------------- area page
function areaPage(area, lang) {
  const t = T[lang];
  const name = areaName(area, lang);
  const vars = { area: name, areaTo: area.to?.[lang] ?? name, areaIn: area.in?.[lang] ?? name };
  const path = areaPath(area.slug, lang);
  const alternates = Object.fromEntries(LANGS.map((l) => [l, areaPath(area.slug, l)]));
  const order = orderUrl('area_page', area.slug.replace(/-/g, '_'), lang);
  const title = fill(t.areaTitle, vars);
  const description = fill(t.areaDesc, vars);
  const ld = [breadcrumbLd([{ name: t.home, path: homePath(lang) }, { name, path }])];
  const others = AREAS.filter((a) => a.slug !== area.slug)
    .map((a) => `<li><a href="${areaPath(a.slug, lang)}">${esc(areaName(a, lang))}</a></li>`).join('');
  const popular = lang === 'en' && area.popular.length
    ? `
          <h2 class="links-title">${esc(fill(t.popularH2, vars))}</h2>
          <ul class="links">${area.popular.map((slug) => {
            const c = CATEGORY_PAGES.find((x) => x.slug === slug);
            return `<li><a href="/${c.slug}">${esc(c.crumb)}</a></li>`;
          }).join('')}</ul>` : '';
  const body = `${nav(lang, order)}

  <main id="top">
    <section class="page-hero" id="order" aria-labelledby="page-title">
      <div class="wrap">
        <div class="crumbs-row">
          <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${homePath(lang)}">${esc(t.home)}</a></li><li aria-current="page">${esc(name)}</li></ol></nav>
          ${langSwitch(lang, alternates)}
        </div>
        <p class="kicker">${esc(t.kicker)}</p>
        <h1 id="page-title">${esc(fill(t.areaH1, vars))}</h1>
        <p class="lead">${esc(area.lead[lang])}</p>
        <div class="page-hero__cta">
          ${ctaButton(lang, order, 'hero')}
        </div>
        ${factsLine(lang)}
      </div>
    </section>

    <section class="section section--local" aria-labelledby="local-title">
      <div class="wrap prose">
        <h2 id="local-title">${esc(area.localH2[lang])}</h2>
        <p>${esc(area.local[lang])}</p>
      </div>
    </section>

${catsSection(lang, CATEGORIES)}

${howSection(lang, vars)}

${statsSection(lang)}

    <section class="section section--tint" aria-labelledby="areas-title">
      <div class="wrap">
        <h2 class="links-title" id="areas-title">${esc(t.areasH2)}</h2>
        <ul class="links">${others}</ul>${popular}
      </div>
    </section>

${band(lang, order)}
  </main>

${footer(lang, alternates)}

${scripts()}`;
  return { path, alternates, html: page({ lang, headHtml: head({ lang, title, description, path, alternates, ld }), body }) };
}

// ---------------------------------------------------------------- category page
function categoryPage(c) {
  const lang = 'en';
  const t = T.en;
  const path = `/${c.slug}`;
  const order = orderUrl('category_page', c.slug.replace(/-/g, '_'));
  const ld = [breadcrumbLd([{ name: t.home, path: '/' }, { name: c.crumb, path }])];
  const areaLinks = c.areas.map((s) => {
    const a = AREAS.find((x) => x.slug === s);
    return `<li><a href="/${a.slug}">${esc(a.name.en)}</a></li>`;
  }).join('');
  const more = CATEGORY_PAGES.filter((x) => x.slug !== c.slug).map((x) => `<li><a href="/${x.slug}">${esc(x.crumb)}</a></li>`).join('');
  const body = `${nav(lang, order)}

  <main id="top">
    <section class="page-hero" id="order" aria-labelledby="page-title">
      <div class="wrap">
        <div class="crumbs-row">
          <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">${esc(t.home)}</a></li><li aria-current="page">${esc(c.crumb)}</li></ol></nav>
        </div>
        <p class="kicker">Home delivery</p>
        <h1 id="page-title">${esc(c.h1)}</h1>
        <p class="lead">${esc(c.lead)}</p>
        <div class="page-hero__cta">
          ${ctaButton(lang, order, 'hero')}
        </div>
        ${factsLine(lang)}
      </div>
    </section>

    <section class="section section--tint" id="products" aria-labelledby="products-title">
      <div class="wrap">
        <div class="head">
          <p class="kicker">${esc(t.catsKicker)}</p>
          <h2 id="products-title">In the Blynk app</h2>
          <p class="lead">Brands and pack sizes depend on what is in stock. The app shows what is available right now, and the price, before you order.</p>
        </div>
        <ul class="cats">${c.groups.map((g) => `
          <li><h3>${esc(g.main)}</h3><p>${g.items.map(esc).join(' · ')}</p></li>`).join('')}
        </ul>
      </div>
    </section>

${howSection(lang, { area: AREAS.find((a) => a.slug === c.areas[0]).name.en })}

${statsSection(lang)}

    <section class="section section--tint" aria-labelledby="areas-title">
      <div class="wrap">
        <h2 class="links-title" id="areas-title">${esc(t.areasNav)}</h2>
        <ul class="links">${areaLinks}</ul>
        <h2 class="links-title">More to order</h2>
        <ul class="links">${more}</ul>
      </div>
    </section>

${band(lang, order)}
  </main>

${footer(lang, null)}

${scripts()}`;
  return { path, html: page({ lang, headHtml: head({ lang, title: c.title, description: c.description, path, ld }), body }) };
}

// ---------------------------------------------------------------- translated home page
function homePage(lang) {
  const h = HOME[lang];
  const t = T[lang];
  const path = homePath(lang);
  const alternates = { en: '/', si: '/si/', ta: '/ta/' };
  const order = orderUrl('landing', 'home', lang);
  const ld = [{
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: h.title,
    url: url(path),
    inLanguage: lang,
    description: h.description,
    about: { '@id': `${SITE}/#store` },
    isPartOf: { '@id': `${SITE}/#website` },
  }];
  const perkIcons = [
    ['green', ICON.cart], ['green', ICON.pin], ['green', ICON.shield], ['yellow', ICON.star],
  ];
  const tiles = [
    ['rice', 'Rice & Flour', ICON.rice], ['dairy', 'Breakfast & Drinks', ICON.drinks], ['snacks', 'Snacks', ICON.snacks],
    ['drinks', 'Baby Items', ICON.bottle], ['care', 'Ladies Items', ICON.care], ['bakery', 'Personal Care', ICON.soap],
    ['home', 'Household', ICON.home],
  ];
  const areas = AREAS.map((a) => `<li><a href="${areaPath(a.slug, lang)}">${esc(areaName(a, lang))}</a></li>`).join('');
  const body = `  <div class="progress" aria-hidden="true"></div>
  <header class="nav">
    <a class="nav__brand" href="${path}" aria-label="Blynk home">
      <img src="/assets/logo-mark.png" alt="" width="50" height="60">
      <span>blynk</span>
    </a>
    <nav class="nav__links" aria-label="Main">
      <a href="#top" class="is-active">${esc(h.nav[0])}</a>
      <a href="#how">${esc(h.nav[1])}</a>
      <a href="#products">${esc(h.nav[2])}</a>
      <a href="#delivery">${esc(h.nav[3])}</a>
      <a href="#about">${esc(h.nav[4])}</a>
    </nav>
    <a class="btn btn--yellow btn--pill nav__cta" href="${order}" data-order="header">${esc(t.orderShort)} ${ICON.arrow}</a>
  </header>

  <main id="top">
    <section class="hero">
      <div class="hero__copy">
        ${langSwitch(lang, alternates)}
        <div class="chips">
          <span class="chip chip--green">${ICON.pin} ${esc(h.chip)}</span>
          <span class="chip">${esc(h.chip2)}</span>
        </div>
        <h1 class="hero__title">${esc(h.h1a)} <span>${esc(h.h1b)}</span></h1>
        <p class="hero__lead">${esc(h.lead)}</p>
        <ul class="perks" aria-label="Blynk">
${h.perks.map((p, i) => `          <li><span class="perk-icon perk-icon--${perkIcons[i][0]}">${perkIcons[i][1]}</span><span>${p}</span></li>`).join('\n')}
        </ul>
        <div class="ctas">
          <a class="cta cta--primary" href="${order}" data-order="hero">
            ${ICON.phone}
            <span class="cta__text"><strong>${esc(t.order)}</strong><small>${esc(h.ctaSmall)}</small></span>
            <svg class="i cta__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </a>
        </div>
        <p class="assure">${ICON.shield} ${esc(h.assure)}</p>
      </div>
      <div class="hero__art">
        <img src="/assets/phones.webp" alt="${esc(h.phonesAlt)}" width="736" height="790" fetchpriority="high">
      </div>
      <img class="deco deco--veggies" src="/assets/veggies-left.webp" alt="" width="300" height="186" loading="lazy">
      <img class="deco deco--veggies-right" src="/assets/veggies-left.webp" alt="" width="300" height="186" loading="lazy">
    </section>

${howSection(lang, { area: h.howArea, areaIn: h.howArea })}

    <section class="section section--tint" id="products" aria-labelledby="products-title">
      <div class="wrap">
        <div class="head head--split">
          <div>
            <p class="kicker">${esc(h.prodKicker)}</p>
            <h2 id="products-title">${esc(h.prodH2)}</h2>
          </div>
          <a class="btn btn--ink btn--pill" href="${order}" data-order="products">${esc(t.order)} ${ICON.arrow}</a>
        </div>
        <ul class="bento">
          <li class="bento__big">
            <img src="/assets/veggies-left.webp" alt="" width="300" height="186" loading="lazy">
            <span>Grocery</span>
          </li>
${tiles.map(([cls, name, icon]) => `          <li class="bento__tile bento__tile--${cls}">${icon}<span>${esc(name)}</span></li>`).join('\n')}
          <li class="bento__more"><a href="${order}" data-order="products_grid">${esc(h.more)} ${ICON.arrow}</a></li>
        </ul>
      </div>
    </section>

${statsSection(lang, { lead: h.delLead, areaText: h.stAreaT })}

    <section class="section section--tint" aria-labelledby="areas-title">
      <div class="wrap">
        <h2 class="links-title" id="areas-title">${esc(h.areasH2)}</h2>
        <ul class="links">${areas}</ul>
      </div>
    </section>

    <section class="band" id="about" aria-labelledby="about-title">
      <div class="wrap band__inner">
        <div>
          <p class="kicker kicker--ink">${esc(h.aboutKicker)}</p>
          <h2 id="about-title">${esc(h.aboutH2)}</h2>
          <p>${esc(h.aboutP)}</p>
        </div>
        <div class="band__actions">
          <a class="btn btn--ink btn--pill" href="${order}" data-order="about">${esc(t.order)}</a>
        </div>
      </div>
    </section>
  </main>

${footer(lang, alternates)}

${scripts(`\n  <script src="/app.js?v=20261014b" defer></script>`)}`;
  return { path, alternates, html: page({ lang, headHtml: head({ lang, title: h.title, description: h.description, path, alternates, ld }), body }) };
}

// ---------------------------------------------------------------- sitemap + robots
// The hand-written pages, with the date their content last changed. The legal
// pages are built by build-legal-pages.mjs; their date is the "Last updated"
// in legal/legal-config.json.
const LEGAL_UPDATED = JSON.parse(readFileSync(join(siteDir, 'legal', 'legal-config.json'), 'utf8')).lastUpdated;
export const STATIC_PAGES = [
  { path: '/', lastmod: LASTMOD, alternates: { en: '/', si: '/si/', ta: '/ta/' } },
  { path: '/privacy', lastmod: LEGAL_UPDATED },
  { path: '/terms', lastmod: LEGAL_UPDATED },
  { path: '/refunds', lastmod: LEGAL_UPDATED },
];

function sitemap(entries) {
  const rows = entries.map((e) => {
    const alts = e.alternates
      ? [...LANGS.map((l) => `\n    <xhtml:link rel="alternate" hreflang="${l}" href="${url(e.alternates[l])}"/>`),
        `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${url(e.alternates.en)}"/>`].join('')
      : '';
    return `  <url>\n    <loc>${url(e.path)}</loc>\n    <lastmod>${e.lastmod}</lastmod>${alts}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${rows.join('\n')}
</urlset>
`;
}

const ROBOTS = `# blynk.lk - every page may be crawled. The shop (/app/) is a web app
# with no pages of its own to index; it is left open so Google can render
# the links that point to it.
User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

// ---------------------------------------------------------------- build
let GTM;
export function build() {
  GTM = gtmBlocks();
  const files = new Map();
  const entries = [...STATIC_PAGES];
  const add = (p, lastmod = LASTMOD) => {
    const rel = p.path === '/' ? 'index.html' : `${p.path.replace(/^\/|\/$/g, '')}/index.html`;
    files.set(rel, p.html);
    entries.push({ path: p.path, lastmod, alternates: p.alternates });
  };
  for (const lang of ['si', 'ta']) add(homePage(lang));
  for (const area of AREAS) for (const lang of LANGS) add(areaPage(area, lang));
  for (const c of CATEGORY_PAGES) add(categoryPage(c));
  // Sitemap order: home pages, areas, categories, legal.
  const rank = (p) => (p === '/' || /^\/(si|ta)\/$/.test(p) ? 0 : /^\/(privacy|terms|refunds)$/.test(p) ? 3
    : CATEGORY_PAGES.some((c) => p === `/${c.slug}`) ? 2 : 1);
  entries.sort((a, b) => rank(a.path) - rank(b.path));
  files.set('sitemap.xml', sitemap(entries));
  files.set('robots.txt', ROBOTS);
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const [rel, content] of build()) {
    const file = join(outDir, rel);
    const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current === content) continue;
    if (check) { stale.push(rel); continue; }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    console.log(`wrote pages/${rel}`);
  }
  if (check && stale.length) {
    console.error(`out of date (run node apps/customer-site/scripts/build-seo-pages.mjs): ${stale.join(', ')}`);
    process.exit(1);
  }
  if (check) console.log('SEO pages are up to date');
}
