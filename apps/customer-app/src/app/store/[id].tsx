import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation, FadeIn, FadeOut, interpolate, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler,
  useAnimatedStyle, useSharedValue, withDelay, withTiming, ZoomIn, ZoomOut,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import type { Product } from '@/blynk/api/types';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { applyFilters, FILTERS, type FilterId } from '@/blynk/lib/filters';
import { formatLkr } from '@/blynk/lib/money';
import { effectivePrice, isOfferActive } from '@/blynk/lib/pricing';
import { useFreeDeliveryUnlocked } from '@/blynk/store/freeDelivery';
import { useStore } from '@/blynk/store/StoreContext';
import { CART_BAR, CartBar } from '@/components/CartBar';
import { ClosedBanner } from '@/components/ClosedBanner';
import { VegMark } from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { ProductImage } from '@/components/ProductImage';
import { AddButton, Chevron, Collapsible, Hearts, PressScale, Skeleton, StampBadge } from '@/components/ui';
import { extraOf } from '@/demo/extras';
import { DEMO } from '@/demo/mode';
import { rupees } from '@/demo/money';
import { STORE, type DemoSection } from '@/demo/store';
import { liveAisle, pairPicks } from '@/demo/storeLive';
import { useCartSelect } from '@/lib/cart';
import { withSpring } from '@/lib/motion';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';

/*
 * The store screen (video 0:32–0:41), measured off the 384×850 recording. Every y below is
 * from the top of the safe area (the video's y minus its 40 pt status bar).
 */
const HERO_H = 97; // photo strip; the white sheet overlaps its last 20 pt
const SHEET_TOP = 77; // white sheet top
const PAD = 15;
const GAP = 15;
const ROW1_H = 41; // sticky search pill (8..49)
const STICK_Y = SHEET_TOP - 49; // the header takes over once the sheet reaches the pill's bottom
const HEADER_H = 142; // pill + chips + section label
const ROW_PITCH = 1.507; // dish rows repeat every 260 pt on a 172.5 pt tile
const FAB = 68;
// CartBar geometry (A's component): bottom offset and the free-delivery strip height.
const BAR_BOTTOM = CART_BAR.bottom;
const BAR_H = CART_BAR.h;
const STRIP_H = CART_BAR.withStripH - CART_BAR.h;
const FAB_REST = 24; // fab's bottom gap when the cart is empty
const NONVEG = '#E43B4F';

type Filter = 'veg' | 'nonveg' | 'lower' | 'rated' | FilterId;
const LIVE_FILTERS = new Set<string>(FILTERS.map((f) => f.id));
const isLive = (f: Filter): f is FilterId => LIVE_FILTERS.has(f);

function applyDemoFilters(items: Product[], on: Filter[]): Product[] {
  if (!on.length) return items;
  return items.filter((p) => {
    const x = extraOf(p.id);
    return (!on.includes('veg') || x?.veg === true)
      && (!on.includes('nonveg') || x?.veg === false)
      && (!on.includes('lower') || (x?.lowerPct ?? 0) > 0)
      && (!on.includes('rated') || (x?.rating ?? 0) >= 4);
  });
}
const toggleIn = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * The aisle screen. Design mock (DEMO): any id shows the video's "Ovenfresh Cakes And
 * Desserts". Live: the aisle is the Blynk category whose slug is `id`, its sections are
 * its sub-categories, and every store value comes from GET /store (Admin / Ops).
 */
export default function StoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, refresh } = useCatalog();
  const store = useStore();
  const live = useMemo(() => (DEMO ? null : liveAisle(data, id, store)), [data, id, store]);
  const freeLive = useFreeDeliveryUnlocked();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const count = useCartSelect((c) => c.count);
  const total = useCartSelect((c) => c.total);
  const qty = useCartSelect((c) => c.qty);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [pairFor, setPairFor] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [stuckJS, setStuckJS] = useState(false);
  const [current, setCurrent] = useState(0);
  const [filters, setFilters] = useState<Filter[]>([]);
  const stripOn = DEMO ? count > 0 && total >= STORE.freeDeliveryAbove : freeLive > 0;

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const y = useSharedValue(0);
  const stuck = useSharedValue(0);
  const titleRow = useSharedValue(1);
  const pill = useSharedValue(0);
  const fabLift = useSharedValue(0);
  const secTops = useSharedValue<number[]>([]);
  const listY = useRef(0);
  const sectionY = useRef<Record<string, number>>({});
  const rowsY = useRef<Record<string, number>>({});
  const rowY = useRef<Record<string, number>>({});

  const base = useMemo<DemoSection[]>(() => (DEMO ? STORE.sections : (live?.sections ?? [])), [live]);
  const all = useMemo(() => (DEMO ? STORE.sections.flatMap((s) => s.items) : (live?.all ?? [])), [live]);
  const sections = useMemo(
    () => base
      .map((s) => ({ ...s, items: DEMO ? applyDemoFilters(s.items, filters) : applyFilters(s.items, filters.filter(isLive)) }))
      .filter((s) => s.items.length > 0),
    [base, filters],
  );

  // first time a dish here is added, the "pair this with" panel opens under its row
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const [prevQty, setPrevQty] = useState(qty);
  if (qty !== prevQty) {
    setPrevQty(qty);
    const added = all.find((p) => (qty[p.id] ?? 0) > 0 && !(prevQty[p.id] ?? 0) && !seen[p.id]);
    if (added) {
      setSeen((s) => ({ ...s, [added.id]: true }));
      setPairFor(added.id);
    }
  }

  // the MENU fab sits 26 pt above the cart bar, 21 pt above its free-delivery strip
  const lift = count > 0 ? BAR_H + (stripOn ? STRIP_H + 21 : 26) - FAB_REST : 0;
  useEffect(() => {
    fabLift.value = withSpring(lift, { damping: 16, stiffness: 170 });
  }, [lift]);

  // Opening with something already in the basket jumps (no animation) to that dish's row.
  useEffect(() => {
    const t = setTimeout(() => {
      const at = all.findIndex((p) => (qty[p.id] ?? 0) > 0);
      if (at < 0) return;
      const sec = sections.find((s) => s.items.some((p) => p.id === all[at].id));
      if (!sec) return;
      const ri = Math.floor(sec.items.findIndex((p) => p.id === all[at].id) / 2);
      const top = listY.current + (sectionY.current[sec.id] ?? 0) + (rowsY.current[sec.id] ?? 0) + (rowY.current[`${sec.id}:${ri}`] ?? 0);
      if (ri > 0) scrollRef.current?.scrollTo({ y: Math.max(0, top - (HEADER_H - 25)), animated: false });
    }, 350);
    return () => clearTimeout(t);
  }, []);

  const onScroll = useAnimatedScrollHandler((e) => {
    y.value = e.contentOffset.y;
  });
  useAnimatedReaction(
    () => y.value > STICK_Y,
    (s, p) => {
      if (s === p) return;
      stuck.value = s ? 1 : 0;
      if (s) {
        // store-name row shows for a beat, then the search pill fades in over it
        titleRow.value = 1;
        titleRow.value = withDelay(60, withTiming(0, { duration: 80 }));
        pill.value = 0;
        pill.value = withDelay(130, withTiming(1, { duration: 110 }));
      } else {
        titleRow.value = 1;
        pill.value = 0;
      }
      scheduleOnRN(setStuckJS, s);
    },
  );
  // the sticky label names the section under the header
  useAnimatedReaction(
    () => {
      const tops = secTops.value;
      let i = 0;
      for (let k = 0; k < tops.length; k++) if (tops[k] <= y.value + HEADER_H) i = k;
      return i;
    },
    (i, p) => {
      if (i !== p) scheduleOnRN(setCurrent, i);
    },
  );

  const heroA = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(y.value, [-200, 0], [-100, 0], Extrapolation.CLAMP) },
      { scale: interpolate(y.value, [-200, 0], [1.6, 1], Extrapolation.CLAMP) },
    ],
  }));
  const floatBtns = useAnimatedStyle(() => ({ opacity: 1 - stuck.value }));
  const headerA = useAnimatedStyle(() => ({ opacity: stuck.value }));
  const titleA = useAnimatedStyle(() => ({ opacity: titleRow.value }));
  const pillA = useAnimatedStyle(() => ({ opacity: pill.value }));
  const fabA = useAnimatedStyle(() => ({ transform: [{ translateY: -fabLift.value }] }));

  const tile = (width - PAD * 2 - GAP) / 2;
  const toggleFilter = (f: Filter) => setFilters((s) => toggleIn(s, f));
  const name = DEMO ? STORE.name : (live?.cat.name ?? '');
  const search = () => router.push({ pathname: '/search', params: DEMO ? { name } : { c: live?.cat.slug ?? '', name } });
  const share = () => Share.share({ message: `${name} on Blynk` }).catch(() => {});
  const syncTops = () => {
    secTops.value = sections.map((s) => listY.current + (sectionY.current[s.id] ?? 0));
  };
  const jump = (sid: string) => {
    setMenu(false);
    setClosed((s) => ({ ...s, [sid]: false }));
    const at = sectionY.current[sid];
    if (at != null) scrollRef.current?.scrollTo({ y: Math.max(STICK_Y + 1, listY.current + at - HEADER_H + 40), animated: true });
  };
  const cur = sections[Math.min(current, sections.length - 1)];
  const pairPool = (forId: string) => (DEMO ? STORE.pairs.filter((p) => p.id !== forId) : pairPicks(all, forId));
  const pairTitle = DEMO ? STORE.pairTitle : `More from ${name}`;

  if (!DEMO && !live) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top }}>
        <StatusBar style="dark" />
        <PressScale onPress={goBack} style={[styles.round, styles.missingBack]}><ArrowLeft size={16} color="#222" /></PressScale>
        {data ? (
          <View style={styles.missing}>
            <Text style={[styles.name, { marginRight: 0 }]}>This aisle isn&apos;t available</Text>
            <PressScale onPress={() => router.replace('/home')} style={styles.missingBtn} haptic><Text style={styles.missingTxt}>Go to shop</Text></PressScale>
          </View>
        ) : error ? (
          <View style={styles.missing}>
            <Text style={[styles.name, { textAlign: 'center', marginRight: 0 }]}>{error.message}</Text>
            <PressScale onPress={() => void refresh()} style={styles.missingBtn} haptic><Text style={styles.missingTxt}>Try again</Text></PressScale>
          </View>
        ) : (
          <View style={{ padding: PAD, gap: 14 }}>
            <Skeleton h={HERO_H} r={18} />
            <Skeleton w="60%" h={20} />
            <View style={{ flexDirection: 'row', gap: GAP }}><Skeleton w={tile} h={tile} r={14} /><Skeleton w={tile} h={tile} r={14} /></View>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style="dark" />
      <Animated.ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 160 }}>
        <Animated.View style={[{ height: HERO_H + insets.top, overflow: 'hidden', backgroundColor: STORE.heroBg }, heroA]}>
          {DEMO ? (
            <View style={[styles.heroArt, { paddingTop: insets.top }]}>
              <Text style={styles.heroEmoji}>{STORE.heroEmoji}</Text>
            </View>
          ) : live?.hero?.kind === 'category' ? (
            <Image source={{ uri: live.hero.uri }} resizeMode="cover" accessibilityLabel={name} style={StyleSheet.absoluteFill} />
          ) : live?.hero?.kind === 'product' ? (
            <View style={[styles.heroArt, { paddingTop: insets.top }]}>
              <ProductImage product={live.hero.product} size={64} radius={0} style={{ backgroundColor: 'transparent', marginBottom: 14 }} />
            </View>
          ) : null}
        </Animated.View>

        <View style={styles.sheet}>
          {DEMO ? <StampBadge size={84} style={styles.stamp} /> : !!live?.freeCount && <StampBadge variant="free" size={84} style={styles.stamp} />}
          <Text style={styles.name}>{name}</Text>
          {DEMO ? <View style={styles.metaRow}>
            <Text style={styles.star}>★</Text>
            <Text style={[styles.meta, { color: C.ink, fontFamily: F.bold }]}> {STORE.rating.toFixed(1)}</Text>
            <View style={styles.sep} />
            <Text style={styles.meta}>{STORE.eta}</Text>
            <View style={styles.sep} />
            <Text style={styles.meta}>{STORE.area}</Text>
            <Text style={[styles.meta, { fontSize: 10, marginLeft: 3 }]}>▼</Text>
          </View> : (
            <View style={styles.metaRow}>
              {live?.meta.map((m, i) => (
                <Fragment key={i}>
                  {i > 0 && <View style={styles.sep} />}
                  <Text style={[styles.meta, { flexShrink: i === 0 ? 0 : 1 }]} numberOfLines={1}>{m}</Text>
                </Fragment>
              ))}
            </View>
          )}
          {DEMO ? (
            <>
              <View style={[styles.rule, { marginRight: 32 }]} />
              <View style={styles.offerRow}>
                <View style={styles.iconBox}><Hearts size={15} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.offer}>
                    {STORE.offerTitle[0]}<Text style={styles.offerVs}>{STORE.offerTitle[1]}</Text>{STORE.offerTitle[2]}
                  </Text>
                  <Text style={styles.offerSub}>{STORE.offerSub}</Text>
                </View>
              </View>
            </>
          ) : live?.offer && (
            <>
              <View style={[styles.rule, { marginRight: 32 }]} />
              <View style={styles.offerRow}>
                <View style={styles.iconBox}><Hearts size={15} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.offer}>{live.offer.title}</Text>
                  {!!live.offer.sub && <Text style={styles.offerSub}>{live.offer.sub}</Text>}
                </View>
              </View>
            </>
          )}
          {!DEMO && <ClosedBanner style={{ marginTop: 15 }} />}
          <PressScale onPress={search} scaleTo={0.98} style={styles.search}>
            <SearchGlyph size={20} color="#555" />
            <Text style={styles.searchTxt} numberOfLines={1}>{DEMO ? STORE.search : 'Search for products'}</Text>
          </PressScale>
        </View>

        <Chips on={filters} onToggle={toggleFilter} />
        <View style={[styles.rule, { marginHorizontal: PAD }]} />

        <View onLayout={(e) => { listY.current = e.nativeEvent.layout.y; syncTops(); }}>
          {sections.length === 0 && (
            <Text style={styles.emptyTxt}>
              {DEMO || filters.length ? 'Nothing here matches these filters.' : "We're stocking this aisle. Check back shortly."}
            </Text>
          )}
          {sections.map((sec) => (
            <SectionBlock
              key={sec.id}
              sec={sec}
              open={!closed[sec.id]}
              tile={tile}
              pairFor={pairFor}
              pairPool={pairPool}
              pairTitle={pairTitle}
              onToggle={() => setClosed((s) => ({ ...s, [sec.id]: !closed[sec.id] }))}
              onClosePair={() => setPairFor(null)}
              onSectionY={(v) => { sectionY.current[sec.id] = v; syncTops(); }}
              onRowsY={(v) => (rowsY.current[sec.id] = v)}
              onRowY={(ri, v) => (rowY.current[`${sec.id}:${ri}`] = v)}
            />
          ))}
        </View>
      </Animated.ScrollView>

      {/* round buttons over the hero */}
      <Animated.View pointerEvents={stuckJS ? 'none' : 'box-none'} style={[styles.floatRow, { top: insets.top + 10 }, floatBtns]}>
        <PressScale onPress={goBack} style={styles.round}><ArrowLeft size={16} color="#fff" /></PressScale>
        <PressScale onPress={share} style={styles.round}><ShareGlyph size={15} color="#fff" /></PressScale>
      </Animated.View>

      {/* sticky header: store row → search pill, chips, the current section */}
      <Animated.View pointerEvents={stuckJS ? 'box-none' : 'none'} style={[styles.header, { paddingTop: insets.top }, headerA]}>
        <View style={styles.row1}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.titleRow, titleA]}>
            <PressScale onPress={goBack} style={{ padding: 4 }}><ArrowLeft size={18} color="#222" /></PressScale>
            <Text style={styles.titleTxt} numberOfLines={1}>{DEMO ? `${STORE.name} • ${STORE.eta}` : name}</Text>
            <View style={styles.titleSearch}><SearchGlyph size={17} color="#333" /></View>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, pillA]}>
            <Pressable onPress={search} style={styles.pill}>
              <PressScale onPress={goBack} style={styles.pillBack}><ChevronLeft size={18} color="#555" /></PressScale>
              <Text style={styles.pillTxt} numberOfLines={1}>{DEMO ? STORE.stuckSearch : `Search in ${name}`}</Text>
              <SearchGlyph size={20} color="#555" />
            </Pressable>
          </Animated.View>
        </View>
        <Chips on={filters} onToggle={toggleFilter} top={15} />
        <View style={[styles.rule, { marginHorizontal: PAD }]} />
        {cur && <Text style={styles.stickyLabel} numberOfLines={1}>{cur.title} ({cur.items.length})</Text>}
      </Animated.View>


      {/* MENU fab — rides up with the cart bar */}
      {sections.length > 0 && (
        <Animated.View style={[styles.fabWrap, { bottom: insets.bottom + BAR_BOTTOM + FAB_REST }, fabA]}>
          <PressScale onPress={() => setMenu(true)} style={styles.fab} haptic>
            <MenuBook size={24} />
            <Text style={styles.fabTxt}>{STORE.menuLabel}</Text>
          </PressScale>
        </Animated.View>
      )}

      {menu && (
        <MenuPopover
          sections={sections}
          onPick={jump}
          onClose={() => setMenu(false)}
          bottom={insets.bottom + BAR_BOTTOM + FAB_REST + lift + FAB + 12}
        />
      )}

      <CartBar />
    </View>
  );
}

function SectionBlock({
  sec, open, tile, pairFor, pairPool, pairTitle, onToggle, onClosePair, onSectionY, onRowsY, onRowY,
}: {
  sec: DemoSection; open: boolean; tile: number; pairFor: string | null;
  pairPool: (forId: string) => Product[]; pairTitle: string;
  onToggle: () => void; onClosePair: () => void;
  onSectionY: (y: number) => void; onRowsY: (y: number) => void; onRowY: (ri: number, y: number) => void;
}) {
  const rows: Product[][] = [];
  for (let i = 0; i < sec.items.length; i += 2) rows.push(sec.items.slice(i, i + 2));
  return (
    <View onLayout={(e) => onSectionY(e.nativeEvent.layout.y)}>
      <Pressable onPress={onToggle} style={styles.sectionHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 }}>
          <View style={[styles.iconBox, { width: 22 }]}><Hearts size={13} /></View>
          <VsText text={sec.title} style={DEMO ? styles.sectionTxt : [styles.sectionTxt, styles.upper]} />
        </View>
        <Chevron open={!open} color="#8A8A8A" size={20} />
      </Pressable>
      {open && (
        <View onLayout={(e) => onRowsY(e.nativeEvent.layout.y)} style={{ paddingHorizontal: PAD }}>
          {rows.map((row, ri) => {
            const col = row.findIndex((p) => p.id === pairFor);
            const pool = col >= 0 && pairFor ? pairPool(pairFor) : [];
            return (
              <Fragment key={ri}>
                <View onLayout={(e) => onRowY(ri, e.nativeEvent.layout.y)} style={[styles.dishRow, { minHeight: Math.round(tile * ROW_PITCH) }]}>
                  {row.map((p) => <ProductCard key={p.id} product={p} width={tile} height={Math.round(tile * 0.9)} />)}
                </View>
                {col >= 0 && pool.length > 0 && (
                  <PairPanel key={pairFor} caretX={col * (tile + GAP) + 28} pool={pool} title={pairTitle} onClose={onClosePair} />
                )}
              </Fragment>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** "10% LOWER PRICES vs OTHER APPS": the "vs" stays lower-case and lighter, as in the video. */
function VsText({ text, style }: { text: string; style: object | object[] }) {
  const [a, b] = text.split(' vs ');
  return (
    <Text style={style} numberOfLines={1}>
      {a}{b != null && <Text style={{ fontFamily: F.semi }}> vs </Text>}{b}
    </Text>
  );
}

/** Filter chips: two toggles whose mark slides across, then the two text chips. */
function Chips({ on, onToggle, top = 16 }: { on: Filter[]; onToggle: (f: Filter) => void; top?: number }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { paddingTop: top }]}>
      {!DEMO ? FILTERS.map((f) => (
        <PressScale key={f.id} onPress={() => onToggle(f.id)} style={[styles.chip, on.includes(f.id) && styles.chipOn]}>
          {f.id === 'offer' && <Hearts size={14} still />}
          <Text style={styles.chipTxt}>{f.label}</Text>
        </PressScale>
      )) : <>
      <Toggle on={on.includes('veg')} onPress={() => onToggle('veg')} color="#0B9A2C" mark={<VegMark size={14} />} />
      <Toggle on={on.includes('nonveg')} onPress={() => onToggle('nonveg')} color={NONVEG} mark={<NonVegMark size={14} />} />
      <PressScale onPress={() => onToggle('lower')} style={[styles.chip, on.includes('lower') && styles.chipOn]}>
        <Hearts size={14} still />
        <Text style={styles.chipTxt}>{STORE.chips.lower}</Text>
      </PressScale>
      <PressScale onPress={() => onToggle('rated')} style={[styles.chip, on.includes('rated') && styles.chipOn]}>
        <Text style={styles.chipTxt}>{STORE.chips.ratings}</Text>
      </PressScale>
      </>}
    </ScrollView>
  );
}

function Toggle({ on, onPress, color, mark }: { on: boolean; onPress: () => void; color: string; mark: React.ReactNode }) {
  const x = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    x.value = withSpring(on ? 1 : 0, { damping: 14, stiffness: 220 });
  }, [on]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 22 }] }));
  const track = useAnimatedStyle(() => ({ opacity: 0.35 + x.value * 0.65 }));
  return (
    <PressScale onPress={onPress} style={[styles.chip, { width: 67, paddingHorizontal: 0 }, on && { borderColor: color }]}>
      <View style={styles.toggleBox}>
        <View style={styles.track} />
        <Animated.View style={[styles.track, { backgroundColor: color + '40' }, track, !on && { opacity: 0 }]} />
        <Animated.View style={[styles.knob, knob]}>{mark}</Animated.View>
      </View>
    </PressScale>
  );
}

/** "People usually pair this with": a full-bleed grey band under the row you added from. */
function PairPanel({ caretX, pool, title, onClose }: { caretX: number; pool: Product[]; title: string; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const cols: Product[][] = [];
  for (let i = 0; i < pool.length; i += 2) cols.push(pool.slice(i, i + 2));
  return (
    <Animated.View entering={FadeIn.duration(170)} style={styles.pair}>
      <View style={[styles.caret, { left: PAD + caretX - 7 }]} />
      <Pressable onPress={() => (open ? (setOpen(false), setTimeout(onClose, 320)) : setOpen(true))} style={styles.pairHead}>
        <Text style={styles.pairTitle} numberOfLines={1}>{title}</Text>
        <Chevron open={open} color="#333" size={20} />
      </Pressable>
      <Collapsible open={open}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: PAD, paddingBottom: 16 }}>
          {cols.map((col, ci) => (
            <View key={ci} style={{ gap: 5 }}>
              {col.map((p) => <PairItem key={p.id} p={p} />)}
            </View>
          ))}
        </ScrollView>
      </Collapsible>
    </Animated.View>
  );
}

function PairItem({ p }: { p: Product }) {
  if (!DEMO) return <LivePairItem p={p} />;
  const x = extraOf(p.id);
  const offer = p.offer_price != null && p.offer_price < p.selling_price;
  const rating = x?.rating != null && (
    <View style={styles.ratingPill}><Text style={styles.ratingTxt}>★ {Number.isInteger(x.rating) ? x.rating : x.rating.toFixed(1)}</Text></View>
  );
  return (
    <View style={styles.pairItem}>
      <View style={{ flex: 1, paddingLeft: 9, paddingTop: 16, paddingRight: 6 }}>
        {x?.veg === false ? <NonVegMark size={11} /> : <VegMark size={11} />}
        <Text style={styles.pairName} numberOfLines={2}>{p.name}</Text>
        {offer && <View style={{ flexDirection: 'row', marginTop: 3 }}>{rating}</View>}
        <View style={styles.pairPriceRow}>
          <Text style={styles.pairPrice}>{rupees(offer ? (p.offer_price as number) : p.selling_price)}</Text>
          {offer && <Text style={styles.pairMrp}>{rupees(p.selling_price)}</Text>}
          {!offer && rating}
        </View>
      </View>
      <View style={styles.pairImg}>
        <Text style={{ fontSize: 46 }}>{x?.emoji ?? '🍰'}</Text>
        <View style={{ position: 'absolute', right: 8, bottom: 8 }}>
          <AddButton product={p} big />
        </View>
      </View>
    </View>
  );
}

/** Live pair card: the real photo, LKR effective price, regular price struck only on an active offer. */
function LivePairItem({ p }: { p: Product }) {
  const offer = isOfferActive(p);
  return (
    <View style={styles.pairItem}>
      <View style={{ flex: 1, paddingLeft: 9, paddingTop: 16, paddingRight: 6 }}>
        <Text style={styles.pairName} numberOfLines={2}>{p.name}</Text>
        <View style={styles.pairPriceRow}>
          <Text style={styles.pairPrice}>{formatLkr(effectivePrice(p))}</Text>
          {offer && <Text style={styles.pairMrp}>{formatLkr(p.selling_price)}</Text>}
        </View>
      </View>
      <View style={styles.pairImg}>
        <ProductImage product={p} size={96} radius={0} style={{ backgroundColor: 'transparent' }} />
        <View style={{ position: 'absolute', right: 8, bottom: 8 }}>
          <AddButton product={p} big />
        </View>
      </View>
    </View>
  );
}

function MenuPopover({ sections, onPick, onClose, bottom }: { sections: DemoSection[]; onPick: (id: string) => void; onClose: () => void; bottom: number }) {
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View entering={ZoomIn.springify().mass(1).energyThreshold(1e-4).damping(15)} exiting={ZoomOut.duration(150)} style={[styles.menuCard, { bottom }]}>
        <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
          {sections.map((s, i) => (
            <PressScale key={s.id} onPress={() => onPick(s.id)} style={styles.menuRow}>
              <Text style={[styles.menuTxt, { flex: 1 }, i === 0 && { fontFamily: F.bold }]} numberOfLines={1}>{s.title}</Text>
              <Text style={[styles.menuTxt, i === 0 && { fontFamily: F.bold }]}>{s.items.length}</Text>
            </PressScale>
          ))}
        </ScrollView>
      </Animated.View>
    </Animated.View>
  );
}

/* ---------- glyphs drawn as in the video ---------- */
const ArrowLeft = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M20 12H4.5M11 5l-7 7 7 7" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const ChevronLeft = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M15 4l-8 8 8 8" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const SearchGlyph = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={10.5} cy={10.5} r={7} stroke={color} strokeWidth={1.8} />
    <Path d="M15.8 15.8L21 21" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
const ShareGlyph = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 15V3.5M7.5 8L12 3.5 16.5 8M4.5 14v5.5h15V14" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const NonVegMark = ({ size }: { size: number }) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Rect x={0.75} y={0.75} width={10.5} height={10.5} rx={2} fill="none" stroke={NONVEG} strokeWidth={1.3} />
    <Path d="M6 3.2L8.7 8.3H3.3z" fill={NONVEG} />
  </Svg>
);
/** The fab's menu-card glyph: a tall card with a folded top edge. */
const MenuBook = ({ size }: { size: number }) => (
  <Svg width={size * 0.8} height={size} viewBox="0 0 20 25" fill="none">
    <Path d="M4 5.5L15 3c.8-.2 1.5.4 1.5 1.2V21c0 .7-.5 1.3-1.2 1.4L5.2 23.8C4.5 23.9 4 23.4 4 22.7V5.5z" stroke="#fff" strokeWidth={1.4} strokeLinejoin="round" />
    <Path d="M4 5.5c0-1.2.8-2.2 2-2.5l7.5-1.8" stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
  </Svg>
);

const styles = StyleSheet.create({
  heroArt: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 64, opacity: 0.9, marginBottom: 14 },
  sheet: {
    marginTop: -(HERO_H - SHEET_TOP), backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: PAD, paddingTop: 16, overflow: 'hidden',
  },
  stamp: { position: 'absolute', right: -14, top: -6 },
  name: { fontFamily: F.bold, fontSize: 21, color: '#1C1C1C', lineHeight: 25, marginRight: 120 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 9 },
  star: { color: C.brandDeep, fontSize: 13 },
  meta: { fontFamily: F.regular, fontSize: 13.5, color: '#717171' },
  sep: { width: 1, height: 14, backgroundColor: '#DCDCDC', marginHorizontal: 8 },
  rule: { height: 1, backgroundColor: '#EAEAEA', marginTop: 15 },
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14 },
  iconBox: { width: 29, alignItems: 'center' },
  offer: { fontFamily: F.bold, fontSize: 14.5, color: C.brandText, letterSpacing: -0.1 },
  offerVs: { fontFamily: F.semi, textTransform: 'none' },
  offerSub: { fontFamily: F.regular, fontSize: 13, color: '#8A8A8A', marginTop: 1 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F4F4F6', borderWidth: 1, borderColor: '#ECECEE',
    borderRadius: 22, height: 44, paddingHorizontal: 15, marginTop: 15,
  },
  searchTxt: { fontFamily: F.regular, color: '#6E6E6E', fontSize: 15.5 },
  chips: { gap: 9, paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 0, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: '#E2E2E2',
    borderRadius: 17, paddingHorizontal: 12, height: 34, backgroundColor: '#fff',
  },
  chipOn: { borderColor: C.brandDeep, backgroundColor: C.brand },
  chipTxt: { fontFamily: F.regular, fontSize: 14, color: '#333' },
  toggleBox: { width: 38, height: 16, justifyContent: 'center' },
  track: { position: 'absolute', left: 13, right: 0, height: 8, borderRadius: 4, backgroundColor: '#E6E6E6' },
  knob: { position: 'absolute', left: 0, width: 16, height: 16, borderRadius: 3, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: PAD, height: 52 },
  sectionTxt: { fontFamily: F.bold, color: C.brandText, fontSize: 13.5, flexShrink: 1 },
  dishRow: { flexDirection: 'row', gap: GAP },
  emptyTxt: { fontFamily: F.regular, color: C.sub, fontSize: 13, textAlign: 'center', paddingVertical: 30, paddingHorizontal: 20 },
  floatRow: { position: 'absolute', left: PAD, right: PAD, flexDirection: 'row', justifyContent: 'space-between' },
  round: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(40,40,40,0.55)', alignItems: 'center', justifyContent: 'center' },
  header: {
    position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: '#fff', height: undefined,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  row1: { height: ROW1_H, marginTop: 8, marginHorizontal: PAD },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleTxt: { flex: 1, fontFamily: F.semi, fontSize: 14, color: '#1C1C1C' },
  titleSearch: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F2F2F4', alignItems: 'center', justifyContent: 'center' },
  pill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#F4F4F6', borderWidth: 1, borderColor: '#ECECEE',
    borderRadius: ROW1_H / 2, paddingLeft: 12, paddingRight: 12,
  },
  pillBack: { paddingRight: 8 },
  pillTxt: { flex: 1, fontFamily: F.regular, fontSize: 15.5, color: '#6E6E6E' },
  stickyLabel: { fontFamily: F.semi, fontSize: 13.5, color: '#5A5A5A', paddingHorizontal: PAD, height: 31, lineHeight: 31 },
  fabWrap: { position: 'absolute', right: 23 },
  fab: {
    width: FAB, height: FAB, borderRadius: FAB / 2, backgroundColor: '#0A0A0A', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 6,
  },
  fabTxt: { color: '#fff', fontFamily: F.semi, fontSize: 12, marginTop: 3, letterSpacing: 0.2 },
  pair: { backgroundColor: '#F2F2F4', marginHorizontal: -PAD, marginBottom: 16 },
  caret: {
    position: 'absolute', top: -7, width: 14, height: 14, backgroundColor: '#F2F2F4', transform: [{ rotate: '45deg' }],
  },
  pairHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: PAD, height: 53 },
  pairTitle: { fontFamily: F.medium, fontSize: 16, color: '#2B2B2B' },
  pairItem: { flexDirection: 'row', width: 293, height: 117, backgroundColor: '#fff', borderRadius: 10, overflow: 'hidden' },
  pairName: { fontFamily: F.medium, fontSize: 13.5, color: '#333', marginTop: 5 },
  pairPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  pairPrice: { fontFamily: F.regular, fontSize: 12, color: '#6B6B6B' },
  pairMrp: { fontFamily: F.regular, fontSize: 11.5, color: '#9A9A9A', textDecorationLine: 'line-through' },
  ratingPill: { backgroundColor: C.brandTint, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  ratingTxt: { fontFamily: F.semi, fontSize: 10.5, color: C.brandText },
  pairImg: { width: 107, height: 117, backgroundColor: C.tile, alignItems: 'center', justifyContent: 'center' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  menuCard: { position: 'absolute', right: 23, width: 300, backgroundColor: '#0A0A0A', borderRadius: 18, paddingVertical: 10 },
  menuRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 18, paddingVertical: 11 },
  menuTxt: { color: '#fff', fontFamily: F.medium, fontSize: 14 },
  upper: { textTransform: 'uppercase' },
  missingBack: { margin: PAD, backgroundColor: '#F2F2F4' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 },
  missingBtn: { backgroundColor: C.brand, borderRadius: 14, paddingHorizontal: 26, paddingVertical: 12 },
  missingTxt: { color: C.brandInk, fontFamily: F.bold, fontSize: 15 },
});
