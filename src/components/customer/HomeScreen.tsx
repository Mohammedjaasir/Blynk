import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Search, 
  MapPin, 
  ChevronDown, 
  Sparkles, 
  ShieldCheck, 
  Clock, 
  CheckCircle2, 
  Flame, 
  ShoppingBag,
  ArrowRight,
  TrendingUp,
  Mic,
  Tag,
  Zap,
  ChevronRight,
  User,
  AlertCircle,
  RefreshCw,
  Plus,
  Minus,
  Truck,
  Lock
} from 'lucide-react';
import { LocationSelector } from './LocationSelector';
import { CategoryId, Product } from '../../types';

const ROTATING_PLACEHOLDERS = [
  'Search "farm fresh tomatoes, onions..."',
  'Search "full cream milk, eggs, bread..."',
  'Search "white keeri samba, dhal, flour..."',
  'Search "ceylon tea, instant coffee..."',
  'Search "sunflower cooking oil, ghee..."',
  'Search "cream crackers, cassava chips..."',
  'Search "dishwash gel, washing liquid..."'
];

const HERO_BANNERS = [
  {
    id: 1,
    tag: 'DHARGA TOWN STORE',
    title: 'Fresh Groceries Delivered Daily',
    subtitle: 'Stocked in your neighborhood dark store & delivered in 25–35 mins.',
    cta: 'Shop Fresh Now',
    bgColor: 'from-blynk-green-600 via-blynk-green-500 to-emerald-600',
    accentBadge: 'Express Delivery'
  },
  {
    id: 2,
    tag: 'DAILY SAVINGS',
    title: 'Everyday Kitchen Essentials',
    subtitle: 'Up to 25% OFF on Rice, Cooking Oils, Atta & Daily Spices.',
    cta: 'Explore Super Deals',
    bgColor: 'from-emerald-700 via-blynk-green-600 to-teal-700',
    accentBadge: 'Special Offers'
  },
  {
    id: 3,
    tag: 'LOCAL QUALITY',
    title: 'Farm Fresh Produce & Dairy',
    subtitle: 'Plucked every morning from island farms. 100% Quality Assured.',
    cta: 'View Veggies & Fruit',
    bgColor: 'from-blynk-green-700 via-teal-600 to-blynk-green-600',
    accentBadge: '100% Fresh'
  }
];

export const HomeScreen: React.FC = () => {
  const { 
    categories, 
    products, 
    selectedAddress, 
    setCustomerTab, 
    setSelectedCategoryId, 
    setSelectedProduct,
    cart,
    addToCart,
    updateCartQuantity,
    showToast
  } = useApp();

  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [activeBannerIndex, setActiveBannerIndex] = useState(0);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<'all' | CategoryId>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  // Auto rotate banner carousel
  useEffect(() => {
    const bannerTimer = setInterval(() => {
      setActiveBannerIndex(prev => (prev + 1) % HERO_BANNERS.length);
    }, 4500);
    return () => clearInterval(bannerTimer);
  }, []);

  // Auto rotate search placeholders
  useEffect(() => {
    const placeholderTimer = setInterval(() => {
      setPlaceholderIndex(prev => (prev + 1) % ROTATING_PLACEHOLDERS.length);
    }, 2800);
    return () => clearInterval(placeholderTimer);
  }, []);

  // Product Shelf filtering
  const filteredProducts = activeCategoryFilter === 'all' 
    ? products 
    : products.filter(p => p.category === activeCategoryFilter);

  const freshVegetables = products.filter(p => p.category === 'vegetables');
  const dairyAndBreakfast = products.filter(p => p.category === 'dairy' || p.category === 'bakery');
  const riceAttaDal = products.filter(p => p.category === 'grains');
  const oilGheeMasala = products.filter(p => p.category === 'grains' && p.subcategory === 'Oil, Ghee & Masala');
  const snacksAndBiscuits = products.filter(p => p.category === 'snacks');
  const beverages = products.filter(p => p.category === 'beverages');
  const household = products.filter(p => p.category === 'household');
  const popularInArea = products.filter(p => p.isPopular);
  const greatDeals = products.filter(p => p.originalPrice && p.originalPrice > p.price);

  const handleCategoryClick = (catId: CategoryId) => {
    setSelectedCategoryId(catId);
    setCustomerTab('categories');
  };

  const handleRetry = () => {
    setIsError(false);
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
    }, 500);
  };

  if (isError) {
    return (
      <div className="min-h-[500px] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-50 text-red-500 flex items-center justify-center">
          <AlertCircle className="w-8 h-8" />
        </div>
        <div>
          <h3 className="text-base font-extrabold text-gray-900">Couldn't load groceries</h3>
          <p className="text-xs text-gray-500 mt-1 max-w-[240px]">
            Please check your connection and try again.
          </p>
        </div>
        <button
          onClick={handleRetry}
          className="flex items-center gap-2 bg-blynk-green-500 text-white font-extrabold px-5 py-2.5 rounded-2xl shadow-blynk-glow text-xs active:scale-95 transition-transform"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Try Again</span>
        </button>
      </div>
    );
  }

  if (isLoading) {
    return <HomeSkeletonLoader />;
  }

  return (
    <div className="pb-28 pt-1 space-y-3.5 bg-slate-50 min-h-screen">
      {/* ==================================================== */}
      {/* 1. TOP DELIVERY HEADER — BLINKIT-STYLE STRUCTURE     */}
      {/* ==================================================== */}
      <div className="bg-white px-3.5 pt-2.5 pb-3 border-b border-slate-100 shadow-xs space-y-2 sticky top-0 z-30">
        <div className="flex items-center justify-between gap-2">
          {/* Brand Logo + Delivery Expectation */}
          <div className="flex items-center gap-2">
            <div className="bg-blynk-green-500 text-white font-black text-xs px-2.5 py-1 rounded-xl flex items-center gap-1 shadow-blynk-glow shrink-0">
              <Zap className="w-3.5 h-3.5 text-blynk-yellow-400 fill-blynk-yellow-400" />
              <span className="tracking-tight">Blynk</span>
            </div>

            <div className="flex items-center gap-1.5 bg-blynk-green-50 text-blynk-green-800 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border border-blynk-green-200/60">
              <span className="w-1.5 h-1.5 rounded-full bg-blynk-green-500 animate-pulse" />
              <span>Delivering in 25–35 min</span>
            </div>
          </div>

          {/* Profile Shortcut */}
          <button
            onClick={() => setCustomerTab('account')}
            className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs border border-slate-200 hover:bg-blynk-green-50 hover:text-blynk-green-600 transition-colors shrink-0"
            aria-label="Profile Account"
          >
            <User className="w-4 h-4" />
          </button>
        </div>

        {/* Location Selector Row */}
        <div 
          onClick={() => setIsLocationModalOpen(true)}
          className="flex items-center justify-between gap-2 cursor-pointer group bg-slate-50 hover:bg-blynk-green-50/50 p-2 rounded-xl border border-slate-200/80 transition-all"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-7 h-7 rounded-lg bg-blynk-green-500 text-white flex items-center justify-center shrink-0 shadow-xs">
              <MapPin className="w-4 h-4" />
            </div>
            <div className="truncate">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block leading-none">
                Delivering to
              </span>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-xs font-extrabold text-slate-900 truncate">
                  {selectedAddress.label} • {selectedAddress.street}, {selectedAddress.area}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-blynk-green-600 group-hover:translate-y-0.5 transition-transform shrink-0" />
              </div>
            </div>
          </div>

          <span className="text-[10px] font-extrabold text-blynk-green-600 bg-white px-2 py-1 rounded-lg border border-blynk-green-200 shrink-0 shadow-2xs">
            Change
          </span>
        </div>

        {/* ==================================================== */}
        {/* 2. SEARCH BAR                                        */}
        {/* ==================================================== */}
        <div 
          onClick={() => setCustomerTab('search')}
          className="flex items-center justify-between bg-white border-2 border-blynk-green-500/20 hover:border-blynk-green-500 rounded-2xl px-3.5 py-2.5 shadow-blynk-sm cursor-pointer transition-all group"
        >
          <div className="flex items-center gap-2.5 overflow-hidden flex-1">
            <Search className="w-4 h-4 text-blynk-green-600 shrink-0 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-semibold text-slate-400 truncate transition-opacity duration-300">
              {ROTATING_PLACEHOLDERS[placeholderIndex]}
            </span>
          </div>

          <div className="flex items-center gap-1 text-slate-400 border-l border-slate-200 pl-2 ml-2 shrink-0">
            <Mic className="w-3.5 h-3.5 hover:text-blynk-green-600 transition-colors" />
          </div>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 3. QUICK CATEGORY NAVIGATION (Horizontal Tabs)       */}
      {/* ==================================================== */}
      <div className="px-3.5">
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          <button
            onClick={() => setActiveCategoryFilter('all')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold shrink-0 transition-all ${
              activeCategoryFilter === 'all'
                ? 'bg-blynk-green-500 text-white shadow-blynk-glow'
                : 'bg-white text-slate-700 border border-slate-200 hover:border-blynk-green-300'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>All Groceries</span>
          </button>

          {categories.map(cat => {
            const isActive = activeCategoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveCategoryFilter(cat.id);
                  handleCategoryClick(cat.id);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold shrink-0 transition-all ${
                  isActive
                    ? 'bg-blynk-green-500 text-white shadow-blynk-glow'
                    : 'bg-white text-slate-700 border border-slate-200 hover:border-blynk-green-300'
                }`}
              >
                <img src={cat.image} alt={cat.name} className="w-4 h-4 rounded-full object-cover shrink-0" />
                <span>{cat.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ==================================================== */}
      {/* 4. HERO / PROMOTIONAL BANNER CAROUSEL                 */}
      {/* ==================================================== */}
      <div className="px-3.5">
        <div className="relative overflow-hidden rounded-3xl shadow-blynk-md">
          <div 
            className={`bg-gradient-to-r ${HERO_BANNERS[activeBannerIndex].bgColor} p-4 text-white relative flex items-center justify-between min-h-[125px] transition-all duration-500`}
          >
            {/* Left Banner Text */}
            <div className="space-y-1 max-w-[65%] z-10">
              <div className="inline-flex items-center gap-1 bg-white/20 backdrop-blur-md text-blynk-yellow-300 font-black text-[9px] uppercase px-2 py-0.5 rounded-full border border-white/20">
                <Tag className="w-2.5 h-2.5" />
                <span>{HERO_BANNERS[activeBannerIndex].tag}</span>
              </div>

              <h2 className="text-base font-extrabold tracking-tight leading-tight pt-0.5">
                {HERO_BANNERS[activeBannerIndex].title}
              </h2>

              <p className="text-[11px] text-emerald-100 font-medium leading-snug line-clamp-2">
                {HERO_BANNERS[activeBannerIndex].subtitle}
              </p>

              <button 
                onClick={() => setCustomerTab('categories')}
                className="mt-2 inline-flex items-center gap-1 bg-blynk-yellow-400 text-blynk-dark font-extrabold text-[11px] px-3 py-1 rounded-xl shadow-xs hover:bg-blynk-yellow-300 active:scale-95 transition-all"
              >
                <span>{HERO_BANNERS[activeBannerIndex].cta}</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {/* Right Banner Visual */}
            <div className="shrink-0 w-20 h-20 bg-white/10 rounded-2xl p-2.5 flex items-center justify-center border border-white/20 shadow-inner">
              <ShoppingBag className="w-10 h-10 text-blynk-yellow-400 animate-bounce-short" />
            </div>

            {/* Background Decorative Circles */}
            <div className="absolute -bottom-8 -right-8 w-32 h-32 bg-white/10 rounded-full blur-xl pointer-events-none" />
          </div>

          {/* Carousel Dots */}
          <div className="absolute bottom-2 right-3 flex items-center gap-1.5 z-20">
            {HERO_BANNERS.map((banner, index) => (
              <button
                key={banner.id}
                onClick={() => setActiveBannerIndex(index)}
                className={`h-1.5 rounded-full transition-all ${
                  index === activeBannerIndex ? 'w-5 bg-blynk-yellow-400' : 'w-1.5 bg-white/40'
                }`}
                aria-label={`Slide ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ==================================================== */}
      {/* 5. BESTSELLER CATEGORIES (2-Column & 3-Column Grid)   */}
      {/* ==================================================== */}
      <div className="px-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-900 tracking-tight">Bestseller Categories</h3>
            <p className="text-[10px] text-slate-500 font-medium">Explore top-selling items in Dharga Town</p>
          </div>
          <button 
            onClick={() => setCustomerTab('categories')}
            className="text-xs font-extrabold text-blynk-green-600 hover:underline flex items-center gap-0.5"
          >
            <span>See All</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <BestsellerCard
            title="Vegetables & Fruits"
            count="+145 items"
            catId="vegetables"
            images={[
              'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=200&q=80',
              'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=200&q=80',
              'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?auto=format&fit=crop&w=200&q=80'
            ]}
            onClick={() => handleCategoryClick('vegetables')}
          />

          <BestsellerCard
            title="Dairy, Bread & Eggs"
            count="+85 items"
            catId="dairy"
            images={[
              'https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=200&q=80',
              'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=200&q=80',
              'https://images.unsplash.com/photo-1516448620398-c5f44bf9f441?auto=format&fit=crop&w=200&q=80'
            ]}
            onClick={() => handleCategoryClick('dairy')}
          />

          <BestsellerCard
            title="Rice, Atta & Dal"
            count="+95 items"
            catId="grains"
            images={[
              'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=200&q=80',
              'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?auto=format&fit=crop&w=200&q=80',
              'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?auto=format&fit=crop&w=200&q=80'
            ]}
            onClick={() => handleCategoryClick('grains')}
          />

          <BestsellerCard
            title="Oil, Ghee & Masala"
            count="+60 items"
            catId="grains"
            images={[
              'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=200&q=80',
              'https://images.unsplash.com/photo-1631451095765-2c91616fc9e6?auto=format&fit=crop&w=200&q=80',
              'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=200&q=80'
            ]}
            onClick={() => handleCategoryClick('grains')}
          />

          <BestsellerCard
            title="Snacks & Biscuits"
            count="+110 items"
            catId="snacks"
            images={[
              'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?auto=format&fit=crop&w=200&q=80',
              'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=200&q=80',
              'https://images.unsplash.com/photo-1536591375315-1988d6960926?auto=format&fit=crop&w=200&q=80'
            ]}
            onClick={() => handleCategoryClick('snacks')}
          />

          <BestsellerCard
            title="Beverages & Drinks"
            count="+75 items"
            catId="beverages"
            images={[
              'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=200&q=80',
              'https://images.unsplash.com/photo-1546171753-97d7676e4602?auto=format&fit=crop&w=200&q=80',
              'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=200&q=80'
            ]}
            onClick={() => handleCategoryClick('beverages')}
          />
        </div>
      </div>

      {/* ==================================================== */}
      {/* 6. GROCERY & KITCHEN SECTION (Large Horizontal Cards) */}
      {/* ==================================================== */}
      <div className="px-3.5 space-y-2 pt-1">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-900 tracking-tight">Grocery & Kitchen</h3>
            <p className="text-[10px] text-slate-500 font-medium">Daily necessities for every Sri Lankan home</p>
          </div>
        </div>

        <div className="flex gap-2.5 overflow-x-auto no-scrollbar py-0.5">
          {categories.map(cat => (
            <div
              key={cat.id}
              onClick={() => handleCategoryClick(cat.id)}
              className="relative min-w-[130px] max-w-[130px] h-[110px] rounded-2xl overflow-hidden shadow-blynk-sm border border-slate-200/80 cursor-pointer group shrink-0"
            >
              <img 
                src={cat.image} 
                alt={cat.name} 
                className="w-full h-full object-cover group-hover:scale-108 transition-transform duration-500" 
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent p-2.5 flex flex-col justify-end">
                <span className="text-xs font-extrabold text-white leading-tight">
                  {cat.name}
                </span>
                <span className="text-[9px] font-bold text-blynk-yellow-300 flex items-center gap-0.5 mt-0.5">
                  <span>Explore</span>
                  <ChevronRight className="w-2.5 h-2.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ==================================================== */}
      {/* 7. PRODUCT SHELVES (Horizontal Carousels)             */}
      {/* ==================================================== */}

      {/* SHELF 1: Fresh Vegetables */}
      {freshVegetables.length > 0 && (
        <ProductShelfSection
          title="Fresh Vegetables"
          subtitle="Fresh picks for your kitchen"
          products={freshVegetables}
          onSeeAll={() => handleCategoryClick('vegetables')}
        />
      )}

      {/* SHELF 2: Dairy & Breakfast */}
      {dairyAndBreakfast.length > 0 && (
        <ProductShelfSection
          title="Dairy & Breakfast"
          subtitle="Milk, eggs, bread & butter"
          products={dairyAndBreakfast}
          onSeeAll={() => handleCategoryClick('dairy')}
        />
      )}

      {/* SHELF 3: Rice, Atta & Dal */}
      {riceAttaDal.length > 0 && (
        <ProductShelfSection
          title="Rice, Atta & Dal"
          subtitle="Daily kitchen staples"
          products={riceAttaDal}
          onSeeAll={() => handleCategoryClick('grains')}
        />
      )}

      {/* SHELF 4: Oil, Ghee & Masala */}
      {oilGheeMasala.length > 0 && (
        <ProductShelfSection
          title="Oil, Ghee & Masala"
          subtitle="Cooking essential oils & spices"
          products={oilGheeMasala}
          onSeeAll={() => handleCategoryClick('grains')}
        />
      )}

      {/* SHELF 5: Snacks & Biscuits */}
      {snacksAndBiscuits.length > 0 && (
        <ProductShelfSection
          title="Snacks & Biscuits"
          subtitle="Tea time crunch & snacks"
          products={snacksAndBiscuits}
          onSeeAll={() => handleCategoryClick('snacks')}
        />
      )}

      {/* SHELF 6: Beverages & Drinks */}
      {beverages.length > 0 && (
        <ProductShelfSection
          title="Beverages & Drinks"
          subtitle="Tea, coffee & cold drinks"
          products={beverages}
          onSeeAll={() => handleCategoryClick('beverages')}
        />
      )}

      {/* SHELF 7: Household Essentials */}
      {household.length > 0 && (
        <ProductShelfSection
          title="Household Essentials"
          subtitle="Cleaning & home care"
          products={household}
          onSeeAll={() => handleCategoryClick('household')}
        />
      )}

      {/* SHELF 8: Popular in Dharga Town */}
      {popularInArea.length > 0 && (
        <ProductShelfSection
          title="Popular in Dharga Town"
          subtitle="Top picked items in your area"
          products={popularInArea}
          onSeeAll={() => setCustomerTab('categories')}
          highlight
        />
      )}

      {/* SHELF 9: Great Deals Today */}
      {greatDeals.length > 0 && (
        <ProductShelfSection
          title="Great Deals Today"
          subtitle="Special discounted grocery prices"
          products={greatDeals}
          onSeeAll={() => setCustomerTab('categories')}
        />
      )}

      {/* ==================================================== */}
      {/* 8. TRUST / RELIABILITY SECTION                       */}
      {/* ==================================================== */}
      <div className="px-3.5 pt-2">
        <div className="bg-white border border-slate-200/80 rounded-3xl p-4 shadow-blynk-sm space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blynk-green-50 text-blynk-green-600 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs font-black text-slate-900">Why shop with Blynk Dharga Town?</h3>
              <p className="text-[10px] text-slate-500 font-medium">Reliable quick commerce for your neighborhood</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-100 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-blynk-green-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-extrabold text-slate-900 text-[11px]">Freshly Stocked</p>
                <p className="text-[10px] text-slate-500 font-medium">Direct from local dark store</p>
              </div>
            </div>

            <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-100 flex items-start gap-2">
              <Truck className="w-4 h-4 text-blynk-green-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-extrabold text-slate-900 text-[11px]">Reliable Delivery</p>
                <p className="text-[10px] text-slate-500 font-medium">Dedicated bike riders</p>
              </div>
            </div>

            <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-100 flex items-start gap-2">
              <Lock className="w-4 h-4 text-blynk-green-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-extrabold text-slate-900 text-[11px]">Secure Payments</p>
                <p className="text-[10px] text-slate-500 font-medium">Cash & online checkout</p>
              </div>
            </div>

            <div className="bg-slate-50 p-2.5 rounded-2xl border border-slate-100 flex items-start gap-2">
              <TrendingUp className="w-4 h-4 text-blynk-green-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-extrabold text-slate-900 text-[11px]">Live GPS Track</p>
                <p className="text-[10px] text-slate-500 font-medium">Real-time status updates</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* LOCATION SELECTOR MODAL */}
      <LocationSelector
        isOpen={isLocationModalOpen}
        onClose={() => setIsLocationModalOpen(false)}
      />
    </div>
  );
};

// ====================================================
// SUB-COMPONENTS
// ====================================================

// 1. BESTSELLER CATEGORY CARD (Collage of 3 product images)
const BestsellerCard: React.FC<{
  title: string;
  count: string;
  catId: CategoryId;
  images: string[];
  onClick: () => void;
}> = ({ title, count, images, onClick }) => {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl p-2.5 border border-slate-200/80 shadow-blynk-sm hover:border-blynk-green-300 transition-all cursor-pointer flex flex-col justify-between group"
    >
      <div className="grid grid-cols-3 gap-1 bg-slate-50 p-1 rounded-xl mb-2">
        {images.map((img, i) => (
          <div key={i} className="w-full h-10 rounded-lg overflow-hidden bg-white p-0.5 flex items-center justify-center">
            <img src={img} alt="Product" className="w-full h-full object-cover rounded-md group-hover:scale-105 transition-transform" />
          </div>
        ))}
      </div>

      <div>
        <span className="text-[9px] font-extrabold text-blynk-green-600 bg-blynk-green-50 px-1.5 py-0.5 rounded-md inline-block mb-0.5">
          {count}
        </span>
        <h4 className="text-xs font-black text-slate-900 leading-snug line-clamp-1">
          {title}
        </h4>
      </div>
    </div>
  );
};

// 2. REUSABLE PRODUCT SHELF SECTION
const ProductShelfSection: React.FC<{
  title: string;
  subtitle: string;
  products: Product[];
  onSeeAll: () => void;
  highlight?: boolean;
}> = ({ title, subtitle, products, onSeeAll, highlight = false }) => {
  const { setSelectedProduct } = useApp();

  return (
    <div className={`space-y-2 py-1 ${highlight ? 'bg-blynk-green-50/50 py-3 border-y border-blynk-green-100' : ''}`}>
      <div className="px-3.5 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-1.5">
            <span>{title}</span>
            {highlight && (
              <span className="bg-blynk-yellow-400 text-blynk-dark text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full">
                Popular
              </span>
            )}
          </h3>
          <p className="text-[10px] text-slate-500 font-medium">{subtitle}</p>
        </div>

        <button 
          onClick={onSeeAll}
          className="text-xs font-extrabold text-blynk-green-600 hover:underline flex items-center gap-0.5 shrink-0"
        >
          <span>See all</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex gap-2.5 overflow-x-auto px-3.5 no-scrollbar pb-1 pt-0.5">
        {products.map(product => (
          <ProductCard key={product.id} product={product} onSelect={() => setSelectedProduct(product)} />
        ))}
      </div>
    </div>
  );
};

// 3. POLISHED PRODUCT CARD WITH ANIMATED ADD INTERACTION
const ProductCard: React.FC<{ product: Product; onSelect: () => void }> = ({ product, onSelect }) => {
  const { cart, addToCart, updateCartQuantity } = useApp();
  
  const cartItem = cart.find(i => i.product.id === product.id);
  const quantity = cartItem ? cartItem.quantity : 0;
  const isOutOfStock = product.availability === 'out_of_stock' || product.stock === 0;
  const isLowStock = product.stock > 0 && product.stock <= 8;

  const discountPercent = product.originalPrice 
    ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
    : null;

  return (
    <div 
      onClick={onSelect}
      className="bg-white rounded-2xl p-2 border border-slate-200/90 shadow-blynk-sm flex flex-col justify-between min-w-[145px] max-w-[145px] h-[230px] shrink-0 cursor-pointer hover:border-blynk-green-400 transition-all group relative"
    >
      {/* Product Image Box */}
      <div className="relative w-full h-26 bg-slate-50 rounded-xl overflow-hidden p-1 flex items-center justify-center border border-slate-100">
        <img 
          src={product.image} 
          alt={product.name} 
          className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300" 
          loading="lazy"
        />

        {/* Badges Overlay */}
        <div className="absolute top-1 left-1 flex flex-col gap-1 z-10">
          {product.isFresh && (
            <span className="bg-blynk-green-500 text-white font-black text-[8px] uppercase px-1.5 py-0.5 rounded-md shadow-xs">
              Fresh
            </span>
          )}
          {discountPercent && discountPercent > 0 && (
            <span className="bg-red-500 text-white font-black text-[8px] uppercase px-1.5 py-0.5 rounded-md shadow-xs">
              {discountPercent}% OFF
            </span>
          )}
        </div>

        {/* Stock Warning Badge */}
        {isLowStock && (
          <span className="absolute bottom-1 right-1 bg-amber-100 text-amber-800 font-extrabold text-[8px] px-1.5 py-0.5 rounded-md border border-amber-200">
            Only {product.stock} left
          </span>
        )}
      </div>

      {/* Name & Unit */}
      <div className="mt-1.5 space-y-0.5">
        <h4 className="text-[11px] font-extrabold text-slate-900 line-clamp-2 leading-tight">
          {product.name}
        </h4>
        <p className="text-[10px] text-slate-400 font-semibold">{product.unit}</p>
      </div>

      {/* Price & Add Button */}
      <div className="flex items-center justify-between mt-auto pt-1.5 border-t border-slate-100">
        <div>
          <div className="text-xs font-black text-slate-900">
            Rs. {product.price}
          </div>
          {product.originalPrice && (
            <div className="text-[9px] text-slate-400 line-through font-bold leading-none">
              Rs. {product.originalPrice}
            </div>
          )}
        </div>

        {/* Add to Cart Control */}
        <div onClick={(e) => e.stopPropagation()}>
          {isOutOfStock ? (
            <span className="inline-block text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-xl text-center">
              Out
            </span>
          ) : quantity === 0 ? (
            <button
              onClick={() => addToCart(product, 1)}
              className="bg-blynk-green-50 hover:bg-blynk-green-500 text-blynk-green-600 hover:text-white font-extrabold text-[11px] px-3 py-1 rounded-xl border border-blynk-green-300 transition-all active:scale-95 shadow-xs flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" />
              <span>ADD</span>
            </button>
          ) : (
            <div className="flex items-center justify-between bg-blynk-green-500 text-white font-extrabold rounded-xl px-1.5 py-0.5 text-xs shadow-blynk-glow gap-1 animate-bounce-short">
              <button
                onClick={() => updateCartQuantity(product.id, -1)}
                className="p-0.5 hover:bg-blynk-green-600 rounded-md active:scale-90"
                aria-label="Decrease"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="min-w-[12px] text-center font-bold">{quantity}</span>
              <button
                onClick={() => updateCartQuantity(product.id, 1)}
                className="p-0.5 hover:bg-blynk-green-600 rounded-md active:scale-90"
                aria-label="Increase"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 4. HOME SKELETON LOADER
const HomeSkeletonLoader: React.FC = () => {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="w-32 h-6 bg-slate-200 rounded-xl skeleton-shimmer" />
        <div className="w-8 h-8 bg-slate-200 rounded-full skeleton-shimmer" />
      </div>

      {/* Location skeleton */}
      <div className="w-full h-10 bg-slate-200 rounded-xl skeleton-shimmer" />

      {/* Search skeleton */}
      <div className="w-full h-11 bg-slate-200 rounded-2xl skeleton-shimmer" />

      {/* Banner skeleton */}
      <div className="w-full h-32 bg-slate-200 rounded-3xl skeleton-shimmer" />

      {/* Bestsellers skeleton */}
      <div className="grid grid-cols-2 gap-2">
        <div className="h-24 bg-slate-200 rounded-2xl skeleton-shimmer" />
        <div className="h-24 bg-slate-200 rounded-2xl skeleton-shimmer" />
      </div>

      {/* Shelf skeleton */}
      <div className="space-y-2">
        <div className="w-36 h-5 bg-slate-200 rounded-md skeleton-shimmer" />
        <div className="flex gap-3 overflow-hidden">
          <div className="w-36 h-52 bg-slate-200 rounded-2xl shrink-0 skeleton-shimmer" />
          <div className="w-36 h-52 bg-slate-200 rounded-2xl shrink-0 skeleton-shimmer" />
          <div className="w-36 h-52 bg-slate-200 rounded-2xl shrink-0 skeleton-shimmer" />
        </div>
      </div>
    </div>
  );
};
