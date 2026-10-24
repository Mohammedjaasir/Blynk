import { useEffect, useRef, useState } from 'react';

/*
 * ONE shared clock for every countdown on screen (Home's "Ends in" pills, flash-deal pills on product
 * tiles, the product page). A single interval ticks once a second; it starts with the first subscriber
 * and stops when the last one leaves, so a screen with nothing counting down runs no timer at all.
 * `useClockValue` re-renders a component only when the value it derives from the time actually
 * changes (a "2h 10m" pill re-renders once a minute, an "expired?" flag once), which keeps long
 * rails cheap on low-end phones.
 */

export interface Clock {
  subscribe(fn: (nowMs: number) => void): () => void;
  /** Listeners now (tests). */
  size(): number;
  /** The interval is running (tests). */
  running(): boolean;
}

/** A clock with its own timer; the app uses the shared one below, tests pass fakes. */
export function createClock(opts: { now?: () => number; everyMs?: number } = {}): Clock {
  const now = opts.now ?? Date.now;
  const every = opts.everyMs ?? 1000;
  const listeners = new Set<(t: number) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    subscribe(fn) {
      listeners.add(fn);
      if (timer === null) {
        timer = setInterval(() => {
          const t = now();
          // copy: a listener may unsubscribe while we notify
          [...listeners].forEach((l) => l(t));
        }, every);
      }
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0 && timer !== null) { clearInterval(timer); timer = null; }
      };
    },
    size: () => listeners.size,
    running: () => timer !== null,
  };
}

export const clock = createClock();

/**
 * A value worked out from the current time, kept fresh once a second but re-rendering only when the
 * value changes (compare with Object.is: use a string/number/boolean). `enabled: false` = no
 * subscription (and so no timer for it): the value is then worked out once per render.
 */
export function useClockValue<T>(select: (nowMs: number) => T, enabled = true): T {
  const pick = useRef(select);
  pick.current = select;
  const [value, setValue] = useState<T>(() => select(Date.now()));
  useEffect(() => {
    if (!enabled) return;
    setValue(pick.current(Date.now()));
    return clock.subscribe((t) => setValue(pick.current(t)));
  }, [enabled]);
  return enabled ? value : select(Date.now());
}

/** The time, once a second (Home's section countdowns re-render each second anyway). */
export function useSecondClock(): number {
  return useClockValue((t) => t);
}
