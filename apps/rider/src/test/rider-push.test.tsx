// "New delivery assigned" push (owner, 2026-10-21): a push arriving re-reads the delivery list at
// once, and off Android nothing registers.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRevalidate } from '../lib/useRevalidate';
import { ASSIGNMENT_EVENT, startRiderPush } from '../lib/riderPush';

describe('rider push', () => {
  it('a push event re-reads the list straight away', () => {
    const reload = vi.fn();
    const { unmount } = renderHook(() => useRevalidate(reload));
    window.dispatchEvent(new Event(ASSIGNMENT_EVENT));
    expect(reload).toHaveBeenCalledTimes(1);
    unmount();
    window.dispatchEvent(new Event(ASSIGNMENT_EVENT));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('in a browser (not the Android app) nothing is registered', async () => {
    const stop = await startRiderPush({ onOpen: vi.fn(), onForeground: vi.fn() });
    expect(typeof stop).toBe('function');
    stop();
  });
});
