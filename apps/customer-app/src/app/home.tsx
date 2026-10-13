import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, interpolateColor, LinearTransition, SlideOutDown,
  useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withRepeat,
  withSequence, withTiming,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import type { Category, Product } from '@/blynk/api/types';
import { minPrice, productsIn, useCatalog, type CatalogData } from '@/blynk/catalog/CatalogContext';
import { categoryOfferActive } from '@/blynk/lib/categories';
import { applyFilters, FILTERS, toggle, type FilterId } from '@/blynk/lib/filters';
import { formatLkr } from '@/blynk/lib/money';
import { effectivePrice, isOfferActive } from '@/blynk/lib/pricing';
import { flatFee, formatHours, freeDeliveryCount } from '@/blynk/lib/storeText';
import { useStore } from '@/blynk/store/StoreContext';
import { Banner } from '@/components/Banner';
import { CART_BAR_H, CartBar } from '@/components/CartBar';
import { ClosedBanner } from '@/components/ClosedBanner';
import { ChevronIcon, FilterIcon, MenuIcon, NavIcon, SearchIcon } from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { PromoImage } from '@/components/PromoImage';
import { Hearts, PressScale, RollingText, Skeleton, StampBadge, useTicker } from '@/components/ui';
import { useCartSelect } from '@/lib/cart';
import { openAisle } from '@/lib/nav';
import { C, F } from '@/lib/theme';

const CAT_W = 78;

export default function Home() {
  const insets = useSafeAreaInsets();
  const { data, error, refresh } = useCatalog();
  const store = useStore();
  const [warming, setWarming] = useState(true);
  const [locating, setLocating] = useState(true);
  const [granted, setGranted] = useState(false);
  const [cat, setCat] = useState('all');
  const [filters, setFilters] = useState<FilterId[]>([]);
  const [darkBar, setDarkBar] = useState(false);
  const count = useCartSelect((c) => c.count);
  const loading = warming || !data;
  const freeCount = freeDeliveryCount(store);

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const y = useSharedValue(0);
  const headerH = useSharedValue(400);
  const catH = useSharedValue(110);
  const chipsY = useSharedValue(99999);
  const aislesY = useSharedValue(0);
  const feedY = useSharedValue(0);
  const stuckChips = useSharedValue(0);
  const strip = useSharedValue(0);
  const pill = useSharedValue(0);
  const allowStrip = useSharedValue(0);

  useEffect(() => {
    const a = setTimeout(() => setLocating(false), 900);
    const b = setTimeout(() => setWarming(false), 1300);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);

  useEffect(() => {
    if (granted && !loading) {
      allowStrip.set(1);
      strip.set(withSpring(1, { damping: 16, stiffness: 140 }));
    }
  }, [granted, loading]);

  const onScroll = useAnimatedScrollHandler((e) => {
    y.value = e.contentOffset.y;
  });

  useAnimatedReaction(
    () => ({
      chips: y.value + catH.value >= feedY.value + chipsY.value,
      past: y.value > headerH.value - 10,
      far: y.value > 700,
      down: y.value > 40,
    }),
    (s, prev) => {
      if (s.chips !== prev?.chips) stuckChips.value = withTiming(s.chips ? 1 : 0, { duration: 220 });
      if (s.past !== prev?.past) scheduleOnRN(setDarkBar, s.past);
      if (s.far !== prev?.far) pill.value = withSpring(s.far ? 1 : 0, { damping: 14, stiffness: 170 });
      if (s.down !== prev?.down && allowStrip.get()) strip.set(withTiming(s.down ? 0 : 1, { duration: 260 }));
    },
  );

  const statusA = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(y.value, [headerH.value - 80, headerH.value - 10], [C.purple, '#FFFFFF']),
  }));
  const chipsA = useAnimatedStyle(() => ({ height: stuckChips.value * 46, opacity: stuckChips.value }));
  const stickyShadow = useAnimatedStyle(() => ({ elevation: stuckChips.value * 4, shadowOpacity: stuckChips.value * 0.08 }));
  const stripA = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - strip.value) * 120 }] }));
  const pillA = useAnimatedStyle(() => ({ opacity: pill.value, transform: [{ translateY: (1 - pill.value) * 80 }, { scale: 0.8 + pill.value * 0.2 }] }));

  const view = useMemo(() => (data ? buildView(data, cat, filters) : null), [data, cat, filters]);
  const banner = useMemo(() => ({
    images: (data?.products ?? []).filter((p) => p.is_available && p.image_url).slice(0, 6).map((p) => p.image_url as string),
    min: data ? minPrice(data.products) : null,
    hints: (data?.products ?? []).filter((p) => p.is_available).slice(0, 6).map((p) => p.name),
  }), [data]);

  const grant = () => {
    // Asking the browser is fine; the position never leaves this device in this phase.
    try {
      const geo = (globalThis as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
      geo?.getCurrentPosition(() => {}, () => {}, { timeout: 8000 });
    } catch { /* no geolocation here */ }
    setGranted(true);
    setLocating(true);
    setWarming(true);
    setTimeout(() => setLocating(false), 700);
    setTimeout(() => setWarming(false), 1100);
  };

  const toAisles = () => {
    scrollRef.current?.scrollTo({ y: Math.max(0, feedY.get() + aislesY.get() - catH.get() - 8), animated: true });
  };
  const toggleFilter = (f: FilterId) => setFilters((s) => toggle(s, f));

  const flat = flatFee(store);
  const fees: [string, string][] = [
    ['0', 'No packaging fee'],
    ['0', 'No platform fee'],
    freeCount > 0
      ? ['✓', `Free first ${freeCount} deliveries`]
      : flat != null ? ['LKR', `Delivery ${formatLkr(flat)}`] : ['km', 'Delivery fee at checkout'],
  ];

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style={darkBar ? 'dark' : 'light'} />
      <Animated.View style={[{ height: insets.top, zIndex: 10 }, statusA]} />

      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        stickyHeaderIndices={[1]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 160 }}
      >
        {/* 0 — ink header */}
        <View onLayout={(e) => (headerH.value = e.nativeEvent.layout.height)} style={{ backgroundColor: C.purple }}>
          <LocationRow locating={locating} hub={store?.hub_name ?? null} />
          <SearchBar hints={banner.hints} />
          <ClosedBanner style={{ marginHorizontal: 16, marginTop: 12 }} />
          {loading ? (
            <View style={{ padding: 16, gap: 10 }}>
              <Skeleton h={30} w="55%" style={{ opacity: 0.25 }} />
              <Skeleton h={14} w="40%" style={{ opacity: 0.25 }} />
              <Skeleton h={110} style={{ opacity: 0.18, borderRadius: 16 }} />
            </View>
          ) : (
            <Animated.View entering={FadeIn.duration(450)}>
              <Banner images={banner.images} minPrice={banner.min} freeCount={freeCount} onOrderNow={toAisles} />
            </Animated.View>
          )}
        </View>

        {/* 1 — sticky: categories (+ filter chips once the inline row scrolls under) */}
        {/* plain View: RN's sticky-header wrapper copies & freezes this child's style, so no animated styles here */}
        <View>
          <Animated.View style={[styles.sticky, stickyShadow]}>
            <View onLayout={(e) => (catH.value = e.nativeEvent.layout.height)}>
              {loading || !view ? <CategorySkeleton /> : <CategoryRail items={view.rail} value={cat} onChange={setCat} />}
            </View>
            <Animated.View style={[{ overflow: 'hidden' }, chipsA]}>
              <FilterChips on={filters} onToggle={toggleFilter} />
            </Animated.View>
          </Animated.View>
        </View>

        {/* 2 — feed */}
        <View onLayout={(e) => (feedY.value = e.nativeEvent.layout.y)}>
          {error && !data ? (
            <ErrorBox message={error.message} onRetry={() => void refresh()} />
          ) : loading || !view ? (
            <FeedSkeleton />
          ) : (
            <>
              {view.under.length > 0 && (
                <>
                  <Animated.View entering={FadeInDown.duration(420).delay(80)} style={styles.sectionHead}>
                    <Text style={styles.h2}>Groceries under LKR 300</Text>
                  </Animated.View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
                    {view.under.map((p, i) => (
                      <Animated.View key={cat + p.id} entering={FadeInDown.delay(120 + Math.min(i, 8) * 70).springify().mass(1).energyThreshold(1e-4).damping(16)}>
                        <ProductCard product={p} index={i} sub={p.category_name} width={128} />
                      </Animated.View>
                    ))}
                  </ScrollView>
                </>
              )}

              {data.promotions.some((p) => p.image_url) && <PromoImage promotions={data.promotions} categories={data.categories} products={data.products} />}

              {view.offers.length > 0 && <OffersRail products={view.offers} data={data} />}

              <View onLayout={(e) => (chipsY.value = e.nativeEvent.layout.y)} style={{ marginTop: 8 }}>
                <FilterChips on={filters} onToggle={toggleFilter} />
              </View>
              <Text onLayout={(e) => (aislesY.value = e.nativeEvent.layout.y)} style={[styles.h2, { marginHorizontal: 16, marginTop: 6, marginBottom: 10 }]}>Explore all aisles</Text>

              {view.aisles.length === 0 && (
                <Text style={styles.empty}>{filters.length ? 'Nothing matches these filters right now.' : "We're stocking the shelves. Check back shortly."}</Text>
              )}
              {view.aisles.map(({ c, items }, i) => (
                <Animated.View key={c.id} entering={FadeInDown.delay(Math.min(i, 6) * 90).duration(420)} layout={LinearTransition.springify().mass(1).energyThreshold(1e-4).damping(18)}>
                  <AisleCard category={c} items={items} />
                  {i === 1 && <PromoBand />}
                </Animated.View>
              ))}
            </>
          )}
        </View>
      </Animated.ScrollView>

      {/* floating "Search" pill */}
      <Animated.View pointerEvents="box-none" style={[styles.pillWrap, { bottom: insets.bottom + 24 + (count > 0 ? CART_BAR_H + 10 : 0) }, pillA]}>
        <PressScale onPress={() => router.push('/search')} style={styles.pill} haptic>
          <SearchIcon size={14} color="#fff" />
          <Text style={styles.pillTxt}>Search</Text>
        </PressScale>
      </Animated.View>

      {/* fees strip (after location granted) */}
      <Animated.View style={[styles.feeStrip, { paddingBottom: insets.bottom + 10 }, stripA]}>
        {fees.map(([c, l]) => (
          <View key={l} style={{ alignItems: 'center', gap: 4, flex: 1 }}>
            <View style={styles.coin}><Text style={styles.coinTxt}>{c}</Text></View>
            <Text style={styles.feeTxt} numberOfLines={1}>{l}</Text>
          </View>
        ))}
      </Animated.View>

      <CartBar />

      {/* location permission sheet */}
      {!granted && (
        <Animated.View exiting={SlideOutDown.duration(320)} style={[styles.locSheet, { paddingBottom: insets.bottom }]}>
          <View style={styles.locDark}>
            <View style={{ flex: 1 }}>
              <Text style={styles.locTitle}>⌖  Location permission is off</Text>
              <Text style={styles.locSub}>Lets the app find your delivery spot. Your location stays on this device.</Text>
            </View>
            <PressScale onPress={grant} style={styles.grant} haptic>
              <Text style={styles.grantTxt}>GRANT</Text>
            </PressScale>
          </View>
          <Pressable onPress={() => router.push('/address')} style={styles.locManual}>
            <SearchIcon size={15} color={C.green} />
            <Text style={styles.locManualTxt}>Enter location manually</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */

type RailItem = { id: string; name: string; image: string | null; from: number | null; emoji?: string };

function buildView(data: CatalogData, cat: string, filters: FilterId[]) {
  const scope = cat === 'all' ? data.products : productsIn(data, cat);
  const shown = applyFilters(scope, filters);
  const aisles = data.aisles
    .filter((c) => cat === 'all' || c.id === cat)
    .map((c) => ({ c, items: applyFilters(productsIn(data, c.id), filters) }))
    .filter((a) => a.items.length > 0);
  const rail: RailItem[] = [
    { id: 'all', name: 'All', image: null, from: null, emoji: '🛒' },
    ...data.aisles
      .map((c) => {
        const items = productsIn(data, c.id);
        return { id: c.id, name: c.name, image: c.image_url ?? items.find((p) => p.image_url)?.image_url ?? null, from: minPrice(items), n: items.length };
      })
      .filter((r) => r.n > 0),
  ];
  return {
    rail,
    under: shown.filter((p) => p.is_available && effectivePrice(p) <= 300),
    offers: shown.filter((p) => p.is_available && isOfferActive(p)),
    aisles,
  };
}

function LocationRow({ locating, hub }: { locating: boolean; hub: string | null }) {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = locating ? withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1) : withSpring(0);
  }, [locating]);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  return (
    <View style={styles.locRow}>
      <Animated.View style={[styles.navDot, a]}>
        <NavIcon size={13} color={C.ink} />
      </Animated.View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <RollingText text={locating ? 'Locating ...' : 'Dharga Town'} style={styles.locName} />
          <ChevronIcon size={14} color="#fff" />
        </View>
        {!locating && !!hub && (
          <Animated.Text entering={FadeIn.duration(300)} numberOfLines={1} style={styles.locAddr}>
            {hub}
          </Animated.Text>
        )}
      </View>
      <PressScale style={{ padding: 6 }}>
        <MenuIcon size={22} color="#fff" />
      </PressScale>
    </View>
  );
}

function SearchBar({ hints }: { hints: string[] }) {
  const t = useTicker();
  const hint = hints.length ? hints[t % hints.length] : 'groceries';
  return (
    <PressScale onPress={() => router.push('/search')} style={styles.search} scaleTo={0.98}>
      <SearchIcon size={17} color={C.sub} />
      <Text style={styles.searchTxt}>{"Search for '"}</Text>
      <View style={{ flexShrink: 1 }}>
        <RollingText text={hint} style={[styles.searchTxt, { marginLeft: 0 }]} />
      </View>
      <Text style={[styles.searchTxt, { marginLeft: 0 }]}>{"'"}</Text>
    </PressScale>
  );
}

function CategoryRail({ items, value, onChange }: { items: RailItem[]; value: string; onChange: (id: string) => void }) {
  const idx = Math.max(0, items.findIndex((c) => c.id === value));
  const x = useSharedValue(idx * CAT_W);
  useEffect(() => {
    x.value = withSpring(idx * CAT_W, { damping: 17, stiffness: 190 });
  }, [idx]);
  const ind = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 10 }}>
      <Animated.View style={[styles.catIndicator, ind]} />
      {items.map((c, i) => (
        <CategoryItem key={c.id} c={c} active={c.id === value} i={i} onPress={() => onChange(c.id)} />
      ))}
    </ScrollView>
  );
}

function CategoryItem({ c, active, i, onPress }: { c: RailItem; active: boolean; i: number; onPress: () => void }) {
  const b = useSharedValue(0);
  useEffect(() => {
    if (active) b.value = withSequence(withTiming(-6, { duration: 140 }), withSpring(0, { damping: 6, stiffness: 300 }));
  }, [active]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: b.value }, { scale: 1 + -b.value * 0.02 }] }));
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(i, 10) * 45).duration(350)}>
      <PressScale onPress={onPress} style={styles.cat} haptic>
        <Animated.View style={[styles.catImg, a]}>
          {c.image ? <Image source={{ uri: c.image }} resizeMode="contain" style={{ width: 40, height: 40 }} /> : <Text style={{ fontSize: 30 }}>{c.emoji ?? '🛒'}</Text>}
        </Animated.View>
        {c.from != null && (
          <View style={styles.fromTag}>
            <Text style={styles.fromTxt}>FROM {formatLkr(c.from)}</Text>
          </View>
        )}
        <Text numberOfLines={1} style={[styles.catName, active && { fontFamily: F.bold, color: C.ink }]}>{c.name}</Text>
      </PressScale>
    </Animated.View>
  );
}

function FilterChips({ on, onToggle }: { on: FilterId[]; onToggle: (f: FilterId) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 6, alignItems: 'center' }}>
      <View style={styles.chip}><FilterIcon size={15} /></View>
      {FILTERS.map((f, i) => {
        const active = on.includes(f.id);
        return (
          <PressScale
            key={f.id}
            onPress={() => onToggle(f.id)}
            style={[styles.chip, active && { borderColor: C.pink, backgroundColor: C.pinkTint }]}
          >
            {i === 0 && <Hearts size={11} />}
            <Text style={[styles.chipTxt, active && { color: C.pink }]}>{f.label}</Text>
          </PressScale>
        );
      })}
    </ScrollView>
  );
}

function AisleCard({ category: c, items }: { category: Category; items: Product[] }) {
  const store = useStore();
  const freeCount = freeDeliveryCount(store);
  const hours = formatHours(store);
  const flat = flatFee(store);
  const from = minPrice(items);
  const delivery = freeCount > 0 ? `Free delivery on your first ${freeCount} orders` : flat != null ? `Delivery ${formatLkr(flat)}` : 'Delivery fee at checkout';
  return (
    <PressScale scaleTo={0.985} onPress={() => openAisle(c)} style={styles.store}>
      {freeCount > 0 && <StampBadge style={{ position: 'absolute', right: 6, top: 4 }} />}
      {categoryOfferActive(c) && <Text style={styles.lower}>{c.offer_percent}% OFF EVERYTHING HERE</Text>}
      <Text style={styles.storeName} numberOfLines={1}>{c.name}</Text>
      <Text style={styles.meta}>
        <Text style={{ color: C.green }}>✪ </Text>
        {items.length} item{items.length === 1 ? '' : 's'}{hours ? ` • ${hours}` : ''}
      </Text>
      <Text style={[styles.meta, { marginBottom: 10 }]}>
        <Text style={{ color: C.green }}>✿ </Text>{delivery}{from != null ? ` • Items from ${formatLkr(from)}` : ''}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {items.slice(0, 8).map((p, i) => (
          <ProductCard key={p.id} product={p} width={112} index={i} />
        ))}
      </ScrollView>
    </PressScale>
  );
}

/** Green band with a waving delivery scooter: only things Blynk really does. */
function PromoBand() {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withRepeat(withSequence(withTiming(1, { duration: 220 }), withTiming(-1, { duration: 220 }), withTiming(1, { duration: 220 }), withTiming(0, { duration: 220 }), withTiming(0, { duration: 1400 })), -1);
  }, []);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${w.value * 14}deg` }] }));
  return (
    <LinearGradient colors={[C.green, '#14A02C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.promo}>
      <View style={{ gap: 6 }}>
        <Text style={styles.promoTxt}>☑  Cash on delivery</Text>
        <Text style={styles.promoTxt}>☑  No platform fee    ☑  No packaging fee</Text>
      </View>
      <Animated.Text style={[{ fontSize: 46, position: 'absolute', right: 10, bottom: -4 }, a]}>🛵</Animated.Text>
    </LinearGradient>
  );
}

/** Green "On offer at Blynk" featured rail: real offer prices only. */
function OffersRail({ products, data }: { products: Product[]; data: CatalogData }) {
  const open = (p: Product) => {
    const top = data.topOf(p.category_id);
    const c = data.categories.find((x) => x.id === top) ?? data.aisles.find((x) => x.id === top);
    if (c) openAisle(c);
  };
  return (
    <LinearGradient colors={['#FFFFFF', C.pinkSoft, '#FFFFFF']} style={{ paddingVertical: 18, marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16 }}>
        <Hearts size={11} />
        <Text style={styles.vsSmall}>ON OFFER AT BLYNK</Text>
      </View>
      <Text style={styles.vsBig}>OFFER PRICES TODAY</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12, marginTop: 10 }}>
        {products.slice(0, 10).map((p, i) => (
          <Animated.View key={p.id} entering={FadeInDown.delay(200 + Math.min(i, 6) * 80)}>
            <PressScale onPress={() => open(p)}>
              <LinearGradient colors={[C.pinkTint, C.pinkSoft]} style={styles.vsCard}>
                {p.image_url ? <Image source={{ uri: p.image_url }} resizeMode="contain" style={{ width: 96, height: 96 }} /> : <Text style={{ fontSize: 40, color: C.faint }}>{p.name.charAt(0)}</Text>}
                <View style={styles.vsTag}>
                  <Text style={styles.vsTagSmall}>NOW</Text>
                  <Text style={styles.vsTagBig}>{formatLkr(effectivePrice(p))}</Text>
                </View>
              </LinearGradient>
              <Text style={styles.vsName} numberOfLines={1}>{p.name}</Text>
              <Text style={[styles.meta, { textDecorationLine: 'line-through' }]}>{formatLkr(p.selling_price)}</Text>
            </PressScale>
          </Animated.View>
        ))}
      </ScrollView>
    </LinearGradient>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(250)} style={{ padding: 24, alignItems: 'center', gap: 12 }}>
      <Text style={[styles.h2, { textAlign: 'center' }]}>{message}</Text>
      <PressScale onPress={onRetry} style={styles.retry} haptic><Text style={styles.retryTxt}>Try again</Text></PressScale>
    </Animated.View>
  );
}

function CategorySkeleton() {
  return (
    <View style={{ flexDirection: 'row', gap: 14, padding: 14 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ alignItems: 'center', gap: 6 }}>
          <Skeleton w={58} h={58} r={16} />
          <Skeleton w={40} h={8} />
        </View>
      ))}
    </View>
  );
}

function FeedSkeleton() {
  return (
    <View style={{ padding: 16, gap: 14 }}>
      <Skeleton w="45%" h={16} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ gap: 6 }}>
            <Skeleton w={128} h={128} r={14} />
            <Skeleton w={90} h={9} />
            <Skeleton w={60} h={9} />
          </View>
        ))}
      </View>
      <Skeleton h={150} r={16} />
      <Skeleton h={150} r={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  locRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  navDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.yellow, alignItems: 'center', justifyContent: 'center' },
  locName: { fontFamily: F.bold, color: '#fff', fontSize: 16 },
  locAddr: { fontFamily: F.regular, color: '#C9CCDA', fontSize: 11.5, marginTop: 1 },
  search: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12,
    borderRadius: 24, paddingHorizontal: 14, height: 44, gap: 0, overflow: 'hidden',
  },
  searchTxt: { fontFamily: F.regular, color: C.sub, fontSize: 14, marginLeft: 2 },
  sticky: { backgroundColor: '#fff', shadowColor: '#000', shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  catIndicator: { position: 'absolute', left: 10, top: 10, width: CAT_W - 6, height: 92, borderRadius: 16, backgroundColor: C.pinkSoft },
  cat: { width: CAT_W, alignItems: 'center', paddingTop: 8, height: 92 },
  catImg: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  fromTag: { backgroundColor: C.pink, borderRadius: 4, paddingHorizontal: 4, marginTop: -4 },
  fromTxt: { color: '#fff', fontSize: 7.5, fontFamily: F.black },
  catName: { fontFamily: F.medium, fontSize: 11.5, color: C.sub, marginTop: 5, maxWidth: CAT_W - 8 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 10, marginBottom: 12 },
  h2: { fontFamily: F.semi, fontSize: 17, color: C.ink },
  empty: { fontFamily: F.regular, fontSize: 13, color: C.sub, marginHorizontal: 16, marginBottom: 20 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.line, borderRadius: 18,
    paddingHorizontal: 11, height: 34, backgroundColor: '#fff',
  },
  chipTxt: { fontFamily: F.medium, fontSize: 12, color: C.text },
  store: {
    marginHorizontal: 12, marginBottom: 14, backgroundColor: '#fff', borderRadius: 18, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  lower: { fontFamily: F.bold, color: C.pink, fontSize: 10.5, letterSpacing: 0.3 },
  storeName: { fontFamily: F.bold, fontSize: 18, color: C.ink, flexShrink: 1, marginRight: 60 },
  meta: { fontFamily: F.regular, fontSize: 11.5, color: C.sub, marginTop: 3, marginRight: 50 },
  promo: { marginHorizontal: 0, marginBottom: 14, paddingHorizontal: 18, paddingVertical: 16, overflow: 'hidden' },
  promoTxt: { color: '#fff', fontFamily: F.bold, fontSize: 13 },
  vsSmall: { fontFamily: F.bold, fontSize: 11, color: C.pink, letterSpacing: 0.5 },
  vsBig: { fontFamily: F.black, fontSize: 21, color: C.pink, marginHorizontal: 16, marginTop: 2 },
  vsCard: { width: 136, height: 136, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  vsTag: { position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(26,29,46,0.78)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  vsTagSmall: { color: C.yellow, fontFamily: F.bold, fontSize: 9 },
  vsTagBig: { color: '#fff', fontFamily: F.black, fontSize: 14 },
  vsName: { fontFamily: F.semi, fontSize: 12.5, color: C.ink, marginTop: 6, width: 136 },
  pillWrap: { position: 'absolute', alignSelf: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.ink, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22 },
  pillTxt: { color: '#fff', fontFamily: F.semi, fontSize: 13 },
  feeStrip: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.green, flexDirection: 'row',
    justifyContent: 'space-around', paddingTop: 12, paddingHorizontal: 6, borderTopLeftRadius: 18, borderTopRightRadius: 18,
  },
  coin: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 3, backgroundColor: C.yellow, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#D9B800' },
  coinTxt: { fontFamily: F.black, fontSize: 9, color: C.greenDark },
  feeTxt: { color: '#fff', fontFamily: F.medium, fontSize: 11.5 },
  locSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
  locDark: { backgroundColor: '#000', flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  locTitle: { color: '#fff', fontFamily: F.bold, fontSize: 14 },
  locSub: { color: '#ddd', fontFamily: F.regular, fontSize: 11.5, marginTop: 3 },
  grant: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  grantTxt: { fontFamily: F.black, fontSize: 11, color: C.ink },
  locManual: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  locManualTxt: { fontFamily: F.regular, fontSize: 13.5, color: C.sub },
  retry: { backgroundColor: C.green, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 11 },
  retryTxt: { color: '#fff', fontFamily: F.bold, fontSize: 14 },
});
