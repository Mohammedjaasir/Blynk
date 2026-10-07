import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAUNCH_MS, LaunchScreen, resetLaunchForTests } from '../components/LaunchScreen';

/** The opening (owner, 2026-10-07): the native splash's logo, then it lifts away. */
describe('launch screen', () => {
  beforeEach(() => {
    resetLaunchForTests();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('shows the Blynk logo once per launch, then leaves after 1.1 s', () => {
    const { container, unmount } = render(<LaunchScreen />);
    const overlay = container.querySelector('.launch');
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('img.launch__logo')).toHaveAttribute('src', '/launch-logo.png');
    act(() => {
      vi.advanceTimersByTime(LAUNCH_MS);
    });
    expect(container.querySelector('.launch')).toBeNull();
    unmount();
    // A second mount in the same launch (e.g. a remount) does not replay it.
    expect(render(<LaunchScreen />).container.querySelector('.launch')).toBeNull();
  });
});
