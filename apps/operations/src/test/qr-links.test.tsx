import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tokenStore } from '../api/client';
import { OPERATIONS_STAFF, ok, renderAs } from './helpers';

/** QR links in Ops (owner, 2026-10-22: "i need a dynamic QR code to put in the jersey"). */
const PATH = '/admin/settings/qr-links';
const GET = `GET ${PATH}`;
const PUT = `PUT ${PATH}`;

const JERSEY = {
  code: 'j',
  label: 'Jersey',
  url: 'https://blynk.lk/app/?utm_source=jersey&utm_medium=qr&utm_campaign=jersey',
  scans_total: 128,
  scans_7_days: 31,
  scans_today: 4,
  last_scan_at: '2026-10-21T08:30:00.000Z',
};
const POSTER = {
  code: 'poster',
  label: 'Shop poster',
  url: 'https://example.com/promo',
  scans_total: 0,
  scans_7_days: 0,
  scans_today: 0,
  last_scan_at: null,
};

const list = (links: object[]) => () => ok({ links, updated_at: null });
const putEchoes = (c: { body: any }) =>
  ok({
    links: (c.body.links as object[]).map((l) => ({ ...JERSEY, scans_total: 0, scans_7_days: 0, scans_today: 0, last_scan_at: null, ...l })),
    updated_at: '2026-10-22T01:00:00Z',
  });
const page = (handlers: Record<string, (c: any) => unknown>) => renderAs(OPERATIONS_STAFF, '/catalog/qr-links', handlers).api;

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('QR links page', () => {
  it('shows each link with its short address, destination, scan numbers and a QR image of the short address', async () => {
    page({ [GET]: list([JERSEY, POSTER]) });

    expect(await screen.findByRole('heading', { name: 'QR links' })).toBeInTheDocument();
    expect(screen.getByText('The code printed on a jersey or poster never changes. Change where it leads here, any time.')).toBeInTheDocument();

    const jersey = await screen.findByRole('region', { name: 'QR link j' });
    expect((within(jersey).getByLabelText('Short address of j') as HTMLInputElement).value).toBe('https://blynk.lk/q/j');
    expect((within(jersey).getByLabelText('Opens for j') as HTMLInputElement).value).toBe(JERSEY.url);
    expect(within(jersey).getByText('128')).toBeInTheDocument();
    expect(within(jersey).getByText('31')).toBeInTheDocument();
    expect(within(jersey).getByText('4')).toBeInTheDocument();
    expect(within(jersey).getByText('21 Oct 2026, 14:00 (Sri Lanka time)')).toBeInTheDocument();
    expect(within(jersey).queryByText('This leaves blynk.lk')).toBeNull();
    expect(within(jersey).getByRole('checkbox', { name: /Add campaign tags/ })).toBeChecked();

    const test = within(jersey).getByRole('link', { name: 'Test j' });
    expect(test).toHaveAttribute('href', JERSEY.url);
    expect(test).toHaveAttribute('target', '_blank');
    expect(test.getAttribute('rel')).toContain('noopener');

    // The picture is drawn in the browser, from the short address and never the destination.
    const picture = await within(jersey).findByRole('img', { name: 'QR code for https://blynk.lk/q/j' });
    await waitFor(() => expect(picture.querySelector('svg')).not.toBeNull());
    expect(picture.innerHTML).toContain('#12151F');
    expect(picture.innerHTML).not.toContain('example.com');

    const poster = screen.getByRole('region', { name: 'QR link poster' });
    expect(within(poster).getByText('No scans yet')).toBeInTheDocument();
    expect(within(poster).getByText('This leaves blynk.lk')).toBeInTheDocument();
    expect(within(poster).getByRole('checkbox', { name: /Add campaign tags/ })).not.toBeChecked();
    expect(within(poster).getByRole('img', { name: 'QR code for https://blynk.lk/q/poster' })).toBeInTheDocument();
  });

  it('copies the short address', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    page({ [GET]: list([JERSEY]) });
    const card = await screen.findByRole('region', { name: 'QR link j' });
    await user.click(within(card).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('https://blynk.lk/q/j');
    expect(await screen.findByText('Short address copied.')).toBeInTheDocument();
  });

  it('downloads the SVG as blynk-qr-<code>.svg', async () => {
    const user = userEvent.setup();
    let name = '';
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:qr', revokeObjectURL: () => undefined }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    page({ [GET]: list([JERSEY]) });
    const card = await screen.findByRole('region', { name: 'QR link j' });
    await user.click(within(card).getByRole('button', { name: 'Download SVG' }));
    await waitFor(() => expect(name).toBe('blynk-qr-j.svg'));
    expect(within(card).getByRole('button', { name: 'Download PNG' })).toBeInTheDocument();
  });

  it('keeps Save off until something changes, then saves the whole list with PUT', async () => {
    const user = userEvent.setup();
    const api = page({ [GET]: list([JERSEY, POSTER]), [PUT]: putEchoes });
    const card = await screen.findByRole('region', { name: 'QR link poster' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    const opens = within(card).getByLabelText('Opens for poster');
    await user.clear(opens);
    await user.type(opens, 'https://blynk.lk/app/?x=1');
    expect(within(card).queryByText('This leaves blynk.lk')).toBeNull();
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(api.find('PUT', PATH)).toHaveLength(1));
    expect(api.find('PUT', PATH)[0]!.body).toEqual({
      links: [
        { code: 'j', label: 'Jersey', url: JERSEY.url },
        { code: 'poster', label: 'Shop poster', url: 'https://blynk.lk/app/?x=1' },
      ],
    });
    expect(await screen.findByText('QR links saved.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
  });

  it('the campaign tags checkbox appends the tags and takes them off again', async () => {
    const user = userEvent.setup();
    page({ [GET]: list([POSTER]) });
    const card = await screen.findByRole('region', { name: 'QR link poster' });
    await user.click(within(card).getByRole('checkbox', { name: /Add campaign tags/ }));
    expect((within(card).getByLabelText('Opens for poster') as HTMLInputElement).value).toBe(
      'https://example.com/promo?utm_source=poster&utm_medium=qr&utm_campaign=poster'
    );
    await user.click(within(card).getByRole('checkbox', { name: /Add campaign tags/ }));
    expect((within(card).getByLabelText('Opens for poster') as HTMLInputElement).value).toBe('https://example.com/promo');
  });

  it('adds a link (code lowercased, checked) and removes one after the confirm', async () => {
    const user = userEvent.setup();
    const api = page({ [GET]: list([JERSEY]), [PUT]: putEchoes });
    await screen.findByRole('region', { name: 'QR link j' });

    // A code that is already used, then a bad address, are refused before anything is added.
    await user.type(screen.getByLabelText('New code'), 'J');
    expect(screen.getByLabelText('New code')).toHaveValue('j');
    await user.type(screen.getByLabelText('New name'), 'Another');
    await user.type(screen.getByLabelText('New destination'), 'http://blynk.lk');
    await user.click(screen.getByRole('button', { name: 'Add QR link' }));
    expect(screen.getByText('The code "j" is already used')).toBeInTheDocument();
    expect(screen.getByText('The address must start with https://')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'QR link another' })).toBeNull();

    await user.clear(screen.getByLabelText('New code'));
    await user.type(screen.getByLabelText('New code'), 'Table-1');
    await user.clear(screen.getByLabelText('New destination'));
    await user.type(screen.getByLabelText('New destination'), 'https://blynk.lk/app/');
    await user.click(screen.getByRole('button', { name: 'Add QR link' }));
    const fresh = await screen.findByRole('region', { name: 'QR link table-1' });
    expect((within(fresh).getByLabelText('Short address of table-1') as HTMLInputElement).value).toBe('https://blynk.lk/q/table-1');

    // Remove the jersey: the confirm warns, and Cancel keeps it.
    await user.click(within(screen.getByRole('region', { name: 'QR link j' })).getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Any code already printed will open the Blynk shop instead.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('region', { name: 'QR link j' })).toBeInTheDocument();

    await user.click(within(screen.getByRole('region', { name: 'QR link j' })).getByRole('button', { name: 'Remove' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('region', { name: 'QR link j' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', PATH)).toHaveLength(1));
    expect(api.find('PUT', PATH)[0]!.body).toEqual({ links: [{ code: 'table-1', label: 'Another', url: 'https://blynk.lk/app/' }] });
  });

  it('shows a server validation error on the right card', async () => {
    const user = userEvent.setup();
    page({
      [GET]: list([JERSEY, POSTER]),
      [PUT]: () => ({
        status: 400,
        error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ field: 'links.1.url', message: 'The address cannot contain a sign-in' }] },
      }),
    });
    const poster = await screen.findByRole('region', { name: 'QR link poster' });
    await user.type(within(poster).getByLabelText('Name of poster'), ' 2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await within(poster).findByText('The address cannot contain a sign-in')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'QR link j' })).queryByText('The address cannot contain a sign-in')).toBeNull();
    expect(screen.getByText('Check the highlighted fields.')).toBeInTheDocument();
  });
});
