import { Category, Product, Address, Rider, Order } from '../types';

export const INITIAL_CATEGORIES: Category[] = [
  {
    id: 'vegetables',
    name: 'Vegetables',
    iconName: 'Carrot',
    image: 'https://images.unsplash.com/photo-1597362925123-77861d3fbac7?auto=format&fit=crop&w=400&q=80',
    subcategories: ['All Vegetables', 'Fresh Vegetables', 'Leafy Greens', 'Root Vegetables']
  },
  {
    id: 'fruits',
    name: 'Fruits',
    iconName: 'Apple',
    image: 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=400&q=80',
    subcategories: ['All Fruits', 'Tropical Fruits', 'Citrus & Berries', 'Apples & Pears']
  },
  {
    id: 'dairy',
    name: 'Dairy & Eggs',
    iconName: 'Milk',
    image: 'https://images.unsplash.com/photo-1628088062854-d1870b4553da?auto=format&fit=crop&w=400&q=80',
    subcategories: ['All Dairy', 'Milk & Cream', 'Butter & Cheese', 'Yogurt & Curd', 'Eggs']
  },
  {
    id: 'snacks',
    name: 'Snacks & Biscuits',
    iconName: 'Cookie',
    image: 'https://images.unsplash.com/photo-1590080875515-8a3a8dc5735e?auto=format&fit=crop&w=400&q=80',
    subcategories: ['All Snacks', 'Biscuits & Cookies', 'Chips & Wafers', 'Nuts & Seeds']
  },
  {
    id: 'beverages',
    name: 'Beverages & Drinks',
    iconName: 'CupSoda',
    image: 'https://images.unsplash.com/photo-1527661591475-527312dd65f5?auto=format&fit=crop&w=400&q=80',
    subcategories: ['All Beverages', 'Juices & Nectars', 'Tea & Coffee', 'Soft Drinks', 'Mineral Water']
  },
  {
    id: 'grains',
    name: 'Rice & Grains',
    iconName: 'Wheat',
    image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=400&q=80',
    subcategories: ['All Grains', 'Rice & Basmati', 'Pulses & Lentils', 'Flour & Atta']
  },
  {
    id: 'bakery',
    name: 'Bakery & Bread',
    iconName: 'Croissant',
    image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=400&q=80',
    subcategories: ['All Bakery', 'Fresh Bread', 'Buns & Rolls', 'Cakes & Pastries']
  },
  {
    id: 'household',
    name: 'Household',
    iconName: 'Sparkles',
    image: 'https://images.unsplash.com/photo-1585336261026-6757c5bca69c?auto=format&fit=crop&w=400&q=80',
    subcategories: ['All Household', 'Detergents', 'Dishwashing', 'Surface Cleaners']
  },
  {
    id: 'personal',
    name: 'Personal Care',
    iconName: 'Heart',
    image: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=400&q=80',
    subcategories: ['All Personal Care', 'Soaps & Bodywash', 'Shampoo & Haircare', 'Oral Care']
  }
];

export const INITIAL_PRODUCTS: Product[] = [
  // Vegetables
  {
    id: 'v1',
    name: 'Farm Fresh Red Tomatoes',
    category: 'vegetables',
    subcategory: 'Fresh Vegetables',
    brand: 'Blynk Fresh',
    image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=500&q=80',
    unit: '500 g',
    price: 180,
    originalPrice: 220,
    stock: 45,
    availability: 'in_stock',
    isPopular: true,
    isFresh: true,
    description: 'Juicy, farm-plucked red tomatoes delivered fresh every morning from local green farms.'
  },
  {
    id: 'v2',
    name: 'Crisp Yellow Onions',
    category: 'vegetables',
    subcategory: 'Root Vegetables',
    brand: 'Blynk Fresh',
    image: 'https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?auto=format&fit=crop&w=500&q=80',
    unit: '1 kg',
    price: 320,
    originalPrice: 380,
    stock: 60,
    availability: 'in_stock',
    isPopular: true,
    isFresh: true,
    description: 'Peeled-grade crisp onions, essential for everyday curries and cooking.'
  },
  {
    id: 'v3',
    name: 'Organic Baking Potatoes',
    category: 'vegetables',
    subcategory: 'Root Vegetables',
    brand: 'Blynk Fresh',
    image: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=500&q=80',
    unit: '1 kg',
    price: 290,
    originalPrice: 340,
    stock: 50,
    availability: 'in_stock',
    isPopular: true,
    description: 'Smooth-skinned organic potatoes sourced directly from highland farmers.'
  },
  {
    id: 'v4',
    name: 'Fresh Green Spinach (Katurumurunga/Spinach)',
    category: 'vegetables',
    subcategory: 'Leafy Greens',
    brand: 'Blynk Organic',
    image: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?auto=format&fit=crop&w=500&q=80',
    unit: '250 g Bunch',
    price: 120,
    originalPrice: 150,
    stock: 8,
    availability: 'low_stock',
    isFresh: true,
    description: 'Nutrient-rich, vibrant leafy green spinach washed and packed for maximum freshness.'
  },
  {
    id: 'v5',
    name: 'Crunchy Orange Carrots',
    category: 'vegetables',
    subcategory: 'Root Vegetables',
    brand: 'Blynk Fresh',
    image: 'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?auto=format&fit=crop&w=500&q=80',
    unit: '500 g',
    price: 240,
    stock: 35,
    availability: 'in_stock',
    isFresh: true,
    description: 'Sweet, crisp garden carrots packed with Vitamin A.'
  },
  {
    id: 'v6',
    name: 'Green Bell Peppers (Capsicum)',
    category: 'vegetables',
    subcategory: 'Fresh Vegetables',
    brand: 'Blynk Fresh',
    image: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?auto=format&fit=crop&w=500&q=80',
    unit: '250 g',
    price: 210,
    stock: 0,
    availability: 'out_of_stock',
    description: 'Crunchy green capsicums ideal for stir-fries and salads.'
  },

  // Fruits
  {
    id: 'f1',
    name: 'Highland Cavendish Bananas',
    category: 'fruits',
    subcategory: 'Tropical Fruits',
    brand: 'Blynk Select',
    image: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=500&q=80',
    unit: '1 kg (approx 6-7 pcs)',
    price: 280,
    originalPrice: 320,
    stock: 40,
    availability: 'in_stock',
    isPopular: true,
    isFresh: true,
    description: 'Naturally ripened sweet yellow bananas full of potassium.'
  },
  {
    id: 'f2',
    name: 'Crisp Royal Gala Apples',
    category: 'fruits',
    subcategory: 'Apples & Pears',
    brand: 'Imported',
    image: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=500&q=80',
    unit: '4 pcs Pack',
    price: 650,
    originalPrice: 750,
    stock: 25,
    availability: 'in_stock',
    isPopular: true,
    description: 'Juicy, sweet orchard Gala apples imported for peak crispness.'
  },
  {
    id: 'f3',
    name: 'Juicy Sweet Oranges',
    category: 'fruits',
    subcategory: 'Citrus & Berries',
    brand: 'Blynk Select',
    image: 'https://images.unsplash.com/photo-1547514701-42782101795e?auto=format&fit=crop&w=500&q=80',
    unit: '500 g',
    price: 480,
    stock: 30,
    availability: 'in_stock',
    description: 'Vitamin C rich, succulent seedless oranges.'
  },
  {
    id: 'f4',
    name: 'Fresh King Coconut',
    category: 'fruits',
    subcategory: 'Tropical Fruits',
    brand: 'Local Island',
    image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=500&q=80',
    unit: '1 pc (Chilled)',
    price: 160,
    stock: 18,
    availability: 'in_stock',
    isFresh: true,
    description: 'Refreshing electrolyte-rich local King Coconut, chilled and ready to drink.'
  },

  // Dairy
  {
    id: 'd1',
    name: 'Pure Full Cream Pasteurized Milk',
    category: 'dairy',
    subcategory: 'Milk & Cream',
    brand: 'Kotmale / Pelwatte',
    image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=500&q=80',
    unit: '1 Litre Pack',
    price: 420,
    originalPrice: 460,
    stock: 55,
    availability: 'in_stock',
    isPopular: true,
    isFresh: true,
    description: '100% pure cow milk, rich in calcium and essential vitamins.'
  },
  {
    id: 'd2',
    name: 'Fresh White Farm Eggs',
    category: 'dairy',
    subcategory: 'Eggs',
    brand: 'Blynk Poultry',
    image: 'https://images.unsplash.com/photo-1516448620398-c5f44bf9f441?auto=format&fit=crop&w=500&q=80',
    unit: '10 Eggs Pack',
    price: 490,
    originalPrice: 540,
    stock: 40,
    availability: 'in_stock',
    isPopular: true,
    description: 'Grade-A clean white eggs packed in protective biodegradable cartons.'
  },
  {
    id: 'd3',
    name: 'Salted Dairy Butter',
    category: 'dairy',
    subcategory: 'Butter & Cheese',
    brand: 'Highland',
    image: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?auto=format&fit=crop&w=500&q=80',
    unit: '200 g Block',
    price: 680,
    stock: 15,
    availability: 'in_stock',
    description: 'Creamy salted pure butter perfect for baking, toast, and cooking.'
  },
  {
    id: 'd4',
    name: 'Set Curd Clay Pot',
    category: 'dairy',
    subcategory: 'Yogurt & Curd',
    brand: 'Highland Premium',
    image: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=500&q=80',
    unit: '900 g Pot',
    price: 520,
    stock: 12,
    availability: 'in_stock',
    isFresh: true,
    description: 'Traditional thick buffalo curd set naturally in an eco-friendly terracotta clay pot.'
  },

  // Snacks & Biscuits
  {
    id: 's1',
    name: 'Cream Cracker Biscuits',
    category: 'snacks',
    subcategory: 'Biscuits & Cookies',
    brand: 'Maliban / Munchee',
    image: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=500&q=80',
    unit: '190 g Pack',
    price: 230,
    stock: 75,
    availability: 'in_stock',
    isPopular: true,
    description: 'Crisp, flaky oven-baked cream crackers. The ultimate tea-time snack.'
  },
  {
    id: 's2',
    name: 'Chocolate Cream Biscuits',
    category: 'snacks',
    subcategory: 'Biscuits & Cookies',
    brand: 'Super Chocolate',
    image: 'https://images.unsplash.com/photo-1590080875515-8a3a8dc5735e?auto=format&fit=crop&w=500&q=80',
    unit: '200 g Pack',
    price: 310,
    originalPrice: 350,
    stock: 60,
    availability: 'in_stock',
    description: 'Double rich cocoa cream layered inside crunchy biscuits.'
  },
  {
    id: 's3',
    name: 'Spiced Cassava Chips',
    category: 'snacks',
    subcategory: 'Chips & Wafers',
    brand: 'Lanka Snack',
    image: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=500&q=80',
    unit: '100 g Pack',
    price: 180,
    stock: 30,
    availability: 'in_stock',
    description: 'Thinly sliced crispy manioc/cassava chips dusted with chili salt.'
  },
  {
    id: 's4',
    name: 'Roasted & Salted Cashew Nuts',
    category: 'snacks',
    subcategory: 'Nuts & Seeds',
    brand: 'Blynk Royal',
    image: 'https://images.unsplash.com/photo-1536591375315-1988d6960926?auto=format&fit=crop&w=500&q=80',
    unit: '150 g Pack',
    price: 890,
    originalPrice: 990,
    stock: 20,
    availability: 'in_stock',
    description: 'Premium jumbo whole cashews lightly dry roasted with sea salt.'
  },

  // Beverages
  {
    id: 'b1',
    name: 'Ceylon Broken Orange Pekoe Tea (BOPF)',
    category: 'beverages',
    subcategory: 'Tea & Coffee',
    brand: 'Dilmah / Watawala',
    image: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=500&q=80',
    unit: '400 g Box',
    price: 640,
    originalPrice: 700,
    stock: 50,
    availability: 'in_stock',
    isPopular: true,
    description: 'Authentic 100% Ceylon black tea with rich aroma and deep golden liquor.'
  },
  {
    id: 'b2',
    name: 'Instant Roast Coffee Blend',
    category: 'beverages',
    subcategory: 'Tea & Coffee',
    brand: 'Nescafe Classic',
    image: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=500&q=80',
    unit: '100 g Jar',
    price: 1250,
    stock: 25,
    availability: 'in_stock',
    description: 'Rich dark roast instant coffee granules for a bold start to your day.'
  },
  {
    id: 'b3',
    name: 'Natural Mango Nectar Juice',
    category: 'beverages',
    subcategory: 'Juices & Nectars',
    brand: 'Elephant House',
    image: 'https://images.unsplash.com/photo-1546171753-97d7676e4602?auto=format&fit=crop&w=500&q=80',
    unit: '1 Litre Tetra',
    price: 490,
    stock: 35,
    availability: 'in_stock',
    description: 'Made from real ripe tropical mangoes, free from artificial preservatives.'
  },
  {
    id: 'b4',
    name: 'Sparkling Lemon Ginger Ale',
    category: 'beverages',
    subcategory: 'Soft Drinks',
    brand: 'EGP Ginger Beer',
    image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=500&q=80',
    unit: '1.5 Litre Bottle',
    price: 340,
    stock: 45,
    availability: 'in_stock',
    description: 'Authentic spicy ginger beer brewed with natural ginger root extracts.'
  },

  // Rice & Grains
  {
    id: 'g1',
    name: 'White Keeri Samba Rice',
    category: 'grains',
    subcategory: 'Rice & Basmati',
    brand: 'Araliya / Nipuna',
    image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=500&q=80',
    unit: '5 kg Bag',
    price: 1450,
    originalPrice: 1600,
    stock: 80,
    availability: 'in_stock',
    isPopular: true,
    description: 'Short-grain aromatic Keeri Samba rice, triple cleaned and stone-free.'
  },
  {
    id: 'g2',
    name: 'Red Raw Rice (Rath Kekulu)',
    category: 'grains',
    subcategory: 'Rice & Basmati',
    brand: 'Blynk Essentials',
    image: 'https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?auto=format&fit=crop&w=500&q=80',
    unit: '5 kg Bag',
    price: 1280,
    stock: 65,
    availability: 'in_stock',
    isPopular: true,
    description: 'Nutritious unpolished red rice packed with natural fiber and iron.'
  },
  {
    id: 'g3',
    name: 'Red Split Lentils (Mysore Dhal)',
    category: 'grains',
    subcategory: 'Pulses & Lentils',
    brand: 'Blynk Fresh',
    image: 'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?auto=format&fit=crop&w=500&q=80',
    unit: '1 kg Pack',
    price: 440,
    originalPrice: 490,
    stock: 90,
    availability: 'in_stock',
    isPopular: true,
    description: 'Cleaned red split dhal, cooks fast into creamy gravy.'
  },
  {
    id: 'g4',
    name: 'Whole Wheat Flour (Chakki Atta)',
    category: 'grains',
    subcategory: 'Flour & Atta',
    brand: 'Prima Star',
    image: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?auto=format&fit=crop&w=500&q=80',
    unit: '1 kg Pack',
    price: 330,
    stock: 45,
    availability: 'in_stock',
    description: '100% stone-ground whole wheat flour for soft rotis and parathas.'
  },

  // Bakery & Bread
  {
    id: 'bk1',
    name: 'Freshly Baked White Sandwich Bread',
    category: 'bakery',
    subcategory: 'Fresh Bread',
    brand: 'Blynk Bakery',
    image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=500&q=80',
    unit: '400 g Sliced',
    price: 210,
    originalPrice: 240,
    stock: 35,
    availability: 'in_stock',
    isPopular: true,
    isFresh: true,
    description: 'Soft, pillowy sandwich bread baked fresh in our dark store early every morning.'
  },
  {
    id: 'bk2',
    name: 'Butter Croissants (2 Pcs)',
    category: 'bakery',
    subcategory: 'Cakes & Pastries',
    brand: 'Blynk Artisan',
    image: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=500&q=80',
    unit: '2 pcs Pack',
    price: 450,
    stock: 12,
    availability: 'low_stock',
    isFresh: true,
    description: 'Flaky golden french-style croissants baked with pure imported butter.'
  },
  {
    id: 'bk3',
    name: 'Whole Wheat Roasted Buns',
    category: 'bakery',
    subcategory: 'Buns & Rolls',
    brand: 'Blynk Bakery',
    image: 'https://images.unsplash.com/photo-1586444248902-2f64eddc13df?auto=format&fit=crop&w=500&q=80',
    unit: '4 pcs Pack',
    price: 240,
    stock: 20,
    availability: 'in_stock',
    isFresh: true,
    description: 'Nutritious whole wheat dinner buns sprinkled with sesame seeds.'
  },

  // Household
  {
    id: 'h1',
    name: 'Active Washing Liquid Detergent',
    category: 'household',
    subcategory: 'Detergents',
    brand: 'Sunlight / Surf Excel',
    image: 'https://images.unsplash.com/photo-1585336261026-6757c5bca69c?auto=format&fit=crop&w=500&q=80',
    unit: '1 Litre Bottle',
    price: 890,
    originalPrice: 990,
    stock: 30,
    availability: 'in_stock',
    isPopular: true,
    description: 'Deep stain-removing liquid detergent infused with fresh citrus fragrance.'
  },
  {
    id: 'h2',
    name: 'Lime Dishwash Gel',
    category: 'household',
    subcategory: 'Dishwashing',
    brand: 'Vim Ultra',
    image: 'https://images.unsplash.com/photo-1607613009820-a29f7bb81c04?auto=format&fit=crop&w=500&q=80',
    unit: '500 ml Bottle',
    price: 390,
    stock: 45,
    availability: 'in_stock',
    description: 'Powerful grease-cutting liquid dishwash gel with real lemon juice extracts.'
  },

  // Personal Care
  {
    id: 'p1',
    name: 'Moisturizing Aloe Beauty Soap Bar',
    category: 'personal',
    subcategory: 'Soaps & Bodywash',
    brand: 'Lux / Velvet',
    image: 'https://images.unsplash.com/photo-1600857544200-b2f666a9a2ec?auto=format&fit=crop&w=500&q=80',
    unit: '100 g Bar (Pack of 3)',
    price: 450,
    stock: 50,
    availability: 'in_stock',
    isPopular: true,
    description: 'Nourishing beauty bar enriched with organic aloe vera and natural oils.'
  },
  {
    id: 'p2',
    name: 'Anti-Dandruff Herbal Shampoo',
    category: 'personal',
    subcategory: 'Shampoo & Haircare',
    brand: 'Sunsilk / Head & Shoulders',
    image: 'https://images.unsplash.com/photo-1535585209827-a15fcdbc4c2d?auto=format&fit=crop&w=500&q=80',
    unit: '350 ml Bottle',
    price: 850,
    stock: 25,
    availability: 'in_stock',
    description: 'Gentle scalp care shampoo with tea tree oil and mint freshness.'
  },

  // Extra Vegetables
  {
    id: 'v7',
    name: 'Fresh Hot Green Chillies',
    category: 'vegetables',
    subcategory: 'Fresh Vegetables',
    brand: 'Blynk Fresh',
    image: 'https://images.unsplash.com/photo-1588252303782-cb80119abd6d?auto=format&fit=crop&w=500&q=80',
    unit: '100 g',
    price: 90,
    originalPrice: 110,
    stock: 25,
    availability: 'in_stock',
    isFresh: true,
    description: 'Spicy fresh local green chillies essential for daily cooking.'
  },
  {
    id: 'v8',
    name: 'Tender Green Bush Beans',
    category: 'vegetables',
    subcategory: 'Fresh Vegetables',
    brand: 'Blynk Fresh',
    image: 'https://images.unsplash.com/photo-1567375698348-5d9d5ae99de0?auto=format&fit=crop&w=500&q=80',
    unit: '250 g',
    price: 160,
    originalPrice: 190,
    stock: 20,
    availability: 'in_stock',
    isFresh: true,
    description: 'Crisp green beans hand-picked from island highland gardens.'
  },
  {
    id: 'v9',
    name: 'Purple Farm Brinjals (Eggplant)',
    category: 'vegetables',
    subcategory: 'Fresh Vegetables',
    brand: 'Blynk Fresh',
    image: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=500&q=80',
    unit: '500 g',
    price: 190,
    stock: 18,
    availability: 'in_stock',
    isFresh: true,
    description: 'Glossy purple brinjals perfect for moju and curries.'
  },
  {
    id: 'v10',
    name: 'Fresh Green Coriander Leaves',
    category: 'vegetables',
    subcategory: 'Leafy Greens',
    brand: 'Blynk Organic',
    image: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=500&q=80',
    unit: '100 g Bunch',
    price: 80,
    stock: 4,
    availability: 'low_stock',
    isFresh: true,
    description: 'Fragrant fresh coriander leaves for garnishing and chutney.'
  },

  // Oil, Ghee & Masala (category mapping: grains / household / custom)
  {
    id: 'o1',
    name: 'Pure Refined Sunflower Cooking Oil',
    category: 'grains',
    subcategory: 'Oil, Ghee & Masala',
    brand: 'Fortune / Fortune Supreme',
    image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=500&q=80',
    unit: '1 Litre Pouch',
    price: 740,
    originalPrice: 820,
    stock: 50,
    availability: 'in_stock',
    isPopular: true,
    description: 'Light and cholesterol-free pure sunflower oil for healthy cooking.'
  },
  {
    id: 'o2',
    name: 'Pure Golden Cow Milk Ghee',
    category: 'grains',
    subcategory: 'Oil, Ghee & Masala',
    brand: 'Highland / Gowardhan',
    image: 'https://images.unsplash.com/photo-1631451095765-2c91616fc9e6?auto=format&fit=crop&w=500&q=80',
    unit: '200 ml Jar',
    price: 950,
    originalPrice: 1050,
    stock: 30,
    availability: 'in_stock',
    isPopular: true,
    description: 'Aromatic pure cow ghee, slow-cooked for rich traditional flavor.'
  },
  {
    id: 'o3',
    name: 'Pure Ground Turmeric Powder (Kaha)',
    category: 'grains',
    subcategory: 'Oil, Ghee & Masala',
    brand: 'McCurrie / Wijaya',
    image: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=500&q=80',
    unit: '100 g Pack',
    price: 180,
    stock: 60,
    availability: 'in_stock',
    description: '100% natural ground turmeric with high curcumin content.'
  },
  {
    id: 'o4',
    name: 'Roasted Sri Lankan Chili Powder',
    category: 'grains',
    subcategory: 'Oil, Ghee & Masala',
    brand: 'Wijaya Spices',
    image: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=500&q=80',
    unit: '100 g Pack',
    price: 210,
    originalPrice: 240,
    stock: 55,
    availability: 'in_stock',
    description: 'Sun-dried roasted chili powder giving rich red color and heat to curries.'
  },
  {
    id: 'o5',
    name: 'Aromatic Curry Powder (Garam Masala Blend)',
    category: 'grains',
    subcategory: 'Oil, Ghee & Masala',
    brand: 'Blynk Spice Craft',
    image: 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=500&q=80',
    unit: '50 g Pack',
    price: 190,
    stock: 40,
    availability: 'in_stock',
    description: 'Hand-blended fragrant spices including cardamom, clove, and cinnamon.'
  }
];

export const INITIAL_ADDRESSES: Address[] = [
  {
    id: 'addr-1',
    label: 'Home',
    houseNo: 'No. 42',
    street: 'Station Road',
    area: 'Dharga Town',
    city: 'Kalutara District',
    landmark: 'Near Grand Mosque',
    instructions: 'Ring doorbell twice. Deliver to ground floor porch.',
    isDefault: true
  },
  {
    id: 'addr-2',
    label: 'Work',
    houseNo: 'Shop No. 12',
    street: 'Main Street',
    area: 'Alutgama Road',
    city: 'Dharga Town',
    landmark: 'Opposite Commercial Bank',
    instructions: 'Hand over to receptionist or leave at counter.',
    isDefault: false
  }
];

export const INITIAL_RIDERS: Rider[] = [
  {
    id: 'r1',
    name: 'Salman Mohamed',
    phone: '+94 77 123 4567',
    status: 'online',
    completedToday: 9,
    totalDeliveries: 482,
    rating: 4.9,
    vehicleNo: 'SL-BA-4821 (Honda Dio)'
  },
  {
    id: 'r2',
    name: 'Rizwan Ahamed',
    phone: '+94 71 987 6543',
    status: 'online',
    completedToday: 6,
    totalDeliveries: 310,
    rating: 4.8,
    vehicleNo: 'SL-BC-1092 (Yamaha FZ)'
  },
  {
    id: 'r3',
    name: 'Farhan Nizar',
    phone: '+94 76 555 1212',
    status: 'offline',
    completedToday: 4,
    totalDeliveries: 195,
    rating: 4.7,
    vehicleNo: 'SL-BD-8839 (TVS NTorq)'
  }
];

export const INITIAL_ORDERS: Order[] = [
  {
    id: 'BLK-10245',
    customerName: 'Fatima Zohra',
    customerPhone: '+94 77 888 9911',
    address: INITIAL_ADDRESSES[0],
    items: [
      {
        productId: 'd1',
        productName: 'Pure Full Cream Pasteurized Milk',
        unit: '1 Litre Pack',
        price: 420,
        quantity: 2,
        image: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=500&q=80',
        packed: true
      },
      {
        productId: 'bk1',
        productName: 'Freshly Baked White Sandwich Bread',
        unit: '400 g Sliced',
        price: 210,
        quantity: 1,
        image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=500&q=80',
        packed: true
      },
      {
        productId: 'd2',
        productName: 'Fresh White Farm Eggs',
        unit: '10 Eggs Pack',
        price: 490,
        quantity: 1,
        image: 'https://images.unsplash.com/photo-1516448620398-c5f44bf9f441?auto=format&fit=crop&w=500&q=80',
        packed: true
      }
    ],
    subtotal: 1540,
    deliveryFee: 120,
    total: 1660,
    paymentMethod: 'COD',
    status: 'out_for_delivery',
    createdAt: '12 mins ago',
    estimatedTime: '20–30 mins',
    riderId: 'r1',
    riderName: 'Salman Mohamed',
    riderPhone: '+94 77 123 4567'
  },
  {
    id: 'BLK-10246',
    customerName: 'Aisha Mansoor',
    customerPhone: '+94 75 444 3322',
    address: INITIAL_ADDRESSES[1],
    items: [
      {
        productId: 'v1',
        productName: 'Farm Fresh Red Tomatoes',
        unit: '500 g',
        price: 180,
        quantity: 2,
        image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=500&q=80',
        packed: false
      },
      {
        productId: 'v2',
        productName: 'Crisp Yellow Onions',
        unit: '1 kg',
        price: 320,
        quantity: 1,
        image: 'https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?auto=format&fit=crop&w=500&q=80',
        packed: false
      }
    ],
    subtotal: 680,
    deliveryFee: 120,
    total: 800,
    paymentMethod: 'ONLINE',
    status: 'placed',
    createdAt: '3 mins ago',
    estimatedTime: '25–35 mins'
  }
];
