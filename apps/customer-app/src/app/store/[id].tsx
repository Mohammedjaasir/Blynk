import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation, FadeIn, FadeInDown, FadeOut, interpolate, useAnimatedReaction, useAnimatedScrollHandler,
  useAnimatedStyle, useSharedValue, withTiming, ZoomIn, ZoomOut,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { CART_BAR_H, CartBar } from '@/components/CartBar';
import { BackIcon, BagIcon, SearchIcon, ShareIcon, VegMark } from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { AddButton, Chevron, Collapsible, Hearts, PressScale, StampBadge } from '@/components/ui';
import { useCartSelect } from '@/lib/cart';
import { PAIRS, PRODUCTS, STORES } from '@/lib/data';
import { C, F } from '@/lib/theme';

const HERO_H = 210;

export default function StoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = STORES.find((s) => s.id === id) ?? STORES[0];
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const count = useCartSelect((c) => c.count);
  const qty = useCartSelect((c) => c.qty);
  const [open, setOpen] = useState(true);
  const [pairFor, setPairFor] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [darkBar, setDarkBar] = useState(false);

  const y = useSharedValue(0);
  const stickAt = useSharedValue(400);
  const stuck = useSharedValue(0);
  const fab = useSharedValue(0);

  // first time any product in this store is added, open the "pair this with" panel under its row
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const [prevQty, setPrevQty] = useState(qty);
  if (qty !== prevQty) {
    setPrevQty(qty);
    const added = store.products.find((p) => (qty[p] ?? 0) > 0 && !(prevQty[p] ?? 0) && !seen[p]);
    if (added) {
      setSeen((s) => ({ ...s, [added]: true }));
      setPairFor(added);
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
  const heroEmoji = useAnimatedStyle(() => ({
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
  const rows = useMemo(() => {
    const r: string[][] = [];
    for (let i = 0; i < store.products.length; i += 2) r.push(store.products.slice(i, i + 2));
    return r;
  }, [store]);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar style={darkBar ? 'dark' : 'light'} />
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
        <Animated.View style={[{ height: HERO_H + insets.top, overflow: 'hidden' }, heroA]}>
          <LinearGradient colors={store.heroBg} style={[StyleSheet.absoluteFill, styles.heroBg]}>
            <Animated.Text entering={ZoomIn.springify().mass(1).energyThreshold(1e-4).damping(10)} style={[{ fontSize: 120, marginTop: insets.top }, heroEmoji]}>
              {store.hero}
            </Animated.Text>
          </LinearGradient>
        </Animated.View>

        <View style={styles.info}>
          <StampBadge size={70} style={{ position: 'absolute', right: 10, top: 10 }} />
          <Animated.Text entering={FadeInDown.delay(80)} style={styles.name}>{store.name}</Animated.Text>
          <Animated.Text entering={FadeInDown.delay(140)} style={styles.meta}>
            <Text style={{ color: C.green }}>★ </Text>{store.rating}   {store.eta}   {store.area} ▾
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(200)} style={styles.lowerRow}>
            <Hearts size={14} />
            <View>
              <Text style={styles.lower}>{store.lowerBy}% LOWER PRICES vs OTHER APPS</Text>
              <Text style={styles.lowerSub}>Prices seen only on tokri</Text>
            </View>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(260)} style={styles.search}>
            <SearchIcon size={16} color={C.sub} />
            <Text style={styles.searchTxt}>Search for items</Text>
          </Animated.View>
        </View>

        <View onLayout={(e) => (stickAt.value = e.nativeEvent.layout.y - insets.top - 52)}>
          <Chips lowerBy={store.lowerBy} />
        </View>

        <Pressable onPress={() => setOpen((o) => !o)} style={styles.sectionHead}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Hearts size={11} />
            <Text style={styles.sectionTxt}>{store.lowerBy}% LOWER PRICES vs OTHER APPS</Text>
          </View>
          <Chevron open={open} />
        </Pressable>

        {open && (
          <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={{ paddingHorizontal: 16 }}>
            {rows.map((row, ri) => {
              const pairHere = pairFor && row.includes(pairFor) ? pairFor : null;
              return (
                <Fragment key={ri}>
                  <View style={{ flexDirection: 'row', gap: 12, marginBottom: 18 }}>
                    {row.map((pid, ci) => (
                      <Animated.View key={pid} entering={FadeIn.delay(ri * 90 + ci * 50).duration(380)}>
                        <ProductCard id={pid} storeId={store.id} width={tile} index={ri * 2 + ci} />
                      </Animated.View>
                    ))}
                  </View>
                  {pairHere && <PairPanel key={pairHere} forId={pairHere} storeId={store.id} onClose={() => setPairFor(null)} />}
                </Fragment>
              );
            })}
          </Animated.View>
        )}
      </Animated.ScrollView>

      {/* floating round buttons over the hero */}
      <Animated.View pointerEvents="box-none" style={[styles.floatRow, { top: insets.top + 8 }, floatBtns]}>
        <PressScale onPress={() => router.back()} style={styles.round}><BackIcon size={18} /></PressScale>
        <PressScale style={styles.round}><ShareIcon size={16} /></PressScale>
      </Animated.View>

      {/* collapsed top bar + sticky chips */}
      <Animated.View pointerEvents={darkBar ? 'auto' : 'none'} style={[styles.topBar, { paddingTop: insets.top }, topBar]}>
        <View style={styles.topRow}>
          <PressScale onPress={() => router.back()} style={{ padding: 6 }}><BackIcon size={20} /></PressScale>
          <Text style={styles.topSearch} numberOfLines={1}>Search in {store.name}</Text>
          <SearchIcon size={19} color={C.ink} />
        </View>
        <Chips lowerBy={store.lowerBy} />
        <Text style={styles.stickyLabel}>{store.lowerBy}% LOWER PRICES vs OTHER APPS ({store.products.length})</Text>
      </Animated.View>

      {/* MENU fab — rides up when the cart bar appears */}
      <Animated.View style={[styles.fabWrap, { bottom: insets.bottom + 20 }, fabA]}>
        <PressScale onPress={() => setMenu(true)} style={styles.fab} haptic>
          <BagIcon size={18} />
          <Text style={styles.fabTxt}>MENU</Text>
        </PressScale>
      </Animated.View>

      {menu && <MenuPopover onClose={() => setMenu(false)} bottom={insets.bottom + 90 + (count > 0 ? CART_BAR_H : 0)} />}

      <CartBar />
    </View>
  );
}

function Chips({ lowerBy }: { lowerBy: number }) {
  const [org, setOrg] = useState(false);
  const [fresh, setFresh] = useState(false);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      <Toggle on={org} onPress={() => setOrg((v) => !v)} color={C.green} />
      <Toggle on={fresh} onPress={() => setFresh((v) => !v)} color="#C0392B" />
      <View style={styles.chip}><Hearts size={10} /><Text style={styles.chipTxt}>{lowerBy}% lower prices</Text></View>
      <View style={styles.chip}><Text style={styles.chipTxt}>Ratings 4.0+</Text></View>
      <View style={styles.chip}><Text style={styles.chipTxt}>Bestsellers</Text></View>
    </ScrollView>
  );
}

/** Veg/non-veg style toggle chip whose knob slides across. */
function Toggle({ on, onPress, color }: { on: boolean; onPress: () => void; color: string }) {
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
          <VegMark color={color} size={12} />
        </Animated.View>
      </Animated.View>
    </PressScale>
  );
}

/** "People usually pair this with" — unfurls under the row you just added from. */
function PairPanel({ forId, storeId, onClose }: { forId: string; storeId: string; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 30);
    return () => clearTimeout(t);
  }, []);
  const ids = (PAIRS[forId] ?? PAIRS.default).filter((p) => p !== forId);
  return (
    <View style={styles.pair}>
      <Pressable onPress={() => (open ? (setOpen(false), setTimeout(onClose, 320)) : setOpen(true))} style={styles.pairHead}>
        <Text style={styles.pairTitle}>People usually pair this with</Text>
        <Chevron open={!open} />
      </Pressable>
      <Collapsible open={open}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 12, paddingBottom: 12 }}>
          {[ids.slice(0, 2), ids.slice(2, 4)].map((col, ci) => (
            <View key={ci} style={{ gap: 10 }}>
              {col.map((pid, i) => {
                const p = PRODUCTS[pid];
                return (
                  <Animated.View key={pid} entering={FadeInDown.delay(150 + (ci * 2 + i) * 70)} style={styles.pairItem}>
                    <View style={{ flex: 1, paddingRight: 6 }}>
                      <VegMark color={p.organic ? C.green : '#C0392B'} size={10} />
                      <Text style={styles.pairName} numberOfLines={2}>{p.name}</Text>
                      <Text style={styles.pairMeta}><Text style={{ color: C.green }}>★</Text> {p.rating}</Text>
                      <Text style={styles.pairMeta}>₹{p.price}  <Text style={{ textDecorationLine: 'line-through' }}>₹{p.mrp}</Text></Text>
                    </View>
                    <View style={[styles.pairImg, { backgroundColor: p.bg }]}>
                      <Text style={{ fontSize: 38 }}>{p.emoji}</Text>
                      <View style={{ position: 'absolute', right: 4, bottom: 4 }}>
                        <AddButton id={pid} storeId={storeId} compact />
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

function MenuPopover({ onClose, bottom }: { onClose: () => void; bottom: number }) {
  const sections = [['Top picks', 10], ['Fruits & Veggies', 6], ['Dairy & Eggs', 4], ['Bakery', 4], ['Snacks', 3], ['Staples', 3]] as const;
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(160)} style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View entering={ZoomIn.springify().mass(1).energyThreshold(1e-4).damping(15)} exiting={ZoomOut.duration(150)} style={[styles.menuCard, { bottom }]}>
        {sections.map(([n, c], i) => (
          <Animated.View key={n} entering={FadeInDown.delay(60 + i * 40)}>
            <PressScale onPress={onClose} style={styles.menuRow}>
              <Text style={[styles.menuTxt, i === 0 && { fontFamily: F.bold, color: C.pink }]}>{n}</Text>
              <Text style={styles.menuTxt}>{c}</Text>
            </PressScale>
          </Animated.View>
        ))}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  heroBg: { alignItems: 'center', justifyContent: 'center' },
  info: {
    marginTop: -22, backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 18,
  },
  name: { fontFamily: F.bold, fontSize: 24, color: C.ink, marginRight: 80, lineHeight: 28 },
  meta: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 6 },
  lowerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  lower: { fontFamily: F.bold, color: C.pink, fontSize: 13 },
  lowerSub: { fontFamily: F.regular, color: C.sub, fontSize: 11 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderRadius: 14, height: 44, paddingHorizontal: 14, marginTop: 14 },
  searchTxt: { fontFamily: F.regular, color: C.sub, fontSize: 14 },
  chips: { gap: 8, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 10, height: 32, backgroundColor: '#fff' },
  chipTxt: { fontFamily: F.medium, fontSize: 12, color: C.text },
  track: { width: 34, height: 16, borderRadius: 8, justifyContent: 'center' },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 2, shadowOpacity: 0.15, shadowRadius: 2 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  sectionTxt: { fontFamily: F.bold, color: C.pink, fontSize: 12.5 },
  floatRow: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between' },
  round: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  topBar: {
    position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 50, gap: 8 },
  topSearch: { flex: 1, fontFamily: F.regular, fontSize: 14, color: C.sub },
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
  pairImg: { width: 86, height: 86, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  menuCard: { position: 'absolute', right: 16, width: 240, backgroundColor: C.ink, borderRadius: 18, paddingVertical: 10 },
  menuRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 10 },
  menuTxt: { color: '#fff', fontFamily: F.medium, fontSize: 14 },
});
