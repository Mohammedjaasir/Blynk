import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withDecay, withDelay, withSequence,
  withTiming, ZoomOut,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { BackIcon, PinIcon, SearchIcon } from '@/components/icons';
import { PressScale, Pulse, Skeleton, tap, Tooltip } from '@/components/ui';
import { cartActions } from '@/lib/cart';
import { C, F } from '@/lib/theme';

const MAP = 1400;
const PLACES = [
  { name: 'Vaiyapuri Nagar', line: 'Vaiyapuri Nagar, Kurumbapalayam, Tamil Nadu, India' },
  { name: 'SNS College Road', line: 'SNS College Rd, Kurumbapalayam, Coimbatore, Tamil Nadu' },
  { name: 'Nandhi Temple Street', line: 'Nandhi Temple St, Saravanampatti, Coimbatore' },
  { name: 'Lakeview Residency', line: 'Lakeview Residency, Kalapatti, Coimbatore, Tamil Nadu' },
  { name: 'Mill Road', line: 'Mill Rd, Ganapathy, Coimbatore, Tamil Nadu' },
];

export default function Address() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { setAddress } = cartActions;
  const [place, setPlace] = useState<(typeof PLACES)[number] | null>(null);
  const [tip, setTip] = useState(true);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const lift = useSharedValue(0);
  const drop = useSharedValue(-260);
  const tiles = useSharedValue(0);

  const lookup = () =>
    setTimeout(() => {
      const i = Math.abs(Math.round(tx.get() / 90) * 3 + Math.round(ty.get() / 90)) % PLACES.length;
      setPlace(PLACES[i]);
    }, 650);
  const resolve = () => {
    setPlace(null);
    lookup();
  };

  useEffect(() => {
    tiles.value = withDelay(350, withTiming(1, { duration: 500 }));
    drop.value = withDelay(450, withSpring(0, { damping: 9, stiffness: 140 }));
    const t = lookup();
    return () => clearTimeout(t);
  }, []);

  const limit = (MAP - width) / 2;
  const pan = Gesture.Pan()
    .onStart(() => {
      sx.set(tx.get());
      sy.set(ty.get());
      lift.set(withSpring(1, { damping: 14, stiffness: 260 }));
      scheduleOnRN(setPlace, null);
    })
    .onUpdate((e) => {
      tx.set(Math.max(-limit, Math.min(limit, sx.get() + e.translationX)));
      ty.set(Math.max(-limit, Math.min(limit, sy.get() + e.translationY)));
    })
    .onEnd((e) => {
      tx.set(withDecay({ velocity: e.velocityX, clamp: [-limit, limit], deceleration: 0.992 }));
      ty.set(withDecay({ velocity: e.velocityY, clamp: [-limit, limit], deceleration: 0.992 }));
      lift.set(withSequence(withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) }), withSpring(0)));
      scheduleOnRN(resolve);
      scheduleOnRN(setTip, false);
    });

  const mapA = useAnimatedStyle(() => ({ opacity: tiles.value, transform: [{ translateX: tx.value }, { translateY: ty.value }] }));
  const pinA = useAnimatedStyle(() => ({ transform: [{ translateY: drop.value - lift.value * 18 }, { scale: 1 + lift.value * 0.08 }] }));
  const shadowA = useAnimatedStyle(() => ({ opacity: 0.25 - lift.value * 0.12, transform: [{ scaleX: 1 - lift.value * 0.4 }] }));

  const recenter = () => {
    tap();
    tx.set(withSpring(0, { damping: 18 }));
    ty.set(withSpring(0, { damping: 18 }));
    lift.set(withSequence(withTiming(1, { duration: 150 }), withTiming(0, { duration: 250 })));
    resolve();
  };

  const confirm = () => {
    if (!place) return;
    setAddress({ title: 'Home', line: place.line });
    router.back();
  };

  const cx = width / 2;
  const cy = height * 0.42;

  return (
    <View style={{ flex: 1, backgroundColor: '#EEF0F3' }}>
      <StatusBar style="dark" />
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill}>
          <Animated.View style={[{ position: 'absolute', left: cx - MAP / 2, top: cy - MAP / 2, width: MAP, height: MAP }, mapA]}>
            <FakeMap />
            {/* you-are-here dot at map centre */}
            <View style={{ position: 'absolute', left: MAP / 2 - 30, top: MAP / 2 - 30, width: 60, height: 60, alignItems: 'center', justifyContent: 'center' }}>
              <Pulse size={60} color="#3B82F6" />
              <View style={styles.meDot} />
            </View>
          </Animated.View>
        </View>
      </GestureDetector>

      {/* centre pin */}
      <View pointerEvents="box-none" style={[styles.pinWrap, { left: cx - 140, top: cy - 100 }]}>
        {tip && (
          <Animated.View exiting={ZoomOut.duration(150)}>
            <Tooltip text="Move the pin to change location" onClose={() => setTip(false)} />
          </Animated.View>
        )}
        <Animated.View style={pinA}>
          <PinIcon size={36} color={C.green} />
        </Animated.View>
        <Animated.View style={[styles.pinShadow, shadowA]} />
      </View>

      {/* search */}
      <View style={[styles.search, { top: insets.top + 8 }]}>
        <PressScale onPress={() => router.back()} style={{ padding: 4 }}><BackIcon size={20} /></PressScale>
        <Text style={styles.searchTxt}>Search an area or address</Text>
        <SearchIcon size={18} color={C.sub} />
      </View>

      {/* bottom card */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        <PressScale onPress={recenter} style={styles.current}>
          <View style={styles.currentDot} />
          <Text style={styles.currentTxt}>Current location</Text>
        </PressScale>
        <View style={styles.card}>
          <Text style={styles.cardHint}>{place ? 'Place the pin at exact delivery location' : 'Order will be delivered here'}</Text>
          {place ? (
            <Animated.View key={place.name} entering={FadeIn.duration(250)}>
              <Text style={styles.placeName}>📍 {place.name}</Text>
              <Text style={styles.placeLine}>{place.line}</Text>
            </Animated.View>
          ) : (
            <View style={{ gap: 8, marginTop: 8 }}>
              <Skeleton h={14} w="70%" />
              <Skeleton h={10} w="90%" />
            </View>
          )}
          {place && (
            <Animated.View entering={FadeInDown.springify().mass(1).energyThreshold(1e-4).damping(15)}>
              <PressScale onPress={confirm} style={styles.cta} haptic>
                <Text style={styles.ctaTxt}>Confirm & proceed</Text>
              </PressScale>
            </Animated.View>
          )}
        </View>
      </View>
    </View>
  );
}

/** Hand-drawn street map: blocks, roads, a park, a lake and a few labels. */
function FakeMap() {
  const roads = [
    'M0 420 L1400 380', 'M0 760 L1400 820', 'M0 1080 L1400 1040', 'M300 0 L340 1400', 'M690 0 L710 1400',
    'M1040 0 L1000 1400', 'M0 200 C400 260 900 120 1400 220', 'M120 1400 C300 1000 520 900 700 700',
  ];
  return (
    <Svg width={MAP} height={MAP}>
      <Rect width={MAP} height={MAP} fill="#EEF0F3" />
      {Array.from({ length: 64 }, (_, i) => {
        const x = (i % 8) * 175 + 20;
        const y = Math.floor(i / 8) * 175 + 20;
        return <Rect key={i} x={x} y={y} width={135} height={135} rx={10} fill={i % 7 === 0 ? '#E3EADF' : '#F6F7F9'} />;
      })}
      <Rect x={820} y={480} width={170} height={230} rx={24} fill="#CDEBC9" />
      <Path d="M140 880 C220 820 330 860 330 960 C330 1060 180 1080 130 1000 C90 950 100 910 140 880 Z" fill="#BFDDF5" />
      <G stroke="#FFFFFF" strokeLinecap="round" fill="none">
        {roads.map((d, i) => <Path key={i} d={d} strokeWidth={i < 6 ? 22 : 16} />)}
      </G>
      <G stroke="#FFE7A8" strokeLinecap="round" fill="none">
        <Path d={roads[1]} strokeWidth={8} />
        <Path d={roads[4]} strokeWidth={8} />
      </G>
      {[
        ['SNS College of Nursing', 470, 560], ['Vaiyapuri Nagar', 560, 660], ['Nandhi Temple', 150, 820],
        ['Lakeview Residency', 860, 470], ['Annai Mess', 380, 900], ['SNS Spine', 1080, 320], ['Green Park', 835, 600],
      ].map(([t, x, y]) => (
        <G key={t as string}>
          <Circle cx={(x as number) - 10} cy={(y as number) - 4} r={5} fill="#9AA3AE" />
          <SvgText x={x as number} y={y as number} fontSize={15} fill="#6B7380">{t as string}</SvgText>
        </G>
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  meDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#3B82F6', borderWidth: 3, borderColor: '#fff' },
  pinWrap: { position: 'absolute', width: 280, alignItems: 'center' },
  pinShadow: { width: 18, height: 6, borderRadius: 9, backgroundColor: '#000', marginTop: -3 },
  search: {
    position: 'absolute', left: 12, right: 12, height: 48, backgroundColor: '#fff', borderRadius: 14, flexDirection: 'row',
    alignItems: 'center', paddingHorizontal: 10, gap: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
  },
  searchTxt: { flex: 1, fontFamily: F.regular, color: C.sub, fontSize: 14 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12 },
  current: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 8, marginBottom: 12, borderWidth: 1, borderColor: C.greenSoft, elevation: 3, shadowOpacity: 0.1, shadowRadius: 4,
  },
  currentDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, borderColor: C.green },
  currentTxt: { fontFamily: F.medium, fontSize: 12.5, color: C.greenDark },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 16, elevation: 8, shadowOpacity: 0.12, shadowRadius: 12 },
  cardHint: { fontFamily: F.regular, fontSize: 12, color: C.sub },
  placeName: { fontFamily: F.bold, fontSize: 17, color: C.ink, marginTop: 8 },
  placeLine: { fontFamily: F.regular, fontSize: 12.5, color: C.sub, marginTop: 4 },
  cta: { height: 50, borderRadius: 14, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  ctaTxt: { color: '#fff', fontFamily: F.bold, fontSize: 16 },
});
