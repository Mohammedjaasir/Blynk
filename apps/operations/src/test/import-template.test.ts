import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  PRICING_RULES,
  TEMPLATE_COLUMNS,
  TEMPLATE_EXAMPLE_ROWS,
  TEMPLATE_NOTES,
  TEMPLATE_SHEETS,
  VARIANT_RULES,
  buildTemplateWorkbook,
} from '../lib/importTemplate';

/**
 * The product import template is the same in the Admin site and the Ops app
 * (owner, 2026-10-13): Products (header only, the sheet that is imported),
 * How to fill, Examples.
 */
const here = path.resolve(__dirname, '../lib/importTemplate.ts');
const other = path.resolve(__dirname, '../../../', path.basename(path.resolve(__dirname, '../../')) === 'admin' ? 'operations' : 'admin', 'src/lib/importTemplate.ts');

describe('import template', () => {
  it('is word for word the same file in Admin and Ops', () => {
    expect(fs.existsSync(other)).toBe(true);
    expect(fs.readFileSync(here, 'utf8').replace(/\r\n/g, '\n')).toBe(fs.readFileSync(other, 'utf8').replace(/\r\n/g, '\n'));
  });

  it('has Products (header only), How to fill and Examples sheets', () => {
    const book = XLSX.read(new Uint8Array(buildTemplateWorkbook(XLSX)), { type: 'array' });
    expect(book.SheetNames).toEqual([...TEMPLATE_SHEETS]);
    expect(TEMPLATE_SHEETS).toEqual(['Products', 'How to fill', 'Examples']);
    const products = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Products!, { header: 1 });
    expect(products).toEqual([[...TEMPLATE_COLUMNS]]);
    const examples = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Examples!, { header: 1, defval: '' });
    // Header + 7 rows: the three pricing rules, a product with two variants, a lead-time product.
    expect(examples).toHaveLength(8);
    expect(examples[0]).toEqual([...TEMPLATE_COLUMNS]);
    expect(examples.slice(1).map((r) => r[TEMPLATE_COLUMNS.indexOf('sku')])).toEqual([
      'KOT-MILK-1L',
      'RICE-SAMBA-5KG',
      'SUN-SOAP-100',
      'CHILLI-PWD',
      'CHILLI-PWD-50G',
      'CHILLI-PWD-100G',
      'CAKE-RIBBON-1KG',
    ]);
    const col = (name: (typeof TEMPLATE_COLUMNS)[number]) => TEMPLATE_COLUMNS.indexOf(name);
    expect(examples.slice(1).map((r) => r[col('parent_sku')])).toEqual(['', '', '', '', 'CHILLI-PWD', 'CHILLI-PWD', '']);
    expect(examples.slice(1).map((r) => r[col('variant')])).toEqual(['', '', '', '', '50 g', '100 g', '']);
    expect(examples[7]![col('delivery_lead_days')]).toBe(2);
    expect(TEMPLATE_EXAMPLE_ROWS.slice(1).every((r) => r.length === TEMPLATE_COLUMNS.length)).toBe(true);
  });

  it('explains the pricing rules, including blank price cells on an existing product', () => {
    const notes = TEMPLATE_NOTES.map((r) => r.join(' | '));
    expect(notes.some((n) => /NEW product uses the category markup, else the parent category markup, else the global default markup/.test(n))).toBe(true);
    expect(notes.some((n) => /EXISTING product \(same SKU\): its current pricing is kept unchanged/.test(n))).toBe(true);
    expect(notes.some((n) => /never both/.test(n))).toBe(true);
    expect(PRICING_RULES.some((r) => /EXISTING product \(same SKU\): its current pricing is kept/.test(r))).toBe(true);
  });

  it('explains variant rows (parent_sku, variant) and delivery_lead_days', () => {
    const notes = TEMPLATE_NOTES.map((r) => r.join(' | '));
    // Migration 048: mrp follows them, last.
    expect(TEMPLATE_COLUMNS.slice(-4)).toEqual(['parent_sku', 'variant', 'delivery_lead_days', 'mrp']);
    expect(notes.some((n) => /^parent_sku \| variant rows \| .*SKU of the product this variant belongs to/.test(n))).toBe(true);
    expect(notes.some((n) => /^variant \| variant rows \| .*size or pack/.test(n))).toBe(true);
    expect(notes.some((n) => /^delivery_lead_days \| no \| .*0 or empty = same day, up to 30/.test(n))).toBe(true);
    expect(VARIANT_RULES.some((r) => /parent_sku/.test(r) && /variant/.test(r))).toBe(true);
    expect(VARIANT_RULES.some((r) => /delivery_lead_days/.test(r))).toBe(true);
  });
});
