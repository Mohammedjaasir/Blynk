import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, interpolateColor, LinearTransition, SlideOutDown,
  useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withRepeat,
  withSequence, withTiming,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { Banner } from '@/components/Banner';
import { CART_BAR_H, CartBar } from '@/components/CartBar';
import { ChevronIcon, FilterIcon, MenuIcon, NavIcon, SearchIcon } from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { Hearts, PressScale, RollingText, Skeleton, StampBadge, useTicker } from '@/components/ui';
import { CAT_ITEMS, CATEGORIES, PRODUCTS, SEARCH_HINTS, Store, STORES, UNDER_99 } from '@/lib/data';
import { useCartSelect } from '@/lib/cart';
import { C, F } from '@/lib/theme';

const CAT_W = 78;

export default function Home() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(true);
  const [granted, setGranted] = useState(false);
  const [cat, setCat] = useState('all');
  const [darkBar, setDarkBar] = useState(false);
  const count = useCartSelect((c) => c.count);

  const y = useSharedValue(0);
  const headerH = useSharedValue(400);
  const catH = useSharedValue(110);
  const chipsY = useSharedValue(99999);
  const feedY = useSharedValue(0);
  const stuckChips = useSharedValue(0);
  const strip = useSharedValue(0);
  const pill = useSharedValue(0);
  const allowStrip = useSharedValue(0);

  useEffect(() => {
    const a = setTimeout(() => setLocating(false), 900);
    const b = setTimeout(() => setLoading(false), 1300);
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

  const stores = useMemo(() => {
    if (cat === 'all') return STORES;
    const items = CAT_ITEMS[cat] ?? [];
    return STORES.filter((s) => s.products.some((p) => items.includes(p)));
  }, [cat]);
  const under = useMemo(() => (cat === 'all' ? UNDER_99 : (CAT_ITEMS[cat] ?? []).filter((id) => PRODUCTS[id].price < 99)), [cat]);

  const grant = () => {
    setGranted(true);
    setLocating(true);
    setLoading(true);
    setTimeout(() => setLocating(false), 700);
    setTimeout(() => setLoading(false), 1100);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style={darkBar ? 'dark' : 'light'} />
      <Animated.View style={[{ height: insets.top, zIndex: 10 }, statusA]} />

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        stickyHeaderIndices={[1]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 160 }}
      >
        {/* 0 — purple header */}
        <View onLayout={(e) => (headerH.value = e.nativeEvent.layout.height)} style={{ backgroundColor: C.purple }}>
          <LocationRow locating={locating} />
          <SearchBar />
          {loading ? (
            <View style={{ padding: 16, gap: 10 }}>
              <Skeleton h={30} w="55%" style={{ opacity: 0.25 }} />
              <Skeleton h={14} w="40%" style={{ opacity: 0.25 }} />
              <Skeleton h={110} style={{ opacity: 0.18, borderRadius: 16 }} />
            </View>
          ) : (
            <Animated.View entering={FadeIn.duration(450)}>
              <Banner />
            </Animated.View>
          )}
        </View>

        {/* 1 — sticky: categories (+ filter chips once the inline row scrolls under) */}
        {/* plain View: RN's sticky-header wrapper copies & freezes this child's style, so no animated styles here */}
        <View>
          <Animated.View style={[styles.sticky, stickyShadow]}>
            <View onLayout={(e) => (catH.value = e.nativeEvent.layout.height)}>
              {loading ? <CategorySkeleton /> : <CategoryRail value={cat} onChange={setCat} />}
            </View>
            <Animated.View style={[{ overflow: 'hidden' }, chipsA]}>
              <FilterChips />
            </Animated.View>
          </Animated.View>
        </View>

        {/* 2 — feed */}
        <View onLayout={(e) => (feedY.value = e.nativeEvent.layout.y)}>
          {loading ? (
            <FeedSkeleton />
          ) : (
            <>
              <Animated.View entering={FadeInDown.duration(420).delay(80)} style={styles.sectionHead}>
                <Text style={styles.h2}>Groceries under ₹99</Text>
                <PressScale style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.seeAll}>See All </Text>
                  <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={12} color={C.sub} /></View>
                </PressScale>
              </Animated.View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
                {under.map((id, i) => (
                  <Animated.View key={cat + id} entering={FadeInDown.delay(120 + i * 70).springify().mass(1).energyThreshold(1e-4).damping(16)}>
                    <ProductCard id={id} index={i} storeId="fresh" sub="FreshBasket Organics" width={128} />
                  </Animated.View>
                ))}
              </ScrollView>

              <VersusRail />

              <View onLayout={(e) => (chipsY.value = e.nativeEvent.layout.y)} style={{ marginTop: 8 }}>
                <FilterChips />
              </View>
              <Text style={[styles.h2, { marginHorizontal: 16, marginTop: 6, marginBottom: 10 }]}>Explore all stores</Text>

              {stores.map((s, i) => (
                <Animated.View key={s.id} entering={FadeInDown.delay(i * 90).duration(420)} layout={LinearTransition.springify().mass(1).energyThreshold(1e-4).damping(18)}>
                  <StoreCard store={s} />
                  {i === 1 && <PromoBand />}
                </Animated.View>
              ))}
            </>
          )}
        </View>
      </Animated.ScrollView>

      {/* floating "Search" pill */}
      <Animated.View pointerEvents="box-none" style={[styles.pillWrap, { bottom: insets.bottom + 24 + (count > 0 ? CART_BAR_H + 10 : 0) }, pillA]}>
        <PressScale style={styles.pill} haptic>
          <SearchIcon size={14} color="#fff" />
          <Text style={styles.pillTxt}>Search</Text>
        </PressScale>
      </Animated.View>

      {/* ₹0 fees strip (after location granted) */}
      <Animated.View style={[styles.feeStrip, { paddingBottom: insets.bottom + 10 }, stripA]}>
        {[['₹0', 'Packaging Fee'], ['₹0', 'Platform Fee'], ['₹', 'Mandi Price Match']].map(([c, l]) => (
          <View key={l} style={{ alignItems: 'center', gap: 4 }}>
            <View style={styles.coin}><Text style={styles.coinTxt}>{c}</Text></View>
            <Text style={styles.feeTxt}>{l}</Text>
          </View>
        ))}
      </Animated.View>

      <CartBar />

      {/* location permission sheet */}
      {!granted && (
        <Animated.View exiting={SlideOutDown.duration(320)} style={[styles.locSheet, { paddingBottom: insets.bottom }]}>
          <View style={styles.locDark}>
            <View style={{ flex: 1 }}>
              <Text style={styles.locTitle}>⌖  Location Permission is Off</Text>
              <Text style={styles.locSub}>Granting location permission will ensure accurate address and hassle free delivery</Text>
            </View>
            <PressScale onPress={grant} style={styles.grant} haptic>
              <Text style={styles.grantTxt}>GRANT</Text>
            </PressScale>
          </View>
          <Pressable onPress={() => router.push('/address')} style={styles.locManual}>
            <SearchIcon size={15} color={C.green} />
            <Text style={styles.locManualTxt}>Enter Location Manually</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */

function LocationRow({ locating }: { locating: boolean }) {
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
          <RollingText text={locating ? 'Locating ...' : 'Kurumbapalayam'} style={styles.locName} />
          <ChevronIcon size={14} color="#fff" />
        </View>
        {!locating && (
          <Animated.Text entering={FadeIn.duration(300)} numberOfLines={1} style={styles.locAddr}>
            Vaiyapuri Nagar, Kurumbapalayam, Coimbatore
          </Animated.Text>
        )}
      </View>
      <PressScale style={{ padding: 6 }}>
        <MenuIcon size={22} color="#fff" />
      </PressScale>
    </View>
  );
}

function SearchBar() {
  const t = useTicker();
  const hint = SEARCH_HINTS[t % SEARCH_HINTS.length];
  return (
    <PressScale style={styles.search} scaleTo={0.98}>
      <SearchIcon size={17} color={C.sub} />
      <Text style={styles.searchTxt}>{"Search for '"}</Text>
      <RollingText text={hint} style={[styles.searchTxt, { marginLeft: 0 }]} />
      <Text style={[styles.searchTxt, { marginLeft: 0 }]}>{"'"}</Text>
    </PressScale>
  );
}

function CategoryRail({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const idx = CATEGORIES.findIndex((c) => c.id === value);
  const x = useSharedValue(idx * CAT_W);
  useEffect(() => {
    x.value = withSpring(idx * CAT_W, { damping: 17, stiffness: 190 });
  }, [idx]);
  const ind = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 10 }}>
      <Animated.View style={[styles.catIndicator, ind]} />
      {CATEGORIES.map((c, i) => (
        <CategoryItem key={c.id} c={c} active={c.id === value} i={i} onPress={() => onChange(c.id)} />
      ))}
    </ScrollView>
  );
}

function CategoryItem({ c, active, i, onPress }: { c: (typeof CATEGORIES)[number]; active: boolean; i: number; onPress: () => void }) {
  const b = useSharedValue(0);
  useEffect(() => {
    if (active) b.value = withSequence(withTiming(-6, { duration: 140 }), withSpring(0, { damping: 6, stiffness: 300 }));
  }, [active]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: b.value }, { scale: 1 + -b.value * 0.02 }] }));
  return (
    <Animated.View entering={FadeInDown.delay(i * 45).duration(350)}>
      <PressScale onPress={onPress} style={styles.cat} haptic>
        <Animated.Text style={[{ fontSize: 34 }, a]}>{c.emoji}</Animated.Text>
        {c.from > 0 && (
          <View style={styles.fromTag}>
            <Text style={styles.fromTxt}>FROM ₹{c.from}</Text>
          </View>
        )}
        <Text style={[styles.catName, active && { fontFamily: F.bold, color: C.ink }]}>{c.name}</Text>
      </PressScale>
    </Animated.View>
  );
}

function FilterChips() {
  const [on, setOn] = useState<string[]>([]);
  const chips = ['40-60% Lower Prices', 'Organic', 'Under 15 mins', 'Rating 4.0+'];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 6, alignItems: 'center' }}>
      <View style={styles.chip}><FilterIcon size={15} /></View>
      {chips.map((c, i) => {
        const active = on.includes(c);
        return (
          <PressScale
            key={c}
            onPress={() => setOn((s) => (active ? s.filter((x) => x !== c) : [...s, c]))}
            style={[styles.chip, active && { borderColor: C.pink, backgroundColor: C.pinkTint }]}
          >
            {i === 0 && <Hearts size={11} />}
            <Text style={[styles.chipTxt, active && { color: C.pink }]}>{c}</Text>
            {i === 1 && <ChevronIcon size={12} color={C.sub} />}
          </PressScale>
        );
      })}
    </ScrollView>
  );
}

function StoreCard({ store }: { store: Store }) {
  return (
    <PressScale scaleTo={0.985} onPress={() => router.push({ pathname: '/opening', params: { id: store.id } })} style={styles.store}>
      <StampBadge style={{ position: 'absolute', right: 6, top: 4 }} />
      <Text style={styles.lower}>{store.lowerBy}% LOWER PRICES</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {store.ad && <Text style={styles.ad}>Ad</Text>}
        <Text style={styles.storeName} numberOfLines={1}>{store.name}</Text>
      </View>
      <Text style={styles.meta}>
        <Text style={{ color: C.green }}>✪ </Text>
        {store.rating} • {store.eta} • {store.tags}
      </Text>
      <Text style={[styles.meta, { marginBottom: 10 }]}>
        <Text style={{ color: C.green }}>✿ </Text>Free Delivery • Items At ₹{store.itemsAt}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {store.products.slice(0, 6).map((id, i) => (
          <ProductCard key={id} id={id} storeId={store.id} width={112} index={i} showRating={false} />
        ))}
      </ScrollView>
    </PressScale>
  );
}

/** Green "mandi price match" band with a waving mascot. */
function PromoBand() {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withRepeat(withSequence(withTiming(1, { duration: 220 }), withTiming(-1, { duration: 220 }), withTiming(1, { duration: 220 }), withTiming(0, { duration: 220 }), withTiming(0, { duration: 1400 })), -1);
  }, []);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${w.value * 14}deg` }] }));
  return (
    <LinearGradient colors={[C.green, '#13B83A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.promo}>
      <View style={{ gap: 6 }}>
        <Text style={styles.promoTxt}>☑  Mandi Price Match</Text>
        <Text style={styles.promoTxt}>☑  ₹0 Platform Fee    ☑  ₹0 Packaging Fee</Text>
      </View>
      <Animated.Text style={[{ fontSize: 46, position: 'absolute', right: 10, bottom: -4 }, a]}>🧑‍🌾</Animated.Text>
    </LinearGradient>
  );
}

/** Pink "TOKRI vs OTHER APPS" featured rail. */
function VersusRail() {
  return (
    <LinearGradient colors={['#FFFFFF', C.pinkSoft, '#FFFFFF']} style={{ paddingVertical: 18, marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16 }}>
        <Hearts size={11} />
        <Text style={styles.vsSmall}>TOKRI vs OTHER APPS</Text>
      </View>
      <Text style={styles.vsBig}>40-60% LOWER PRICES</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12, marginTop: 10 }}>
        {STORES.slice(0, 5).map((s, i) => (
          <Animated.View key={s.id} entering={FadeInDown.delay(200 + i * 80)}>
            <PressScale onPress={() => router.push({ pathname: '/opening', params: { id: s.id } })}>
              <LinearGradient colors={s.heroBg} style={styles.vsCard}>
                <Text style={{ fontSize: 58 }}>{s.hero}</Text>
                <View style={styles.vsTag}>
                  <Text style={styles.vsTagSmall}>ITEMS</Text>
                  <Text style={styles.vsTagBig}>AT ₹{s.itemsAt}</Text>
                </View>
              </LinearGradient>
              <Text style={styles.vsName} numberOfLines={1}>{s.name}</Text>
              <Text style={styles.meta}><Text style={{ color: C.green }}>✪ </Text>{s.rating} • {s.eta}</Text>
            </PressScale>
          </Animated.View>
        ))}
      </ScrollView>
    </LinearGradient>
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
  locAddr: { fontFamily: F.regular, color: '#D9CCEB', fontSize: 11.5, marginTop: 1 },
  search: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12,
    borderRadius: 24, paddingHorizontal: 14, height: 44, gap: 0,
  },
  searchTxt: { fontFamily: F.regular, color: C.sub, fontSize: 14, marginLeft: 2 },
  sticky: { backgroundColor: '#fff', shadowColor: '#000', shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  catIndicator: { position: 'absolute', left: 10, top: 10, width: CAT_W - 6, height: 92, borderRadius: 16, backgroundColor: C.pinkSoft },
  cat: { width: CAT_W, alignItems: 'center', paddingTop: 8, height: 92 },
  fromTag: { backgroundColor: C.pink, borderRadius: 4, paddingHorizontal: 4, marginTop: -6 },
  fromTxt: { color: '#fff', fontSize: 7.5, fontFamily: F.black },
  catName: { fontFamily: F.medium, fontSize: 11.5, color: C.sub, marginTop: 5 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 10, marginBottom: 12 },
  h2: { fontFamily: F.semi, fontSize: 17, color: C.ink },
  seeAll: { fontFamily: F.medium, fontSize: 12, color: C.sub },
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
  ad: { fontFamily: F.medium, fontSize: 9, color: C.sub, backgroundColor: C.bg, paddingHorizontal: 4, borderRadius: 3 },
  storeName: { fontFamily: F.bold, fontSize: 18, color: C.ink, flexShrink: 1, marginRight: 60 },
  meta: { fontFamily: F.regular, fontSize: 11.5, color: C.sub, marginTop: 3 },
  promo: { marginHorizontal: 0, marginBottom: 14, paddingHorizontal: 18, paddingVertical: 16, overflow: 'hidden' },
  promoTxt: { color: '#fff', fontFamily: F.bold, fontSize: 13 },
  vsSmall: { fontFamily: F.bold, fontSize: 11, color: C.pink, letterSpacing: 0.5 },
  vsBig: { fontFamily: F.black, fontSize: 21, color: C.pink, marginHorizontal: 16, marginTop: 2 },
  vsCard: { width: 136, height: 136, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  vsTag: { position: 'absolute', left: 8, bottom: 8 },
  vsTagSmall: { color: '#fff', fontFamily: F.bold, fontSize: 10, textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 3 },
  vsTagBig: { color: '#fff', fontFamily: F.black, fontSize: 17, textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 3 },
  vsName: { fontFamily: F.semi, fontSize: 12.5, color: C.ink, marginTop: 6, width: 136 },
  pillWrap: { position: 'absolute', alignSelf: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.ink, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22 },
  pillTxt: { color: '#fff', fontFamily: F.semi, fontSize: 13 },
  feeStrip: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.green, flexDirection: 'row',
    justifyContent: 'space-around', paddingTop: 12, borderTopLeftRadius: 18, borderTopRightRadius: 18,
  },
  coin: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.yellow, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#E6B800' },
  coinTxt: { fontFamily: F.black, fontSize: 9, color: C.greenDark },
  feeTxt: { color: '#fff', fontFamily: F.medium, fontSize: 12 },
  locSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
  locDark: { backgroundColor: '#000', flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  locTitle: { color: '#fff', fontFamily: F.bold, fontSize: 14 },
  locSub: { color: '#ddd', fontFamily: F.regular, fontSize: 11.5, marginTop: 3 },
  grant: { backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  grantTxt: { fontFamily: F.black, fontSize: 11, color: C.ink },
  locManual: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  locManualTxt: { fontFamily: F.regular, fontSize: 13.5, color: C.sub },
});

