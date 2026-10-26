import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstallPrompt } from '../components/InstallPrompt';
import { IOS_HINT, createInstallController, isIosDevice, type InstallEnv } from '../lib/install';

function fakeEnv(init: { standalone?: boolean; ios?: boolean; dismissed?: boolean } = {}) {
  const win = new EventTarget();
  let dismissed = init.dismissed ?? false;
  const env: InstallEnv = {
    win: win as unknown as InstallEnv['win'],
    isStandalone: () => init.standalone ?? false,
    isIos: () => init.ios ?? false,
    readDismissed: () => dismissed,
    writeDismissed: () => {
      dismissed = true;
    },
  };
  return { env, win, get dismissed() { return dismissed; } };
}

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  e.prompt = vi.fn(async () => undefined);
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

describe('install controller', () => {
  it('is hidden until the browser says the app can be installed', () => {
    const f = fakeEnv();
    const c = createInstallController(f.env);
    c.start();
    expect(c.getMode()).toBe('hidden');
    const e = installEvent();
    f.win.dispatchEvent(e);
    expect(c.getMode()).toBe('prompt');
    // the browser's own mini prompt is replaced by our button
    expect(e.defaultPrevented).toBe(true);
  });

  it('Install shows the browser dialog once and hides the prompt when accepted', async () => {
    const f = fakeEnv();
    const c = createInstallController(f.env);
    c.start();
    const e = installEvent('accepted');
    f.win.dispatchEvent(e);
    expect(await c.install()).toBe('accepted');
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(c.getMode()).toBe('hidden');
    expect(await c.install()).toBe('unavailable');
  });

  it('hides once the app is installed (appinstalled)', () => {
    const f = fakeEnv();
    const c = createInstallController(f.env);
    c.start();
    f.win.dispatchEvent(installEvent());
    f.win.dispatchEvent(new Event('appinstalled'));
    expect(c.getMode()).toBe('hidden');
  });

  it('is hidden when the app is already running installed (standalone)', () => {
    const f = fakeEnv({ standalone: true, ios: true });
    const c = createInstallController(f.env);
    c.start();
    f.win.dispatchEvent(installEvent());
    expect(c.getMode()).toBe('hidden');
  });

  it('shows the Share hint on an iPhone, where there is no install event', () => {
    const c = createInstallController(fakeEnv({ ios: true }).env);
    c.start();
    expect(c.getMode()).toBe('ios');
  });

  it('Not now hides it for good and remembers it', () => {
    const f = fakeEnv({ ios: true });
    const c = createInstallController(f.env);
    c.start();
    c.dismiss();
    expect(c.getMode()).toBe('hidden');
    expect(f.dismissed).toBe(true);
    // a new page load on this phone stays hidden
    const again = createInstallController(f.env);
    again.start();
    again.getMode();
    f.win.dispatchEvent(installEvent());
    expect(again.getMode()).toBe('hidden');
  });

  it('tells the subscribers when the mode changes, and stop() stops listening', () => {
    const f = fakeEnv();
    const c = createInstallController(f.env);
    const seen = vi.fn();
    c.subscribe(seen);
    c.start();
    f.win.dispatchEvent(installEvent());
    expect(seen).toHaveBeenCalledTimes(1);
    c.stop();
    f.win.dispatchEvent(new Event('appinstalled'));
    expect(c.getMode()).toBe('prompt');
  });

  it('knows an iPhone, an iPad (which says Macintosh but has a touch screen) and not a Mac or Android', () => {
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 })).toBe(true);
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe(true);
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe(false);
    expect(isIosDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', maxTouchPoints: 5 })).toBe(false);
  });
});

describe('the install strip', () => {
  it('renders nothing when there is nothing to install', () => {
    const c = createInstallController(fakeEnv().env);
    c.start();
    const { container } = render(<InstallPrompt controller={c} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "Install the Blynk Seller app" with an Install button once the browser allows it', async () => {
    const f = fakeEnv();
    const c = createInstallController(f.env);
    c.start();
    render(<InstallPrompt controller={c} />);
    const e = installEvent();
    act(() => void f.win.dispatchEvent(e));
    expect(await screen.findByText('Install the Blynk Seller app')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Install app' }));
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument();
  });

  it('shows the one-line hint on an iPhone and hides after Not now', async () => {
    const c = createInstallController(fakeEnv({ ios: true }).env);
    c.start();
    render(<InstallPrompt controller={c} />);
    expect(screen.getByText('Install the Blynk Seller app')).toBeInTheDocument();
    expect(screen.getByText(IOS_HINT)).toBeInTheDocument();
    expect(screen.getByText('Tap Share, then Add to Home Screen.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument();
  });
});
