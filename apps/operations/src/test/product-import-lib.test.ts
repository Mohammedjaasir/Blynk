import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_DELIVERY_FEE_LKR, parseDeliveryFee } from '../lib/catalog';
import {
  MAX_IMPORT_ROWS,
  TEMPLATE_COLUMNS,
  TEMPLATE_EXAMPLE_ROWS,
  buildTemplateBlob,
  errorsCsv,
  parseImportRow,
  parseSheet,
  readImportFile,
  resultLabel,
  rowPricing,
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
  purchase_cost: 300,
  sku: 'KOT-MILK-1L',
};

describe('productImport: template', () => {
  it('uses the exact contract columns in order', () => {
    expect(TEMPLATE_COLUMNS).toEqual([
      'name',
      'category',
      'sub_category',
      'unit',
      'pack_size',
      'purchase_cost',
      'selling_price',
      'markup_percent',
      'sku',
      'barcode',
      'description',
      'tracked',
      'opening_stock',
      'image_url',
      'parent_sku',
      'variant',
      'delivery_lead_days',
    ]);
  });

  it('builds an .xlsx whose first sheet is just the header row (round-trips through the reader)', async () => {
    const blob = await buildTemplateBlob();
    const matrix = await readImportFile(new File([blob], 'template.xlsx'));
    expect(matrix[0]).toEqual(HEADER);
    expect(parseSheet(matrix).fileErrors).toEqual(['The file has a header but no products.']);
  });

  it('explains the three pricing rules and carries a fixed, a markup and an inherited example (never on the imported sheet)', async () => {
    const XLSX = await import('xlsx');
    const blob = await buildTemplateBlob();
    const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    const wb = XLSX.read(buffer, { type: 'array' });
    expect(wb.SheetNames).toEqual(['Products', 'How to fill', 'Examples']);
    const notes = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['How to fill'], { header: 1 }).map((r) => r.join(' | '));
    expect(notes.some((n) => /^selling_price \| no \| .*FIXED price.*Below the cost is allowed/.test(n))).toBe(true);
    expect(notes.some((n) => /^markup_percent \| no \| .*own markup/.test(n))).toBe(true);
    expect(notes.some((n) => /NEW product uses the category markup, else the parent category markup, else the global default markup/.test(n))).toBe(true);
    expect(notes.some((n) => /EXISTING product \(same SKU\): its current pricing is kept unchanged/.test(n))).toBe(true);
    expect(notes.some((n) => /never both/.test(n))).toBe(true);
    expect(notes.some((n) => /Old files with only selling_price now set a FIXED price/.test(n))).toBe(true);
    expect(notes.some((n) => /^purchase_cost \| yes \| .*cost_price/.test(n))).toBe(true);

    // The examples parse cleanly: one FIXED, one product markup, one inheriting,
    // a product with a fixed and a markup variant, and a lead-time product.
    const examples = parseSheet(TEMPLATE_EXAMPLE_ROWS);
    expect(examples.fileErrors).toEqual([]);
    expect(examples.rows.map((r) => r.errors)).toEqual([[], [], [], [], [], [], []]);
    expect(examples.rows.map((r) => rowPricing(r.data, undefined).source)).toEqual([
      'FIXED',
      'PRODUCT_MARKUP',
      null,
      null,
      'FIXED',
      'VARIANT_MARKUP',
      'FIXED',
    ]);
    expect(examples.rows[5]!.data).toMatchObject({ parent_sku: 'CHILLI-PWD', variant: '100 g', sku: 'CHILLI-PWD-100G' });
    expect(examples.rows[6]!.data).toMatchObject({ delivery_lead_days: 2 });
  });
});

describe('productImport: reading files', () => {
  it('reads a CSV keeping SKUs as text (leading zeros survive)', async () => {
    const csv = '﻿name,category,unit,purchase_cost,sku\r\nMilk,Dairy,1 L,300,00123\r\n';
    const matrix = await readImportFile(new File([csv], 'products.csv', { type: 'text/csv' }));
    const sheet = parseSheet(matrix);
    expect(sheet.fileErrors).toEqual([]);
    expect(sheet.rows[0].data).toMatchObject({ row: 2, name: 'Milk', sku: '00123', purchase_cost: 300 });
  });
});

describe('productImport: parseSheet', () => {
  it('maps headers case-insensitively in any order and numbers rows from 2, skipping blank rows', () => {
    const sheet = parseSheet([
      ['SKU', ' Name ', 'Category', 'Unit', 'Purchase_Cost', 'notes'],
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
      purchase_cost: 450,
      selling_price: null,
      markup_percent: null,
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
    expect(sheet.fileErrors[0]).toMatch(/Missing columns: category, purchase_cost, sku/);
  });

  it('accepts the older cost_price header instead of purchase_cost and sends purchase_cost', () => {
    const sheet = parseSheet([
      ['name', 'category', 'unit', 'cost_price', 'selling_price', 'sku'],
      ['Milk', 'Dairy', '1 L', '300', '350', 'M1'],
    ]);
    expect(sheet.fileErrors).toEqual([]);
    expect(sheet.ignoredColumns).toEqual([]);
    expect(sheet.rows[0].errors).toEqual([]);
    expect(sheet.rows[0].data).toMatchObject({ purchase_cost: 300, selling_price: 350, markup_percent: null });
    expect(sheet.rows[0].data).not.toHaveProperty('cost_price');
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
      { ...GOOD, selling_price: '1,250.50', purchase_cost: '1,000', tracked: 'Yes', opening_stock: '12', image_url: 'https://x.test/a.jpg' },
      5
    );
    expect(r.errors).toEqual([]);
    expect(r.data).toMatchObject({ row: 5, purchase_cost: 1000, selling_price: 1250.5, tracked: 'yes', opening_stock: 12 });
  });

  it('collects every client error for a bad row', () => {
    const r = parseImportRow(
      { name: '', category: 'Dairy', unit: '', sku: 'X', purchase_cost: 'abc', tracked: 'maybe', opening_stock: '1.5', image_url: 'ftp://x' },
      3
    );
    const fields = r.errors.map((e) => e.field);
    expect(fields).toEqual(['name', 'unit', 'purchase_cost', 'tracked', 'opening_stock', 'image_url']);
  });

  it('allows a selling price below cost (the server warns), refuses 3 decimals and opening stock without tracking', () => {
    const below = parseImportRow({ ...GOOD, selling_price: 200 }, 2);
    expect(below.errors).toEqual([]);
    expect(below.data).toMatchObject({ purchase_cost: 300, selling_price: 200, markup_percent: null });
    expect(parseImportRow({ ...GOOD, purchase_cost: '1.234' }, 2).errors[0].field).toBe('purchase_cost');
    expect(parseImportRow({ ...GOOD, opening_stock: 5 }, 2).errors).toEqual([
      { field: 'opening_stock', message: 'opening_stock needs tracked = yes.' },
    ]);
    expect(parseImportRow({ ...GOOD, purchase_cost: -1 }, 2).errors[0].message).toMatch(/negative/);
  });

  it('refuses a row with both selling_price and markup_percent', () => {
    expect(parseImportRow({ ...GOOD, selling_price: 400, markup_percent: 25 }, 2).errors).toEqual([
      { field: 'selling_price', message: 'Give either selling_price or markup_percent, not both.' },
    ]);
  });

  it('checks selling_price above 0 and markup_percent 0..999.99 with 2 decimals', () => {
    expect(parseImportRow({ ...GOOD, selling_price: 0 }, 2).errors).toEqual([
      { field: 'selling_price', message: 'selling_price must be more than 0.' },
    ]);
    expect(parseImportRow({ ...GOOD, markup_percent: '25' }, 2).data).toMatchObject({ markup_percent: 25, selling_price: null });
    expect(parseImportRow({ ...GOOD, markup_percent: 0 }, 2).errors).toEqual([]);
    expect(parseImportRow({ ...GOOD, markup_percent: 1000 }, 2).errors[0]).toEqual({
      field: 'markup_percent',
      message: 'markup_percent can be at most 999.99.',
    });
    expect(parseImportRow({ ...GOOD, markup_percent: '12.345' }, 2).errors[0].field).toBe('markup_percent');
    expect(parseImportRow({ ...GOOD, markup_percent: '-5' }, 2).errors[0].message).toMatch(/negative/);
    expect(parseImportRow({ ...GOOD, markup_percent: 'lots' }, 2).errors[0].message).toMatch(/number/);
  });

  it('refuses purchase_cost and cost_price that disagree, and reads cost_price alone', () => {
    expect(parseImportRow({ ...GOOD, cost_price: 310 }, 2).errors).toEqual([
      { field: 'purchase_cost', message: 'purchase_cost and cost_price differ; fill only one of them.' },
    ]);
    expect(parseImportRow({ ...GOOD, cost_price: 300 }, 2).errors).toEqual([]);
    const { purchase_cost: _drop, ...noPurchase } = GOOD;
    expect(parseImportRow({ ...noPurchase, cost_price: '250' }, 2).data.purchase_cost).toBe(250);
    expect(parseImportRow({ ...noPurchase }, 2).errors).toEqual([{ field: 'purchase_cost', message: 'purchase_cost is required.' }]);
  });
});

describe('productImport: errorsCsv / resultLabel', () => {
  it('lists client errors and server errors, quoting and neutralising formulas', () => {
    const sheet = parseSheet([HEADER, line({ ...GOOD, name: 'Milk, "fresh"', purchase_cost: 'x' }), line({ ...GOOD, sku: 'S2', name: '=HYPERLINK()' })]);
    const csv = errorsCsv(sheet.rows, [
      { row: 3, sku: 'S2', status: 'error', errors: [{ field: 'category', message: 'Unknown category "Dairy".' }] },
      { row: 4, sku: 'S3', status: 'error', message: 'Database said no' },
      { row: 5, sku: 'S4', status: 'created' },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'row,sku,name,field,message',
      '2,KOT-MILK-1L,"Milk, ""fresh""",purchase_cost,purchase_cost must be a number.',
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

  it('rowPricing prefers the dry run, and otherwise shows what the file says', () => {
    const data = parseImportRow({ ...GOOD }, 2).data;
    expect(
      rowPricing(data, {
        row: 2,
        sku: 'a',
        status: 'created',
        pricing: { pricing_mode: 'MARKUP', pricing_source: 'CATEGORY_MARKUP', purchase_cost: 300, selling_price: 375, effective_markup_percent: 25 },
      })
    ).toEqual({ price: 375, source: 'CATEGORY_MARKUP', label: 'Category markup', warnings: [] });
    expect(rowPricing(data, undefined)).toEqual({ price: null, source: null, label: 'Category / global markup (new) or current pricing (existing)', warnings: [] });
    expect(rowPricing({ ...data, markup_percent: 12.5 }, undefined)).toMatchObject({ price: 337.5, label: 'Product markup' });
    const warn = 'The selling price LKR 90.00 is below the purchase cost LKR 300.00.';
    expect(
      rowPricing({ ...data, selling_price: 90 }, {
        row: 2,
        sku: 'a',
        status: 'created',
        pricing: { pricing_mode: 'FIXED', pricing_source: 'FIXED', purchase_cost: 300, selling_price: 90, effective_markup_percent: -70 },
        warnings: [warn],
      })
    ).toEqual({ price: 90, source: 'FIXED', label: 'Fixed', warnings: [warn] });
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
