import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { ImportResult, ImportRow } from '../api/types';
import { ADMIN_WITH_RIDER, ok, renderAs } from './helpers';

/** Bulk product import screen (API contract §4). */

// These screens render behind the full auth + shell boot; under a loaded,
// fully parallel suite that cold start can outlast the 1s/5s defaults.
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });

beforeAll(async () => {
  await import('xlsx');
}, 60_000);

let clickSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // jsdom has no object URLs and cannot "navigate" to a download.
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }));
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  tokenStore.clear();
  clickSpy.mockRestore();
  vi.unstubAllGlobals();
});

const CSV = [
  'name,category,unit,pack_size,selling_price,cost_price,sku,barcode,description,tracked,opening_stock,image_url',
  'Kotmale Fresh Milk 1L,Dairy,1 L,,,300,KOT-1L,,,yes,10,',
  'Bad Row,Dairy,,,,abc,BAD-1,,,,,',
  'Unknown Cat,Toys,each,,,100,TOY-1,,,,,',
  'Butter,Dairy,200 g,,450,400,BUT-200,,,no,,',
].join('\r\n');

function summarize(rows: ImportRow[], dryRun: boolean): ImportResult {
  const results = rows.map((r) =>
    r.category === 'Toys'
      ? { row: r.row!, sku: r.sku, status: 'error' as const, errors: [{ field: 'category', message: 'Unknown category "Toys".' }] }
      : { row: r.row!, sku: r.sku, status: r.sku === 'BUT-200' ? ('updated' as const) : ('created' as const) }
  );
  const count = (s: string) => results.filter((r) => r.status === s).length;
  return {
    dry_run: dryRun,
    summary: { created: count('created'), updated: count('updated'), skipped: count('skipped'), errors: count('error') },
    results,
  };
}

describe('Product import', () => {
  it('previews client errors + dry run, imports only the good rows, and offers the errors CSV', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/import', {
      'POST /admin/products/import': (call) => ok(summarize(call.body.rows, call.body.dry_run)),
    });

    const input = await screen.findByLabelText('2. Choose the filled .xlsx or .csv file');
    await user.upload(input, new File([CSV], 'products.csv', { type: 'text/csv' }));

    // Dry run: only the client-valid rows go to the server.
    await waitFor(() => expect(api.find('POST', '/admin/products/import')).toHaveLength(1), { timeout: 10_000 });
    const dry = api.find('POST', '/admin/products/import')[0].body;
    expect(dry.dry_run).toBe(true);
    expect(dry.rows.map((r: ImportRow) => r.row)).toEqual([2, 4, 5]);
    expect(dry.rows[0]).toEqual({
      row: 2,
      name: 'Kotmale Fresh Milk 1L',
      category: 'Dairy',
      unit: '1 L',
      pack_size: null,
      cost_price: 300,
      selling_price: null,
      sku: 'KOT-1L',
      barcode: null,
      description: null,
      tracked: 'yes',
      opening_stock: 10,
      image_url: null,
    });

    // Preview shows client errors and the server's verdict per row.
    const table = await screen.findByRole('table');
    expect(within(table).getByText(/unit: unit is required\./)).toBeInTheDocument();
    expect(within(table).getByText('category: Unknown category "Toys".')).toBeInTheDocument();
    expect(within(table).getByText('Will be added')).toBeInTheDocument();
    expect(within(table).getByText('Will update the existing SKU')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download errors' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Import 2 products' }));
    await waitFor(() => expect(api.find('POST', '/admin/products/import')).toHaveLength(2));
    const real = api.find('POST', '/admin/products/import')[1].body;
    expect(real.dry_run).toBe(false);
    expect(real.rows.map((r: ImportRow) => r.sku)).toEqual(['KOT-1L', 'BUT-200']);

    const summary = await screen.findByRole('region', { name: 'Import summary' });
    const value = (label: string) => within(summary).getByText(label).parentElement!.querySelector('.card__value')!.textContent;
    expect(value('Created')).toBe('1');
    expect(value('Updated')).toBe('1');
    expect(value('Skipped')).toBe('0');
    expect(value('Errors')).toBe('2');
    await user.click(within(summary).getByRole('button', { name: 'Download errors' }));
    expect(clickSpy).toHaveBeenCalledTimes(2);
  }, 30_000);

  it('a file missing required columns is refused without calling the server', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/import');
    const input = await screen.findByLabelText('2. Choose the filled .xlsx or .csv file');
    await user.upload(input, new File(['name,unit\r\nMilk,1 L\r\n'], 'p.csv', { type: 'text/csv' }));
    expect(await screen.findByText(/Missing columns: category, cost_price, sku/, undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(api.find('POST', '/admin/products/import')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /^Import \d/ })).not.toBeInTheDocument();
  }, 30_000);

  it('Download template builds an .xlsx and triggers a download', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/catalog/products/import');
    await user.click(await screen.findByRole('button', { name: 'Download template' }));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  }, 30_000);
});

describe('Product import: request size', () => {
  it('shows a 413 PAYLOAD_TOO_LARGE as a clear "split the file" message', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/catalog/products/import', {
      'POST /admin/products/import': () => ({ status: 413, error: { code: 'PAYLOAD_TOO_LARGE', message: 'request entity too large' } }),
    });
    const input = await screen.findByLabelText('2. Choose the filled .xlsx or .csv file');
    await user.upload(input, new File([CSV], 'products.csv', { type: 'text/csv' }));
    expect(await screen.findByText(/too much to send at once \(over 1 MB\)\. Split it into smaller files/)).toBeInTheDocument();
  });

  it('warns before sending when the rows would be over 1 MB, and sends nothing', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/import', {
      'POST /admin/products/import': (call) => ok(summarize(call.body.rows, call.body.dry_run)),
    });
    const longText = 'x'.repeat(1500);
    const rows = Array.from({ length: 800 }, (_, i) => `Product ${i},Dairy,1 L,,,300,SKU-${i},,${longText},,,`);
    const big = [CSV.split('\r\n')[0], ...rows].join('\r\n');
    const input = await screen.findByLabelText('2. Choose the filled .xlsx or .csv file');
    await user.upload(input, new File([big], 'big.csv', { type: 'text/csv' }));
    expect(await screen.findByText(/too big to send at once .*the limit is 1 MB/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/products/import')).toHaveLength(0);
  });
});
