import { renderHook, act, waitFor } from '@testing-library/react';
import { useLoad } from './useLoad';

function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }

test('an older in-flight call never overwrites newer data', async () => {
  const a = deferred<string>(); const b = deferred<string>();
  const calls = [a, b]; let n = 0;
  const { result } = renderHook(() => useLoad(() => calls[n++].promise, []));
  act(() => { void result.current.retry(); });
  await act(async () => { b.resolve('new'); });
  await waitFor(() => expect(result.current.data).toBe('new'));
  await act(async () => { a.resolve('old'); });
  expect(result.current.data).toBe('new');
  expect(result.current.loading).toBe(false);
});

test('a refresh with data on screen does not flip loading back on', async () => {
  const d1 = deferred<string>(); const d2 = deferred<string>();
  const calls = [d1, d2]; let n = 0;
  const { result } = renderHook(() => useLoad(() => calls[n++].promise, []));
  await act(async () => { d1.resolve('first'); });
  await waitFor(() => expect(result.current.data).toBe('first'));
  act(() => { void result.current.retry(); });
  expect(result.current.loading).toBe(false);
  expect(result.current.data).toBe('first');
  await act(async () => { d2.resolve('second'); });
  expect(result.current.data).toBe('second');
});
