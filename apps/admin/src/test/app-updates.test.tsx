import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { AppUpdatesPanel } from '../components/AppUpdatesPanel';
import { Settings } from '../pages/Settings';
import { tokenStore } from '../api/client';
import type { AppShareLinks, AppUpdatesSetting } from '../api/types';
import { minimumWarning, parseMinVersionCode, parseShareHours } from '../lib/appUpdatesSettings';
import { fail, mockApi, ok } from './mockApi';

/**
 * Settings > App updates (owner, 2026-10-12): per staff app the published
 * version (from the signed-in manifest endpoint), minimum version code,
 * Optional/Required, release notes, and the temporary public share link. The
 * API contract is tested in backend/api/tests/app-updates.test.ts and
 * app-downloads.test.ts; Operations has the same panel under More.
 */
const SETTING: AppUpdatesSetting = {
  ops: { min_version_code: 0, mode: 'optional', notes: '' },
  rider: { min_version_code: 3, mode: 'required', notes: 'Rider fix' },
  updated_at: null,
};
const MANIFEST = {
  app: 'rider',
  version_code: 61,
  version_name: '1.4',
  sha256: 'c'.repeat(64),
  size: 5_600_000,
  released_at: '2026-10-12T06:00:00.000Z',
};

const renderPanel = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <AppUpdatesPanel />
      </ToastProvider>
    </MemoryRouter>
  );

const LINK_OFF = { active: false, path: null, hours: null, created_at: null, expires_at: null };
const LINKS_OFF: AppShareLinks = { ops: LINK_OFF, rider: LINK_OFF, updated_at: null };
const TOKEN = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa987654';
const LINKS_OPS_ON: AppShareLinks = {
  ops: {
    active: true,
    path: `/app-updates/share/${TOKEN}/ops.apk`,
    hours: 24,
    created_at: '2026-10-12T06:00:00.000Z',
    expires_at: '2026-10-13T06:00:00.000Z',
  },
  rider: LINK_OFF,
  updated_at: '2026-10-12T06:00:00.000Z',
};

/** The published manifests now come from the signed-in API (GET /app-updates/manifest?app=). */
const manifestReply = (manifests: Record<string, unknown>) => (c: { method: string; path: string; query: URLSearchParams }) => {
  if (c.method !== 'GET' || c.path !== '/app-updates/manifest') return undefined;
  const m = manifests[c.query.get('app') ?? ''];
  return m ? ok(m) : fail(404, 'NOT_FOUND', 'This app has not been published yet.');
};

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('App updates helpers', () => {
  it('minimum version code and the warning', () => {
    expect(parseMinVersionCode('')).toEqual({ value: 0 });
    expect(parseMinVersionCode('61')).toEqual({ value: 61 });
    expect(parseMinVersionCode('6.1')).toHaveProperty('error');
    expect(parseMinVersionCode('99999999999')).toHaveProperty('error');
    const pub = { version_code: 61, version_name: '1.4', released_at: '', size: 1 };
    expect(minimumWarning(62, 'required', pub)).toMatch(/above the published version \(61\)/);
    expect(minimumWarning(61, 'required', pub)).toBeNull();
  });
});

describe('Settings > App updates', () => {
  it('shows the published versions and saves both apps', async () => {
    const user = userEvent.setup();
    const manifests = manifestReply({ rider: MANIFEST });
    const api = mockApi((c) => {
      if (c.path === '/admin/settings/app-share-links') return ok(LINKS_OFF);
      if (c.path !== '/admin/settings/app-updates') return manifests(c);
      if (c.method === 'GET') return ok(SETTING);
      return ok({ ...SETTING, ...c.body, updated_at: '2026-10-12T06:00:00.000Z' });
    });
    renderPanel();
    expect(await screen.findByLabelText('Blynk Rider latest published version')).toHaveTextContent('1.4 (version code 61)');
    expect(await screen.findByLabelText('Blynk Ops latest published version')).toHaveTextContent('not found');

    const riderMin = screen.getByLabelText('Blynk Rider minimum version code');
    expect(riderMin).toHaveValue('3');
    await user.clear(riderMin);
    await user.type(riderMin, '61');
    await user.type(screen.getByLabelText('Blynk Rider release notes'), ' and maps');
    const opsMode = screen.getByRole('group', { name: 'Blynk Ops update mode' });
    expect(within(opsMode).getByRole('button', { name: 'Optional' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(opsMode).getByRole('button', { name: 'Required' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/app-updates')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/app-updates')[0].body).toEqual({
      ops: { min_version_code: 0, mode: 'required', notes: '' },
      rider: { min_version_code: 61, mode: 'required', notes: 'Rider fix and maps' },
    });
    expect(await screen.findByText('App update settings saved.')).toBeInTheDocument();
    // Read through the API (token attached), never the old public blynk.lk address.
    expect(api.find('GET', '/app-updates/manifest').map((c) => c.query.get('app')).sort()).toEqual(['ops', 'rider']);
    expect(api.calls.some((c) => c.path.includes('download'))).toBe(false);
  });

  it('Optional | Automatic | Required: choosing Automatic saves mode automatic; the Required note shows only under Required', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/admin/settings/app-share-links') return ok(LINKS_OFF);
      if (c.path === '/app-updates/manifest') return fail(404, 'NOT_FOUND', 'none');
      if (c.path !== '/admin/settings/app-updates') return undefined;
      if (c.method === 'GET') return ok(SETTING);
      return ok({ ...SETTING, ...c.body, updated_at: '2026-10-22T06:00:00.000Z' });
    });
    renderPanel();
    const opsMode = await screen.findByRole('group', { name: 'Blynk Ops update mode' });
    expect(within(opsMode).getAllByRole('button').map((b) => b.textContent)).toEqual(['Optional', 'Automatic', 'Required']);
    // Rider is Required in the fixture, so its note shows; Ops (Optional) has none.
    const opsApp = screen.getByRole('group', { name: 'Blynk Ops' });
    const riderApp = screen.getByRole('group', { name: 'Blynk Rider' });
    expect(within(riderApp).getByText(/Phones still on Ops\/Rider 1.2 \(build 148\) cannot update themselves: install them once by hand from a share link first\./)).toBeInTheDocument();
    expect(within(opsApp).queryByText(/cannot update themselves/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Optional shows "Update available"; staff can put it off for a day\. Automatic downloads the new version by itself when staff open the app and opens Android's install screen\. Required blocks apps below the minimum version code until they update\. 0 = no minimum\./)
    ).toBeInTheDocument();

    await user.click(within(opsMode).getByRole('button', { name: 'Automatic' }));
    expect(within(opsMode).getByRole('button', { name: 'Automatic' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(opsApp).queryByText(/cannot update themselves/)).not.toBeInTheDocument();
    await user.click(within(opsMode).getByRole('button', { name: 'Required' }));
    expect(within(opsApp).getByText(/cannot update themselves/)).toBeInTheDocument();
    await user.click(within(opsMode).getByRole('button', { name: 'Automatic' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/app-updates')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/settings/app-updates')[0].body).toEqual({
      ops: { min_version_code: 0, mode: 'automatic', notes: '' },
      rider: { min_version_code: 3, mode: 'required', notes: 'Rider fix' },
    });
  });

  it('a bad minimum is shown on its field and nothing is sent', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => (c.path === '/admin/settings/app-updates' && c.method === 'GET' ? ok(SETTING) : undefined));
    renderPanel();
    const opsMin = await screen.findByLabelText('Blynk Ops minimum version code');
    await user.clear(opsMin);
    await user.type(opsMin, '-2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter a whole number (0 = no minimum).')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/settings/app-updates')).toHaveLength(0);
  });

  it('shows the server refusal', async () => {
    const user = userEvent.setup();
    mockApi((c) => {
      if (c.path !== '/admin/settings/app-updates') return undefined;
      return c.method === 'GET' ? ok(SETTING) : fail(403, 'FORBIDDEN', 'Forbidden');
    });
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('is on the Settings page', async () => {
    mockApi((c) => (c.path === '/admin/settings/app-updates' && c.method === 'GET' ? ok(SETTING) : undefined));
    render(
      <MemoryRouter>
        <ToastProvider>
          <Settings />
        </ToastProvider>
      </MemoryRouter>
    );
    expect(await screen.findByRole('region', { name: 'App updates' })).toBeInTheDocument();
  });
});

describe('Settings > App updates > Share link', () => {
  it('hours must be 1-72', () => {
    expect(parseShareHours('24')).toEqual({ value: 24 });
    expect(parseShareHours('72')).toEqual({ value: 72 });
    for (const bad of ['0', '73', '2.5', '', 'abc']) expect(parseShareHours(bad)).toHaveProperty('error');
  });

  it('turns the Ops link on (default 24 h), shows the full link, copies it, and turns it off', async () => {
    const user = userEvent.setup();
    let links: AppShareLinks = LINKS_OFF;
    const api = mockApi((c) => {
      if (c.path === '/admin/settings/app-updates' && c.method === 'GET') return ok(SETTING);
      if (c.path === '/app-updates/manifest') return fail(404, 'NOT_FOUND');
      if (c.path !== '/admin/settings/app-share-links') return undefined;
      if (c.method === 'PATCH') links = c.body.enabled ? LINKS_OPS_ON : LINKS_OFF;
      return ok(links);
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel();
    const ops = await screen.findByRole('group', { name: 'Blynk Ops share link' });
    expect(await within(ops).findByText(/Off\. Only signed-in staff can download Blynk Ops/)).toBeInTheDocument();
    expect(within(ops).getByLabelText('Blynk Ops share link hours')).toHaveValue('24');
    await user.click(within(ops).getByRole('button', { name: 'Turn on share link' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/app-share-links')[0]?.body).toEqual({ app: 'ops', enabled: true, hours: 24 }));

    const address = (await within(ops).findByLabelText('Blynk Ops share link address')) as HTMLInputElement;
    expect(address.value).toMatch(new RegExp(`^https?://.+/api/v1/app-updates/share/${TOKEN}/ops\\.apk$`));
    expect(within(ops).getByText(/Anyone with this link can download Blynk Ops until/)).toBeInTheDocument();
    await user.click(within(ops).getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(address.value);

    await user.click(within(ops).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/settings/app-share-links')[1]?.body).toEqual({ app: 'ops', enabled: false }));
    expect(await within(ops).findByText(/Off\. Only signed-in staff/)).toBeInTheDocument();
  });

  it('a bad number of hours is refused before sending', async () => {
    const user = userEvent.setup();
    const api = mockApi((c) => {
      if (c.path === '/admin/settings/app-updates' && c.method === 'GET') return ok(SETTING);
      if (c.path === '/admin/settings/app-share-links') return ok(LINKS_OFF);
      return fail(404, 'NOT_FOUND');
    });
    renderPanel();
    const rider = await screen.findByRole('group', { name: 'Blynk Rider share link' });
    const hours = await within(rider).findByLabelText('Blynk Rider share link hours');
    await user.clear(hours);
    await user.type(hours, '0');
    await user.click(within(rider).getByRole('button', { name: 'Turn on share link' }));
    expect(await within(rider).findByRole('alert')).toHaveTextContent('1 to 72');
    expect(api.find('PATCH', '/admin/settings/app-share-links')).toHaveLength(0);
  });
});
