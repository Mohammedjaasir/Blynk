import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  SlideInDown, SlideOutDown, useAnimatedStyle, useSharedValue, withSequence, withTiming,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatLkr } from '@/blynk/lib/money';
import { useFreeDeliveryUnlocked } from '@/blynk/store/freeDelivery';
import { useCartSelect } from '@/lib/cart';
import { C, F } from '@/lib/theme';
import { CartIcon } from './icons';
import { Confetti, PressScale, RollingText } from './ui';

export const CART_BAR_H = 56;

/**
 * Green "n items | LKR x — View cart" bar. Slides up on first add, its numbers roll,
 * it jiggles on every add, and when free delivery unlocks a strip unfurls on top
 * of it while confetti bursts out of the bar. "Unlocked" comes from Blynk's
 * new-customer free deliveries (no public basket threshold exists); see freeDelivery.ts.
 */
export function CartBar() {
  const count = useCartSelect((c) => c.count);
  const total = useCartSelect((c) => c.total);
  const freeCount = useFreeDeliveryUnlocked();
  const freeDelivery = freeCount > 0;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const jiggle = useSharedValue(0);
  const strip = useSharedValue(freeDelivery ? 1 : 0);
  const [burst, setBurst] = useState(0);
  const wasFree = useRef(freeDelivery);
  const prevCount = useRef(count);

  useEffect(() => {
    if (count > prevCount.current) {
      jiggle.value = withSequence(withTiming(-5, { duration: 70 }), withSpring(0, { damping: 5, stiffness: 400 }));
    }
    prevCount.current = count;
  }, [count]);

  useEffect(() => {
    strip.value = withSpring(freeDelivery ? 1 : 0, { damping: 15, stiffness: 160 });
    if (freeDelivery && !wasFree.current) setBurst(Date.now());
    wasFree.current = freeDelivery;
  }, [freeDelivery]);

  const barA = useAnimatedStyle(() => ({ transform: [{ translateY: jiggle.value }] }));
  const stripA = useAnimatedStyle(() => ({ height: strip.value * 24, opacity: strip.value }));

  if (count === 0) return null;
  return (
    <>
      <Animated.View
        entering={SlideInDown.springify().mass(1).energyThreshold(1e-4).damping(16)}
        exiting={SlideOutDown.duration(220)}
        style={[styles.wrap, { bottom: insets.bottom + 10 }, barA]}
      >
        <PressScale onPress={() => router.push('/cart')} style={styles.bar} scaleTo={0.97} haptic>
          <Animated.View style={[styles.strip, stripA]}>
            <Text style={styles.stripTxt}>Yay! FREE delivery on your first {freeCount} order{freeCount > 1 ? 's' : ''}</Text>
          </Animated.View>
          <View style={styles.row}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <RollingText text={`${count} item${count > 1 ? 's' : ''}`} numeric={count} style={styles.txt} />
              <Text style={styles.txt}>  |  </Text>
              <RollingText text={formatLkr(total)} numeric={total} style={styles.txt} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.txt}>View cart</Text>
              <CartIcon size={16} />
            </View>
          </View>
        </PressScale>
      </Animated.View>
      <Confetti burstKey={burst} x={width / 2} y={height - insets.bottom - 50} />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12 },
  bar: {
    backgroundColor: C.green, borderRadius: 16, overflow: 'hidden',
    shadowColor: C.green, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  strip: { justifyContent: 'center', paddingHorizontal: 16, backgroundColor: C.greenDark },
  stripTxt: { color: '#fff', fontFamily: F.semi, fontSize: 11 },
  row: { height: CART_BAR_H - 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  txt: { color: '#fff', fontFamily: F.bold, fontSize: 14 },
});
