import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_DELIVERY_FEE_LKR, parseDeliveryFee } from '../lib/catalog';
import {
  MAX_IMPORT_ROWS,
  TEMPLATE_COLUMNS,
  buildTemplateBlob,
  errorsCsv,
  parseImportRow,
  parseSheet,
  readImportFile,
  resultLabel,
} from '../lib/productImport';

// SheetJS is lazy-loaded by the lib; load it once up front so its (large)
// module transform is not billed to whichever test happens to run first.
beforeAll(async () => {
  await import('xlsx');
}, 60_000);

const HEADER = [...TEMPLATE_COLUMNS];

function line(values: Partial<Record<(typeof TEMPLATE_COLUMNS)[number], unknown>>): unknown[] {
  return TEMPLATE_COLUMNS.map((c) => values[c] ?? null);
}

const GOOD = {
  name: 'Kotmale Fresh Milk 1L',
  category: 'Dairy',
  unit: '1 L',
  cost_price: 300,
  sku: 'KOT-MILK-1L',
};

describe('productImport: template', () => {
  it('uses the exact contract columns in order', () => {
    expect(TEMPLATE_COLUMNS).toEqual([
      'name',
      'category',
      'unit',
      'pack_size',
      'selling_price',
      'cost_price',
      'sku',
      'barcode',
      'description',
      'tracked',
      'opening_stock',
      'image_url',
    ]);
  });

  it('builds an .xlsx whose first sheet is just the header row (round-trips through the reader)', async () => {
    const blob = await buildTemplateBlob();
    const matrix = await readImportFile(new File([blob], 'template.xlsx'));
    expect(matrix[0]).toEqual(HEADER);
    expect(parseSheet(matrix).fileErrors).toEqual(['The file has a header but no products.']);
  });
});

describe('productImport: reading files', () => {
  it('reads a CSV keeping SKUs as text (leading zeros survive)', async () => {
    const csv = '﻿name,category,unit,cost_price,sku\r\nMilk,Dairy,1 L,300,00123\r\n';
    const matrix = await readImportFile(new File([csv], 'products.csv', { type: 'text/csv' }));
    const sheet = parseSheet(matrix);
    expect(sheet.fileErrors).toEqual([]);
    expect(sheet.rows[0].data).toMatchObject({ row: 2, name: 'Milk', sku: '00123', cost_price: 300 });
  });
});

describe('productImport: parseSheet', () => {
  it('maps headers case-insensitively in any order and numbers rows from 2, skipping blank rows', () => {
    const sheet = parseSheet([
      ['SKU', ' Name ', 'Category', 'Unit', 'Cost_Price', 'notes'],
      ['A1', 'Apples', 'Fruit', 'kg', '450'],
      [null, '', null, null, null],
      ['B2', 'Bananas', 'fruit', 'bunch', 120],
    ]);
    expect(sheet.fileErrors).toEqual([]);
    expect(sheet.ignoredColumns).toEqual(['notes']);
    expect(sheet.rows.map((r) => r.row)).toEqual([2, 4]);
    expect(sheet.rows[0].data).toEqual({
      row: 2,
      name: 'Apples',
      category: 'Fruit',
      unit: 'kg',
      pack_size: null,
      cost_price: 450,
      selling_price: null,
      sku: 'A1',
      barcode: null,
      description: null,
      tracked: null,
      opening_stock: null,
      image_url: null,
    });
  });

  it('reports missing required columns and parses no rows', () => {
    const sheet = parseSheet([['name', 'unit'], ['Milk', '1 L']]);
    expect(sheet.rows).toEqual([]);
    expect(sheet.fileErrors[0]).toMatch(/Missing columns: category, cost_price, sku/);
  });

  it('reports an empty file', () => {
    expect(parseSheet([]).fileErrors).toEqual(['The file is empty. Start from the template.']);
  });

  it('flags a SKU repeated later in the file', () => {
    const sheet = parseSheet([HEADER, line(GOOD), line({ ...GOOD, name: 'Other' })]);
    expect(sheet.rows[0].errors).toEqual([]);
    expect(sheet.rows[1].errors).toEqual([{ field: 'sku', message: 'Same SKU as row 2.' }]);
  });

  it(`refuses more than ${MAX_IMPORT_ROWS} rows`, () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => line({ ...GOOD, sku: `S${i}` }));
    expect(parseSheet([HEADER, ...rows]).fileErrors[0]).toMatch(/at most 1000/);
  });
});

describe('productImport: parseImportRow', () => {
  it('accepts a complete valid row and normalises tracked', () => {
    const r = parseImportRow(
      { ...GOOD, selling_price: '1,250.50', cost_price: '1,000', tracked: 'Yes', opening_stock: '12', image_url: 'https://x.test/a.jpg' },
      5
    );
    expect(r.errors).toEqual([]);
    expect(r.data).toMatchObject({ row: 5, cost_price: 1000, selling_price: 1250.5, tracked: 'yes', opening_stock: 12 });
  });

  it('collects every client error for a bad row', () => {
    const r = parseImportRow(
      { name: '', category: 'Dairy', unit: '', sku: 'X', cost_price: 'abc', tracked: 'maybe', opening_stock: '1.5', image_url: 'ftp://x' },
      3
    );
    const fields = r.errors.map((e) => e.field);
    expect(fields).toEqual(['name', 'unit', 'cost_price', 'tracked', 'opening_stock', 'image_url']);
  });

  it('refuses selling below cost, 3 decimals and opening stock without tracking', () => {
    expect(parseImportRow({ ...GOOD, selling_price: 200 }, 2).errors).toEqual([
      { field: 'selling_price', message: 'selling_price cannot be below cost_price.' },
    ]);
    expect(parseImportRow({ ...GOOD, cost_price: '1.234' }, 2).errors[0].field).toBe('cost_price');
    expect(parseImportRow({ ...GOOD, opening_stock: 5 }, 2).errors).toEqual([
      { field: 'opening_stock', message: 'opening_stock needs tracked = yes.' },
    ]);
    expect(parseImportRow({ ...GOOD, cost_price: -1 }, 2).errors[0].message).toMatch(/negative/);
  });
});

describe('productImport: errorsCsv / resultLabel', () => {
  it('lists client errors and server errors, quoting and neutralising formulas', () => {
    const sheet = parseSheet([HEADER, line({ ...GOOD, name: 'Milk, "fresh"', cost_price: 'x' }), line({ ...GOOD, sku: 'S2', name: '=HYPERLINK()' })]);
    const csv = errorsCsv(sheet.rows, [
      { row: 3, sku: 'S2', status: 'error', errors: [{ field: 'category', message: 'Unknown category "Dairy".' }] },
      { row: 4, sku: 'S3', status: 'error', message: 'Database said no' },
      { row: 5, sku: 'S4', status: 'created' },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'row,sku,name,field,message',
      '2,KOT-MILK-1L,"Milk, ""fresh""",cost_price,cost_price must be a number.',
      `3,S2,'=HYPERLINK(),category,"Unknown category ""Dairy""."`,
      '4,S3,,,Database said no',
      '',
    ]);
  });

  it('describes dry-run results in plain words', () => {
    expect(resultLabel({ row: 2, sku: 'a', status: 'created' })).toBe('Will be added');
    expect(resultLabel({ row: 2, sku: 'a', status: 'updated' })).toBe('Will update the existing SKU');
    expect(resultLabel({ row: 2, sku: 'a', status: 'skipped' })).toBe('No change');
    expect(resultLabel({ row: 2, sku: 'a', status: 'error', errors: [{ field: 'category', message: 'Unknown.' }] })).toBe(
      'category: Unknown.'
    );
    expect(resultLabel(undefined)).toBe('');
  });
});

describe('parseDeliveryFee', () => {
  it('accepts 0 to 1000 with at most 2 decimals', () => {
    expect(parseDeliveryFee('0')).toEqual({ value: 0 });
    expect(parseDeliveryFee(' 199.5 ')).toEqual({ value: 199.5 });
    expect(parseDeliveryFee('1000.00')).toEqual({ value: MAX_DELIVERY_FEE_LKR });
  });

  it('refuses blank, non-numbers, negatives, 3 decimals and more than 1000', () => {
    expect(parseDeliveryFee('')).toHaveProperty('error');
    expect(parseDeliveryFee('abc')).toEqual({ error: 'Enter a number, like 250 or 199.50.' });
    expect(parseDeliveryFee('-5')).toEqual({ error: 'Enter a number, like 250 or 199.50.' });
    expect(parseDeliveryFee('10.123')).toEqual({ error: 'Use at most 2 decimals.' });
    expect(parseDeliveryFee('1000.01')).toEqual({ error: 'The fee can be at most LKR 1000.' });
  });
});
