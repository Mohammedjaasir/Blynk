import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DENIED_TEXT,
  NEEDS_INSTALL_TEXT,
  NOTIFY_LEDE,
  NotificationsCard,
  NotificationsNudge,
  ON_TEXT,
  TURN_ON_LABEL,
  UNSUPPORTED_TEXT,
} from '../components/NotificationsCard';
import { Toaster } from '../components/Toaster';
import { mockApi } from './mockApi';
import { renderApp, signInStoredSession, worldHandler } from './fixtures';
import { createPushManager, type ForegroundMessage, type PushDeps, type PushPermission, type PushPlatform } from '../lib/push/manager';

function setup(opts: { platform?: boolean; permission?: PushPermission; promptAnswer?: PushPermission; needsInstall?: boolean; off?: boolean } = {}) {
  let permission: PushPermission = opts.permission ?? 'default';
  let emit: ((m: ForegroundMessage) => void) | null = null;
  const platform: PushPlatform = {
    name: 'web',
    initialize: async () => undefined,
    permission: () => permission,
    requestPermission: async () => {
      permission = opts.promptAnswer ?? 'granted';
      return permission;
    },
    getToken: async () => (permission === 'granted' ? 'tok-1' : null),
    deleteToken: async () => undefined,
    onMessage: (cb) => {
      emit = cb;
      return () => undefined;
    },
  };
  let off = opts.off ?? false;
  const register = vi.fn(async (_t: string) => undefined);
  const unregister = vi.fn(async (_t: string, _a?: string) => undefined);
  const deps: PushDeps = {
    platform: () => (opts.platform === false ? null : platform),
    register,
    unregister,
    needsInstall: () => opts.needsInstall ?? false,
    store: { isOff: () => off, setOff: (v) => void (off = v) },
  };
  const manager = createPushManager(deps);
  return { manager, register, unregister, emit: (m: ForegroundMessage) => emit?.(m), setPermission: (p: PermissionState | PushPermission) => void (permission = p as PushPermission) };
}

async function started(s: ReturnType<typeof setup>, signedIn = true) {
  await act(async () => {
    await s.manager.start();
    if (signedIn) await s.manager.signedIn();
  });
}

describe('the Get notifications card', () => {
  it('explains what the seller gets and offers Turn on notifications', async () => {
    const s = setup();
    await started(s);
    render(<NotificationsCard manager={s.manager} />);
    expect(screen.getByRole('heading', { name: 'Get notifications' })).toBeInTheDocument();
    expect(screen.getByText(NOTIFY_LEDE)).toBeInTheDocument();
    expect(screen.getByText('Know when a product goes live, is not approved, or a payout is sent.')).toBeInTheDocument();
    expect(screen.getByTestId('notify-card')).toHaveAttribute('data-state', 'off');
    expect(screen.getByRole('button', { name: TURN_ON_LABEL })).toBeEnabled();
  });

  it('Turn on asks the browser, registers the device and then shows on with a Turn off button', async () => {
    const s = setup();
    await started(s);
    render(<NotificationsCard manager={s.manager} />);
    await userEvent.click(screen.getByRole('button', { name: TURN_ON_LABEL }));
    expect(await screen.findByText(ON_TEXT)).toBeInTheDocument();
    expect(s.register).toHaveBeenCalledWith('tok-1');
    expect(screen.queryByRole('button', { name: TURN_ON_LABEL })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(await screen.findByRole('button', { name: TURN_ON_LABEL })).toBeInTheDocument();
    expect(s.unregister).toHaveBeenCalledWith('tok-1');
    expect(screen.queryByText(ON_TEXT)).not.toBeInTheDocument();
  });

  it('is already on when notifications were allowed before', async () => {
    const s = setup({ permission: 'granted' });
    await started(s);
    render(<NotificationsCard manager={s.manager} />);
    expect(screen.getByText(ON_TEXT)).toBeInTheDocument();
    expect(screen.getByTestId('notify-card')).toHaveAttribute('data-state', 'on');
  });

  it('shows how to re-enable when the browser blocks notifications, and Check again picks up the change', async () => {
    const s = setup({ permission: 'denied' });
    await started(s);
    render(<NotificationsCard manager={s.manager} />);
    expect(screen.getByText(DENIED_TEXT)).toBeInTheDocument();
    expect(screen.getByTestId('notify-card')).toHaveAttribute('data-state', 'denied');
    expect(screen.queryByRole('button', { name: TURN_ON_LABEL })).not.toBeInTheDocument();

    s.setPermission('default');
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('button', { name: TURN_ON_LABEL })).toBeInTheDocument();
  });

  it('tells an iPhone browser tab to install the app first', async () => {
    const s = setup({ platform: false, needsInstall: true });
    await started(s);
    render(<NotificationsCard manager={s.manager} />);
    expect(screen.getByText(NEEDS_INSTALL_TEXT)).toBeInTheDocument();
    expect(screen.getByText(/install the app first, then turn on notifications/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: TURN_ON_LABEL })).not.toBeInTheDocument();
  });

  it('says so in an unsupported browser', async () => {
    const s = setup({ platform: false });
    await started(s);
    render(<NotificationsCard manager={s.manager} />);
    expect(screen.getByText(UNSUPPORTED_TEXT)).toBeInTheDocument();
    expect(screen.getByTestId('notify-card')).toHaveAttribute('data-state', 'unsupported');
  });

  it('shows nothing while push is still starting', () => {
    const s = setup();
    const { container } = render(<NotificationsCard manager={s.manager} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a plain error when turning on fails', async () => {
    const s = setup();
    s.register.mockRejectedValue(new Error('offline'));
    await started(s);
    render(<NotificationsCard manager={s.manager} />);
    await userEvent.click(screen.getByRole('button', { name: TURN_ON_LABEL }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not turn on notifications/i);
    expect(screen.getByRole('button', { name: TURN_ON_LABEL })).toBeEnabled();
  });
});

describe('the home-screen nudge', () => {
  it('invites a seller who has not turned notifications on, and Not now hides it', async () => {
    const s = setup();
    await started(s);
    render(<NotificationsNudge manager={s.manager} />);
    expect(screen.getByTestId('notify-nudge')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('notify-nudge')).not.toBeInTheDocument();
    expect(localStorage.getItem('blynk.seller.notifyNudgeDismissed')).toBe('1');
  });

  it('can turn them on right there', async () => {
    const s = setup();
    await started(s);
    render(<NotificationsNudge manager={s.manager} />);
    await userEvent.click(screen.getByRole('button', { name: TURN_ON_LABEL }));
    await vi.waitFor(() => expect(s.register).toHaveBeenCalled());
    expect(screen.queryByTestId('notify-nudge')).not.toBeInTheDocument();
  });

  it.each([
    ['already on', { permission: 'granted' as PushPermission }],
    ['blocked', { permission: 'denied' as PushPermission }],
    ['unsupported', { platform: false }],
    ['an iPhone tab', { platform: false, needsInstall: true }],
  ])('stays out of the way when notifications are %s', async (_name, opts) => {
    const s = setup(opts);
    await started(s);
    render(<NotificationsNudge manager={s.manager} />);
    expect(screen.queryByTestId('notify-nudge')).not.toBeInTheDocument();
  });

  it('stays hidden once dismissed on this phone', async () => {
    localStorage.setItem('blynk.seller.notifyNudgeDismissed', '1');
    const s = setup();
    await started(s);
    render(<NotificationsNudge manager={s.manager} />);
    expect(screen.queryByTestId('notify-nudge')).not.toBeInTheDocument();
  });
});

describe('a push while the app is open', () => {
  it('shows an in-app toast with the title and body, and the close button removes it', async () => {
    const s = setup({ permission: 'granted' });
    render(<Toaster manager={s.manager} />);
    await started(s);
    act(() => s.emit({ title: 'Mango Jam is live', body: 'Customers can order it now.', url: '/' }));
    expect(await screen.findByText('Mango Jam is live')).toBeInTheDocument();
    expect(screen.getByText('Customers can order it now.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close notification' }));
    expect(screen.queryByText('Mango Jam is live')).not.toBeInTheDocument();
  });

  it('goes away by itself', async () => {
    const s = setup({ permission: 'granted' });
    render(<Toaster manager={s.manager} ms={400} />);
    await started(s);
    act(() => s.emit({ title: 'Payment sent', body: '', url: null }));
    expect(await screen.findByText('Payment sent')).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(screen.queryByText('Payment sent')).not.toBeInTheDocument();
  });
});

describe('in the app', () => {
  it('My shop has the card; in a browser without web push (jsdom) it says so, and there is no install strip', async () => {
    signInStoredSession();
    mockApi(worldHandler());
    renderApp('/shop');
    expect(await screen.findByRole('heading', { name: 'Get notifications' })).toBeInTheDocument();
    expect(await screen.findByText(UNSUPPORTED_TEXT)).toBeInTheDocument();
    expect(screen.queryByTestId('install-prompt')).not.toBeInTheDocument();
  });

  it('the home screen shows no nudge when push is not possible', async () => {
    signInStoredSession();
    mockApi(worldHandler());
    renderApp('/products');
    await screen.findByRole('heading', { name: 'My products' });
    expect(screen.queryByTestId('notify-nudge')).not.toBeInTheDocument();
  });
});
