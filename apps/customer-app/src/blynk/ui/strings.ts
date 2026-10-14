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
