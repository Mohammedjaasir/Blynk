/*
 * Mock content for the aisle intro and the store screen, copied from the reference
 * recording (0:31.7–0:41). Nothing here is fetched or sent anywhere. Prices are the
 * video's own rupee amounts; render them with rupees() from ./money, never formatLkr.
 * Ids shared with the cart mock (src/demo/cart.ts) keep the same id and price.
 */
import type { Product } from '@/blynk/api/types';
import { demoProduct, type DemoExtra } from './extras';

const CAT = 'demo-ovenfresh';
const dish = (id: string, name: string, price: number, offer: number | null, extra: DemoExtra) =>
  demoProduct(`demo-${id}`, name, price, offer, CAT, extra);

/* ---------- the store's one menu section, in the video's grid order ---------- */
export const KNIFE_CANDLE = dish('knife-candle', 'Knife and Candle', 9, null, { emoji: '🕯️', rating: 4.0, veg: true, other: [19, 24], lowerPct: 50 });
export const RED_VELVET = dish('red-velvet-cupcake', 'Red Velvet Cupcake', 109, 79, { emoji: '🧁', rating: 4.0, veg: true, other: [114, 124], lowerPct: 30 });
const STRAWBERRY = dish('strawberry-cupcake', 'Strawberry  Cupcake', 109, 79, { emoji: '🧁', rating: 5.0, veg: true, other: [114, 124], lowerPct: 30 });
const BUTTERSCOTCH = dish('butterscotch-cupcake', 'Butterscot ch Cupcake', 109, 79, { emoji: '🧁', veg: true, other: [114, 124], lowerPct: 30 });
export const GREETING_CARD = dish('greeting-card', 'Happy Birthday Greeting Card', 79, null, { emoji: '💌', veg: true, other: [119, 129], lowerPct: 30 });
const VANILLA_CUPCAKE = dish('vanilla-cupcake', 'Vanilla Cupcake', 109, 79, { emoji: '🧁', veg: true, other: [114, 124], lowerPct: 30 });
const BLACK_FOREST_CUPCAKE = dish('black-forest-cupcake', 'Black Forest Cupcake', 109, 79, { emoji: '🧁', rating: 5.0, veg: true, other: [114, 124], lowerPct: 30 });
const MARBLE_TEA_CAKE = dish('marble-tea-cake', 'Marble Tea Cake', 169, 119, { emoji: '🍰', rating: 5.0, veg: true, other: [174, 184], lowerPct: 30 });
const VANILLA_BENTO = dish('vanilla-bento-cake', 'Vanilla Bento Cake', 259, 199, { emoji: '🎂', rating: 4.5, veg: true, other: [299, 309], lowerPct: 30 });
const SIX_CUPCAKES = dish('six-cupcakes', 'Choice Of Any Six Cupcakes', 369, 289, { emoji: '🧁', rating: 5.0, veg: true, other: [449, 459], lowerPct: 30 });

/* ---------- "People usually pair this with" ---------- */
const FRUIT_EGGLESS = dish('fruit-eggless-cake', 'Fruit Eggless Cake', 559, null, { emoji: '🍰', rating: 4, veg: true });
const BLACK_FOREST_EGGLESS = dish('black-forest-eggless-cake', 'Black Forest Eggless Cake', 499, null, { emoji: '🎂', rating: 5, veg: true });
const CLASSIC_BUTTERSCOTCH = dish('classic-butterscotch-cake', 'Classic Butterscotch Cake', 459, null, { emoji: '🎂', rating: 5, veg: false });

export type DemoSection = { id: string; title: string; items: Product[] };

export const STORE = {
  name: 'Ovenfresh Cakes And Desserts',
  rating: 4.4,
  eta: '30-40 mins',
  area: 'Saravanampatti',
  /** Stand-in for the hero photo. */
  heroEmoji: '🎂',
  heroBg: '#E9E2DA',
  offerTitle: ['10% LOWER PRICES ', 'vs', ' OTHER APPS'] as const,
  offerSub: 'Prices seen only on Blynk',
  search: 'Search for dishes',
  stuckSearch: 'Search in Ovenfresh Cakes And Desserts',
  chips: { lower: '10% lower prices', ratings: 'Ratings 4.0+' },
  menuLabel: 'MENU',
  /** The cart bar's "Yay! You've unlocked Free Delivery" strip shows from this basket total. */
  freeDeliveryAbove: 129,
  sections: [
    {
      id: 'lower',
      title: '10% LOWER PRICES vs OTHER APPS',
      items: [KNIFE_CANDLE, RED_VELVET, STRAWBERRY, BUTTERSCOTCH, GREETING_CARD, VANILLA_CUPCAKE, BLACK_FOREST_CUPCAKE, MARBLE_TEA_CAKE, VANILLA_BENTO, SIX_CUPCAKES],
    },
  ] as DemoSection[],
  pairTitle: 'People usually pair this with',
  /** Two rows, scrolled sideways: column by column. */
  pairs: [VANILLA_BENTO, BLACK_FOREST_EGGLESS, FRUIT_EGGLESS, CLASSIC_BUTTERSCOTCH],
};

/* ---------- aisle intro interstitial (0:31.7) ---------- */
export const OPENING = {
  title: ['OFFLINE MENU', 'PRICE MATCHED'] as const,
  sub: 'Opening menu to explore...',
  /** The printed menu card the arcs chase around: a title, then three "course" blocks with a dish each. */
  menuHead: 'RESTAURANT',
  courses: [
    { name: 'Breakfast', emoji: '🥞' },
    { name: 'Main', emoji: '🍝' },
    { name: 'Salads', emoji: '🥗' },
  ],
  heroEmoji: '🍝',
};
