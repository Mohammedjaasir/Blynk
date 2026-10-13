import { afterEach, expect, test, vi } from 'vitest';
import { startCatalogLive } from './catalogLive';

class FakeES {
  static last: FakeES;
  listeners: Record<string, () => void> = {};
  constructor(public url: string) { FakeES.last = this; }
  addEventListener(n: string, cb: () => void) { this.listeners[n] = cb; }
  close = vi.fn();
}
const g = globalThis as { EventSource?: unknown };
afterEach(() => { delete g.EventSource; vi.useRealTimers(); });

test('fires onChange on a catalog event and on the 30 s poll, and stops cleanly', () => {
  vi.useFakeTimers();
  g.EventSource = FakeES;
  const onChange = vi.fn();
  const stop = startCatalogLive(onChange, () => false);
  FakeES.last.listeners['catalog']();
  expect(onChange).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30_000);
  expect(onChange).toHaveBeenCalledTimes(2);
  stop();
  expect(FakeES.last.close).toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  expect(onChange).toHaveBeenCalledTimes(2);
});

test('without EventSource it polls only, and skips while hidden', () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  let hidden = false;
  const stop = startCatalogLive(onChange, () => hidden);
  vi.advanceTimersByTime(30_000);
  expect(onChange).toHaveBeenCalledTimes(1);
  hidden = true;
  vi.advanceTimersByTime(60_000);
  expect(onChange).toHaveBeenCalledTimes(1);
  stop();
});
