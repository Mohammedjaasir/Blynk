/*
 * Home's mock content, read off the reference recording (0:04–0:31) frame by frame.
 * Owner, 2026-10-13: "dont add any products from existing blynk platform for now,
 * generate exactly in the video". Names, ratings, ETAs, ₹ prices, "Other apps" ranges and
 * "% lower" figures are the video's; dishes the video only shows cut off at the screen
 * edge are completed in the same style. "toing" reads "Blynk". No photos: each dish has
 * an emoji stand-in on a neutral tile.
 */
import type { Product } from '@/blynk/api/types';
import { demoProduct, type DemoExtra } from './extras';

export type DemoCategory = { id: string; name: string; emoji: string; from: number | null };
export type DemoStore = {
  id: string;
  name: string;
  ad?: boolean;
  /** "20% LOWER PRICES" line above the name. */
  lowerPct?: number;
  rating: number;
  eta: string;
  tags: string;
  itemsAt: number;
  dishes: Product[];
};

export const LOCATION = {
  name: 'Kurumbapalayam SSKulam',
  address: 'Vaiyapuri Nagar, Kurumbapalayam SSKulam, Coimbatore, Tamil Nadu 641062',
};

/** The search placeholder rolls 'Burger' → 'Pizza' → … */
export const SEARCH_HINTS = ['Burger', 'Pizza', 'Biryani', 'Cakes', 'Noodles', 'Rolls'];

export const BANNER = {
  title: ['BROKE', 'HOURS'] as [string, string],
  line: 'Dishes starting at ₹49',
  accent: '₹49',
  /** What the beam abducts in turn (the video: a sandwich, noodles, then a burger). */
  emojis: ['🥪', '🍜', '🍔', '🍕'],
};

/** Before location is granted the rail has no "FROM" tags and a different order. */
export const CATEGORIES_PRE: DemoCategory[] = [
  { id: 'all', name: 'All', emoji: '🍱', from: null },
  { id: 'noodles', name: 'Noodles', emoji: '🍜', from: null },
  { id: 'cakes', name: 'Cakes', emoji: '🍰', from: null },
  { id: 'biryani', name: 'Biryani', emoji: '🍛', from: null },
  { id: 'pizzas', name: 'Pizzas', emoji: '🍕', from: null },
  { id: 'rolls', name: 'Rolls', emoji: '🌯', from: null },
  { id: 'burgers', name: 'Burgers', emoji: '🍔', from: null },
];
export const CATEGORIES: DemoCategory[] = [
  { id: 'all', name: 'All', emoji: '🍱', from: null },
  { id: 'noodles', name: 'Noodles', emoji: '🍜', from: 149 },
  { id: 'pizzas', name: 'Pizzas', emoji: '🍕', from: 99 },
  { id: 'rolls', name: 'Rolls', emoji: '🌯', from: 65 },
  { id: 'burgers', name: 'Burgers', emoji: '🍔', from: 99 },
  { id: 'cakes', name: 'Cakes', emoji: '🍰', from: 58 },
  { id: 'biryani', name: 'Biryani', emoji: '🍛', from: 83 },
];

export const FILTERS = [
  { id: 'lower', label: '40-60% Lower Prices', hearts: true },
  { id: 'veg', label: 'Veg/Non-Veg', caret: true },
  { id: 'u99', label: '₹99 & Under' },
  { id: 'fast', label: 'Under 30 mins' },
] as const;
export type DemoFilter = (typeof FILTERS)[number]['id'];

const x = (e: DemoExtra) => e;
const d = (id: string, name: string, price: number, offer: number | null, cat: string, e: DemoExtra) =>
  demoProduct(id, name, price, offer, cat, e);

/* ---------- dishes ---------- */
const MIDNIGHT = 'Midnight biriyani';
const chickenChilli = d('demo-chicken-chilli', 'Chicken chilli', 113, 99, 'biryani',
  x({ emoji: '🍗', store: MIDNIGHT, rating: 4.1, popular: true, veg: false, other: [199, 209], lowerPct: 50 }));
const plainBiriyani = d('demo-plain-biriyani', 'Plain biriyani', 83, null, 'biryani',
  x({ emoji: '🍛', store: MIDNIGHT, rating: 4.2, popular: true, veg: false, other: [179, 189], lowerPct: 50 }));
const chickenBiriyaniMid = d('demo-chicken-biriyani-mn', 'Chicken biriyani', 209, null, 'biryani',
  x({ emoji: '🍲', store: MIDNIGHT, rating: 4.3, popular: true, veg: false, other: [239, 249], lowerPct: 20 }));

const OLIO = '99 Slice by Olio Pizza';
const margherita = d('demo-margherita-slice', 'Margherita Giant Pizza Slice (24 cm)', 199, 99, 'pizzas',
  x({ emoji: '🍕', store: OLIO, rating: 4.1, veg: true, other: [199, 209], lowerPct: 50 }));
const cheeseCorn = d('demo-cheese-corn-slice', 'Cheese N Corn Giant Pizza Slice (24 cm)', 199, 99, 'pizzas',
  x({ emoji: '🍕', store: OLIO, veg: true, other: [199, 209], lowerPct: 50 }));
const fieryPaprika = d('demo-fiery-paprika-slice', 'Fiery Paprika Giant Pizza Slice (24 cm)', 199, 99, 'pizzas',
  x({ emoji: '🍕', store: OLIO, veg: true, other: [199, 209], lowerPct: 50 }));
const periGarlic = d('demo-peri-garlic-knots', 'Peri Peri Garlic Knots', 239, 119, 'pizzas',
  x({ emoji: '🧄', store: OLIO, veg: true, other: [239, 249], lowerPct: 50 }));
const makeOwn = d('demo-make-own-slice', 'Make your Own Non Veg Giant Pizza Slice', 199, 99, 'pizzas',
  x({ emoji: '🍕', store: OLIO, veg: false, other: [199, 209], lowerPct: 50 }));
const bbqChicken = d('demo-bbq-chicken-slice', 'BBQ Chicken Giant Pizza Slice (24 cm)', 299, 149, 'pizzas',
  x({ emoji: '🍕', store: OLIO, veg: false, other: [299, 309], lowerPct: 50 }));
const pepperoni = d('demo-pepperoni-slice', 'Pepperoni Bacon Giant Pizza Slice (24 cm)', 399, 199, 'pizzas',
  x({ emoji: '🍕', store: OLIO, veg: false, other: [399, 409], lowerPct: 50 }));

const VILLAGE = 'The Village Express Non Veg';
const periRoll = d('demo-peri-roll-shawarma', 'Peri Peri Roll Shawarma', 130, null, 'rolls',
  x({ emoji: '🌯', store: VILLAGE, popular: true, veg: false, other: [150, 160], lowerPct: 10 }));
const chickenBriyani = d('demo-chicken-briyani', 'Chicken Briyani', 200, 199, 'biryani',
  x({ emoji: '🍗', store: VILLAGE, popular: true, veg: false, other: [219, 229], lowerPct: 10 }));
const chickenNoodles = d('demo-chicken-noodles', 'Chicken Noodles', 192, null, 'noodles',
  x({ emoji: '🍜', store: VILLAGE, popular: true, veg: false, other: [229, 239], lowerPct: 20 }));
const eggRoll = d('demo-egg-roll', 'Egg Roll', 65, null, 'rolls',
  x({ emoji: '🌯', store: VILLAGE, popular: true, veg: false, other: [79, 89], lowerPct: 20 }));

const CAKEZONE = 'CakeZone Patisserie';
const chocoLava = d('demo-choco-lava-cz', 'Choco Lava Cake', 114, 58, 'cakes',
  x({ emoji: '🧁', store: CAKEZONE, rating: 4.3, popular: true, veg: true, other: [119, 129], lowerPct: 50 }));
const vanillaBentoCz = d('demo-vanilla-bento-cz', 'Vanilla Bento Cake', 259, 209, 'cakes',
  x({ emoji: '🎂', store: CAKEZONE, veg: true, other: [299, 309], lowerPct: 30 }));
const chocoPastryCz = d('demo-choco-pastry-cz', 'Choco Pastry', 144, 115, 'cakes',
  x({ emoji: '🍰', store: CAKEZONE, veg: true, other: [149, 159], lowerPct: 20 }));

const BAKINGO = 'Bakingo';
const truffleCake = d('demo-choco-truffle-cake', 'Choco Truffle Cake', 519, null, 'cakes',
  x({ emoji: '🎂', store: BAKINGO, veg: true, other: [549, 559], lowerPct: 20 }));
const trufflePastry = d('demo-choco-truffle-pastry-bk', 'Choco Truffle Pastry', 99, null, 'cakes',
  x({ emoji: '🍰', store: BAKINGO, rating: 4.6, veg: true, other: [109, 119], lowerPct: 20 }));
const chocoJarCake = d('demo-choco-jar-cake', 'Choco Jar Cake', 149, null, 'cakes',
  x({ emoji: '🍫', store: BAKINGO, veg: true, other: [169, 179], lowerPct: 20 }));

const HEAVEN = 'The Dessert Heaven - Pastry Shop';
const chocoLavaDh = d('demo-choco-lava-dh', 'Choco Lava Cake', 114, null, 'cakes',
  x({ emoji: '🧁', store: HEAVEN, popular: true, veg: true, other: [119, 129], lowerPct: 30 }));
const trufflePastryDh = d('demo-choco-truffle-pastry-dh', 'Choco Truffle Pastry', 119, 99, 'cakes',
  x({ emoji: '🍰', store: HEAVEN, veg: true, other: [124, 134], lowerPct: 20 }));
const butterscotchJar = d('demo-butterscotch-jar', 'Butterscotch Jar Cake', 134, 94, 'cakes',
  x({ emoji: '🍮', store: HEAVEN, veg: true, other: [139, 149], lowerPct: 30 }));

const REDBOX = 'The Red Box';
const hakka = d('demo-chicken-hakka', 'Chicken Hakka Noodles', 215, 149, 'noodles',
  x({ emoji: '🥡', store: REDBOX, popular: true, veg: false, other: [239, 249], lowerPct: 30 }));
const eggRice = d('demo-egg-fried-rice', 'Egg Fried Rice', 199, 129, 'noodles',
  x({ emoji: '🍚', store: REDBOX, popular: true, veg: false, other: [219, 229], lowerPct: 40 }));
const schezwan = d('demo-chicken-schezwan', 'Chicken Schezwan Noodles', 256, null, 'noodles',
  x({ emoji: '🍜', store: REDBOX, popular: true, veg: false, other: [289, 299], lowerPct: 20 }));

const CRUSTOS = "Crusto's - Cheese Burst Pizza";
const garlicKnots = d('demo-royal-garlic-knots', 'The Royal Garlic Knots with Cheese Dip', 239, 119, 'pizzas',
  x({ emoji: '🧄', store: CRUSTOS, veg: true, other: [239, 249], lowerPct: 50 }));
const classicMargherita = d('demo-classic-margherita', 'Classic Margherita Pizza', 229, null, 'pizzas',
  x({ emoji: '🍕', store: CRUSTOS, veg: true, other: [299, 309], lowerPct: 20 }));
const garlicBread = d('demo-italian-garlic-bread', 'Italian Garlic Bread', 219, null, 'pizzas',
  x({ emoji: '🥖', store: CRUSTOS, veg: true, other: [249, 259], lowerPct: 20 }));

const OVENFRESH = 'Ovenfresh Cakes And Desserts';
/** Same id as the cart's mock line (src/demo/cart.ts), so the 0:30.8 "+" and the cart agree. */
const greetingCard = d('demo-greeting-card', 'Happy Birthday Greeting Card', 79, null, 'cakes',
  x({ emoji: '💌', store: OVENFRESH, veg: true, other: [119, 129], lowerPct: 30 }));
const vanillaBentoOf = d('demo-vanilla-bento-of', 'Vanilla Bento Cake', 259, 199, 'cakes',
  x({ emoji: '🎂', store: OVENFRESH, veg: true, other: [299, 309], lowerPct: 30 }));
const butterscotchOf = d('demo-classic-butterscotch', 'Classic Butterscotch Cake', 459, null, 'cakes',
  x({ emoji: '🍰', store: OVENFRESH, veg: false, other: [499, 509], lowerPct: 10 }));

const BIGFAT = 'Big Fat Burger';
const crispyBurger = d('demo-crispy-chicken-burger', 'Crispy Chicken Burger', 149, 99, 'burgers',
  x({ emoji: '🍔', store: BIGFAT, popular: true, veg: false, other: [179, 189], lowerPct: 20 }));
const vegWrap = d('demo-veg-crunch-wrap', 'Veg Crunch Wrap', 129, null, 'rolls',
  x({ emoji: '🌯', store: BIGFAT, popular: true, veg: true, other: [149, 159], lowerPct: 20 }));
const classicBurger = d('demo-classic-veg-burger', 'Classic Veg Burger', 99, null, 'burgers',
  x({ emoji: '🍔', store: BIGFAT, popular: true, veg: true, other: [119, 129], lowerPct: 20 }));

const SLURP = 'Slurp Momos';
const cornMomos = d('demo-corn-cheese-momos', 'Corn Cheese Momos', 199, 99, 'momos',
  x({ emoji: '🥟', store: SLURP, rating: 4.5, popular: true, veg: true, other: [199, 209], lowerPct: 50 }));

/* ---------- sections ---------- */
/** "Meals under ₹99" before location is granted… */
export const MEALS_PRE: Product[] = [chickenChilli, plainBiriyani, cornMomos, chocoLava, trufflePastry, greetingCard];
/** …and after. */
export const MEALS: Product[] = [chickenChilli, plainBiriyani, margherita, chocoLava, trufflePastry, greetingCard];

export const VS = {
  kicker: ['BLYNK', 'vs', 'OTHER APPS'] as [string, string, string],
  title: '40-60% LOWER PRICES',
  tiles: [{ id: 'olio', name: 'Olio - The Wood Fired Pizzeria', rating: 4.1, eta: '25-30 mins', tags: 'Pizzas', itemsAt: 99, lowerPct: 50, emoji: '🍕' }],
};

export const PROMO = { line1: 'Offline Menu Price Match', fees: ['₹0 Platform Fee', '₹0 Packaging Fee'] };

/** Bottom strip once location is granted. */
export const FEES: [string, string][] = [['₹0', 'Packaging Fee'], ['₹0', 'Platform Fee'], ['₹', 'Offline Price Match']];

export const LOCATION_SHEET = {
  title: 'Location Permission is Off',
  sub: 'Granting location permission will ensure accurate address and hassle free delivery',
  cta: 'GRANT',
  manual: 'Enter Location Manually',
};

export const STORES: DemoStore[] = [
  { id: 'olio99', name: OLIO, ad: true, rating: 4.2, eta: '25-30 mins', tags: 'Pizzas, Pastas', itemsAt: 99,
    dishes: [margherita, cheeseCorn, fieryPaprika, periGarlic, makeOwn, bbqChicken, pepperoni] },
  { id: 'village', name: VILLAGE, lowerPct: 20, rating: 4.1, eta: '15-20 mins', tags: 'Chinese, Biryani', itemsAt: 99,
    dishes: [periRoll, chickenBriyani, chickenNoodles, eggRoll] },
  { id: 'cakezone', name: CAKEZONE, ad: true, rating: 4.3, eta: '35-45 mins', tags: 'Bakery, Desserts', itemsAt: 58,
    dishes: [chocoLava, vanillaBentoCz, chocoPastryCz] },
  { id: 'bakingo', name: BAKINGO, lowerPct: 20, rating: 4.6, eta: '15-20 mins', tags: 'Bakery, Desserts', itemsAt: 98,
    dishes: [truffleCake, trufflePastry, chocoJarCake] },
  { id: 'dessertheaven', name: HEAVEN, ad: true, lowerPct: 30, rating: 4.3, eta: '25-30 mins', tags: 'Bakery, Desserts', itemsAt: 68,
    dishes: [chocoLavaDh, trufflePastryDh, butterscotchJar] },
  { id: 'redbox', name: REDBOX, lowerPct: 20, rating: 4.1, eta: '20-25 mins', tags: 'Chinese, Asian', itemsAt: 49,
    dishes: [hakka, eggRice, schezwan] },
  { id: 'crustos', name: CRUSTOS, ad: true, lowerPct: 20, rating: 4.3, eta: '30-35 mins', tags: 'Pizzas, Pastas', itemsAt: 99,
    dishes: [garlicKnots, classicMargherita, garlicBread] },
  { id: 'midnight', name: MIDNIGHT, lowerPct: 20, rating: 4.0, eta: '15-20 mins', tags: 'South Indian, Fast Food', itemsAt: 99,
    dishes: [chickenChilli, plainBiriyani, chickenBiriyaniMid] },
  { id: 'ovenfresh', name: OVENFRESH, ad: true, lowerPct: 10, rating: 4.4, eta: '30-40 mins', tags: 'Bakery, Desserts', itemsAt: 68,
    dishes: [greetingCard, vanillaBentoOf, butterscotchOf] },
  { id: 'bigfat', name: BIGFAT, lowerPct: 20, rating: 4.1, eta: '20-25 mins', tags: 'Burgers, Snacks', itemsAt: 99,
    dishes: [crispyBurger, vegWrap, classicBurger] },
];

/** The green promo band sits under this many store cards. */
export const PROMO_AFTER = 3;

/** Which stores a category chip keeps. */
export const STORES_BY_CATEGORY: Record<string, string[]> = {
  noodles: ['village', 'redbox'],
  pizzas: ['olio99', 'crustos'],
  rolls: ['village', 'bigfat'],
  burgers: ['bigfat'],
  cakes: ['cakezone', 'bakingo', 'dessertheaven', 'ovenfresh'],
  biryani: ['village', 'midnight'],
};
