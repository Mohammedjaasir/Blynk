import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { ProductImport } from '../pages/ProductImport';
import { tokenStore } from '../api/client';
import {
  TEMPLATE_COLUMNS,
  buildTemplateXlsx,
  errorsCsv,
  loadXlsx,
  parseImportFile,
  rowsFromMatrix,
  templateCsv,
  validateRow,
} from '../lib/productImport';

/**
 * Bulk product import: the pure parsing/validation lib (with the real
 * SheetJS for the file round trips) and the page flow against a fake
 * POST /admin/products/import shaped like the contract.
 */
const HEADER = [...TEMPLATE_COLUMNS];

/** jsdom's Blob has no arrayBuffer()/text(); read it the old way. */
function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
const blobText = async (blob: Blob) => new TextDecoder().decode(await readBlob(blob));
const GOOD = ['Kotmale Fresh Milk 1L', 'Dairy', 'bottle', '1L', 430, 480, '', 'KOT-MILK-1L', '4791234567890', '', 'yes', 24, ''];

describe('productImport lib', () => {
  it('the template has exactly the contract columns, in order', async () => {
    expect(TEMPLATE_COLUMNS).toEqual([
      'name', 'category', 'unit', 'pack_size', 'purchase_cost', 'selling_price', 'markup_percent',
      'sku', 'barcode', 'description', 'tracked', 'opening_stock', 'image_url',
      'parent_sku', 'variant', 'delivery_lead_days',
    ]);
    expect(templateCsv().split('\r\n')[0]).toBe(TEMPLATE_COLUMNS.join(','));

    const XLSX = await loadXlsx();
    const blob = await buildTemplateXlsx();
    const book = XLSX.read(new Uint8Array(await readBlob(blob)), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]!]!, { header: 1 });
    expect(rows[0]).toEqual(HEADER);
  });

  it('maps a valid row to the ImportRow shape with the spreadsheet row number', () => {
    const { rows, fileError } = rowsFromMatrix([HEADER, GOOD]);
    expect(fileError).toBeNull();
    expect(rows[0]).toEqual({
      row: 2,
      errors: [],
      data: {
        row: 2,
        name: 'Kotmale Fresh Milk 1L',
        category: 'Dairy',
        unit: 'bottle',
        pack_size: '1L',
        purchase_cost: 430,
        selling_price: 480,
        markup_percent: null,
        sku: 'KOT-MILK-1L',
        barcode: '4791234567890',
        description: null,
        tracked: 'yes',
        opening_stock: 24,
        image_url: null,
        parent_sku: null,
        variant: null,
        delivery_lead_days: null,
      },
    });
  });

  it('flags missing required fields, bad numbers and inconsistent stock per row', () => {
    const fields = (record: Record<string, unknown>) => validateRow(record, 2).errors.map((e) => e.field);
    expect(fields({})).toEqual(['name', 'category', 'unit', 'sku', 'purchase_cost']);
    // The older cost_price header still works as the purchase cost.
    const base = { name: 'Milk', category: 'Dairy', unit: 'l', sku: 'M1', cost_price: '100' };
    expect(fields(base)).toEqual([]);
    expect(fields({ ...base, cost_price: 'abc' })).toEqual(['cost_price']);
    expect(fields({ ...base, cost_price: -1 })).toEqual(['cost_price']);
    // A selling price below cost is allowed now (a FIXED price; the dry run warns).
    expect(fields({ ...base, selling_price: 90 })).toEqual([]);
    expect(fields({ ...base, selling_price: 0 })).toEqual(['selling_price']);
    expect(fields({ ...base, tracked: 'maybe' })).toEqual(['tracked']);
    expect(fields({ ...base, opening_stock: 5 })).toEqual(['opening_stock']);
    expect(fields({ ...base, tracked: 'yes', opening_stock: 2.5 })).toEqual(['opening_stock']);
    expect(fields({ ...base, tracked: 'yes', opening_stock: '5' })).toEqual([]);
    expect(fields({ ...base, image_url: 'ftp://x' })).toEqual(['image_url']);
    // Blank selling price and markup mean "category / parent / global markup".
    expect(validateRow({ ...base, selling_price: '' }, 2).data).toMatchObject({ selling_price: null, markup_percent: null, purchase_cost: 100 });
  });

  it('skips blank rows, keeps row numbers, and flags duplicate SKUs after the first', () => {
    const { rows } = rowsFromMatrix([HEADER, GOOD, [], GOOD]);
    expect(rows.map((r) => r.row)).toEqual([2, 4]);
    expect(rows[0]!.errors).toEqual([]);
    expect(rows[1]!.errors).toEqual([{ field: 'sku', message: 'Same SKU as row 2.' }]);
  });

  it('reports file-level problems', () => {
    expect(rowsFromMatrix([]).fileError).toBe('The file is empty.');
    expect(rowsFromMatrix([['name', 'unit']]).fileError).toMatch(/Missing columns: category, purchase_cost, sku/);
    expect(rowsFromMatrix([HEADER]).fileError).toMatch(/no products/);
    const many = [HEADER, ...Array.from({ length: 1001 }, (_, i) => [...GOOD.slice(0, 7), `SKU-${i}`, ...GOOD.slice(8)])];
    expect(rowsFromMatrix(many).fileError).toMatch(/at most 1000/);
  });

  it('parses a CSV keeping leading zeros, and an .xlsx', async () => {
    const csv = new File(
      ['﻿name,category,unit,cost_price,sku,barcode\r\n"Milk, fresh",Dairy,l,100,0042,00123\r\n'],
      'products.csv',
      { type: 'text/csv' }
    );
    const fromCsv = await parseImportFile(csv);
    expect(fromCsv.fileError).toBeNull();
    expect(fromCsv.rows[0]!.data).toMatchObject({ name: 'Milk, fresh', sku: '0042', barcode: '00123', purchase_cost: 100 });

    // The template's imported sheet is just the header: the examples live on their own sheet.
    const xlsx = new File([await buildTemplateXlsx()], 'products.xlsx');
    const fromXlsx = await parseImportFile(xlsx);
    expect(fromXlsx.fileError).toBe('The file has a header row but no products.');
    // A filled-in workbook reads from its first sheet.
    const XLSX = await loadXlsx();
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([HEADER, GOOD]), 'Products');
    const filled = new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], 'products.xlsx');
    const fromFilled = await parseImportFile(filled);
    expect(fromFilled.fileError).toBeNull();
    expect(fromFilled.rows[0]!.data).toMatchObject({ sku: 'KOT-MILK-1L', purchase_cost: 430, selling_price: 480, opening_stock: 24 });

    expect((await parseImportFile(new File(['x'], 'products.txt'))).fileError).toBe('Choose an .xlsx or .csv file.');
  });

  it('the errors CSV lists client and server errors by row, quoted safely', () => {
    const { rows } = rowsFromMatrix([HEADER, ['', 'Dairy', 'l', '', '', '', '', ''], ['Milk, "fresh"', 'Nope', 'l', '', 10, '', '', 'B2']]);
    const csv = errorsCsv(rows, {
      dry_run: false,
      summary: { created: 0, updated: 0, skipped: 0, errors: 1 },
      results: [{ row: 3, sku: 'B2', status: 'error', errors: [{ field: 'category', message: 'Unknown category "Nope"' }] }],
    });
    expect(csv.split('\r\n')).toEqual([
      'row,sku,name,field,message',
      '2,,,name,Name is required.',
      '2,,,sku,SKU is required.',
      '2,,,purchase_cost,Purchase cost is required.',
      '3,B2,"Milk, ""fresh""",category,"Unknown category ""Nope"""',
      '',
    ]);
  });
});

// ------------------------------------------------------------------ page
type Call = { method: string; path: string; body: any };

describe('Import products page', () => {
  let calls: Call[];
  let created: string[];

  beforeEach(() => {
    tokenStore.save('access', 'refresh');
    calls = [];
    created = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).replace(/^.*\/api\/v1/, '');
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ method: init?.method ?? 'GET', path, body });
        if (path === '/admin/products/import') {
          const results = body.rows.map((r: any) =>
            r.category === 'Nope'
              ? { row: r.row, sku: r.sku, status: 'error', errors: [{ field: 'category', message: 'Unknown category "Nope"' }] }
              : { row: r.row, sku: r.sku, status: 'created', product_id: `p-${r.row}` }
          );
          const errors = results.filter((r: any) => r.status === 'error').length;
          const data = {
            dry_run: body.dry_run,
            summary: { created: results.length - errors, updated: 0, skipped: 0, errors },
            results,
          };
          if (!body.dry_run) created.push(...body.rows.map((r: any) => r.sku));
          return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data }) } as Response;
        }
        return { ok: false, status: 404, text: async () => JSON.stringify({ success: false, error: { code: 'NOT_MOCKED' } }) } as Response;
      })
    );
  });
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('preview with client + dry-run errors, import only the good rows, then a summary with Download errors', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:errors');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(
      <MemoryRouter>
        <ToastProvider>
          <ProductImport />
        </ToastProvider>
      </MemoryRouter>
    );
    const csv = [
      TEMPLATE_COLUMNS.join(','),
      'Kotmale Fresh Milk 1L,Dairy,bottle,1L,430,480,,KOT-MILK-1L,,,yes,24,',
      'Mystery,Nope,pack,,100,,,MYS-1,,,,,',
      ',Dairy,pack,,100,,,NONAME,,,,,',
    ].join('\n');
    await user.upload(screen.getByLabelText(/Spreadsheet/), new File([csv], 'products.csv', { type: 'text/csv' }));

    const preview = await screen.findByRole('table', { name: 'Preview' });
    await waitFor(() => expect(calls.filter((c) => c.body?.dry_run === true)).toHaveLength(1));
    // Rows with client errors are not even sent to the dry run.
    expect(calls[0]!.body.rows.map((r: any) => r.sku)).toEqual(['KOT-MILK-1L', 'MYS-1']);
    expect(await within(preview).findByText('category: Unknown category "Nope"')).toBeInTheDocument();
    expect(within(preview).getByText('name: Name is required.')).toBeInTheDocument();
    expect(within(preview).getByText('Will be added')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Import 1 product' }));
    await waitFor(() => expect(created).toEqual(['KOT-MILK-1L']));
    const real = calls.find((c) => c.body?.dry_run === false)!;
    expect(real.body.rows).toEqual([
      {
        row: 2, name: 'Kotmale Fresh Milk 1L', category: 'Dairy', unit: 'bottle', pack_size: '1L',
        purchase_cost: 430, selling_price: 480, markup_percent: null, sku: 'KOT-MILK-1L', barcode: null, description: null,
        tracked: 'yes', opening_stock: 24, image_url: null, parent_sku: null, variant: null, delivery_lead_days: null,
      },
    ]);

    const summary = await screen.findByRole('region', { name: 'Import summary' });
    expect(summary).toHaveTextContent('1 created · 0 updated · 0 skipped · 1 errors');
    await user.click(within(summary).getByRole('button', { name: 'Download errors' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]![0];
    expect(await blobText(blob)).toContain('4,NONAME,,name,Name is required.');
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('a file with a wrong header says what is missing and sends nothing', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ToastProvider>
          <ProductImport />
        </ToastProvider>
      </MemoryRouter>
    );
    await user.upload(screen.getByLabelText(/Spreadsheet/), new File(['title,price\nMilk,10\n'], 'bad.csv', { type: 'text/csv' }));
    expect(await screen.findByText(/Missing columns: name, category, unit, purchase_cost, sku/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
