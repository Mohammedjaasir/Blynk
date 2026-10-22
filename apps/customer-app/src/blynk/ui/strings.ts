/*
 * UI wording for the shell, browsing and the small notices (one place per feature, plain
 * constants). A later phase adds Sinhala and Tamil: these objects are what gets translated,
 * so screens read their text from here instead of writing it inline.
 */

export const TABS = {
  shop: 'Shop',
  orders: 'Orders',
  help: 'Help',
  profile: 'Profile',
  /** Read after "Orders" by a screen reader while an order is open. */
  openOrderBadge: 'order in progress',
} as const;

export const CATEGORIES = {
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
} as const;

export const PROMO = {
  /** Accessibility name of the carousel and of a banner without a title. */
  carousel: 'Offers',
  offer: 'Offer',
  slideOf: (i: number, n: number) => `Offer ${i} of ${n}`,
} as const;

export const USUALS = {
  title: 'Your usuals',
  addAll: 'Add all',
  fromLast: (orderNumber: string | null) => (orderNumber ? `From your last order, ${orderNumber}` : 'From your last order'),
} as const;

export const OFFLINE = {
  offline: "You're offline. Showing saved items.",
  restored: 'Back online',
  tryAgain: 'Try again',
} as const;

export const CONFIG = {
  title: "This build isn't configured",
  native: 'Install the latest version of Blynk from the store and try again.',
  web: 'Please try again in a little while.',
  code: (code: string) => `Code: ${code}`,
} as const;

export const CLEAR_CART = {
  button: 'Clear cart',
  title: 'Clear cart?',
  message: 'Every item is removed. You can add them again from the shop.',
  cancel: 'Cancel',
  confirm: 'Clear cart',
} as const;

export const DOCTORS_OFF = {
  title: 'Doctor channelling is not available right now.',
  message: 'Your booked appointments are still in My appointments.',
  myAppointments: 'My appointments',
  goToShop: 'Go to shop',
} as const;

/** The start gate's login (Flutter SessionGate + LoginScreen's Skip, owner 2026-10-14). */
export const LOGIN_GATE = {
  skip: 'Skip for now',
  /** Read by a screen reader after the Skip button. */
  skipHint: 'Opens the shop. You can log in later from Profile.',
} as const;

/** The phone login's yellow hero (rider mascot). The headlines take turns, about 3 s each. */
export const LOGIN = {
  headlines: ['Fresh to your door', 'Delivered in minutes', 'Groceries, delivered fast'],
  /** Read by a screen reader for the (decorative) rider picture. */
  heroLabel: 'The Blynk rider bringing groceries',
} as const;

/** The "Order placed!" screen (src/app/placed.tsx). The stage lines take turns under the headline. */
export const PLACED = {
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
} as const;

/**
 * The one small line under a product tile's price that rolls between the struck reference and
 * the saving (src/components/PriceRoll.tsx, decided in src/blynk/lib/priceRoll.ts). True facts
 * only: the saving against the struck regular price / MRP the tile already shows.
 */
export const PRICE_ROLL = {
  save: (amount: string) => `Save ${amount}`,
  /** Added after the saving when the struck reference is the MRP and the tile has room. */
  vsMrp: ' vs MRP',
  /** A category offer's saving ("5% off", as the aisle's "5% off everything here"). */
  pctOff: (pct: number) => `${pct}% off`,
  /** Screen reader: the struck reference. */
  mrp: (amount: string) => `MRP ${amount}`,
  regular: (amount: string) => `Regular price ${amount}`,
} as const;

/** The end of Home's list: two quiet lines over the rider bouncing on a trampoline (src/components/HomeFooter.tsx). */
export const HOME_FOOTER = {
  small: 'Fresh groceries delivered',
  large: 'to your door',
  /** Read by a screen reader for the (decorative) picture. */
  label: 'Fresh groceries delivered to your door',
} as const;

/** Profile's hero (src/components/TabHero.tsx ProfileHero): a guest's invitation, or the greeting. */
export const PROFILE_HERO = {
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
} as const;

/** Help's hero (src/components/TabHero.tsx HelpHero) and its contact rows. */
export const HELP_HERO = {
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
} as const;
