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
    expect(examples).toHaveLength(4);
    expect(examples[0]).toEqual([...TEMPLATE_COLUMNS]);
    expect(examples.slice(1).map((r) => r[TEMPLATE_COLUMNS.indexOf('sku')])).toEqual(['KOT-MILK-1L', 'RICE-SAMBA-5KG', 'SUN-SOAP-100']);
    expect(TEMPLATE_EXAMPLE_ROWS.slice(1).every((r) => r.length === TEMPLATE_COLUMNS.length)).toBe(true);
  });

  it('explains the pricing rules, including blank price cells on an existing product', () => {
    const notes = TEMPLATE_NOTES.map((r) => r.join(' | '));
    expect(notes.some((n) => /NEW product uses the category markup, else the parent category markup, else the global default markup/.test(n))).toBe(true);
    expect(notes.some((n) => /EXISTING product \(same SKU\): its current pricing is kept unchanged/.test(n))).toBe(true);
    expect(notes.some((n) => /never both/.test(n))).toBe(true);
    expect(PRICING_RULES.some((r) => /EXISTING product \(same SKU\): its current pricing is kept/.test(r))).toBe(true);
  });
});
