import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, FadeIn, LinearTransition, useAnimatedStyle, useSharedValue, withDecay, withDelay, withSequence, withTiming,
  ZoomOut,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { G, Path, Rect } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { LiveAddressScreen } from '@/blynk/address/LiveAddressScreen';
import { Pin, SmallPin, TargetIcon } from '@/blynk/address/pins';
import { BackIcon, CloseIcon, SearchIcon } from '@/components/icons';
import { PressScale, Skeleton, tap } from '@/components/ui';
import { ADDRESS as DEMO_ADDRESS } from '@/demo/cart';
import { LIVE } from '@/demo/cartLive';
import { DEMO } from '@/demo/mode';
import { withSpring } from '@/lib/motion';
import { cartActions } from '@/lib/cart';
import { C, F } from '@/lib/theme';

const MAP = 1400;
/** Pin head centre, from the video: x = centre + 6, y = top inset + 346. */
const PIN_DX = 6;
const PIN_Y = 346;
const RESOLVE_MS = 1270;
const TILES_MS = 1900;
const HINT_MS = 600;
const CURRENT_MS = 420;

/*
 * Address map, read off the reference (video 1:12–1:19). Nothing is looked up or sent:
 * the map is a drawing styled like the video's (beige until the "tiles" fade in) with the
 * video's own labels, and the place card shows the video's mock address. Confirming keeps
 * that mock address on this device only.
 *
 * Live mode (DEMO=false) is an honest preview: the same drawing and motion, but no place names,
 * no you-are-here dot (no location is read) and copy that says it is not a real map. Confirming
 * keeps a "pin preview" address on this device only; nothing is looked up or sent.
 */
const ADDRESS = DEMO ? DEMO_ADDRESS : { ...DEMO_ADDRESS, ...LIVE.address, labels: [] as typeof DEMO_ADDRESS.labels };

/**
 * Live (EXPO_PUBLIC_DEMO=0): the real picker, a MapLibre map with a fixed centre pin, then the
 * address form (src/blynk/address/LiveAddressScreen.tsx). The design mock keeps the drawing below.
 * Params: return (in-app path to go back to), lat/lng (a GPS fix to start at), id (edit), gps=off.
 */
export default function Address() {
  return DEMO ? <DemoAddress /> : <LiveAddressScreen />;
}

function DemoAddress() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [placed, setPlaced] = useState(false);
  const [hint, setHint] = useState(false);
  const [current, setCurrent] = useState(false);
  const [tip, setTip] = useState(true);
  // a pending "look-up": the card resolves `ms` after it is set (0 = pin is moving)
  const [lookup, setLookup] = useState({ at: 0, ms: RESOLVE_MS });

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const lift = useSharedValue(0);
  const tiles = useSharedValue(0);
  const me = useSharedValue(0);

  const resolve = (ms: number) => setLookup((l) => ({ at: l.at + 1, ms }));
  const unresolve = () => {
    setPlaced(false);
    setHint(false);
    setLookup((l) => ({ at: l.at + 1, ms: 0 }));
  };

  useEffect(() => {
    if (!lookup.ms) return;
    const a = setTimeout(() => setPlaced(true), lookup.ms);
    const b = setTimeout(() => setHint(true), lookup.ms + HINT_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [lookup]);

  useEffect(() => {
    const a = setTimeout(() => setCurrent(true), CURRENT_MS);
    const b = setTimeout(() => { me.value = withTiming(1, { duration: 160 }); }, RESOLVE_MS - 60);
    tiles.value = withDelay(TILES_MS, withTiming(1, { duration: 300 }));
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);

  const limit = (MAP - width) / 2;
  const pan = Gesture.Pan()
    .onStart(() => {
      sx.set(tx.get());
      sy.set(ty.get());
      lift.set(withSpring(1, { damping: 14, stiffness: 260 }));
      scheduleOnRN(unresolve);
      scheduleOnRN(setTip, false);
    })
    .onUpdate((e) => {
      tx.set(Math.max(-limit, Math.min(limit, sx.get() + e.translationX)));
      ty.set(Math.max(-limit, Math.min(limit, sy.get() + e.translationY)));
    })
    .onEnd((e) => {
      tx.set(withDecay({ velocity: e.velocityX, clamp: [-limit, limit], deceleration: 0.992 }));
      ty.set(withDecay({ velocity: e.velocityY, clamp: [-limit, limit], deceleration: 0.992 }));
      lift.set(withSequence(withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) }), withSpring(0)));
      scheduleOnRN(resolve, 650);
    });

  const recenter = () => {
    tap();
    tx.set(withSpring(0, { damping: 18 }));
    ty.set(withSpring(0, { damping: 18 }));
    unresolve();
    resolve(650);
  };

  const confirm = () => {
    if (!placed) return;
    cartActions.setAddress(DEMO ? { title: ADDRESS.name, line: ADDRESS.line } : LIVE.address.saved);
    router.back();
  };

  const cx = width / 2 + PIN_DX;
  const cy = insets.top + PIN_Y;
  const mapA = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }] }));
  const tilesA = useAnimatedStyle(() => ({ opacity: tiles.value }));
  const meA = useAnimatedStyle(() => ({ opacity: me.value, transform: [{ scale: 0.6 + me.value * 0.4 }] }));
  const pinA = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value * 16 }] }));

  return (
    <Animated.View entering={FadeIn.duration(110)} style={{ flex: 1, backgroundColor: '#EFEBE3' }}>
      <StatusBar style="dark" />
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[{ position: 'absolute', left: cx - MAP / 2, top: cy - MAP / 2, width: MAP, height: MAP }, mapA]}>
            <Animated.View style={[StyleSheet.absoluteFill, tilesA]}>
              <MapDrawing />
              {ADDRESS.labels.map((l) => (
                <View key={l.t} pointerEvents="none" style={StyleSheet.absoluteFill}>
                  {l.icon && <View style={[styles.poi, { left: MAP / 2 + l.icon[0] - 7, top: MAP / 2 + l.icon[1] - 7 }]} />}
                  <Text style={[styles.mapLabel, l.small && styles.mapLabelSmall, { left: MAP / 2 + l.dx, top: MAP / 2 + l.dy }]}>{l.t}</Text>
                </View>
              ))}
            </Animated.View>
            {/* you-are-here dot, just under the pin's tail (live mode reads no location, so none) */}
            {DEMO && <Animated.View style={[styles.me, { left: MAP / 2 - 19, top: MAP / 2 + 35 - 19 }, meA]}>
              <View style={styles.meDot} />
            </Animated.View>}
          </Animated.View>
        </View>
      </GestureDetector>

      {/* centre pin + tooltip */}
      <View pointerEvents="box-none" style={[styles.pinWrap, { left: cx - 140, top: cy - 70 }]}>
        {tip ? (
          <Animated.View exiting={ZoomOut.duration(150)} style={{ alignItems: 'center' }}>
            <View style={styles.tip}>
              <Text style={styles.tipTxt}>{ADDRESS.tip}</Text>
              <Pressable hitSlop={10} onPress={() => setTip(false)} style={styles.tipX}><CloseIcon size={8} color="#fff" stroke={3} /></Pressable>
            </View>
            <View style={styles.tipArrow} />
          </Animated.View>
        ) : (
          <View style={{ height: 45 }} />
        )}
        <Animated.View style={[{ marginTop: 8 }, pinA]}>
          <Pin />
        </Animated.View>
      </View>

      {/* back + search */}
      <View style={[styles.top, { top: insets.top + 24 }]}>
        <PressScale onPress={() => router.back()} style={styles.backBtn}><BackIcon size={19} color="#111" stroke={2} /></PressScale>
        <View style={styles.search}>
          <Text style={styles.searchTxt}>{ADDRESS.search}</Text>
          <SearchIcon size={19} color="#444" stroke={1.8} />
        </View>
      </View>

      {/* bottom: current location pill + place card */}
      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 0) + 38 }]} pointerEvents="box-none">
        {current && (
          <Animated.View entering={FadeIn.duration(200)} layout={LinearTransition.duration(140)} style={{ alignSelf: 'center' }}>
            <PressScale onPress={recenter} style={styles.current}>
              <TargetIcon />
              <Text style={styles.currentTxt}>{ADDRESS.current}</Text>
            </PressScale>
          </Animated.View>
        )}
        <Animated.View layout={LinearTransition.duration(140)} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardHint}>{hint ? ADDRESS.placedHint : ADDRESS.loadingHint}</Text>
          </View>
          {placed ? (
            <Animated.View key="placed" entering={FadeIn.duration(140)} style={{ paddingHorizontal: 15, paddingTop: 15 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <SmallPin />
                <Text style={styles.placeName}>{ADDRESS.name}</Text>
              </View>
              <Text style={styles.placeLine}>{ADDRESS.line}</Text>
              <Animated.View entering={FadeIn.duration(180)}>
                <PressScale onPress={confirm} style={styles.cta} haptic scaleTo={0.96}>
                  <Text style={styles.ctaTxt}>{ADDRESS.cta}</Text>
                </PressScale>
              </Animated.View>
            </Animated.View>
          ) : (
            <View key="loading" style={{ paddingHorizontal: 15, paddingTop: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <SmallPin />
                <Skeleton h={22} r={6} style={{ flex: 1 }} />
              </View>
              <Skeleton h={22} r={6} style={{ marginTop: 8 }} />
            </View>
          )}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/** Street drawing in the video map's light style: grey ground, pale building blocks, white roads. */
function MapDrawing() {
  const o = MAP / 2;
  // road centre lines relative to the pin head centre (video 1:14 frame), extended past the screen
  const roads = [
    `M${o - 700} ${o - 210} L${o + 700} ${o - 205}`,
    `M${o - 40} ${o - 100} C${o + 60} ${o - 108} ${o + 200} ${o - 105} ${o + 700} ${o - 110}`,
    `M${o + 50} ${o - 160} L${o + 50} ${o - 100}`,
    `M${o + 124} ${o - 130} L${o + 120} ${o + 240}`,
    `M${o - 700} ${o + 172} L${o + 700} ${o + 178}`,
    `M${o - 68} ${o + 12} L${o - 68} ${o + 175}`,
    `M${o - 168} ${o - 60} L${o - 172} ${o + 700}`,
    `M${o + 50} ${o - 100} C${o + 52} ${o + 20} ${o + 60} ${o + 120} ${o + 64} ${o + 700}`,
    `M${o - 700} ${o + 20} L${o - 68} ${o + 12}`,
    `M${o - 40} ${o - 700} L${o - 40} ${o - 100}`,
  ];
  const blocks: [number, number, number, number][] = [
    [-198, -180, 60, 50], [-120, -185, 46, 30], [-60, -150, 70, 40], [70, -190, 40, 60], [150, -95, 60, 45],
    [-150, -40, 50, 40], [-60, -60, 40, 34], [80, -40, 26, 50], [140, -20, 40, 40], [150, 40, 50, 60],
    [-150, 40, 60, 40], [-50, 40, 40, 50], [70, 70, 30, 60], [-150, 110, 70, 46], [-40, 120, 60, 40],
    [140, 120, 40, 40], [-198, 210, 60, 50], [-100, 220, 80, 40], [70, 210, 60, 70], [150, 220, 50, 40],
    [-30, 280, 70, 50], [100, 300, 60, 40], [-190, -260, 50, 40], [40, -260, 50, 40],
  ];
  return (
    <Svg width={MAP} height={MAP}>
      <Rect width={MAP} height={MAP} fill="#FBFBFB" />
      {blocks.map(([x, y, w, h], i) => <Rect key={i} x={o + x} y={o + y} width={w} height={h} rx={2} fill="#F7F7F5" stroke="#EFEFF1" strokeWidth={1} />)}
      <G fill="none" strokeLinecap="round">
        {roads.map((d, i) => <Path key={i} d={d} stroke="#E9EAF1" strokeWidth={i < 2 || i === 4 ? 13 : 9} />)}
      </G>
    </Svg>
  );
}

const styles = StyleSheet.create({
  pinWrap: { position: 'absolute', width: 280, alignItems: 'center' },
  tip: { height: 37, borderRadius: 10, backgroundColor: '#0B0B0D', flexDirection: 'row', alignItems: 'center', paddingLeft: 11, paddingRight: 10, gap: 10 },
  tipTxt: { color: '#fff', fontFamily: F.medium, fontSize: 12.5, letterSpacing: -0.1 },
  tipX: { width: 15, height: 15, borderRadius: 8, backgroundColor: '#2C2C30', alignItems: 'center', justifyContent: 'center' },
  tipArrow: {
    width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#0B0B0D',
  },
  me: { position: 'absolute', width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(66,133,244,0.35)', alignItems: 'center', justifyContent: 'center' },
  meDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2F7BEA' },
  poi: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#C5C7CC', borderWidth: 2.5, borderColor: '#FBFBFB' },
  mapLabel: { position: 'absolute', fontFamily: F.regular, fontSize: 12.5, color: '#74777C', lineHeight: 16 },
  mapLabelSmall: { fontSize: 11, lineHeight: 14 },
  top: { position: 'absolute', left: 17, right: 15, flexDirection: 'row', alignItems: 'center', gap: 13 },
  backBtn: {
    width: 31, height: 31, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#E6E6E9',
  },
  search: {
    flex: 1, height: 36, borderRadius: 18, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center',
    paddingLeft: 14, paddingRight: 13, borderWidth: 1, borderColor: '#E3E3E6',
  },
  searchTxt: { flex: 1, fontFamily: F.regular, color: '#6E6E76', fontSize: 13.5 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 15 },
  current: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 20, height: 39,
    paddingHorizontal: 13, marginBottom: 13, borderWidth: 1, borderColor: '#E3E3E6',
  },
  currentTxt: { fontFamily: F.medium, fontSize: 12.5, color: '#333' },
  card: {
    backgroundColor: '#fff', borderRadius: 16, paddingBottom: 15, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 6,
  },
  cardHead: { height: 32, backgroundColor: '#F4F4F6', justifyContent: 'center', paddingHorizontal: 17 },
  cardHint: { fontFamily: F.regular, fontSize: 12.5, color: '#55555C' },
  placeName: { fontFamily: F.semi, fontSize: 16.5, color: '#111' },
  placeLine: { fontFamily: F.regular, fontSize: 13, color: '#55555C', marginTop: 7, lineHeight: 17, paddingRight: 6 },
  cta: { height: 50, borderRadius: 25, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', marginTop: 13 },
  ctaTxt: { color: C.brandInk, fontFamily: F.semi, fontSize: 16 },
});
