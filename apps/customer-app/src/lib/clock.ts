import { cancelAnimation, Easing, makeMutable, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

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

/*
 * Home's aisle-card corner animation: one linear 0→1 clock every aisle card reads with its own
 * phase (src/components/AisleStamp.tsx). Home runs it only while it is the focused screen.
 */
export const AISLE_BEAT_MS = 7800; // three items × 2.6 s
export const aisleBeat = makeMutable(0);
let aisleRunning = false;
export function runAisleBeat(on: boolean) {
  if (on === aisleRunning) return;
  aisleRunning = on;
  if (!on) { cancelAnimation(aisleBeat); return; }
  aisleBeat.value = 0;
  aisleBeat.value = withRepeat(withTiming(1, { duration: AISLE_BEAT_MS, easing: Easing.linear }), -1);
}

/*
 * The rolling line under product tiles' prices (src/components/PriceRoll.tsx): one linear 0→1
 * clock every rolling tile reads with its own phase (rollPhase), so twenty tiles cost twenty
 * cheap style worklets and no timers or re-renders. It runs while at least one focused screen
 * shows a rolling tile (holdPriceRoll / its release), and resumes where it paused.
 */
export const ROLL_MS = 5600; // ~2.5 s on each line, 0.3 s slides
export const rollBeat = makeMutable(0);
let rollHolders = 0;
const ROLL_TIMING = { duration: ROLL_MS, easing: Easing.linear };
function startRoll() {
  const from = rollBeat.value % 1;
  rollBeat.value = from;
  rollBeat.value = withTiming(1, { duration: Math.max(1, ROLL_MS * (1 - from)), easing: Easing.linear }, (done) => {
    if (!done) return;
    rollBeat.value = 0;
    rollBeat.value = withRepeat(withTiming(1, ROLL_TIMING), -1);
  });
}
/** Keeps the roll clock running until the returned release is called (ref-counted). */
export function holdPriceRoll(): () => void {
  rollHolders += 1;
  if (rollHolders === 1) startRoll();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    rollHolders = Math.max(0, rollHolders - 1);
    if (rollHolders === 0) cancelAnimation(rollBeat);
  };
}

/*
 * Home's end-of-list footer (src/components/HomeFooter.tsx): one linear 0→1 clock over 4 s. The
 * rider's bounce reads it 4× (a 1 s bounce), the floating groceries once or twice. Runs only while
 * the footer is on screen and Home is focused.
 */
export const FOOTER_BEAT_MS = 4000;
export const footerBeat = makeMutable(0);
let footerRunning = false;
export function runFooterBeat(on: boolean) {
  if (on === footerRunning) return;
  footerRunning = on;
  if (!on) { cancelAnimation(footerBeat); return; }
  footerBeat.value = 0;
  footerBeat.value = withRepeat(withTiming(1, { duration: FOOTER_BEAT_MS, easing: Easing.linear }), -1);
}
