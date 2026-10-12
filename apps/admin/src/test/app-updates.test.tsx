import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { AppUpdatesPanel } from '../components/AppUpdatesPanel';
import { Settings } from '../pages/Settings';
import { tokenStore } from '../api/client';
import type { AppUpdatesSetting } from '../api/types';
import { minimumWarning, parseMinVersionCode } from '../lib/appUpdatesSettings';
import { fail, mockApi, ok } from './mockApi';

/**
 * Settings > App updates (owner, 2026-10-12): per staff app the published
 * version, minimum version code, Optional/Required and release notes. The API
 * contract is tested in backend/api/tests/app-updates.test.ts; Operations has
 * the same panel under More.
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

/** The API mock, plus the landing site's manifests (raw JSON, not the API envelope). */
function withManifests(manifests: Record<string, unknown>) {
  const apiFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://blynk.lk/download/')) {
      const m = manifests[url];
      return (m ? { ok: true, status: 200, text: async () => JSON.stringify(m) } : { ok: false, status: 404, text: async () => '' }) as Response;
    }
    return apiFetch(input, init);
  });
}

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
    const api = mockApi((c) => {
      if (c.path !== '/admin/settings/app-updates') return undefined;
      if (c.method === 'GET') return ok(SETTING);
      return ok({ ...SETTING, ...c.body, updated_at: '2026-10-12T06:00:00.000Z' });
    });
    withManifests({ 'https://blynk.lk/download/rider.json': MANIFEST });
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
