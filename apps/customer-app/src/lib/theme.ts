/*
 * Blynk colours. The key names are kept from the original layout so every screen keeps
 * its structure: "purple" is now Blynk ink, "pink" is Blynk green, "yellow" is Blynk yellow.
 */
export const C = {
  green: '#0C831F',
  greenDark: '#0A6B19',
  greenSoft: '#A8DDB5',
  greenTint: '#E7F5EA',
  pink: '#0C831F',
  pinkSoft: '#DDF2E1',
  pinkTint: '#FFF8D6',
  purple: '#1A1D2E',
  purpleLight: '#2A2E45',
  yellow: '#FFE141',
  wash: '#FFFADD',
  ink: '#1A1D2E',
  text: '#2B2E3D',
  sub: '#6E7080',
  faint: '#A3A5B0',
  line: '#ECECF1',
  bg: '#F4F4F6',
  white: '#FFFFFF',
  skeleton: '#E9E9EF',
  tile: '#F3F4F6',
  problem: '#C0392B',
  // Blynk's brand colour is yellow (owner, 2026-10-13). Yellow is a FILL; anything sitting on
  // it uses brandInk. Never use brand yellow for text or thin lines on white: use brandText.
  brand: '#FFE141',
  brandDeep: '#F2C600', // pressed state, borders around yellow fills
  brandInk: '#1A1D2E', // text and icons on brand yellow
  brandText: '#7A5F00', // yellow-family text on white (meets AA contrast)
  brandSoft: '#FFEFA0',
  brandTint: '#FFF8D6',
  // Food-standard marks only (veg / non-veg). Not a brand colour.
  veg: '#0C831F',
  nonVeg: '#C0392B',
};

export const F = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semi: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
  black: 'Outfit_800ExtraBold',
  display: 'BowlbyOne_400Regular',
  condensed: 'Anton_400Regular',
};

/*
 * A small type and spacing scale (clean pass, 2026-10-14: "make it more clean minimal").
 * Section headers everywhere use T.section / T.seeAll; Home stacks its sections SPACE.section
 * apart. Designed banner titles (hero, promo band) keep their own display type.
 */
export const T = {
  /** Section header: "Grocery & Kitchen", "Under LKR 300", "Your usuals". */
  section: { fontFamily: F.semi, fontSize: 18, color: C.ink, letterSpacing: -0.2 },
  /** The quiet "See all" link beside a section header. */
  seeAll: { fontFamily: F.medium, fontSize: 13.5, color: C.sub },
  /** Card / row titles. */
  title: { fontFamily: F.bold, fontSize: 17, color: C.ink, letterSpacing: -0.2 },
  body: { fontFamily: F.regular, fontSize: 14, color: C.text },
  /** Helper lines under a title (one line). */
  meta: { fontFamily: F.regular, fontSize: 12.5, color: C.sub },
  /** The one small label on a product tile. */
  label: { fontFamily: F.medium, fontSize: 11, color: C.sub },
} as const;

export const SPACE = {
  /** Between Home sections. */
  section: 24,
  /** Page side gutter. */
  gutter: 15,
  /** Header to its content. */
  head: 12,
} as const;
