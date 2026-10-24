import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClock } from './clock';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the shared one-second clock', () => {
  it('runs no timer until something listens', () => {
    const c = createClock();
    expect(c.running()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('one interval serves every listener, once a second', () => {
    let t = 1000;
    const c = createClock({ now: () => t });
    const a = vi.fn();
    const b = vi.fn();
    c.subscribe(a);
    c.subscribe(b);
    expect(vi.getTimerCount()).toBe(1);
    t = 2000;
    vi.advanceTimersByTime(1000);
    expect(a).toHaveBeenCalledWith(2000);
    expect(b).toHaveBeenCalledWith(2000);
    t = 3000;
    vi.advanceTimersByTime(1000);
    expect(a).toHaveBeenCalledTimes(2);
  });

  it('stops the timer when the last listener leaves, and starts again for a new one', () => {
    const c = createClock();
    const off1 = c.subscribe(() => {});
    const off2 = c.subscribe(() => {});
    off1();
    expect(c.running()).toBe(true);
    off2();
    expect(c.running()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const off3 = c.subscribe(() => {});
    expect(c.running()).toBe(true);
    off3();
  });

  it('a listener that unsubscribes while being notified does not break the others', () => {
    const c = createClock();
    const b = vi.fn();
    const offA = c.subscribe(() => offA());
    c.subscribe(b);
    vi.advanceTimersByTime(1000);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c.size()).toBe(1);
  });
});
