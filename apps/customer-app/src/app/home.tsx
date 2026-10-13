import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, FadeIn, interpolate, interpolateColor, SlideOutDown,
  useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withDelay, withRepeat,
  withSequence, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import type { Product } from '@/blynk/api/types';
import { effectivePrice } from '@/blynk/lib/pricing';
import { Banner } from '@/components/Banner';
import { CART_BAR, CartBar } from '@/components/CartBar';
import {
  CheckBoxIcon, ChevronIcon, HeartsIcon, LocateIcon, MenuIcon, NavIcon, OfferBadge, SearchIcon, SlidersIcon, StarBadge,
} from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { PressScale, RollingText, Skeleton, StampBadge } from '@/components/ui';
import {
  BANNER, CATEGORIES, CATEGORIES_PRE, FEES, FILTERS, LOCATION, LOCATION_SHEET, MEALS, MEALS_PRE, PROMO, PROMO_AFTER,
  SEARCH_HINTS, STORES, STORES_BY_CATEGORY, VS, type DemoCategory, type DemoFilter, type DemoStore,
} from '@/demo/home';
import { extraOf } from '@/demo/extras';
import { rupees } from '@/demo/money';
import { withSpring } from '@/lib/motion';
import { useCartSelect } from '@/lib/cart';
import { openAisle } from '@/lib/nav';
import { C, F } from '@/lib/theme';

/*
 * Home, matched frame by frame to the reference recording (0:04–0:31). All content is the
 * video's own (src/demo/home.ts); colours follow Blynk's mapping (purple → ink, pink → green).
 *
 *   0:04.5  splash green fades off while the page rises into place, header WHITE, "Locating …"
 *   0:05.1  location name rolls in     0:05.5  skeleton → content     0:05.7  ink header + banner unfold
 *   pre-grant: 60 % black scrim + black "Location Permission is Off" bar
 *   GRANT   bar slides away, page reloads the same way, then the green fee strip rises
 *   scroll  categories (+ filter chips) stick; fee strip hides; black "Search" pill springs up
 */

const CAT_W = 90; // one category slot (the reference's tiles sit 90 pt apart)
const TILE_W = 81;
const TILE_H = 86;
const MEAL_W = 155; // "Meals under ₹99" photo
const DISH_W = 134; // dish photo inside a store card
const DISH_H = 100;
const BANNER_H = 183;

type Phase = 'locating' | 'skeleton' | 'content' | 'banner';

/** The splash hands over to Home once per app launch. */
let fromSplash = true;

export default function Home() {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [phase, setPhase] = useState<Phase>('locating');
  const [granted, setGranted] = useState(false);
  const [cat, setCat] = useState('all');
  const [filters, setFilters] = useState<DemoFilter[]>([]);
  const [past, setPast] = useState(false);
  const [chipsOn, setChipsOn] = useState(false);
  const count = useCartSelect((c) => c.count);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const y = useSharedValue(0);
  const headerH = useSharedValue(400);
  const catH = useSharedValue(TILE_H + 16);
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
  const scrim = useSharedValue(1);
  const splash = useSharedValue(fromSplash ? 1 : 0);
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
    if (fromSplash) {
      fromSplash = false;
      splash.set(withTiming(0, { duration: 330, easing: Easing.out(Easing.quad) }));
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
      [interpolateColor(ink.value, [0, 1], ['#FFFFFF', C.purple]), '#FFFFFF'],
    ),
  }));
  const headerA = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(ink.value, [0, 1], ['#FFFFFF', C.purple]) }));
  const bannerA = useAnimatedStyle(() => ({ height: bannerOpen.value * BANNER_H, opacity: interpolate(bannerOpen.value, [0, 0.35, 1], [0, 0.7, 1]) }));
  const chipsA = useAnimatedStyle(() => ({ top: catH.value, opacity: stuckChips.value, shadowOpacity: stuckChips.value * 0.09 }));
  const stickyShadow = useAnimatedStyle(() => {
    const v = stuckCats.value * (1 - stuckChips.value);
    return { elevation: v * 4, shadowOpacity: v * 0.09 };
  });
  const stripA = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - strip.value * (1 - cartOn.value)) * 130 }] }));
  const pillA = useAnimatedStyle(() => ({ opacity: pill.value, transform: [{ translateY: (1 - pill.value) * 80 }, { scale: 0.8 + pill.value * 0.2 }] }));
  const scrimA = useAnimatedStyle(() => ({ opacity: scrim.value * 0.6 }));
  const splashA = useAnimatedStyle(() => ({ opacity: splash.value }));
  const riseA = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value * screenH * 0.32 }] }));

  const cats = granted ? CATEGORIES : CATEGORIES_PRE;
  const meals = granted ? MEALS : MEALS_PRE;
  const stores = useMemo(() => filterStores(cat, filters), [cat, filters]);

  const grant = () => {
    // Asking the browser is fine; the position never leaves this device in this phase.
    try {
      const geo = (globalThis as { navigator?: { geolocation?: Geolocation } }).navigator?.geolocation;
      geo?.getCurrentPosition(() => {}, () => {}, { timeout: 8000 });
    } catch { /* no geolocation here */ }
    scrim.set(withTiming(0, { duration: 320 }));
    setGranted(true);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    setPhase('locating');
    load({ name: 500, content: 1000, banner: 1300 });
  };

  const toExplore = () => {
    scrollRef.current?.scrollTo({ y: Math.max(0, feedY.get() + exploreY.get() - catH.get() - 52), animated: true });
  };
  const toggleFilter = (f: DemoFilter) => setFilters((s) => (s.includes(f) ? s.filter((x) => x !== f) : [...s, f]));

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
            <LocationRow locating={phase === 'locating'} dark={dark} />
            <SearchBar phase={phase} />
            <Animated.View style={[{ overflow: 'hidden' }, bannerA]}>
              {dark && <Banner images={[]} minPrice={null} freeCount={0} onOrderNow={toExplore} demo={BANNER} />}
            </Animated.View>
          </Animated.View>

          {/* 1 — sticky: categories (+ filter chips once the inline row scrolls under) */}
          {/* plain View: RN's sticky-header wrapper copies & freezes this child's style, so no animated styles here */}
          <View>
            {!loading && (
              <Animated.View style={[styles.sticky, stickyShadow]}>
                <View onLayout={(e) => catH.set(e.nativeEvent.layout.height)}>
                  <CategoryRail key={granted ? 'post' : 'pre'} items={cats} value={cat} onChange={setCat} stuck={stuckCats} />
                </View>
              </Animated.View>
            )}
          </View>

          {/* 2 — feed */}
          <View>
            {loading ? (
              <FeedSkeleton />
            ) : (
              <Animated.View key={granted ? 'post' : 'pre'} entering={FadeIn.duration(260)}>
                <View style={styles.sectionHead}>
                  <Text style={styles.h2}>Meals under ₹99</Text>
                  <Pressable onPress={toExplore} hitSlop={8} style={styles.seeAll}>
                    <Text style={styles.seeAllTxt}>See All</Text>
                    <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={15} color="#4A4A50" stroke={2.2} /></View>
                  </Pressable>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15, gap: 15 }}>
                  {meals.map((p, i) => (
                    <ProductCard key={p.id} product={p} index={i} width={MEAL_W} />
                  ))}
                </ScrollView>

                {granted && <VsSection />}

                <View onLayout={(e) => chipsY.set(e.nativeEvent.layout.y)} style={{ marginTop: granted ? 2 : 16 }}>
                  <FilterChips on={filters} onToggle={toggleFilter} />
                </View>
                <Text onLayout={(e) => exploreY.set(e.nativeEvent.layout.y)} style={styles.explore}>Explore all restaurants</Text>

                {stores.length === 0 && <Text style={styles.empty}>No restaurants match these filters.</Text>}
                {stores.map((s, i) => (
                  <StoreCard key={s.id} store={s} y={y} feedY={feedY} screenH={screenH} promo={granted && i === PROMO_AFTER - 1} />
                ))}
              </Animated.View>
            )}
          </View>
        </Animated.ScrollView>

        {/* filter chips pinned under the stuck categories (an overlay, so nothing below shifts) */}
        <Animated.View pointerEvents={chipsOn ? 'auto' : 'none'} style={[styles.chipsPinned, chipsA]}>
          <FilterChips on={filters} onToggle={toggleFilter} />
        </Animated.View>
      </Animated.View>

      {/* the location bar's scrim dims everything above it, status bar included */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, scrimA]} />

      {/* floating "Search" pill */}
      <Animated.View pointerEvents="box-none" style={[styles.pillWrap, { bottom: insets.bottom + 17 + (count > 0 ? CART_BAR.h + CART_BAR.bottom : 0) }, pillA]}>
        <PressScale onPress={() => router.push('/search')} style={styles.pill} haptic>
          <SearchIcon size={14} color="#fff" stroke={2.4} />
          <Text style={styles.pillTxt}>Search</Text>
        </PressScale>
      </Animated.View>

      {/* fee strip (after location is granted) */}
      <Animated.View style={[styles.feeStripWrap, stripA]} pointerEvents="none">
        <LinearGradient colors={[C.green, C.greenDark]} style={[styles.feeStrip, { paddingBottom: insets.bottom + 27 }]}>
          {FEES.map(([c, l]) => (
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
        <Animated.View exiting={SlideOutDown.duration(300)} style={[styles.locSheet, { paddingBottom: insets.bottom }]}>
          <View style={styles.locDark}>
            <View style={{ flex: 1 }}>
              <View style={styles.locTitleRow}>
                <LocateIcon size={15} color="#fff" />
                <Text style={styles.locTitle}>{LOCATION_SHEET.title}</Text>
              </View>
              <Text style={styles.locSub}>{LOCATION_SHEET.sub}</Text>
            </View>
            <PressScale onPress={grant} style={styles.grant} haptic>
              <Text style={styles.grantTxt}>{LOCATION_SHEET.cta}</Text>
            </PressScale>
          </View>
          <Pressable onPress={() => router.push('/address')} style={styles.locManual}>
            <SearchIcon size={17} color={C.green} />
            <Text style={styles.locManualTxt}>{LOCATION_SHEET.manual}</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* the splash's green card, fading off as the page rises in */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.green }, splashA]} />
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

function LocationRow({ locating, dark }: { locating: boolean; dark: boolean }) {
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = locating ? withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1) : withSpring(0);
  }, [locating]);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const fg = dark ? '#fff' : '#1B1B1F';
  return (
    <View style={styles.locRow}>
      <Animated.View style={[styles.navDot, a]}>
        <NavIcon size={15} color={C.ink} />
      </Animated.View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <RollingText text={locating ? 'Locating ...' : LOCATION.name} style={[styles.locName, { color: fg }]} />
          <ChevronIcon size={13} color={dark ? '#D9D6E8' : '#55555C'} stroke={2.2} />
        </View>
        {!locating && (
          <Animated.Text entering={FadeIn.duration(250)} numberOfLines={1} style={[styles.locAddr, { color: dark ? '#CFCBE0' : '#55555C' }]}>
            {LOCATION.address}
          </Animated.Text>
        )}
      </View>
      <PressScale style={{ padding: 6, marginRight: -6 }}>
        <MenuIcon size={22} color={fg} stroke={2.3} />
      </PressScale>
    </View>
  );
}

/** "Search for 'Burger'" — the quoted word rolls up to the next dish now and then. */
function SearchBar({ phase }: { phase: Phase }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const first = setTimeout(() => setI(1), 2200);
    const t = setInterval(() => setI((n) => n + 1), 9000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  const hint = SEARCH_HINTS[i % SEARCH_HINTS.length];
  const grey = phase === 'locating' || phase === 'skeleton';
  return (
    <PressScale
      onPress={() => router.push('/search')}
      style={[styles.search, grey ? styles.searchGrey : phase === 'content' ? styles.searchLine : null]}
      scaleTo={0.98}
    >
      <SearchIcon size={18} color="#55555C" stroke={2} />
      <View style={{ flexDirection: 'row', flexShrink: 1 }}>
        <Text style={styles.searchTxt}>{'Search for '}</Text>
        <RollingText text={`'${hint}'`} style={styles.searchTxt} />
      </View>
    </PressScale>
  );
}

/** Stuck to the top, the rail tightens: tiles 86 → 78 pt, top padding 11 → 8 (0:16.5). */
const SQUEEZE = TILE_H - 78;
function CategoryRail({ items, value, onChange, stuck }: {
  items: DemoCategory[]; value: string; onChange: (id: string) => void; stuck: SharedValue<number>;
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

function CategoryItem({ c, active, onPress, stuck }: { c: DemoCategory; active: boolean; onPress: () => void; stuck: SharedValue<number> }) {
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
        <Text style={{ fontSize: 40, lineHeight: 48 }}>{c.emoji}</Text>
      </Animated.View>
      {c.from != null ? (
        <View style={styles.fromTag}><Text style={styles.fromTxt}>FROM {rupees(c.from)}</Text></View>
      ) : (
        <View style={{ height: 6 }} />
      )}
      <Text numberOfLines={1} style={[styles.catName, active && styles.catNameOn]}>{c.name}</Text>
      </Animated.View>
    </PressScale>
  );
}

function FilterChips({ on, onToggle }: { on: DemoFilter[]; onToggle: (f: DemoFilter) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15, gap: 8, paddingVertical: 6, alignItems: 'center' }}>
      <View style={[styles.chip, { width: 38, paddingHorizontal: 0, justifyContent: 'center' }]}><SlidersIcon size={17} color="#3A3A40" /></View>
      {FILTERS.map((f) => {
        const active = on.includes(f.id);
        return (
          <PressScale key={f.id} onPress={() => onToggle(f.id)} style={[styles.chip, active && styles.chipOn]}>
            {'hearts' in f && (
              <View style={styles.chipHearts}><HeartsIcon size={15} color={C.pink} filled /></View>
            )}
            <Text style={[styles.chipTxt, active && { color: C.pink }]}>{f.label}</Text>
            {'caret' in f && <ChevronIcon size={14} color="#3A3A40" stroke={2.2} />}
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

/** "BLYNK vs OTHER APPS / 40-60% LOWER PRICES" with its store tile(s). */
function VsSection() {
  return (
    <View style={{ marginTop: 34 }}>
      <Wave color={C.greenTint} />
      <LinearGradient colors={[C.greenTint, '#F5FBF6', '#FFFFFF']} style={{ paddingTop: 12, paddingBottom: 6 }}>
        <View style={styles.vsKicker}>
          <HeartsIcon size={15} color={C.pink} pupil="#3A3A40" />
          <Text style={styles.vsSmall}>{VS.kicker[0]} <Text style={styles.vsVs}>{VS.kicker[1]}</Text> {VS.kicker[2]}</Text>
        </View>
        <Text style={styles.vsBig}>{VS.title}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 15, gap: 14, marginTop: 10 }}>
          {VS.tiles.map((t) => (
            <PressScale key={t.id} scaleTo={0.97} onPress={() => openAisle({ slug: 'olio99', name: t.name })} style={{ width: MEAL_W }}>
              <View style={styles.vsTile}>
                <Text style={{ fontSize: 76 }}>{t.emoji}</Text>
                <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={styles.vsShade} />
                <Text style={styles.vsItems}>ITEMS{'\n'}AT {rupees(t.itemsAt)}</Text>
              </View>
              <Text style={styles.vsName} numberOfLines={1}>{t.name}</Text>
              <View style={styles.vsMeta}>
                <StarBadge size={12} color={C.green} />
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
  /** The green promo band follows this card. */
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
          <StarBadge size={12} color={C.green} />
          <Text style={styles.meta}>{s.rating.toFixed(1)} • {s.eta} • {s.tags}</Text>
        </View>
        <View style={[styles.metaRow, { marginTop: 4 }]}>
          <OfferBadge size={12} color={C.green} />
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

/** Green band with scalloped edges: the reference's "Offline Menu Price Match / ₹0 fees". */
function PromoBand() {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withRepeat(withSequence(withTiming(1, { duration: 220 }), withTiming(-1, { duration: 220 }), withTiming(1, { duration: 220 }), withTiming(0, { duration: 220 }), withTiming(0, { duration: 1400 })), -1);
  }, []);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${w.value * 10}deg` }] }));
  return (
    <View style={{ marginTop: 2, marginBottom: 22 }}>
      <Wave color="#14A02C" />
      <LinearGradient colors={['#14A02C', C.green]} style={styles.promo}>
        <View style={styles.promoRow}>
          <CheckBoxIcon size={14} color={C.yellow} />
          <Text style={styles.promoTxt}>{PROMO.line1}</Text>
        </View>
        <View style={[styles.promoRow, { marginTop: 9 }]}>
          {PROMO.fees.map((f) => (
            <View key={f} style={[styles.promoRow, { marginRight: 12 }]}>
              <CheckBoxIcon size={14} color={C.yellow} />
              <Text style={styles.promoTxt}>{f}</Text>
            </View>
          ))}
        </View>
        <Animated.Text style={[styles.mascot, a]}>🫶</Animated.Text>
      </LinearGradient>
      <Wave color={C.green} flip />
    </View>
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
  sticky: { backgroundColor: '#fff', shadowColor: '#000', shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  chipsPinned: {
    position: 'absolute', left: 0, right: 0, backgroundColor: '#fff', paddingBottom: 4,
    shadowColor: '#000', shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  catIndicator: {
    position: 'absolute', left: (CAT_W - TILE_W) / 2, width: TILE_W, borderRadius: 14,
    backgroundColor: C.pinkSoft, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 2 },
  },
  cat: { width: CAT_W, alignItems: 'center', paddingTop: 7 },
  catImg: { width: 56, height: 50, alignItems: 'center', justifyContent: 'center' },
  fromTag: { backgroundColor: C.pink, borderRadius: 7, paddingHorizontal: 5, height: 13, justifyContent: 'center', marginTop: -6 },
  fromTxt: { color: '#fff', fontSize: 8.5, fontFamily: F.bold, letterSpacing: 0.1 },
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
  chipOn: { borderColor: C.pink, backgroundColor: C.greenTint },
  chipHearts: { marginLeft: -3 },
  chipTxt: { fontFamily: F.regular, fontSize: 13.5, color: '#2E2E33' },
  store: {
    marginHorizontal: 12, marginTop: 10, marginBottom: 12, backgroundColor: '#fff', borderRadius: 16, padding: 15, paddingBottom: 16,
    borderWidth: 1, borderColor: '#EDEDF0', overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  stamp: { position: 'absolute', right: -10, top: -9 },
  lower: { fontFamily: F.bold, color: C.pink, fontSize: 12, letterSpacing: -0.1, marginBottom: 1 },
  storeNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 52 },
  ad: { backgroundColor: '#F1F1F3', borderRadius: 4, paddingHorizontal: 4, height: 15, justifyContent: 'center' },
  adTxt: { fontFamily: F.medium, fontSize: 9, color: '#8A8A90' },
  storeName: { fontFamily: F.bold, fontSize: 18.5, color: '#141418', letterSpacing: -0.2, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5, marginRight: 50 },
  meta: { fontFamily: F.regular, fontSize: 12.5, color: '#3A3A40' },
  vsKicker: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 15 },
  vsSmall: { fontFamily: F.bold, fontSize: 13, color: C.pink, letterSpacing: -0.1 },
  vsVs: { fontFamily: F.semi, fontSize: 10.5, fontStyle: 'italic' },
  vsBig: { fontFamily: F.black, fontSize: 22.5, color: C.pink, marginHorizontal: 15, marginTop: 2, letterSpacing: -0.2 },
  vsTile: { width: MEAL_W, height: MEAL_W, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: C.tile },
  vsShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 70 },
  vsItems: { position: 'absolute', left: 9, bottom: 9, color: '#fff', fontFamily: F.black, fontSize: 15.5, lineHeight: 18 },
  vsName: { fontFamily: F.semi, fontSize: 14.5, color: '#1B1B1F', marginTop: 7 },
  vsMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 0 },
  vsMetaTxt: { fontFamily: F.regular, fontSize: 12, color: '#3A3A40' },
  vsTags: { fontFamily: F.regular, fontSize: 12, color: '#77777C', marginTop: 0 },
  promo: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16, overflow: 'hidden' },
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  promoTxt: { color: '#fff', fontFamily: F.semi, fontSize: 14 },
  mascot: { position: 'absolute', right: 16, bottom: -2, fontSize: 46 },
  pillWrap: { position: 'absolute', alignSelf: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#17171B', paddingHorizontal: 11, height: 32, borderRadius: 16 },
  pillTxt: { color: '#fff', fontFamily: F.medium, fontSize: 13 },
  feeStripWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  feeStrip: { flexDirection: 'row', paddingTop: 17, paddingHorizontal: 4, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  fee: { alignItems: 'center', gap: 3, flex: 1 },
  coin: {
    minWidth: 23, height: 23, borderRadius: 12, paddingHorizontal: 2, backgroundColor: C.yellow,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#E0B800',
  },
  coinTxt: { fontFamily: F.black, fontSize: 10.5, color: C.ink },
  feeTxt: { color: '#fff', fontFamily: F.medium, fontSize: 14 },
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
