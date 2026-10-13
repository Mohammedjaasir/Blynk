export type Product = {
  id: string;
  name: string;
  emoji: string;
  unit: string;
  price: number;
  mrp: number;
  otherMin: number;
  otherMax: number;
  rating: number;
  organic: boolean;
  bg: string;
  popular?: boolean;
};

export type Store = {
  id: string;
  name: string;
  hero: string;
  heroBg: [string, string];
  rating: number;
  eta: string;
  tags: string;
  area: string;
  lowerBy: number;
  itemsAt: number;
  ad?: boolean;
  products: string[];
};

export const CATEGORIES = [
  { id: 'all', name: 'All', emoji: '🛒', from: 0 },
  { id: 'fruits', name: 'Fruits', emoji: '🍎', from: 19 },
  { id: 'veggies', name: 'Veggies', emoji: '🥦', from: 9 },
  { id: 'dairy', name: 'Dairy', emoji: '🥛', from: 25 },
  { id: 'bakery', name: 'Bakery', emoji: '🍞', from: 29 },
  { id: 'snacks', name: 'Snacks', emoji: '🍿', from: 10 },
  { id: 'drinks', name: 'Drinks', emoji: '🧃', from: 20 },
  { id: 'staples', name: 'Staples', emoji: '🌾', from: 39 },
];

const P = (
  id: string, name: string, emoji: string, unit: string, price: number, mrp: number,
  otherMin: number, rating: number, organic: boolean, bg: string, popular = false,
): Product => ({ id, name, emoji, unit, price, mrp, otherMin, otherMax: otherMin + 10, rating, organic, bg, popular });

export const PRODUCTS: Record<string, Product> = Object.fromEntries(
  [
    P('apple', 'Shimla Apples', '🍎', '4 pcs · 500g', 79, 113, 99, 4.3, true, '#FFE3E3', true),
    P('banana', 'Robusta Banana', '🍌', '6 pcs', 39, 55, 49, 4.4, true, '#FFF6CC', true),
    P('mango', 'Alphonso Mango', '🥭', '2 pcs', 99, 149, 129, 4.6, true, '#FFE9C7'),
    P('grapes', 'Green Grapes', '🍇', '500g', 59, 89, 79, 4.1, true, '#EDE3FF'),
    P('melon', 'Watermelon', '🍉', '1 pc · ~2kg', 69, 99, 89, 4.2, true, '#FFE0E6', true),
    P('straw', 'Strawberries', '🍓', '200g box', 89, 129, 119, 4.5, true, '#FFE3EC'),
    P('tomato', 'Desi Tomato', '🍅', '500g', 19, 32, 28, 4.0, false, '#FFE4DE', true),
    P('onion', 'Red Onion', '🧅', '1kg', 35, 52, 45, 4.1, false, '#F6E6F0', true),
    P('potato', 'Potato', '🥔', '1kg', 29, 42, 38, 4.2, false, '#F5EBDD'),
    P('broccoli', 'Broccoli', '🥦', '1 pc · 250g', 49, 79, 69, 4.3, true, '#E2F5E1'),
    P('carrot', 'Ooty Carrot', '🥕', '500g', 29, 45, 39, 4.4, true, '#FFE8D6'),
    P('corn', 'Sweet Corn', '🌽', '2 pcs', 25, 40, 35, 4.0, false, '#FFF3C9'),
    P('milk', 'Toned Milk', '🥛', '500ml', 27, 30, 29, 4.7, false, '#E6F0FF', true),
    P('cheese', 'Cheese Slices', '🧀', '10 slices', 99, 140, 130, 4.5, false, '#FFF1C2'),
    P('butter', 'Salted Butter', '🧈', '100g', 52, 58, 56, 4.6, false, '#FFF4D1'),
    P('egg', 'Farm Eggs', '🥚', '6 pcs', 45, 60, 54, 4.3, false, '#F7F1E8', true),
    P('bread', 'Brown Bread', '🍞', '400g', 35, 50, 45, 4.2, false, '#F6E7D3', true),
    P('croissant', 'Butter Croissant', '🥐', '2 pcs', 59, 99, 89, 4.4, false, '#FCEBD2'),
    P('bagel', 'Sesame Bagels', '🥯', '4 pcs', 69, 99, 90, 4.0, false, '#F3E6D6'),
    P('cookie', 'Choco Cookies', '🍪', '150g', 29, 45, 40, 4.5, false, '#F3E3D3', true),
    P('chips', 'Masala Chips', '🍿', '90g', 20, 30, 25, 4.1, false, '#FFF0D9'),
    P('choc', 'Dark Chocolate', '🍫', '80g', 79, 120, 105, 4.6, false, '#EADCD3'),
    P('juice', 'Orange Juice', '🧃', '1L', 89, 130, 115, 4.2, false, '#FFE8CC', true),
    P('cola', 'Cola Can', '🥤', '300ml', 30, 40, 38, 4.0, false, '#FFE1E1'),
    P('coconut', 'Tender Coconut', '🥥', '1 pc', 45, 60, 55, 4.4, true, '#EDEBE3'),
    P('rice', 'Basmati Rice', '🍚', '1kg', 99, 149, 135, 4.5, false, '#F2F2EA', true),
    P('honey', 'Wild Honey', '🍯', '250g', 119, 179, 159, 4.7, true, '#FFF0C7'),
    P('salt', 'Rock Salt', '🧂', '1kg', 39, 55, 49, 4.1, false, '#EEF1F5'),
  ].map((p) => [p.id, p]),
);

export const UNDER_99 = ['apple', 'tomato', 'milk', 'banana', 'bread', 'egg', 'cookie', 'melon'];

export const STORES: Store[] = [
  {
    id: 'fresh', name: 'FreshBasket Organics', hero: '🥗', heroBg: ['#D8F3DC', '#95D5B2'],
    rating: 4.4, eta: '15-20 mins', tags: 'Fruits, Veggies', area: 'Saravanampatti',
    lowerBy: 20, itemsAt: 19, ad: true,
    products: ['apple', 'banana', 'mango', 'broccoli', 'carrot', 'straw', 'grapes', 'tomato', 'corn', 'coconut'],
  },
  {
    id: 'dairy', name: 'Daily Dairy Co.', hero: '🥛', heroBg: ['#E3F0FF', '#B9D7FF'],
    rating: 4.6, eta: '10-15 mins', tags: 'Milk, Eggs, Cheese', area: 'Vaiyapuri Nagar',
    lowerBy: 10, itemsAt: 25,
    products: ['milk', 'cheese', 'butter', 'egg', 'bread', 'croissant', 'honey', 'cookie', 'juice', 'bagel'],
  },
  {
    id: 'mandi', name: 'Sabzi Mandi Express', hero: '🥬', heroBg: ['#E9F7D9', '#BFE3A0'],
    rating: 4.1, eta: '20-25 mins', tags: 'Veggies, Staples', area: 'Kurumbapalayam',
    lowerBy: 30, itemsAt: 9,
    products: ['tomato', 'onion', 'potato', 'carrot', 'corn', 'broccoli', 'rice', 'salt', 'coconut', 'banana'],
  },
  {
    id: 'bake', name: "Baker's Oven", hero: '🥐', heroBg: ['#FCEBD2', '#F3C98B'],
    rating: 4.3, eta: '25-30 mins', tags: 'Bakery, Desserts', area: 'Ganapathy',
    lowerBy: 20, itemsAt: 29, ad: true,
    products: ['croissant', 'bread', 'bagel', 'cookie', 'choc', 'butter', 'honey', 'milk', 'egg', 'cheese'],
  },
  {
    id: 'munch', name: 'Crunch Corner Snacks', hero: '🍿', heroBg: ['#FFF0D9', '#FFC98B'],
    rating: 4.0, eta: '15-20 mins', tags: 'Snacks, Drinks', area: 'Peelamedu',
    lowerBy: 20, itemsAt: 10,
    products: ['chips', 'cola', 'juice', 'choc', 'cookie', 'coconut', 'cheese', 'banana', 'grapes', 'melon'],
  },
  {
    id: 'pantry', name: "Nature's Pantry", hero: '🌾', heroBg: ['#F2EEDF', '#DCCFA6'],
    rating: 4.5, eta: '30-35 mins', tags: 'Staples, Organic', area: 'RS Puram',
    lowerBy: 10, itemsAt: 39,
    products: ['rice', 'honey', 'salt', 'potato', 'onion', 'egg', 'milk', 'bread', 'mango', 'apple'],
  },
];

export const PAIRS: Record<string, string[]> = {
  default: ['honey', 'butter', 'juice', 'cookie'],
  apple: ['banana', 'honey', 'grapes', 'juice'],
  bread: ['butter', 'cheese', 'egg', 'honey'],
  milk: ['bread', 'cookie', 'egg', 'butter'],
  tomato: ['onion', 'potato', 'carrot', 'salt'],
  onion: ['tomato', 'potato', 'corn', 'salt'],
  potato: ['onion', 'tomato', 'carrot', 'butter'],
  carrot: ['broccoli', 'corn', 'potato', 'honey'],
  banana: ['milk', 'honey', 'bread', 'apple'],
  egg: ['bread', 'butter', 'milk', 'cheese'],
  chips: ['cola', 'juice', 'choc', 'cookie'],
};

export const SEARCH_HINTS = ['Apples', 'Milk', 'Bread', 'Tomato', 'Eggs', 'Chips'];

export const FREE_DELIVERY_AT = 149;

export const CAT_ITEMS: Record<string, string[]> = {
  fruits: ['apple', 'banana', 'mango', 'grapes', 'melon', 'straw', 'coconut'],
  veggies: ['tomato', 'onion', 'potato', 'broccoli', 'carrot', 'corn'],
  dairy: ['milk', 'cheese', 'butter', 'egg'],
  bakery: ['bread', 'croissant', 'bagel', 'cookie'],
  snacks: ['chips', 'choc', 'cookie'],
  drinks: ['juice', 'cola', 'coconut', 'milk'],
  staples: ['rice', 'honey', 'salt', 'potato', 'onion'],
};
