import { startCatalogLive } from './catalogLive';

class FakeES { static last: FakeES; listeners: Record<string, () => void> = {}; constructor(public url: string) { FakeES.last = this; }
  addEventListener(n: string, cb: () => void) { this.listeners[n] = cb; } close = vi.fn(); }

test('fires onChange on a catalog event and on the 30 s poll, and stops cleanly', () => {
  vi.useFakeTimers();
  (globalThis as any).EventSource = FakeES;
  const onChange = vi.fn();
  const stop = startCatalogLive(onChange);
  FakeES.last.listeners['catalog']();
  expect(onChange).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30_000);
  expect(onChange).toHaveBeenCalledTimes(2);
  stop();
  expect(FakeES.last.close).toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  expect(onChange).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
