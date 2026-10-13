import { Easing, makeMutable, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

/*
 * App-wide motion clocks. Instead of every card owning its own JS timer / infinite
 * animation, a handful of shared values loop once on the UI thread and every
 * component just reads them inside useAnimatedStyle. Zero React re-renders.
 */
export const flip = makeMutable(0); // 0 = "Offer price", 1 = "You save LKR n" (eases between)
export const pulse = makeMutable(1); // heartbeat scale for the green hearts
export const sway = makeMutable(0); // slow 0↔1 for rubber stamps

let started = false;
export function startClocks() {
  if (started) return;
  started = true;
  flip.value = withRepeat(
    withSequence(
      withDelay(2350, withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) })),
      withDelay(2350, withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) })),
    ),
    -1,
  );
  pulse.value = withRepeat(
    withSequence(withTiming(1.25, { duration: 180 }), withTiming(1, { duration: 220 }), withDelay(900, withTiming(1, { duration: 0 }))),
    -1,
  );
  sway.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true);
}
