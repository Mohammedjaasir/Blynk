import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeIn, FadeOut, interpolate, SlideInDown, SlideOutDown, useAnimatedStyle, useSharedValue, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { formatLkr } from '@/blynk/lib/money';
import { useFreeDeliveryUnlocked } from '@/blynk/store/freeDelivery';
import { DEMO } from '@/demo/mode';
import { rupees } from '@/demo/money';
import { STORE } from '@/demo/store';
import { withSpring } from '@/lib/motion';
import { useCartSelect } from '@/lib/cart';
import { useBottomInset } from '@/lib/tabs';
import { C, F } from '@/lib/theme';
import { Confetti, PressScale, RollingText } from './ui';

/**
 * Bar geometry, measured off the reference (0:32–0:41): a 52 pt pill (radius 26) floating
 * 10 pt above the bottom inset; when free delivery unlocks a 30 pt strip unfurls on top and
 * the row tightens to 37 pt, 67 pt in all.
 */
export const CART_BAR = { h: 52, bottom: 10, radius: 26, stripH: 30, withStripH: 67 } as const;
/** @deprecated legacy: the visible height is `CART_BAR_H - 8`; use CART_BAR.h. */
export const CART_BAR_H = CART_BAR.h + 8;

const ROW_STRIP = CART_BAR.withStripH - CART_BAR.stripH; // 37

/** Filled trolley, as on the reference's "View Cart". */
function TrolleyIcon({ size = 18, color = C.brandInk }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M1.5 3h3l.6 2.4H22l-2.4 9.1H7.3L4.4 4.6" fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
      <Path d="M6.2 6.2h15l-2 7.3H8z" fill={color} />
      <Path d="M7.3 14.5l-.9 2.7h13.4" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={8.5} cy={20.4} r={1.8} fill={color} />
      <Circle cx={18} cy={20.4} r={1.8} fill={color} />
    </Svg>
  );
}

/** Demo mode: the reference unlocks free delivery from a ₹129 basket. */
function useStripOn(total: number, count: number) {
  const live = useFreeDeliveryUnlocked();
  return DEMO ? (count > 0 && total >= STORE.freeDeliveryAbove ? 1 : 0) : live;
}

/**
 * Green "1 Item | ₹79 — View Cart" bar. Slides up on first add, its numbers roll, it
 * jiggles on every add, and when free delivery unlocks the "Yay! You've unlocked Free
 * Delivery" strip unfurls on top while confetti bursts out of the bar. The page content
 * fades to white behind it.
 */
export function CartBar() {
  const count = useCartSelect((c) => c.count);
  const total = useCartSelect((c) => c.total);
  const freeCount = useStripOn(total, count);
  const freeDelivery = freeCount > 0;
  // inside the tabs the tab bar already keeps clear of the home indicator
  const insets = { bottom: useBottomInset() };
  const { width, height } = useWindowDimensions();
  const jiggle = useSharedValue(0);
  const strip = useSharedValue(freeDelivery ? 1 : 0);
  const [burst, setBurst] = useState(0);
  const wasFree = useRef(freeDelivery);
  const prevCount = useRef(count);
  const money = DEMO ? rupees : formatLkr;

  useEffect(() => {
    if (count > prevCount.current) {
      jiggle.value = withSequence(withTiming(-5, { duration: 70 }), withSpring(0, { damping: 5, stiffness: 400 }));
    }
    prevCount.current = count;
  }, [count]);

  useEffect(() => {
    strip.value = withSpring(freeDelivery ? 1 : 0, { damping: 18, stiffness: 170 });
    // live: the strip is an offer line for new customers, not an unlock, so no confetti
    if (DEMO && freeDelivery && !wasFree.current) setBurst(Date.now());
    wasFree.current = freeDelivery;
  }, [freeDelivery]);

  const barA = useAnimatedStyle(() => ({ transform: [{ translateY: jiggle.value }] }));
  const stripA = useAnimatedStyle(() => ({ height: strip.value * CART_BAR.stripH, opacity: interpolate(strip.value, [0, 0.5, 1], [0, 0.6, 1]) }));
  const rowA = useAnimatedStyle(() => ({ height: CART_BAR.h + (ROW_STRIP - CART_BAR.h) * strip.value }));

  if (count === 0) return null;
  // live: /store only says new customers get N free deliveries; it cannot tell whether this
  // shopper is one, so the strip states the offer and promises nothing
  const freeLine = DEMO ? "Yay! You've unlocked Free Delivery" : `Free delivery on your first ${freeCount} order${freeCount > 1 ? 's' : ''} for new customers`;
  return (
    <>
      {/* the page fades to white behind the bar */}
      <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(200)} pointerEvents="none" style={[styles.fade, { height: insets.bottom + CART_BAR.bottom + CART_BAR.h / 2 + 40 }]}>
        <LinearGradient colors={['rgba(255,255,255,0)', '#fff']} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View
        entering={SlideInDown.springify().mass(1).energyThreshold(1e-4).damping(16)}
        exiting={SlideOutDown.duration(220)}
        style={[styles.wrap, { bottom: insets.bottom + CART_BAR.bottom }, barA]}
      >
        <PressScale onPress={() => router.push('/cart')} style={styles.bar} scaleTo={0.97} haptic>
          <Animated.View style={[styles.strip, stripA]}>
            <Text style={styles.stripTxt} numberOfLines={1}>{freeLine}</Text>
          </Animated.View>
          <Animated.View style={[styles.row, rowA]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <RollingText text={`${count} Item${count > 1 ? 's' : ''}`} numeric={count} style={styles.txt} />
              <Text style={styles.txt}>{'  |  '}</Text>
              <RollingText text={money(total)} numeric={total} style={styles.txt} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.txt}>View Cart</Text>
              <TrolleyIcon size={17} />
            </View>
          </Animated.View>
        </PressScale>
      </Animated.View>
      <Confetti burstKey={burst} x={width / 2} y={height - insets.bottom - 50} />
    </>
  );
}

const styles = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  wrap: { position: 'absolute', left: 13, right: 13 },
  bar: {
    backgroundColor: C.brand, borderRadius: CART_BAR.radius, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  strip: { justifyContent: 'center', paddingHorizontal: 19, backgroundColor: C.brandDeep },
  stripTxt: { color: C.brandInk, fontFamily: F.medium, fontSize: 12.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 19 },
  txt: { color: C.brandInk, fontFamily: F.semi, fontSize: 15 },
});
