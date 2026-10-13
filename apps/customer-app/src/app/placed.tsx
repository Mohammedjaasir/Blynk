import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, FadeInDown, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import { withSpring } from '@/lib/motion';
import Svg, { Circle, Path } from 'react-native-svg';
import { formatLkr } from '@/blynk/lib/money';
import { getOrder } from '@/blynk/orders/api';
import { placedFromMemory } from '@/blynk/orders/checkout';
import type { Order } from '@/blynk/orders/types';
import { Confetti, PressScale } from '@/components/ui';
import { DEMO } from '@/demo/mode';
import { cartActions } from '@/lib/cart';
import { C, F } from '@/lib/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * Order placed: ring draws, tick draws, badge pops, confetti rains.
 * Live: the cart's "Place order" lands here as /placed?id=<order id> with the order the server
 * returned (fetched again after a reload): its number, the total to pay in cash, and "Track
 * order" to /order/<id>. The cart is emptied only for an order placed just now.
 */
export default function Placed() {
  const { width, height } = useWindowDimensions();
  const { clear } = cartActions;
  const { id } = useLocalSearchParams<{ id?: string }>();
  const fresh = !DEMO && id ? placedFromMemory(id) : null;
  const [order, setOrder] = useState<Order | null>(fresh);
  const ring = useSharedValue(0);
  const tick = useSharedValue(0);
  const pop = useSharedValue(0);
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    ring.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    tick.value = withDelay(500, withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }));
    pop.value = withDelay(450, withSpring(1, { damping: 7, stiffness: 160 }));
    const t = setTimeout(() => setBurst(Date.now()), 750);
    if (DEMO || fresh) clear();
    if (!DEMO && id && !fresh) getOrder(id).then(setOrder).catch(() => undefined);
    return () => clearTimeout(t);
  }, []);

  const ringP = useAnimatedProps(() => ({ strokeDashoffset: 302 * (1 - ring.value) }));
  const tickP = useAnimatedProps(() => ({ strokeDashoffset: 70 * (1 - tick.value) }));
  const popA = useAnimatedStyle(() => ({ transform: [{ scale: 0.7 + pop.value * 0.3 }] }));

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <Animated.View style={popA}>
        {/* the ring starts at 12 o'clock: its own Svg turned -90° (an SVG rotation/origin is not a valid DOM prop on the web) */}
        <Svg width={120} height={120} viewBox="0 0 120 120" style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={60} cy={60} r={48} fill="rgba(26,29,46,0.1)" />
          <AnimatedCircle cx={60} cy={60} r={48} stroke={C.brandInk} strokeWidth={6} fill="none" strokeDasharray="302" animatedProps={ringP} strokeLinecap="round" />
        </Svg>
        <Svg width={120} height={120} viewBox="0 0 120 120" style={StyleSheet.absoluteFill}>
          <AnimatedPath d="M38 62 L54 77 L84 45" stroke={C.brandInk} strokeWidth={8} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="70" animatedProps={tickP} />
        </Svg>
      </Animated.View>
      <Animated.Text entering={FadeInDown.delay(700)} style={styles.title}>Order placed!</Animated.Text>
      <Animated.Text entering={FadeInDown.delay(820)} style={styles.sub}>Your Blynk order is being packed 🧺</Animated.Text>
      {!DEMO && order && (
        <Animated.View entering={FadeInDown.delay(900)} style={styles.facts}>
          <View style={styles.factRow}>
            <Text style={styles.factLabel}>Order number</Text>
            <Text style={styles.factValue} selectable>{order.order_number}</Text>
          </View>
          <View style={styles.factRow}>
            <Text style={styles.factLabel}>Amount</Text>
            <Text style={styles.factValue}>{formatLkr(order.total_amount)} · Cash on delivery</Text>
          </View>
        </Animated.View>
      )}
      <Animated.View entering={FadeInDown.delay(1000)} style={{ alignItems: 'center' }}>
        {!DEMO && id && (
          <PressScale onPress={() => router.replace({ pathname: '/order/[id]', params: { id } })} style={styles.cta} haptic>
            <Text style={styles.ctaTxt}>Track order</Text>
          </PressScale>
        )}
        <PressScale onPress={() => router.dismissTo('/home')} style={!DEMO && id ? styles.ghost : styles.cta} haptic>
          <Text style={!DEMO && id ? styles.ghostTxt : styles.ctaTxt}>Back to home</Text>
        </PressScale>
      </Animated.View>
      <Confetti burstKey={burst} x={width / 2} y={height * 0.4} count={60} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: F.display, color: C.brandInk, fontSize: 30, marginTop: 20 },
  sub: { fontFamily: F.medium, color: C.brandInk, fontSize: 15, textAlign: 'center', marginTop: 8, lineHeight: 22 },
  cta: { marginTop: 28, backgroundColor: C.brandInk, borderRadius: 14, paddingHorizontal: 30, paddingVertical: 14 },
  ctaTxt: { fontFamily: F.bold, color: C.brand, fontSize: 15 },
  ghost: { marginTop: 12, paddingHorizontal: 30, paddingVertical: 12 },
  ghostTxt: { fontFamily: F.bold, color: C.brandInk, fontSize: 14.5, textDecorationLine: 'underline' },
  facts: { marginTop: 22, backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 16, paddingHorizontal: 18, paddingVertical: 12, minWidth: 280 },
  factRow: { paddingVertical: 5 },
  factLabel: { fontFamily: F.medium, color: 'rgba(26,29,46,0.65)', fontSize: 12 },
  factValue: { fontFamily: F.bold, color: C.brandInk, fontSize: 16, marginTop: 1 },
});
