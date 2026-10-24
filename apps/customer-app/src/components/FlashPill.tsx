import { useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import type { PricedItem } from '@/blynk/lib/pricing';
import { useClockValue } from '@/blynk/promo/clock';
import { flashEndMs, flashPillText, flashSpeech, flashUrgent } from '@/blynk/promo/flashDeals';
import { C, F } from '@/lib/theme';

/*
 * Flash deals (wave 2, 2026-10-25): an offer that ends within 24 h counts down where the customer
 * sees it - a compact "Ends in 01:59:12" pill on the product tile, a larger one with a pulsing bolt
 * on the product page, and an automatic Home rail. What counts, the words and the colours:
 * src/blynk/promo/flashDeals.ts. Every pill reads the one shared 1-second clock
 * (src/blynk/promo/clock.ts) and re-renders only when its own text changes.
 */

export function BoltIcon({ size = 12, color = C.brandInk }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M13.2 2 4.5 13.4c-.4.5 0 1.2.6 1.2H10l-1.1 7.3c-.1.8.9 1.2 1.4.6l8.7-11.5c.4-.5 0-1.2-.6-1.2H14l1.1-6.6c.1-.8-.9-1.2-1.4-.6z" fill={color} />
    </Svg>
  );
}

/**
 * The end (epoch ms) of this item's offer while it is a flash deal, else null. The component using it
 * re-renders by itself the moment the offer ends, so the price goes back to normal without a reload:
 * the clock is subscribed only while a flash deal is on screen (nothing counting down: no timer).
 */
export function useFlashEnd(p: PricedItem | null | undefined): number | null {
  const end = p ? flashEndMs(p, Date.now()) : null;
  useClockValue((t) => (p ? flashEndMs(p, t) !== null : false), end !== null);
  return end;
}

type Size = 'tile' | 'head' | 'page';

/** A beating bolt (the page pill); with reduced motion it just sits there. */
function PulseBolt({ size, color, animate }: { size: number; color: string; animate: boolean }) {
  const reduced = useReducedMotion();
  const beat = useSharedValue(0);
  useEffect(() => {
    if (!animate || reduced) { beat.value = 0; return; }
    beat.value = withRepeat(withSequence(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) }),
      withTiming(0, { duration: 800, easing: Easing.inOut(Easing.quad) }),
    ), -1);
    return () => cancelAnimation(beat);
  }, [animate, reduced, beat]);
  const a = useAnimatedStyle(() => ({ opacity: 0.75 + beat.value * 0.25, transform: [{ scale: 1 + beat.value * 0.18 }] }));
  return <Animated.View style={a}><BoltIcon size={size} color={color} /></Animated.View>;
}

/**
 * "Ends in 01:59:12" / "Ends in 2h 10m" with a bolt; red under an hour. Draws nothing once the time is up.
 * `tile` is the small overlay on a product photo, `head` sits under a rail title, `page` is the bigger one
 * beside the offer price (pulsing bolt).
 */
export function FlashPill({ endsAtMs, size, style }: { endsAtMs: number; size: Size; style?: StyleProp<ViewStyle> }) {
  // re-renders only when the text changes: once a second under 2 h, once a minute above
  const text = useClockValue((t) => flashPillText(endsAtMs, t));
  if (text === null) return null;
  const now = Date.now();
  const urgent = flashUrgent(endsAtMs, now);
  const ink = urgent ? C.problem : C.brandInk;
  const icon = size === 'page' ? 16 : size === 'head' ? 12 : 10;
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={flashSpeech(endsAtMs, now) ?? text}
      pointerEvents="none"
      style={[s.pill, size === 'tile' ? s.tile : size === 'head' ? s.head : s.page, urgent ? s.urgent : s.calm, style]}
    >
      {size === 'page' ? <PulseBolt size={icon} color={ink} animate /> : <BoltIcon size={icon} color={ink} />}
      <Text
        style={[s.txt, size === 'tile' ? s.txtTile : size === 'head' ? s.txtHead : s.txtPage, { color: ink }]}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  tile: { position: 'absolute', gap: 3, height: 19, paddingHorizontal: 6, borderRadius: 9, right: 6, top: 6 },
  head: { gap: 5, paddingHorizontal: 9, paddingVertical: 3.5, borderRadius: 999 },
  page: { gap: 7, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  calm: { backgroundColor: C.brand },
  urgent: { backgroundColor: '#FDECEA' },
  txt: { fontFamily: F.semi, fontVariant: ['tabular-nums'] },
  txtTile: { fontSize: 9.5, letterSpacing: 0 },
  txtHead: { fontSize: 11.5, letterSpacing: 0.1 },
  txtPage: { fontSize: 14, letterSpacing: 0.1 },
});
