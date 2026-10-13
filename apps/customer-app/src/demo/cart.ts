/*
 * Mock content for the cart, login, OTP and address screens, copied verbatim from the
 * reference recording (0:41–1:20). Nothing here is fetched or sent anywhere.
 * Prices are demo rupees (₹), so they use `rupee()` below and never formatLkr.
 */
import type { Product } from '@/blynk/api/types';

/** "₹79", "₹8.35"; `fixed` keeps two decimals ("₹25.00"). */
export function rupee(n: number, fixed = false): string {
  const v = Math.round(n * 100) / 100;
  return `₹${fixed ? v.toFixed(2) : Number.isInteger(v) ? String(v) : v.toFixed(2)}`;
}

const demo = (id: string, name: string, price: number, offer: number | null = null): Product => ({
  id: `demo-${id}`, category_id: 'demo-cakes', category_name: 'Cakes', name, slug: id,
  description: null, unit: '1 pc', pack_size: null, image_url: null, image_focal_x: null, image_focal_y: null,
  selling_price: price, offer_price: offer, offer_ends_at: null, offer_kind: offer == null ? null : 'PRODUCT', is_available: true,
});

/** The three lines in the video's cart, in order. */
export const CART_ITEMS: Product[] = [
  demo('greeting-card', 'Happy Birthday Greeting Card', 79),
  demo('knife-candle', 'Knife and Candle', 9),
  demo('red-velvet-cupcake', 'Red Velvet Cupcake', 109, 79),
];

/** "COMPLETE YOUR MEAL" picks (shown once the shopper has logged in). */
export const MEAL_PICKS: { product: Product; emoji: string; bg: string }[] = [
  { product: demo('vanilla-bento', 'Vanill - a Bento Cake', 259), emoji: '🎂', bg: '#EDE3FF' },
  { product: demo('magic-candle', 'Magic Candle', 94), emoji: '🕯️', bg: '#FFF3C9' },
  { product: demo('red-velvet-bento', 'Red Velvet Bento Cake', 359), emoji: '🍰', bg: '#FFE3EC' },
];

/** localStorage seed (key blynk.app.cart.v1) matching the video's cart. */
export const CART_SEED = { v: 1, lines: CART_ITEMS.map((product) => ({ product, quantity: 1 })) };

export const COPY = {
  storeName: 'Ovenfresh Cakes And Desserts',
  feePill: '₹0 Packaging Fee · ₹0 Platform fee',
  burst1: ['OFFLINE PRICE', 'MATCH'],
  burst2: { big: '₹0', lines: ['Packaging fee', 'Platform fee'] },
  hurrayTitle: 'Hurray! Free delivery\nUnlocked!',
  hurraySub: 'Applied directly on bill, above ₹129',
  hurrayCta: 'YAY!',
  chips: { add: 'Add Items', cooking: 'Cooking requests', cutlery: 'Cutlery Needed' },
  cutleryTip: 'Tap here if you need cutlery',
  mealTitle: 'COMPLETE YOUR MEAL',
  paymentOffers: 'Payment offers & more',
  itemsAtSaving: "₹30 saved with 'Items at ₹79'",
  freeDeliverySaving: '₹25 saved with free delivery',
  applied: '✓ Applied',
  instructions: 'Add Delivery Instructions',
  thatsIt: "THAT'S IT. No unnecessary fees. Ever!",
  policyTitle: 'Cancellation policy:',
  policy: 'Please double-check your order and address details. Orders are non-refundable once placed.',
  almost: 'Almost There',
  almostSub: 'Login/Create Account quickly to place order',
  proceedPhone: 'Proceed with Phone Number',
  whereTitle: 'Where would you like us to deliver this order?',
  addAddress: 'Add or Select address',
  login: 'Login',
  loginSub: 'Enter your phone number to proceed',
  countryFlag: '🇮🇳',
  countryCode: '+91',
  mobileLabel: 'Mobile Number',
  continue: 'Continue',
  verifyTitle: 'Verify Details',
  otpSentTo: (phone: string) => `OTP sent to +91-${phone}`,
  enterOtp: 'Enter OTP',
  retry: (s: number) => `Didn't receive the OTP? Retry in 00:${String(s).padStart(2, '0')}`,
  verify: 'Verify And Proceed',
};

/** Bill rows. "before" is the logged-out cart, "after" is once a number is entered (video 1:06+). */
export const BILL = {
  taxes: 8.35,
  deliveryFee: 25,
  before: { saved: 110, distance: 'Delivery Fee | 4.8 kms', feeFixed: true, thatsIt: false },
  after: { saved: 55, distance: 'Delivery Fee | 5.7 kms', feeFixed: false, thatsIt: true },
  freeNote: 'FREE Delivery on your order!',
};

export const ADDRESS = {
  search: 'Search an area or address',
  tip: 'Move the pin to change location',
  current: 'Current location',
  loadingHint: 'Order will be delivered here',
  placedHint: 'Place the pin at exact delivery location',
  name: 'Vaiyapuri Nagar',
  line: 'Vaiyapuri Nagar, Kurumbapalayam SSKulam, Tamil Nadu, India',
  cta: 'Confirm & proceed',
  /**
   * Map labels exactly as far as the video shows them (fragments cut by the screen edge stay
   * cut). dx/dy: top-left of the text relative to the pin head centre; icon: POI dot centre.
   */
  labels: [
    { t: 'ilai Residency', dx: -198, dy: -242 },
    { t: 'SNS SPINE: T\nFounder’s Clu', dx: 103, dy: -157, icon: [89, -141] },
    { t: 'SNS College of Nursing', dx: -125, dy: -99, icon: [30, -92] },
    { t: 'OYO\nny…\n(231)\nhotel', dx: -198, dy: -86, small: true, icon: [-161, -59] },
    { t: 'nai Mess\nனை மெஸ்\nt food', dx: -198, dy: 67, small: true },
    { t: 'ri Nandhi Temple\nஸ்ரீ நந்தி கோவில்', dx: -198, dy: 190, icon: [-82, 202] },
    { t: 'SNS Lawn', dx: 10, dy: 418, icon: [85, 426] },
  ] as { t: string; dx: number; dy: number; small?: boolean; icon?: [number, number] }[],
};
