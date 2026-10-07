import { useEffect, useState } from 'react';

/**
 * The opening, as in the customer app (owner, 2026-10-07): it starts as an
 * exact copy of Android's native splash - the same Blynk logo, size, centre
 * and white (res/drawable-*\/splash.png is built from the same image) - so
 * the handover is invisible, then the logo breathes up a touch and lifts
 * away into the app. 1.1 s in all; under reduced motion the logo simply
 * holds for 0.4 s. Once per app launch, never on navigation, and it never
 * takes a tap (pointer-events: none).
 */
let shown = false;

export const LAUNCH_MS = 1100;
export const REDUCED_MOTION_HOLD_MS = 400;

/** Tests only: behave like a fresh launch. */
export function resetLaunchForTests() {
  shown = false;
}

export function LaunchScreen() {
  const [visible, setVisible] = useState(() => !shown);

  useEffect(() => {
    if (!visible) return undefined;
    shown = true;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const timer = window.setTimeout(() => setVisible(false), reduced ? REDUCED_MOTION_HOLD_MS : LAUNCH_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;
  return (
    <div className="launch" aria-hidden="true">
      <img className="launch__logo" src="/launch-logo.png" alt="" width={256} height={256} />
    </div>
  );
}
