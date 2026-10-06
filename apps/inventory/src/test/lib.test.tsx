import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { productionApiUrlProblem } from '../lib/apiBaseUrl';
import { useAutoRefresh } from '../lib/autoRefresh';
import { mapLimit } from '../lib/concurrency';

describe('mapLimit', () => {
  it('keeps the input order and never runs more than the limit at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const result = await mapLimit([30, 5, 20, 1, 10, 2, 8], 3, async (ms, i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return i * 10;
    });
    expect(result).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(3);
  });

  it('handles an empty list and rejects when a call fails', async () => {
    expect(await mapLimit([], 5, async () => 1)).toEqual([]);
    await expect(mapLimit([1, 2], 5, async (n) => (n === 2 ? Promise.reject(new Error('x')) : n))).rejects.toThrow('x');
  });
});

describe('production API address check (vite.config.ts)', () => {
  it.each([
    [undefined, /not set/],
    ['', /not set/],
    ['   ', /not set/],
    ['not a url', /not a valid URL/],
    ['http://api.blynk.lk/api/v1', /must use https/],
    ['http://localhost:4000/api/v1', /must use https/],
    ['https://localhost:4000/api/v1', /points to this machine/],
    ['https://127.0.0.1/api/v1', /points to this machine/],
    ['https://0.0.0.0/api/v1', /points to this machine/],
  ])('refuses %j', (value, problem) => {
    expect(productionApiUrlProblem(value)).toMatch(problem);
  });

  it('accepts a public https address', () => {
    expect(productionApiUrlProblem('https://api.blynk.lk/api/v1')).toBeNull();
  });
});

describe('useAutoRefresh', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('refreshes every interval while visible, skips while hidden, and catches up on return', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    renderHook(() => useAutoRefresh(refresh, 30_000));

    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    vi.advanceTimersByTime(90_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does nothing while paused and stops on unmount', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const { rerender, unmount } = renderHook(({ paused }) => useAutoRefresh(refresh, 30_000, paused), {
      initialProps: { paused: true },
    });
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();

    rerender({ paused: false });
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    unmount();
    vi.advanceTimersByTime(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
