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
  'name,category,unit,pack_size,purchase_cost,selling_price,markup_percent,sku,barcode,description,tracked,opening_stock,image_url',
  'Kotmale Fresh Milk 1L,Dairy,1 L,,300,,,KOT-1L,,,yes,10,',
  'Bad Row,Dairy,,,abc,,,BAD-1,,,,,',
  'Unknown Cat,Toys,each,,100,,,TOY-1,,,,,',
  'Butter,Dairy,200 g,,400,450,,BUT-200,,,no,,',
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
      purchase_cost: 300,
      selling_price: null,
      markup_percent: null,
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
    expect(await screen.findByText(/Missing columns: category, purchase_cost, sku/, undefined, { timeout: 10_000 })).toBeInTheDocument();
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

describe('Product import: selling-price modes (migration 044)', () => {
  /** A dry run shaped like the server's: pricing + warnings on every non-error row. */
  function priced(rows: ImportRow[], dryRun: boolean): ImportResult {
    const results = rows.map((r) => {
      if (r.selling_price != null) {
        const warnings =
          r.selling_price < r.purchase_cost
            ? [`The selling price LKR ${r.selling_price.toFixed(2)} is below the purchase cost LKR ${r.purchase_cost.toFixed(2)}.`]
            : [];
        return {
          row: r.row!,
          sku: r.sku,
          status: 'created' as const,
          pricing: { pricing_mode: 'FIXED' as const, pricing_source: 'FIXED' as const, purchase_cost: r.purchase_cost, selling_price: r.selling_price, effective_markup_percent: null },
          warnings,
        };
      }
      if (r.markup_percent != null) {
        return {
          row: r.row!,
          sku: r.sku,
          status: 'created' as const,
          pricing: { pricing_mode: 'MARKUP' as const, pricing_source: 'PRODUCT_MARKUP' as const, purchase_cost: r.purchase_cost, selling_price: 130, effective_markup_percent: r.markup_percent },
        };
      }
      return {
        row: r.row!,
        sku: r.sku,
        status: 'skipped' as const,
        pricing: { pricing_mode: 'MARKUP' as const, pricing_source: 'CATEGORY_MARKUP' as const, purchase_cost: r.purchase_cost, selling_price: 125, effective_markup_percent: 25 },
      };
    });
    const count = (st: string) => results.filter((x) => x.status === st).length;
    return { dry_run: dryRun, summary: { created: count('created'), updated: 0, skipped: count('skipped'), errors: 0 }, results };
  }

  it('explains the three pricing rules on the screen', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/products/import');
    const rules = await screen.findByLabelText('How prices are set');
    expect(rules).toHaveTextContent(/selling_price filled: the product gets that FIXED selling price, exactly/);
    expect(rules).toHaveTextContent(/markup_percent filled: the selling price is purchase_cost \+ that markup/);
    expect(rules).toHaveTextContent(/Both empty on a NEW product: the category markup applies, else its parent category markup, else the global default markup/);
    expect(rules).toHaveTextContent(/Both empty on an EXISTING product \(same SKU\): its current pricing is kept/);
    expect(rules).toHaveTextContent(/not both/);
    expect(rules).toHaveTextContent(/Older files that have only selling_price now set a FIXED price/);
    expect(screen.getByText(/purchase_cost, selling_price, markup_percent/)).toBeInTheDocument();
  });

  it('previews each row\'s selling price, its source and below-cost warnings; both columns filled is a row error', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/products/import', {
      'POST /admin/products/import': (call) => ok(priced(call.body.rows, call.body.dry_run)),
    });
    // An older file: cost_price instead of purchase_cost still works.
    const csv = [
      'name,category,unit,cost_price,selling_price,markup_percent,sku',
      'Fixed Milk,Dairy,1 L,100,90,,FIX-1',
      'Markup Rice,Rice,1 kg,100,,30,MRK-1',
      'Plain Rice,Rice,1 kg,100,,,CAT-1',
      'Both Given,Rice,1 kg,100,120,30,BOTH-1',
    ].join('\r\n');
    const input = await screen.findByLabelText('2. Choose the filled .xlsx or .csv file');
    await user.upload(input, new File([csv], 'old.csv', { type: 'text/csv' }));

    await waitFor(() => expect(api.find('POST', '/admin/products/import')).toHaveLength(1), { timeout: 10_000 });
    const dry = api.find('POST', '/admin/products/import')[0].body;
    // The both-given row never goes; the rest are sent with purchase_cost.
    expect(dry.rows.map((r: ImportRow) => r.sku)).toEqual(['FIX-1', 'MRK-1', 'CAT-1']);
    expect(dry.rows[0]).toMatchObject({ purchase_cost: 100, selling_price: 90, markup_percent: null });
    expect(dry.rows[0]).not.toHaveProperty('cost_price');
    expect(dry.rows[1]).toMatchObject({ purchase_cost: 100, selling_price: null, markup_percent: 30 });

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Selling price' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Price from' })).toBeInTheDocument();
    const row = (sku: string) => within(table).getByText(sku).closest('tr') as HTMLElement;
    await waitFor(() => expect(within(row('FIX-1')).getByText('Fixed')).toBeInTheDocument());
    expect(within(row('FIX-1')).getByText('90.00')).toBeInTheDocument();
    // Below cost is a warning, not an error: the row is still imported.
    expect(within(row('FIX-1')).getByText(/Warning: The selling price LKR 90.00 is below the purchase cost LKR 100.00./)).toBeInTheDocument();
    expect(within(row('MRK-1')).getByText('Product markup')).toBeInTheDocument();
    expect(within(row('MRK-1')).getByText('130.00')).toBeInTheDocument();
    expect(within(row('CAT-1')).getByText('Category markup')).toBeInTheDocument();
    expect(within(row('CAT-1')).getByText('125.00')).toBeInTheDocument();
    expect(within(row('BOTH-1')).getByText(/selling_price: Give either selling_price or markup_percent, not both\./)).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Import 3 products' })).toBeEnabled();
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
    const rows = Array.from({ length: 800 }, (_, i) => `Product ${i},Dairy,1 L,,300,,,SKU-${i},,${longText},,,`);
    const big = [CSV.split('\r\n')[0], ...rows].join('\r\n');
    const input = await screen.findByLabelText('2. Choose the filled .xlsx or .csv file');
    await user.upload(input, new File([big], 'big.csv', { type: 'text/csv' }));
    expect(await screen.findByText(/too big to send at once .*the limit is 1 MB/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/products/import')).toHaveLength(0);
  });
});
