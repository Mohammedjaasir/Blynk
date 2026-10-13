import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation, FadeIn, FadeInDown, FadeOut, interpolate, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler,
  useAnimatedStyle, useSharedValue, withTiming, ZoomIn, ZoomOut,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import type { Category, Product } from '@/blynk/api/types';
import { productsIn, useCatalog, type CatalogData } from '@/blynk/catalog/CatalogContext';
import { categoryOfferActive } from '@/blynk/lib/categories';
import { applyFilters, toggle, type FilterId } from '@/blynk/lib/filters';
import { formatLkr } from '@/blynk/lib/money';
import { effectivePrice, isOfferActive } from '@/blynk/lib/pricing';
import { formatHours, formatOfferEnd, freeDeliveryCount } from '@/blynk/lib/storeText';
import { useStore } from '@/blynk/store/StoreContext';
import { CART_BAR_H, CartBar } from '@/components/CartBar';
import { ClosedBanner } from '@/components/ClosedBanner';
import { BackIcon, BagIcon, SearchIcon, ShareIcon } from '@/components/icons';
import { ProductCard, unitText } from '@/components/ProductCard';
import { ProductImage } from '@/components/ProductImage';
import { AddButton, Chevron, Collapsible, Hearts, PressScale, Skeleton, StampBadge } from '@/components/ui';
import { useCartSelect } from '@/lib/cart';
import { goBack } from '@/lib/nav';
import { C, F } from '@/lib/theme';

const HERO_H = 210;

type Section = { id: string; name: string; items: Product[] };

/** Sub-categories become sections; products sitting directly in the aisle get their own section. */
function sectionsOf(data: CatalogData, cat: Category): Section[] {
  const all = productsIn(data, cat.id);
  const kids = data.categories.filter((k) => k.parent_id === cat.id).sort((a, b) => a.display_order - b.display_order);
  if (!kids.length) return [{ id: cat.id, name: cat.name, items: all }];
  const used = new Set<string>();
  const out: Section[] = kids.map((k) => {
    const items = all.filter((p) => !used.has(p.id) && data.chainOf(p.category_id).includes(k.id));
    items.forEach((p) => used.add(p.id));
    return { id: k.id, name: k.name, items };
  });
  const rest = all.filter((p) => !used.has(p.id));
  if (rest.length) out.unshift({ id: cat.id, name: `More in ${cat.name}`, items: rest });
  return out.filter((s) => s.items.length > 0);
}

/** An aisle (a Blynk category), keyed by its slug. */
export default function AisleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, refresh } = useCatalog();
  const store = useStore();
  const cat = data?.categories.find((c) => c.slug === id || c.id === id) ?? null;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const count = useCartSelect((c) => c.count);
  const qty = useCartSelect((c) => c.qty);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [pairFor, setPairFor] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [darkBar, setDarkBar] = useState(false);
  const [filters, setFilters] = useState<FilterId[]>([]);
  const freeCount = freeDeliveryCount(store);
  const hours = formatHours(store);

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const y = useSharedValue(0);
  const stickAt = useSharedValue(400);
  const stuck = useSharedValue(0);
  const fab = useSharedValue(0);
  const listY = useRef(0);
  const sectionY = useRef<Record<string, number>>({});

  const all = useMemo(() => (data && cat ? productsIn(data, cat.id) : []), [data, cat]);
  const sections = useMemo(() => {
    if (!data || !cat) return [];
    return sectionsOf(data, cat).map((s) => ({ ...s, items: applyFilters(s.items, filters) })).filter((s) => s.items.length > 0);
  }, [data, cat, filters]);
  const heroImg = cat?.image_url ?? all.find((p) => p.image_url)?.image_url ?? null;

  // first time any product in this aisle is added, open the "pair this with" panel under its row
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

  useEffect(() => {
    fab.value = withSpring(count > 0 ? 1 : 0, { damping: 16, stiffness: 170 });
  }, [count > 0]);

  const onScroll = useAnimatedScrollHandler((e) => {
    y.value = e.contentOffset.y;
  });
  useAnimatedReaction(
    () => y.value > stickAt.value,
    (s, p) => {
      if (s === p) return;
      stuck.value = withTiming(s ? 1 : 0, { duration: 200 });
      scheduleOnRN(setDarkBar, s);
    },
  );

  const heroA = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(y.value, [-200, 0, HERO_H], [-100, 0, HERO_H * 0.5], Extrapolation.CLAMP) },
      { scale: interpolate(y.value, [-200, 0], [1.6, 1], Extrapolation.CLAMP) },
    ],
  }));
  const heroArt = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(y.value, [0, HERO_H], [0, -12], Extrapolation.CLAMP)}deg` }],
    opacity: interpolate(y.value, [0, HERO_H * 0.8], [1, 0.2], Extrapolation.CLAMP),
  }));
  const floatBtns = useAnimatedStyle(() => ({ opacity: 1 - stuck.value }));
  const topBar = useAnimatedStyle(() => ({
    opacity: stuck.value,
    transform: [{ translateY: (1 - stuck.value) * -16 }],
  }));
  const fabA = useAnimatedStyle(() => ({ transform: [{ translateY: -fab.value * (CART_BAR_H + 8) }] }));

  const tile = (width - 16 * 2 - 12) / 2;
  const toggleFilter = (f: FilterId) => setFilters((s) => toggle(s, f));
  const search = () => cat && router.push({ pathname: '/search', params: { c: cat.slug, name: cat.name } });
  const share = () => cat && Share.share({ message: `${cat.name} at Blynk, Dharga Town` }).catch(() => {});
  const jump = (sid: string) => {
    setMenu(false);
    setClosed((s) => ({ ...s, [sid]: false }));
    const at = sectionY.current[sid];
    if (at != null) scrollRef.current?.scrollTo({ y: Math.max(0, listY.current + at - insets.top - 110), animated: true });
  };

  if (!data || !cat) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top }}>
        <StatusBar style="dark" />
        <PressScale onPress={goBack} style={[styles.round, { margin: 14, backgroundColor: C.bg }]}><BackIcon size={18} /></PressScale>
        {data ? (
          <View style={styles.missing}>
            <Text style={styles.name}>This aisle isn&apos;t available</Text>
            <PressScale onPress={() => router.replace('/home')} style={styles.missingBtn} haptic><Text style={styles.missingTxt}>Go to shop</Text></PressScale>
          </View>
        ) : error ? (
          <View style={styles.missing}>
            <Text style={[styles.name, { textAlign: 'center' }]}>{error.message}</Text>
            <PressScale onPress={() => void refresh()} style={styles.missingBtn} haptic><Text style={styles.missingTxt}>Try again</Text></PressScale>
          </View>
        ) : (
          <View style={{ padding: 16, gap: 14 }}>
            <Skeleton h={HERO_H - 40} r={18} />
            <Skeleton w="60%" h={20} />
            <View style={{ flexDirection: 'row', gap: 12 }}><Skeleton w={tile} h={tile} r={14} /><Skeleton w={tile} h={tile} r={14} /></View>
          </View>
        )}
      </View>
    );
  }

  const offerOn = categoryOfferActive(cat);
  const total = sections.reduce((a, s) => a + s.items.length, 0);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style={darkBar ? 'dark' : 'light'} />
      <Animated.ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
        <Animated.View style={[{ height: HERO_H + insets.top, overflow: 'hidden' }, heroA]}>
          <LinearGradient colors={[C.pinkTint, C.yellow]} style={[StyleSheet.absoluteFill, styles.heroBg]}>
            <Animated.View entering={ZoomIn.springify().mass(1).energyThreshold(1e-4).damping(10)} style={[{ marginTop: insets.top }, heroArt]}>
              {heroImg ? (
                <View style={styles.heroTile}><Image source={{ uri: heroImg }} resizeMode="contain" style={{ width: 128, height: 128 }} /></View>
              ) : (
                <Text style={{ fontSize: 96 }}>🛒</Text>
              )}
            </Animated.View>
          </LinearGradient>
        </Animated.View>

        <View style={styles.info}>
          {freeCount > 0 && <StampBadge size={70} style={{ position: 'absolute', right: 10, top: 10 }} />}
          <Animated.Text entering={FadeInDown.delay(80)} style={[styles.name, freeCount > 0 && { marginRight: 80 }]}>{cat.name}</Animated.Text>
          <Animated.Text entering={FadeInDown.delay(140)} style={styles.meta}>
            {all.length} item{all.length === 1 ? '' : 's'}{hours ? `   ${hours}` : ''}   Dharga Town
          </Animated.Text>
          {(offerOn || freeCount > 0) && (
            <Animated.View entering={FadeInDown.delay(200)} style={styles.lowerRow}>
              <Hearts size={14} />
              <View style={{ flex: 1 }}>
                <Text style={styles.lower}>{offerOn ? `${cat.offer_percent}% OFF EVERYTHING HERE` : `FREE DELIVERY ON YOUR FIRST ${freeCount} ORDER${freeCount > 1 ? 'S' : ''}`}</Text>
                <Text style={styles.lowerSub}>
                  {offerOn ? (cat.offer_ends_at ? `Offer until ${formatOfferEnd(cat.offer_ends_at)}` : 'Offer prices across this aisle') : (store?.hub_name ?? 'From the Dharga Town store')}
                </Text>
              </View>
            </Animated.View>
          )}
          <ClosedBanner style={{ marginTop: 14 }} />
          <Animated.View entering={FadeInDown.delay(260)}>
            <PressScale onPress={search} scaleTo={0.98} style={styles.search}>
              <SearchIcon size={16} color={C.sub} />
              <Text style={styles.searchTxt}>Search in {cat.name}</Text>
            </PressScale>
          </Animated.View>
        </View>

        <View onLayout={(e) => (stickAt.value = e.nativeEvent.layout.y - insets.top - 52)}>
          <Chips on={filters} onToggle={toggleFilter} />
        </View>

        <View onLayout={(e) => (listY.current = e.nativeEvent.layout.y)}>
          {sections.length === 0 && (
            <Text style={styles.emptyTxt}>{filters.length ? 'Nothing here matches these filters.' : "We're stocking this aisle. Check back shortly."}</Text>
          )}
          {sections.map((sec) => {
            const open = !closed[sec.id];
            const rows: Product[][] = [];
            for (let i = 0; i < sec.items.length; i += 2) rows.push(sec.items.slice(i, i + 2));
            return (
              <View key={sec.id} onLayout={(e) => (sectionY.current[sec.id] = e.nativeEvent.layout.y)}>
                <Pressable onPress={() => setClosed((s) => ({ ...s, [sec.id]: open }))} style={styles.sectionHead}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <Hearts size={11} />
                    <Text style={styles.sectionTxt} numberOfLines={1}>{sec.name} ({sec.items.length})</Text>
                  </View>
                  <Chevron open={open} />
                </Pressable>
                {open && (
                  <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={{ paddingHorizontal: 16 }}>
                    {rows.map((row, ri) => {
                      const pairHere = pairFor && row.some((p) => p.id === pairFor) ? pairFor : null;
                      return (
                        <Fragment key={ri}>
                          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 18 }}>
                            {row.map((p, ci) => (
                              <Animated.View key={p.id} entering={FadeIn.delay(Math.min(ri, 6) * 90 + ci * 50).duration(380)}>
                                <ProductCard product={p} width={tile} index={Math.min(ri * 2 + ci, 8)} />
                              </Animated.View>
                            ))}
                          </View>
                          {pairHere && <PairPanel key={pairHere} forId={pairHere} pool={all} onClose={() => setPairFor(null)} />}
                        </Fragment>
                      );
                    })}
                  </Animated.View>
                )}
              </View>
            );
          })}
        </View>
      </Animated.ScrollView>

      {/* floating round buttons over the hero */}
      <Animated.View pointerEvents="box-none" style={[styles.floatRow, { top: insets.top + 8 }, floatBtns]}>
        <PressScale onPress={goBack} style={styles.round}><BackIcon size={18} /></PressScale>
        <PressScale onPress={share} style={styles.round}><ShareIcon size={16} /></PressScale>
      </Animated.View>

      {/* collapsed top bar + sticky chips */}
      <Animated.View pointerEvents={darkBar ? 'auto' : 'none'} style={[styles.topBar, { paddingTop: insets.top }, topBar]}>
        <View style={styles.topRow}>
          <PressScale onPress={goBack} style={{ padding: 6 }}><BackIcon size={20} /></PressScale>
          <Pressable onPress={search} style={{ flex: 1 }}><Text style={styles.topSearch} numberOfLines={1}>Search in {cat.name}</Text></Pressable>
          <SearchIcon size={19} color={C.ink} />
        </View>
        <Chips on={filters} onToggle={toggleFilter} />
        <Text style={styles.stickyLabel}>{cat.name} ({total})</Text>
      </Animated.View>

      {/* MENU fab — rides up when the cart bar appears */}
      {sections.length > 0 && (
        <Animated.View style={[styles.fabWrap, { bottom: insets.bottom + 20 }, fabA]}>
          <PressScale onPress={() => setMenu(true)} style={styles.fab} haptic>
            <BagIcon size={18} />
            <Text style={styles.fabTxt}>MENU</Text>
          </PressScale>
        </Animated.View>
      )}

      {menu && <MenuPopover sections={sections} onPick={jump} onClose={() => setMenu(false)} bottom={insets.bottom + 90 + (count > 0 ? CART_BAR_H : 0)} />}

      <CartBar />
    </View>
  );
}

function Chips({ on, onToggle }: { on: FilterId[]; onToggle: (f: FilterId) => void }) {
  const under = on.includes('under300');
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      <Toggle on={on.includes('instock')} onPress={() => onToggle('instock')} color={C.green} label="In stock" />
      <Toggle on={on.includes('offer')} onPress={() => onToggle('offer')} color={C.pink} label="On offer" />
      <PressScale onPress={() => onToggle('under300')} style={[styles.chip, under && { borderColor: C.pink, backgroundColor: C.pinkTint }]}>
        <Hearts size={10} />
        <Text style={[styles.chipTxt, under && { color: C.pink }]}>Under LKR 300</Text>
      </PressScale>
    </ScrollView>
  );
}

/** Toggle chip whose knob slides across. */
function Toggle({ on, onPress, color, label }: { on: boolean; onPress: () => void; color: string; label: string }) {
  const x = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    x.value = withSpring(on ? 1 : 0, { damping: 14, stiffness: 220 });
  }, [on]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 16 }] }));
  const track = useAnimatedStyle(() => ({ backgroundColor: on ? color + '33' : '#EEE' }));
  return (
    <PressScale onPress={onPress} style={styles.chip}>
      <Animated.View style={[styles.track, track]}>
        <Animated.View style={[styles.knob, knob]}>
          <View style={[styles.knobDot, { backgroundColor: on ? color : C.faint }]} />
        </Animated.View>
      </Animated.View>
      <Text style={[styles.chipTxt, on && { color }]}>{label}</Text>
    </PressScale>
  );
}

/** "People usually pair this with" — other products from the same aisle; unfurls under the row you just added from. */
function PairPanel({ forId, pool, onClose }: { forId: string; pool: Product[]; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 30);
    return () => clearTimeout(t);
  }, []);
  const picks = pool.filter((p) => p.id !== forId && p.is_available).slice(0, 4);
  if (!picks.length) return null;
  return (
    <View style={styles.pair}>
      <Pressable onPress={() => (open ? (setOpen(false), setTimeout(onClose, 320)) : setOpen(true))} style={styles.pairHead}>
        <Text style={styles.pairTitle}>People usually pair this with</Text>
        <Chevron open={!open} />
      </Pressable>
      <Collapsible open={open}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 12, paddingBottom: 12 }}>
          {[picks.slice(0, 2), picks.slice(2, 4)].filter((col) => col.length).map((col, ci) => (
            <View key={ci} style={{ gap: 10 }}>
              {col.map((p, i) => {
                const offer = isOfferActive(p);
                return (
                  <Animated.View key={p.id} entering={FadeInDown.delay(150 + (ci * 2 + i) * 70)} style={styles.pairItem}>
                    <View style={{ flex: 1, paddingRight: 6 }}>
                      <Text style={styles.pairName} numberOfLines={2}>{p.name}</Text>
                      {!!unitText(p) && <Text style={styles.pairMeta} numberOfLines={1}>{unitText(p)}</Text>}
                      <Text style={styles.pairMeta}>
                        <Text style={offer ? { color: C.pink, fontFamily: F.semi } : undefined}>{formatLkr(effectivePrice(p))}</Text>
                        {offer && <Text style={{ textDecorationLine: 'line-through' }}>  {formatLkr(p.selling_price)}</Text>}
                      </Text>
                    </View>
                    <View style={styles.pairImg}>
                      <ProductImage product={p} size={86} radius={10} />
                      <View style={{ position: 'absolute', right: 4, bottom: 4 }}>
                        <AddButton product={p} compact />
                      </View>
                    </View>
                  </Animated.View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </Collapsible>
    </View>
  );
}

function MenuPopover({ sections, onPick, onClose, bottom }: { sections: Section[]; onPick: (id: string) => void; onClose: () => void; bottom: number }) {
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View entering={ZoomIn.springify().mass(1).energyThreshold(1e-4).damping(15)} exiting={ZoomOut.duration(150)} style={[styles.menuCard, { bottom }]}>
        <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
          {sections.map((s, i) => (
            <Animated.View key={s.id} entering={FadeInDown.delay(60 + Math.min(i, 8) * 40)}>
              <PressScale onPress={() => onPick(s.id)} style={styles.menuRow}>
                <Text style={[styles.menuTxt, { flex: 1 }, i === 0 && { fontFamily: F.bold, color: C.yellow }]} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.menuTxt}>{s.items.length}</Text>
              </PressScale>
            </Animated.View>
          ))}
        </ScrollView>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  heroBg: { alignItems: 'center', justifyContent: 'center' },
  heroTile: { width: 150, height: 150, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' },
  info: {
    marginTop: -22, backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 18,
  },
  name: { fontFamily: F.bold, fontSize: 24, color: C.ink, lineHeight: 28 },
  meta: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 6 },
  lowerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  lower: { fontFamily: F.bold, color: C.pink, fontSize: 13 },
  lowerSub: { fontFamily: F.regular, color: C.sub, fontSize: 11 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderRadius: 14, height: 44, paddingHorizontal: 14, marginTop: 14 },
  searchTxt: { fontFamily: F.regular, color: C.sub, fontSize: 14 },
  chips: { gap: 8, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 10, height: 32, backgroundColor: '#fff' },
  chipTxt: { fontFamily: F.medium, fontSize: 12, color: C.text },
  track: { width: 34, height: 16, borderRadius: 8, justifyContent: 'center' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 2, shadowOpacity: 0.15, shadowRadius: 2 },
  knobDot: { width: 7, height: 7, borderRadius: 4 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  sectionTxt: { fontFamily: F.bold, color: C.pink, fontSize: 12.5, flexShrink: 1 },
  emptyTxt: { fontFamily: F.regular, color: C.sub, fontSize: 13, textAlign: 'center', paddingVertical: 30, paddingHorizontal: 20 },
  floatRow: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between' },
  round: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  topBar: {
    position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 50, gap: 8 },
  topSearch: { fontFamily: F.regular, fontSize: 14, color: C.sub },
  stickyLabel: { fontFamily: F.medium, fontSize: 11, color: C.sub, paddingHorizontal: 16, paddingBottom: 8 },
  fabWrap: { position: 'absolute', right: 16 },
  fab: {
    width: 62, height: 62, borderRadius: 31, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  fabTxt: { color: '#fff', fontFamily: F.bold, fontSize: 9, marginTop: 2 },
  pair: { backgroundColor: C.bg, borderRadius: 16, marginBottom: 18, marginHorizontal: -4 },
  pairHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  pairTitle: { fontFamily: F.semi, fontSize: 15, color: C.ink },
  pairItem: { flexDirection: 'row', width: 230, backgroundColor: '#fff', borderRadius: 12, padding: 8 },
  pairName: { fontFamily: F.medium, fontSize: 12, color: C.ink, marginTop: 4 },
  pairMeta: { fontFamily: F.regular, fontSize: 11, color: C.sub, marginTop: 2 },
  pairImg: { width: 86, height: 86, borderRadius: 10 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  menuCard: { position: 'absolute', right: 16, width: 240, backgroundColor: C.ink, borderRadius: 18, paddingVertical: 10 },
  menuRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingHorizontal: 18, paddingVertical: 10 },
  menuTxt: { color: '#fff', fontFamily: F.medium, fontSize: 14 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 },
  missingBtn: { backgroundColor: C.green, borderRadius: 14, paddingHorizontal: 26, paddingVertical: 12 },
  missingTxt: { color: '#fff', fontFamily: F.bold, fontSize: 15 },
});
