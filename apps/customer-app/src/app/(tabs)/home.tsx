import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, FadeIn, interpolate, interpolateColor, SlideOutDown,
  useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withDelay, withRepeat,
  withSequence, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomInset } from '@/lib/tabs';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { useHomeLocation } from '@/blynk/address/homeLocation';
import type { Product } from '@/blynk/api/types';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { FILTERS as LIVE_FILTERS, toggle, type FilterId } from '@/blynk/lib/filters';
import { formatLkr } from '@/blynk/lib/money';
import { effectivePrice } from '@/blynk/lib/pricing';
import { aisleArt, aislePhase } from '@/blynk/lib/aisleArt';
import { useFreeClaim } from '@/blynk/store/useFreeClaim';
import { AisleStamp } from '@/components/AisleStamp';
import { runAisleBeat } from '@/lib/clock';
import { useStore } from '@/blynk/store/StoreContext';
import { Banner, BANNER_TOP } from '@/components/Banner';
import { CART_BAR, CartBar } from '@/components/CartBar';
import { ClosedBanner } from '@/components/ClosedBanner';
import {
  BagBadge, ChevronIcon, HeartsIcon, LocateIcon, MenuIcon, NavIcon, OfferBadge, SearchIcon, SlidersIcon, StarBadge,
} from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { PromoBand } from '@/components/PromoBand';
import { DoctorsHomeEntry } from '@/blynk/doctors/DoctorsHomeEntry';
import { HomeCategoryGroups } from '@/blynk/catalog/HomeCategoryGroups';
import { PromoCarousel } from '@/components/PromoCarousel';
import { UsualsRow } from '@/blynk/rewards/UsualsRow';
import { OfflineBanner } from '@/components/OfflineBanner';
import { ComboRail } from '@/blynk/combos/ComboViews';
import { BirthdayOfferBanner } from '@/blynk/rewards/BirthdayOfferBanner';
import { splashHandover } from '@/lib/splash';
import { PressScale, RollingText, Skeleton, StampBadge } from '@/components/ui';
import {
  BANNER, CATEGORIES, CATEGORIES_PRE, FEES, FILTERS, LOCATION, LOCATION_SHEET, MEALS, MEALS_PRE, PROMO_AFTER,
  SEARCH_HINTS, STORES, STORES_BY_CATEGORY, VS, type DemoFilter, type DemoStore,
} from '@/demo/home';
import {
  liveAisles, liveBanner, liveFees, liveHints, livePromo, liveRail,
  liveUnder, liveVs, UNDER_LKR, type LiveAisleCard, type LiveVs,
} from '@/demo/homeLive';
import { extraOf } from '@/demo/extras';
import { DEMO } from '@/demo/mode';
import { rupees } from '@/demo/money';
import { withSpring } from '@/lib/motion';
import { useCartSelect } from '@/lib/cart';
import { openAisle } from '@/lib/nav';
import { C, F } from '@/lib/theme';

/*
 * Home, matched frame by frame to the reference recording (0:04–0:31). All content is the
 * video's own (src/demo/home.ts); colours follow Blynk's mapping (purple → ink, pink → Blynk yellow).
 *
 *   0:04.5  the intro's white cover lifts off (SplashHandoverHost) while the page rises into place, header WHITE, "Locating …"
 *   0:05.1  location name rolls in     0:05.5  skeleton → content     0:05.7  ink header + banner unfold
 *   pre-grant: 60 % black scrim + black "Location Permission is Off" bar
 *   GRANT   bar slides away, page reloads the same way, then the yellow fee strip rises
 *   scroll  categories (+ filter chips) stick; fee strip hides; black "Search" pill springs up
 *
 * Live (DEMO = false): the same layout and motion over Blynk's catalogue and GET /store
 * (src/demo/homeLive.ts), so Admin and Ops stay in control. Restaurants become aisles,
 * "Meals under ₹99" becomes "Under LKR 300", and every slot without true data (ratings,
 * ETAs, "% lower", "Other apps", "Ad", the "lowest price" stamp) is hidden.
 */

const money = (n: number) => (DEMO ? rupees(n) : formatLkr(n));

/** A category-rail tile: the video's emoji (demo) or the aisle's photo (live). */
type RailCat = { id: string; name: string; from: number | null; emoji?: string; image?: string | null };
type Chip = { id: string; label: string; hearts?: boolean; caret?: boolean };
const LIVE_CHIPS: Chip[] = LIVE_FILTERS.map((f) => ({ ...f, hearts: f.id === 'offer' }));

const CAT_W = 90; // one category slot (the reference's tiles sit 90 pt apart)
const TILE_W = 81;
const TILE_H = 86;
const MEAL_W = 155; // "Meals under ₹99" photo
const DISH_W = 134; // dish photo inside a store card
const DISH_H = 100;
const BANNER_H = 183;

type Phase = 'locating' | 'skeleton' | 'content' | 'banner';

export default function Home() {
  const insets = useSafeAreaInsets();
  // inside the tabs the tab bar keeps clear of the home indicator
  const bottomInset = useBottomInset();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [timedPhase, setPhase] = useState<Phase>('locating');
  // live: where to deliver (header row, first-launch sheet); a spot chosen earlier keeps the sheet closed
  const here = useHomeLocation(useStore());
  const [granted, setGranted] = useState(!DEMO && here.chosen);
  const [cat, setCat] = useState('all');
  const [filters, setFilters] = useState<string[]>([]);
  const [past, setPast] = useState(false);
  const [chipsOn, setChipsOn] = useState(false);
  const count = useCartSelect((c) => c.count);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // opened by the intro: the page rises into place while the intro's cover lifts away above it
  const [fromSplash] = useState(splashHandover.homeRisePending);
  const { data, error, refresh } = useCatalog();
  const store = useStore();
  // live: hold the skeleton until the catalogue is in (demo content is always there)
  const ready = DEMO || !!data;
  const phase: Phase = !ready && (timedPhase === 'content' || timedPhase === 'banner') ? 'skeleton' : timedPhase;

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const y = useSharedValue(0);
  const headerH = useSharedValue(400);
  // live: the Mains are sections in the feed (HomeCategoryGroups), so there is no sticky rail
  const catH = useSharedValue(DEMO ? TILE_H + 16 : 0);
  const chipsY = useSharedValue(99999);
  const exploreY = useSharedValue(0);
  const feedY = useSharedValue(0);
  const stuckChips = useSharedValue(0);
  const stuckCats = useSharedValue(0);
  const strip = useSharedValue(0);
  const pill = useSharedValue(0);
  const allowStrip = useSharedValue(0);
  const ink = useSharedValue(0); // header white → ink
  const bannerOpen = useSharedValue(0);
  const scrim = useSharedValue(granted ? 0 : 1);
  const rise = useSharedValue(fromSplash ? 1 : 0);

  const loading = phase === 'locating' || phase === 'skeleton';
  const dark = phase === 'banner';

  /** "Locating …" → name → skeleton → content → ink header with the banner, as at 0:04.5–0:05.9. */
  const load = (t: { name: number; content: number; banner: number }) => {
    timers.current.forEach(clearTimeout);
    timers.current = [
      setTimeout(() => setPhase('skeleton'), t.name),
      setTimeout(() => setPhase('content'), t.content),
      setTimeout(() => setPhase('banner'), t.banner),
    ];
  };

  useEffect(() => {
    // the intro's cover (SplashHandoverHost, over the whole window) lifts away now
    splashHandover.release();
    if (fromSplash) {
      splashHandover.clearHomeRise();
      rise.set(withTiming(0, { duration: 340, easing: Easing.out(Easing.cubic) }));
    }
    load({ name: 550, content: 950, banner: 1170 });
    return () => timers.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (dark) {
      ink.set(1); // the reference's header turns ink at once while the banner unfolds below it
      bannerOpen.set(withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }));
    } else {
      ink.set(0);
      bannerOpen.set(0);
    }
    if (dark && granted && !allowStrip.get()) {
      allowStrip.set(1);
      strip.set(withDelay(180, withSpring(1, { damping: 18, stiffness: 150 })));
    }
  }, [dark, granted]);

  // the cart bar takes the bottom edge: the fee strip steps aside while there is one
  const cartOn = useSharedValue(count > 0 ? 1 : 0);
  useEffect(() => {
    cartOn.set(withTiming(count > 0 ? 1 : 0, { duration: 220 }));
  }, [count > 0]);

  const onScroll = useAnimatedScrollHandler((e) => {
    y.value = e.contentOffset.y;
  });

  // Where the feed starts. Not from onLayout: on web that only fires on size changes, and the
  // feed moves (without resizing) when the banner unfolds above it.
  useAnimatedReaction(() => headerH.value + catH.value, (v) => { feedY.value = v; });

  useAnimatedReaction(
    () => ({
      chips: y.value + catH.value >= feedY.value + chipsY.value,
      stuck: y.value >= headerH.value - 1,
      past: y.value > headerH.value - 10,
      far: y.value > 2000,
      down: y.value > 40,
    }),
    (s, prev) => {
      // the inline chip row reaches the categories' bottom edge and stays there: the overlay
      // copy sits exactly where the inline row is, so the hand-over is seamless
      if (s.chips !== prev?.chips) {
        stuckChips.value = s.chips ? 1 : 0;
        scheduleOnRN(setChipsOn, s.chips);
      }
      if (s.stuck !== prev?.stuck) stuckCats.value = withTiming(s.stuck ? 1 : 0, { duration: 160 });
      if (s.past !== prev?.past) scheduleOnRN(setPast, s.past);
      if (s.far !== prev?.far) pill.value = withSpring(s.far ? 1 : 0, { damping: 14, stiffness: 170 });
      if (s.down !== prev?.down && allowStrip.get()) strip.set(withTiming(s.down ? 0 : 1, { duration: 260 }));
    },
  );

  const statusA = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      y.value, [headerH.value - 80, headerH.value - 10],
      [interpolateColor(ink.value, [0, 1], ['#FFFFFF', BANNER_TOP]), '#FFFFFF'],
    ),
  }));
  const headerA = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(ink.value, [0, 1], ['#FFFFFF', BANNER_TOP]) }));
  const bannerA = useAnimatedStyle(() => ({ height: bannerOpen.value * BANNER_H, opacity: interpolate(bannerOpen.value, [0, 0.35, 1], [0, 0.7, 1]) }));
  const chipsA = useAnimatedStyle(() => ({ top: catH.value, opacity: stuckChips.value, shadowOpacity: stuckChips.value * 0.09 }));
  const stickyShadow = useAnimatedStyle(() => {
    const v = stuckCats.value * (1 - stuckChips.value);
    return { elevation: v * 4, shadowOpacity: v * 0.09 };
  });
  const stripA = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - strip.value * (1 - cartOn.value)) * 130 }] }));
  const pillA = useAnimatedStyle(() => ({ opacity: pill.value, transform: [{ translateY: (1 - pill.value) * 80 }, { scale: 0.8 + pill.value * 0.2 }] }));
  const scrimA = useAnimatedStyle(() => ({ opacity: scrim.value * 0.6 }));
  const riseA = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value * screenH * 0.32 }] }));

  // what this customer may be told about free deliveries (guest: new customers; signed in: their own left)
  const claim = useFreeClaim();
  // the aisle cards' corner animation runs only while Home is the screen in front
  useFocusEffect(useCallback(() => {
    runAisleBeat(true);
    return () => runAisleBeat(false);
  }, []));
  const live = useMemo(() => {
    if (DEMO) return null;
    const on = filters as FilterId[];
    return {
      rail: liveRail(data) as RailCat[],
      under: liveUnder(data, cat, on),
      aisles: liveAisles(data, store, cat, on, undefined, claim),
      vs: liveVs(data, store, undefined, claim),
      promo: livePromo(store, claim),
      fees: liveFees(store, claim),
      banner: liveBanner(data, store, undefined, claim),
      hints: liveHints(data),
    };
  }, [data, store, cat, filters, claim]);

  const cats: RailCat[] = live ? live.rail : granted ? CATEGORIES : CATEGORIES_PRE;
  const meals = live ? live.under : granted ? MEALS : MEALS_PRE;
  const stores = useMemo(() => (DEMO ? filterStores(cat, filters as DemoFilter[]) : []), [cat, filters]);
  const fees = live ? live.fees : FEES;
  const sheet = DEMO ? LOCATION_SHEET : here.sheet;
  const feedError = !DEMO && !data && !!error && timedPhase !== 'locating';

  /** The sheet goes and the page reloads its header, as after GRANT in the reference. */
  const reveal = () => {
    scrim.set(withTiming(0, { duration: 320 }));
    setGranted(true);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setPhase('locating');
    load({ name: 500, content: 1000, banner: 1300 });
  };

  // Design mock: GRANT only asks the browser (the position is not used) and reveals the page.
  // Live: GRANT and "Enter Location Manually" open the map; the sheet closes once a spot is chosen.
  const grant = () => {
    if (!DEMO) { here.grant(); return; }
    try {
      const geo = (globalThis as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
      geo?.getCurrentPosition(() => {}, () => {}, { timeout: 8000 });
    } catch { /* no geolocation here */ }
    reveal();
  };
  useEffect(() => {
    // a spot was chosen (on the map, or a saved address loaded): the sheet goes, as after GRANT
    if (DEMO || !here.chosen || granted) return;
    const t = setTimeout(reveal, 0);
    return () => clearTimeout(t);
  }, [here.chosen]);

  const toExplore = () => {
    scrollRef.current?.scrollTo({ y: Math.max(0, feedY.get() + exploreY.get() - catH.get() - 52), animated: true });
  };
  const toggleFilter = (f: string) => setFilters((s) => toggle(s, f));
  const chips: readonly Chip[] = DEMO ? FILTERS : LIVE_CHIPS;

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style={dark && !past ? 'light' : 'dark'} />
      <Animated.View style={[{ height: insets.top, zIndex: 10 }, statusA]} />

      <Animated.View style={[{ flex: 1 }, riseA]}>
        <Animated.ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          stickyHeaderIndices={[1]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!loading}
          contentContainerStyle={{ paddingBottom: 160 }}
        >
          {/* 0 — header: white while locating, ink once the banner unfolds */}
          <Animated.View onLayout={(e) => headerH.set(e.nativeEvent.layout.height)} style={headerA}>
            <LocationRow
              locating={phase === 'locating'}
              dark={dark}
              name={DEMO ? LOCATION.name : here.name}
              address={DEMO ? LOCATION.address : here.address}
              onPress={DEMO ? undefined : here.openRow}
            />
            <SearchBar phase={phase} hints={live ? (live.hints.length ? live.hints : ['groceries']) : SEARCH_HINTS} />
            {/* live: /store says the store is closed (hidden in the design mock, which loads no store) */}
            <ClosedBanner style={styles.closed} />
            <Animated.View style={[{ overflow: 'hidden' }, bannerA]}>
              {dark && (live
                ? <Banner images={live.banner.images} minPrice={live.banner.minPrice} freeCount={live.banner.freeCount} freeKind={live.banner.freeKind} onOrderNow={toExplore} hero={store?.hero_banner} />
                : <Banner images={[]} minPrice={null} freeCount={0} onOrderNow={toExplore} demo={BANNER} />)}
            </Animated.View>
          </Animated.View>

          {/* 1 — sticky: categories (+ filter chips once the inline row scrolls under) */}
          {/* plain View: RN's sticky-header wrapper copies & freezes this child's style, so no animated styles here */}
          <View>
            {!loading && DEMO && (
              <Animated.View style={[styles.sticky, stickyShadow]}>
                <View onLayout={(e) => catH.set(e.nativeEvent.layout.height)}>
                  <CategoryRail key={granted ? 'post' : 'pre'} items={cats} value={cat} onChange={setCat} stuck={stuckCats} />
                </View>
              </Animated.View>
            )}
          </View>

          {/* 2 — feed */}
          <View>
            {feedError ? (
              <ErrorBox message={error.message} onRetry={() => void refresh()} />
            ) : loading ? (
              <FeedSkeleton />
            ) : (
              <Animated.View key={granted ? 'post' : 'pre'} entering={FadeIn.duration(260)}>
                {/* live, in the Flutter home's order: connection notice, birthday gift, promotions, your usuals,
                    Channel doctors, then every Main as a section of category tiles with "All categories" */}
                {!DEMO && <OfflineBanner onRetry={() => void refresh()} style={{ marginHorizontal: 15, marginTop: 12 }} />}
                {!DEMO && <BirthdayOfferBanner style={{ marginHorizontal: 15, marginTop: 12 }} />}
                {!DEMO && !!data && <PromoCarousel promotions={data.promotions} style={{ marginTop: 14 }} />}
                {!DEMO && <UsualsRow />}
                {!DEMO && <DoctorsHomeEntry style={{ marginHorizontal: 15, marginTop: 18 }} />}
                {!DEMO && !!data && <HomeCategoryGroups tree={data.tree} width={screenW} />}
                {meals.length > 0 && (
                  <>
                    <View style={styles.sectionHead}>
                      <Text style={styles.h2}>{DEMO ? 'Meals under ₹99' : `Under ${formatLkr(UNDER_LKR)}`}</Text>
                      <Pressable onPress={toExplore} hitSlop={8} style={styles.seeAll}>
                        <Text style={styles.seeAllTxt}>See All</Text>
                        <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={15} color="#4A4A50" stroke={2.2} /></View>
                      </Pressable>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15, gap: 15 }}>
                      {meals.map((p, i) => (
                        <ProductCard key={p.id} product={p} index={i} width={MEAL_W} sub={DEMO ? undefined : p.category_name} />
                      ))}
                    </ScrollView>
                  </>
                )}

                {/* live: Combo packs (Flutter home combo rail; GET /combos, nothing until one is live) */}
                {!DEMO && <ComboRail style={{ marginTop: 20 }} />}

                {granted && (DEMO || !!live?.vs) && <VsSection live={live?.vs ?? null} />}

                <View onLayout={(e) => chipsY.set(e.nativeEvent.layout.y)} style={{ marginTop: granted && (DEMO || !!live?.vs) ? 2 : 16 }}>
                  <FilterChips items={chips} on={filters} onToggle={toggleFilter} />
                </View>
                <Text onLayout={(e) => exploreY.set(e.nativeEvent.layout.y)} style={styles.explore}>
                  {DEMO ? 'Explore all restaurants' : 'Explore all aisles'}
                </Text>

                {DEMO ? (
                  <>
                    {stores.length === 0 && <Text style={styles.empty}>No restaurants match these filters.</Text>}
                    {stores.map((s, i) => (
                      <StoreCard key={s.id} store={s} y={y} feedY={feedY} screenH={screenH} promo={granted && i === PROMO_AFTER - 1} />
                    ))}
                  </>
                ) : (
                  <>
                    {live && live.aisles.length === 0 && (
                      <Text style={styles.empty}>{filters.length ? 'Nothing matches these filters right now.' : "We're stocking the shelves. Check back shortly."}</Text>
                    )}
                    {/* The promo band follows the 3rd aisle, or the last one when the store has fewer
                        (owner, 2026-10-13: the live store has two categories and the band never showed). */}
                    {live?.aisles.map((a, i) => (
                      <AisleCard
                        key={a.cat.id}
                        aisle={a}
                        index={i}
                        promo={i === Math.min(PROMO_AFTER, live.aisles.length) - 1 ? live.promo : null}
                      />
                    ))}
                  </>
                )}
              </Animated.View>
            )}
          </View>
        </Animated.ScrollView>

        {/* filter chips pinned under the stuck categories (an overlay, so nothing below shifts) */}
        <Animated.View pointerEvents={chipsOn ? 'auto' : 'none'} style={[styles.chipsPinned, chipsA]}>
          <FilterChips items={chips} on={filters} onToggle={toggleFilter} />
        </Animated.View>
      </Animated.View>

      {/* the location bar's scrim dims everything above it, status bar included */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, scrimA]} />

      {/* floating "Search" pill */}
      <Animated.View pointerEvents="box-none" style={[styles.pillWrap, { bottom: bottomInset + 17 + (count > 0 ? CART_BAR.h + CART_BAR.bottom : 0) }, pillA]}>
        <PressScale onPress={() => router.push('/search')} style={styles.pill} haptic>
          <SearchIcon size={14} color="#fff" stroke={2.4} />
          <Text style={styles.pillTxt}>Search</Text>
        </PressScale>
      </Animated.View>

      {/* fee strip (after location is granted) */}
      <Animated.View style={[styles.feeStripWrap, stripA]} pointerEvents="none">
        <LinearGradient colors={[C.brand, C.brandDeep]} style={[styles.feeStrip, { paddingBottom: bottomInset + 27 }]}>
          {fees.map(([c, l]) => (
            <View key={l} style={styles.fee}>
              <View style={styles.coin}><Text style={styles.coinTxt}>{c}</Text></View>
              <Text style={styles.feeTxt} numberOfLines={1}>{l}</Text>
            </View>
          ))}
        </LinearGradient>
      </Animated.View>

      <CartBar />

      {/* location permission bar */}
      {!granted && (
        <Animated.View exiting={SlideOutDown.duration(300)} style={[styles.locSheet, { paddingBottom: bottomInset }]}>
          <View style={styles.locDark}>
            <View style={{ flex: 1 }}>
              <View style={styles.locTitleRow}>
                <LocateIcon size={15} color="#fff" />
                <Text style={styles.locTitle}>{sheet.title}</Text>
              </View>
              <Text style={styles.locSub}>{sheet.sub}</Text>
            </View>
            <PressScale onPress={grant} style={styles.grant} haptic>
              <Text style={styles.grantTxt}>{!DEMO && here.asking ? here.sheet.asking : sheet.cta}</Text>
            </PressScale>
          </View>
          <Pressable onPress={DEMO ? () => router.push('/address') : here.manual} style={styles.locManual}>
            <SearchIcon size={17} color={C.brandInk} />
            <Text style={styles.locManualTxt}>{sheet.manual}</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */

function filterStores(cat: string, filters: DemoFilter[]): DemoStore[] {
  const keep = cat === 'all' ? null : STORES_BY_CATEGORY[cat] ?? [];
  return STORES
    .filter((s) => !keep || keep.includes(s.id))
    .filter((s) => !filters.includes('lower') || (s.lowerPct ?? 0) >= 20 || s.ad)
    .filter((s) => !filters.includes('fast') || Number(s.eta.split('-')[1]?.split(' ')[0] ?? 99) <= 30)
    .map((s) => ({
      ...s,
      dishes: s.dishes
        .filter((p) => !filters.includes('veg') || extraOf(p.id)?.veg !== false)
        .filter((p) => !filters.includes('u99') || effectivePrice(p) <= 99),
    }))
    .filter((s) => s.dishes.length > 0);
}

function LocationRow({ locating, dark, name, address, onPress }: {
  locating: boolean; dark: boolean; name: string; address: string | null; onPress?: () => void;
}) {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = locating ? withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1) : withSpring(0);
  }, [locating]);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const fg = dark ? '#fff' : '#1B1B1F';
  return (
    <View style={styles.locRow}>
      <Pressable onPress={onPress} disabled={!onPress || locating} accessibilityRole={onPress ? 'button' : undefined} style={styles.locTap}>
      <Animated.View style={[styles.navDot, a]}>
        <NavIcon size={15} color={C.ink} />
      </Animated.View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <RollingText text={locating ? 'Locating ...' : name} style={[styles.locName, { color: fg }]} />
          <ChevronIcon size={13} color={dark ? '#D9D6E8' : '#55555C'} stroke={2.2} />
        </View>
        {!locating && !!address && (
          <Animated.Text entering={FadeIn.duration(250)} numberOfLines={1} style={[styles.locAddr, { color: dark ? '#CFCBE0' : '#55555C' }]}>
            {address}
          </Animated.Text>
        )}
      </View>
      </Pressable>
      {/* the profile: orders, addresses, SMS settings, help, log out (src/app/account.tsx) */}
      <PressScale onPress={() => router.push('/account')} style={{ padding: 6, marginRight: -6 }}>
        <MenuIcon size={22} color={fg} stroke={2.3} />
      </PressScale>
    </View>
  );
}

/** "Search for 'Burger'": every 2 s the quoted name slides up and the next one slides in from below. */
function SearchBar({ phase, hints }: { phase: Phase; hints: string[] }) {
  const grey = phase === 'locating' || phase === 'skeleton';
  return (
    <PressScale
      onPress={() => router.push('/search')}
      style={[styles.search, grey ? styles.searchGrey : phase === 'content' ? styles.searchLine : null]}
      scaleTo={0.98}
    >
      <SearchIcon size={18} color="#55555C" stroke={2} />
      <View style={{ flexDirection: 'row', flexShrink: 1, alignItems: 'center' }}>
        <Text style={[styles.searchTxt, { lineHeight: HINT_LH }]}>{'Search for '}</Text>
        <SlideUpHints hints={hints} />
      </View>
    </PressScale>
  );
}

const HINT_LH = 20;
/**
 * A column of the hints (first one repeated at the end) moves up one line at a time. On reaching
 * the repeated first line it snaps back to the top; both lines read the same, so the loop is seamless.
 */
function SlideUpHints({ hints }: { hints: string[] }) {
  const y = useSharedValue(0);
  const step = useSharedValue(0);
  const list = hints.length ? [...hints, hints[0]] : [''];
  const n = hints.length;
  useEffect(() => {
    if (n < 2) return;
    step.value = 0;
    y.value = 0;
    const t = setInterval(() => {
      const next = step.value + 1;
      step.value = next;
      y.value = withTiming(-next * HINT_LH, { duration: 420, easing: Easing.out(Easing.cubic) }, (done) => {
        if (done && next >= n) {
          step.value = 0;
          y.value = 0; // seamless: the repeated first line sits where the real first line is
        }
      });
    }, 2000);
    return () => clearInterval(t);
  }, [n, hints.join('|')]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <View style={{ height: HINT_LH, overflow: 'hidden', flexShrink: 1 }}>
      <Animated.View style={a}>
        {list.map((h, k) => (
          <Text key={k} numberOfLines={1} style={[styles.searchTxt, { lineHeight: HINT_LH, height: HINT_LH }]}>{`'${h}'`}</Text>
        ))}
      </Animated.View>
    </View>
  );
}

/** Stuck to the top, the rail tightens: tiles 86 → 78 pt, top padding 11 → 8 (0:16.5). */
const SQUEEZE = TILE_H - 78;
function CategoryRail({ items, value, onChange, stuck }: {
  items: RailCat[]; value: string; onChange: (id: string) => void; stuck: SharedValue<number>;
}) {
  const idx = Math.max(0, items.findIndex((c) => c.id === value));
  const x = useSharedValue(idx * CAT_W);
  useEffect(() => {
    x.value = withSpring(idx * CAT_W, { damping: 17, stiffness: 190 });
  }, [idx]);
  const ind = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], height: TILE_H - SQUEEZE * stuck.value, top: 11 - 3 * stuck.value }));
  const pad = useAnimatedStyle(() => ({ paddingTop: 11 - 3 * stuck.value }));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 8 }}>
      <Animated.View style={[{ flexDirection: 'row' }, pad]}>
        <Animated.View style={[styles.catIndicator, ind]} />
        {items.map((c) => (
          <CategoryItem key={c.id} c={c} active={c.id === value} onPress={() => onChange(c.id)} stuck={stuck} />
        ))}
      </Animated.View>
    </ScrollView>
  );
}

function CategoryItem({ c, active, onPress, stuck }: { c: RailCat; active: boolean; onPress: () => void; stuck: SharedValue<number> }) {
  const b = useSharedValue(0);
  useEffect(() => {
    if (active) b.value = withSequence(withTiming(-6, { duration: 140 }), withSpring(0, { damping: 6, stiffness: 300 }));
  }, [active]);
  const a = useAnimatedStyle(() => ({
    height: 50 - SQUEEZE * stuck.value,
    transform: [{ translateY: b.value }, { scale: (1 + -b.value * 0.02) * (1 - 0.1 * stuck.value) }],
  }));
  const h = useAnimatedStyle(() => ({ height: TILE_H - 7 - SQUEEZE * stuck.value }));
  return (
    <PressScale onPress={onPress} style={styles.cat} haptic>
      <Animated.View style={[{ alignItems: 'center' }, h]}>
      <Animated.View style={[styles.catImg, a]}>
        {c.emoji ? (
          <Text style={{ fontSize: 40, lineHeight: 48 }}>{c.emoji}</Text>
        ) : (
          <Photo uri={c.image ?? null} name={c.name} size={46} />
        )}
      </Animated.View>
      {c.from != null ? (
        <View style={styles.fromTag}><Text style={styles.fromTxt}>FROM {money(c.from)}</Text></View>
      ) : (
        <View style={{ height: 6 }} />
      )}
      <Text numberOfLines={1} style={[styles.catName, active && styles.catNameOn]}>{c.name}</Text>
      </Animated.View>
    </PressScale>
  );
}

function FilterChips({ items, on, onToggle }: { items: readonly Chip[]; on: string[]; onToggle: (f: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15, gap: 8, paddingVertical: 6, alignItems: 'center' }}>
      <View style={[styles.chip, { width: 38, paddingHorizontal: 0, justifyContent: 'center' }]}><SlidersIcon size={17} color="#3A3A40" /></View>
      {items.map((f) => {
        const active = on.includes(f.id);
        return (
          <PressScale key={f.id} onPress={() => onToggle(f.id)} style={[styles.chip, active && styles.chipOn]}>
            {f.hearts && (
              <View style={styles.chipHearts}><HeartsIcon size={15} color={C.brandInk} filled /></View>
            )}
            <Text style={[styles.chipTxt, active && { color: C.brandInk, fontFamily: F.semi }]}>{f.label}</Text>
            {f.caret && <ChevronIcon size={14} color="#3A3A40" stroke={2.2} />}
          </PressScale>
        );
      })}
    </ScrollView>
  );
}

/** Wavy top edge of the "vs" section (the reference draws a soft scalloped line). */
function Wave({ color, flip }: { color: string; flip?: boolean }) {
  const w = 390;
  let d = `M0 10`;
  for (let x = 0; x < w; x += 26) d += ` Q${x + 6.5} 4 ${x + 13} 7 T${x + 26} 8`;
  d += ` L${w} 14 L0 14 Z`;
  return (
    <Svg width="100%" height={14} viewBox={`0 0 ${w} 14`} preserveAspectRatio="none" style={flip ? { transform: [{ scaleY: -1 }] } : undefined}>
      <Path d={d} fill={color} />
    </Svg>
  );
}

/**
 * "BLYNK vs OTHER APPS / 40-60% LOWER PRICES" with its store tile(s). Live: Blynk's fees and
 * free deliveries over tiles of products on offer (else aisles), true copy only.
 */
function VsSection({ live }: { live: LiveVs | null }) {
  const kicker = live ? live.kicker : VS.kicker;
  return (
    <View style={{ marginTop: 34 }}>
      <Wave color={C.brandTint} />
      <LinearGradient colors={[C.brandTint, '#FFFCEB', '#FFFFFF']} style={{ paddingTop: 12, paddingBottom: 6 }}>
        <View style={styles.vsKicker}>
          <HeartsIcon size={15} color={C.brandInk} pupil="#3A3A40" />
          <Text style={styles.vsSmall}>{kicker[0]} <Text style={styles.vsVs}>{kicker[1]}</Text> {kicker[2]}</Text>
        </View>
        <Text style={styles.vsBig}>{live ? live.title : VS.title}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15, gap: 14, marginTop: 10 }}>
          {live?.tiles.map((t) => (
            <PressScale key={t.id} scaleTo={0.97} onPress={() => t.aisle && openAisle(t.aisle)} style={{ width: MEAL_W }}>
              <View style={styles.vsTile}>
                <Photo uri={t.image} name={t.name} size={MEAL_W * 0.86} />
                <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={styles.vsShade} />
                <Text style={styles.vsItems}>{t.overlay[0]}{'\n'}{t.overlay[1]}</Text>
              </View>
              <Text style={styles.vsName} numberOfLines={1}>{t.name}</Text>
              {!!t.line && (
                <Text style={[styles.vsMetaTxt, t.strike && styles.vsStrike]} numberOfLines={1}>{t.line}</Text>
              )}
              {!!t.save && (
                <View style={[styles.vsMeta, { marginTop: 7 }]}>
                  <HeartsIcon size={12} color={C.brandInk} filled />
                  <Text style={[styles.vsTags, { marginTop: 0, color: C.brandText, fontFamily: F.semi }]}>{t.save}</Text>
                </View>
              )}
            </PressScale>
          ))}
          {!live && VS.tiles.map((t) => (
            <PressScale key={t.id} scaleTo={0.97} onPress={() => openAisle({ slug: 'olio99', name: t.name })} style={{ width: MEAL_W }}>
              <View style={styles.vsTile}>
                <Text style={{ fontSize: 76 }}>{t.emoji}</Text>
                <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={styles.vsShade} />
                <Text style={styles.vsItems}>ITEMS{'\n'}AT {rupees(t.itemsAt)}</Text>
              </View>
              <Text style={styles.vsName} numberOfLines={1}>{t.name}</Text>
              <View style={styles.vsMeta}>
                <StarBadge size={12} color={C.brandInk} />
                <Text style={styles.vsMetaTxt}>{t.rating.toFixed(1)} • {t.eta}</Text>
              </View>
              <Text style={styles.vsTags}>{t.tags}</Text>
              <View style={[styles.vsMeta, { marginTop: 7 }]}>
                <HeartsIcon size={12} color="#8A8A8F" pupil="#6A6A70" />
                <Text style={[styles.vsTags, { marginTop: 0 }]}>Our app: {t.lowerPct}% lower</Text>
              </View>
            </PressScale>
          ))}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

/** One restaurant card. Its dishes' footers roll to "Our app" once the card is on screen. */
const StoreCard = memo(function StoreCard({ store: s, y, feedY, screenH, promo }: {
  store: DemoStore; y: SharedValue<number>; feedY: SharedValue<number>; screenH: number;
  /** The yellow promo band follows this card. */
  promo?: boolean;
}) {
  const top = useSharedValue(99999);
  const [seen, setSeen] = useState(false);
  useAnimatedReaction(
    () => y.value + screenH > feedY.value + top.value + 140,
    (v, prev) => {
      if (v && !prev) scheduleOnRN(setSeen, true);
    },
  );
  return (
    <View onLayout={(e) => top.set(e.nativeEvent.layout.y)}>
      <PressScale scaleTo={0.985} onPress={() => openAisle({ slug: s.id, name: s.name })} style={styles.store}>
        <StampBadge size={74} style={styles.stamp} />
        {!!s.lowerPct && <Text style={styles.lower}>{s.lowerPct}% LOWER PRICES</Text>}
        <View style={styles.storeNameRow}>
          {s.ad && <View style={styles.ad}><Text style={styles.adTxt}>Ad</Text></View>}
          <Text style={styles.storeName} numberOfLines={1}>{s.name}</Text>
        </View>
        <View style={styles.metaRow}>
          <StarBadge size={12} color={C.brandInk} />
          <Text style={styles.meta}>{s.rating.toFixed(1)} • {s.eta} • {s.tags}</Text>
        </View>
        <View style={[styles.metaRow, { marginTop: 4 }]}>
          <OfferBadge size={12} color={C.brandInk} />
          <Text style={[styles.meta, { fontSize: 11.5 }]}>Free Delivery • Items At {rupees(s.itemsAt)}</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -15, marginTop: 12 }}
          contentContainerStyle={{ gap: 12, paddingHorizontal: 15 }}
        >
          {s.dishes.map((p: Product, i) => (
            <ProductCard key={p.id} product={p} width={DISH_W} height={DISH_H} index={i} showRating={false} seen={seen} />
          ))}
        </ScrollView>
      </PressScale>
      {promo && <PromoBand />}
    </View>
  );
});

/**
 * Live: the video's restaurant card as a Blynk aisle. Same layout; the rating / ETA row
 * becomes the item count and delivery hours, the delivery row says what this customer may
 * really get (useFreeClaim), the "% LOWER PRICES" line is a running category offer, and there
 * is no "Ad" tag. The corner holds the aisle's illustrated items swaying in a stamp ring
 * (owner, 2026-10-14: the "FREE DELIVERY" stamp misled customers who had used theirs).
 */
const AisleCard = memo(function AisleCard({ aisle: a, index, promo }: {
  aisle: LiveAisleCard; index: number;
  /** The yellow promo band follows this card. */
  promo: { line1: string | null; fees: string[] } | null;
}) {
  return (
    <View>
      <PressScale scaleTo={0.985} onPress={() => openAisle(a.cat)} style={styles.store}>
        <AisleStamp items={aisleArt(a.cat, index)} phase={aislePhase(index)} style={styles.aisleStamp} />
        {!!a.offer && <Text style={styles.lower}>{a.offer}</Text>}
        <View style={styles.storeNameRow}>
          <Text style={styles.storeName} numberOfLines={1}>{a.cat.name}</Text>
        </View>
        <View style={styles.metaRow}>
          <BagBadge size={12} color={C.brandInk} />
          <Text style={styles.meta}>{a.meta}</Text>
        </View>
        <View style={[styles.metaRow, { marginTop: 4 }]}>
          <OfferBadge size={12} color={C.brandInk} />
          <Text style={[styles.meta, { fontSize: 11.5, flexShrink: 1 }]}>{a.delivery}</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -15, marginTop: 12 }}
          contentContainerStyle={{ gap: 12, paddingHorizontal: 15 }}
        >
          {a.items.slice(0, 10).map((p: Product, i) => (
            <ProductCard key={p.id} product={p} width={DISH_W} height={DISH_H} index={i} showRating={false} />
          ))}
        </ScrollView>
      </PressScale>
      {promo && <PromoBand live={promo} />}
    </View>
  );
});

/* The yellow promo band lives in src/components/PromoBand.tsx (Admin / Ops edit it; docs/promo-surfaces.md). */

/** Live: a category or product photo, or its initial while it is missing or fails to load. */
function Photo({ uri, name, size }: { uri: string | null; name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (uri && !failed) {
    return <Image source={{ uri }} accessibilityLabel={name} resizeMode="contain" onError={() => setFailed(true)} style={{ width: size, height: size }} />;
  }
  return <Text style={[styles.initial, { fontSize: Math.round(size * 0.5) }]}>{name.trim().charAt(0).toUpperCase() || '·'}</Text>;
}

/** Live: the catalogue could not load. */
function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(250)} style={styles.errorBox}>
      <Text style={[styles.h2, { textAlign: 'center' }]}>{message}</Text>
      <PressScale onPress={onRetry} style={styles.retry} haptic><Text style={styles.retryTxt}>Try again</Text></PressScale>
    </Animated.View>
  );
}

/** The reference's loading page: two rows of four tiles, then full-width blocks, all very faint. */
function FeedSkeleton() {
  const tone = { backgroundColor: '#F6F6F8' };
  return (
    <View style={{ paddingHorizontal: 15, paddingTop: 14, gap: 14 }}>
      {[0, 1].map((r) => (
        <View key={r} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} w={79} h={75} r={10} style={tone} />)}
        </View>
      ))}
      <Skeleton h={174} r={12} style={[tone, { marginTop: 4 }]} />
      <Skeleton h={172} r={12} style={tone} />
      <Skeleton h={172} r={12} style={tone} />
    </View>
  );
}

const styles = StyleSheet.create({
  locRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 15, paddingRight: 16, paddingTop: 18, gap: 8 },
  locTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  navDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.yellow, alignItems: 'center', justifyContent: 'center' },
  locName: { fontFamily: F.bold, fontSize: 17, letterSpacing: -0.1 },
  locAddr: { fontFamily: F.regular, fontSize: 12, marginTop: 0, marginRight: 30 },
  search: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 15, marginTop: 17,
    borderRadius: 24, paddingHorizontal: 15, height: 47, gap: 9, overflow: 'hidden', borderWidth: 1, borderColor: 'transparent',
  },
  searchGrey: { backgroundColor: '#F2F0F5' },
  searchLine: { borderColor: '#E3E3E8' },
  searchTxt: { fontFamily: F.regular, color: '#5A5A60', fontSize: 15 },
  closed: { marginHorizontal: 15, marginTop: 12 },
  sticky: { backgroundColor: '#fff', shadowColor: '#000', shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  chipsPinned: {
    position: 'absolute', left: 0, right: 0, backgroundColor: '#fff', paddingBottom: 4,
    shadowColor: '#000', shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  catIndicator: {
    position: 'absolute', left: (CAT_W - TILE_W) / 2, width: TILE_W, borderRadius: 14,
    backgroundColor: C.brandSoft, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 2 },
  },
  cat: { width: CAT_W, alignItems: 'center', paddingTop: 7 },
  catImg: { width: 56, height: 50, alignItems: 'center', justifyContent: 'center' },
  fromTag: { backgroundColor: C.brand, borderRadius: 7, paddingHorizontal: 5, height: 13, justifyContent: 'center', marginTop: -6 },
  fromTxt: { color: C.brandInk, fontSize: 8.5, fontFamily: F.bold, letterSpacing: 0.1 },
  catName: { fontFamily: F.medium, fontSize: 11, color: '#55555C', marginTop: 2, maxWidth: CAT_W - 8 },
  catNameOn: { fontFamily: F.bold, color: '#1B1B1F' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 15, marginTop: 16, marginBottom: 15 },
  h2: { fontFamily: F.semi, fontSize: 19.5, color: '#26262B', letterSpacing: -0.2 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllTxt: { fontFamily: F.medium, fontSize: 14.5, color: '#4A4A50' },
  explore: { fontFamily: F.semi, fontSize: 17, color: '#1B1B1F', marginHorizontal: 15, marginTop: 6, marginBottom: 6 },
  empty: { fontFamily: F.regular, fontSize: 13, color: C.sub, marginHorizontal: 16, marginVertical: 20 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#E1E1E6', borderRadius: 18,
    paddingHorizontal: 12, height: 34, backgroundColor: '#fff',
  },
  chipOn: { borderColor: C.brandInk, backgroundColor: C.brandTint },
  chipHearts: { marginLeft: -3 },
  chipTxt: { fontFamily: F.regular, fontSize: 13.5, color: '#2E2E33' },
  store: {
    marginHorizontal: 12, marginTop: 10, marginBottom: 12, backgroundColor: '#fff', borderRadius: 16, padding: 15, paddingBottom: 16,
    borderWidth: 1, borderColor: '#EDEDF0', overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  stamp: { position: 'absolute', right: -10, top: -9 },
  // clear of the title (storeNameRow keeps 52 pt free) and of the product row below
  aisleStamp: { position: 'absolute', right: -5, top: -5 },
  lower: { fontFamily: F.bold, color: C.brandText, fontSize: 12, letterSpacing: -0.1, marginBottom: 1, marginRight: 52 },
  storeNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 52 },
  ad: { backgroundColor: '#F1F1F3', borderRadius: 4, paddingHorizontal: 4, height: 15, justifyContent: 'center' },
  adTxt: { fontFamily: F.medium, fontSize: 9, color: '#8A8A90' },
  storeName: { fontFamily: F.bold, fontSize: 18.5, color: '#141418', letterSpacing: -0.2, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5, marginRight: 50 },
  meta: { fontFamily: F.regular, fontSize: 12.5, color: '#3A3A40' },
  vsKicker: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 15 },
  vsSmall: { fontFamily: F.bold, fontSize: 13, color: C.brandText, letterSpacing: -0.1 },
  vsVs: { fontFamily: F.semi, fontSize: 10.5, fontStyle: 'italic' },
  vsBig: { fontFamily: F.black, fontSize: 22.5, color: C.ink, marginHorizontal: 15, marginTop: 2, letterSpacing: -0.2 },
  vsTile: { width: MEAL_W, height: MEAL_W, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: C.tile },
  vsShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70 },
  vsItems: { position: 'absolute', left: 9, bottom: 9, color: '#fff', fontFamily: F.black, fontSize: 15.5, lineHeight: 18 },
  vsName: { fontFamily: F.semi, fontSize: 14.5, color: '#1B1B1F', marginTop: 7 },
  vsMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 0 },
  vsMetaTxt: { fontFamily: F.regular, fontSize: 12, color: '#3A3A40' },
  vsTags: { fontFamily: F.regular, fontSize: 12, color: '#77777C', marginTop: 0 },
  vsStrike: { color: '#77777C', textDecorationLine: 'line-through' },
  initial: { fontFamily: F.bold, color: C.faint },
  errorBox: { padding: 24, alignItems: 'center', gap: 12 },
  retry: { backgroundColor: C.brand, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 11 },
  retryTxt: { color: C.brandInk, fontFamily: F.bold, fontSize: 14 },
  promo: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16, overflow: 'hidden' },
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  promoTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 14 },
  mascot: { position: 'absolute', right: 10, bottom: 2, width: 74, height: 74 },
  pillWrap: { position: 'absolute', alignSelf: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#17171B', paddingHorizontal: 11, height: 32, borderRadius: 16 },
  pillTxt: { color: '#fff', fontFamily: F.medium, fontSize: 13 },
  feeStripWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  feeStrip: { flexDirection: 'row', paddingTop: 17, paddingHorizontal: 4, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  fee: { alignItems: 'center', gap: 3, flex: 1 },
  coin: {
    minWidth: 23, height: 23, borderRadius: 12, paddingHorizontal: 2, backgroundColor: C.brandInk,
    alignItems: 'center', justifyContent: 'center',
  },
  coinTxt: { fontFamily: F.black, fontSize: 10.5, color: C.brand },
  feeTxt: { color: C.brandInk, fontFamily: F.medium, fontSize: 14 },
  locSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
  locDark: { backgroundColor: '#000', flexDirection: 'row', alignItems: 'flex-start', paddingLeft: 15, paddingRight: 13, paddingTop: 16, paddingBottom: 14, gap: 10 },
  locTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locTitle: { color: '#fff', fontFamily: F.bold, fontSize: 15.5 },
  locSub: { color: '#D6D6D6', fontFamily: F.regular, fontSize: 13, lineHeight: 14.5, marginTop: 5, marginRight: 30 },
  grant: { backgroundColor: '#fff', borderRadius: 13, paddingHorizontal: 11, height: 25, justifyContent: 'center', marginTop: -3 },
  grantTxt: { fontFamily: F.bold, fontSize: 12, color: '#000', letterSpacing: 0.2 },
  locManual: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 30, height: 58 },
  locManualTxt: { fontFamily: F.regular, fontSize: 14.5, color: '#55555C' },
});
