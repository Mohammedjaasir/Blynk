import type { CategoryImportSheetRow } from '../api/types';

/**
 * Import categories, browser side (owner, 2026-10-14): the owner's list as
 * a fallback for the pre-filled text, reading an .xlsx/.csv into the rows
 * POST /admin/categories/import takes, and the sheet template. The API does
 * the real parsing and validation; this only shapes the file.
 */

/**
 * The owner's list, word for word as OWNER_CATEGORY_SETUP in
 * backend/api/src/modules/catalog/catalog.category-import.ts. The page asks
 * the API for it (GET /admin/categories/import/template) and uses this copy
 * only when that request fails.
 */
export const OWNER_CATEGORY_SETUP = `BLYNK – CATEGORY SETUP (Ops → Catalog)
1. GROCERY
- Rice & Flour → Rice | Flour | Dhal & Grams
- Oil, Sugar & Salt → Oil | Sugar & Salt | Coconut & Coconut Milk | Sauces
- Spices → Chilli & Curry Powder | Whole Spices | Curry Mixes | Goraka & Tamarind
- Vegetables → Onions & Garlic | Potatoes & Others
- Dry Fish & Tin Fish
- Noodles & Soup
2. BREAKFAST & DRINKS
- Milk Powder & Eggs
- Jam, Butter & Cereal
- Tea & Coffee
- Drinks → Milo & Nestomalt | Soft Drinks | Water & Juice
3. SNACKS
- Biscuits
- Chips & Bites
- Chocolates & Sweets → Chocolates | Jelly & Custard
- Dates & Nuts
4. BABY ITEMS
- Diapers & Wipes → Diapers | Wipes
- Baby Soap & Powder
- Baby Food & Bottles
5. LADIES ITEMS
- Sanitary Pads
- Hair Oil & Shampoo
- Creams & Beauty
- Clips, Bands & Pins
6. PERSONAL CARE
- Soap & Toothpaste
- Shaving Items
- First Aid
- Adult Diapers
7. HOUSEHOLD
- Washing Powder & Dishwash
- Cleaning Items
- Tissue, Foil & Lunch Sheets
- Batteries, Bulbs & Candles
- Mosquito Coils & Sprays
- Books & Pens (add later)`;

/** The API's limits (catalog.category-import.ts). */
export const MAX_CATEGORY_IMPORT_TEXT = 20000;
export const MAX_CATEGORY_IMPORT_ROWS = 1000;

export const CATEGORY_TEMPLATE_COLUMNS = ['main', 'category', 'sub_category', 'active'] as const;

/** The sheet template: the header plus a few example rows. */
export const CATEGORY_TEMPLATE_ROWS: string[][] = [
  [...CATEGORY_TEMPLATE_COLUMNS],
  ['Grocery', 'Rice & Flour', 'Rice', 'yes'],
  ['Grocery', 'Rice & Flour', 'Flour', 'yes'],
  ['Grocery', 'Noodles & Soup', '', 'yes'],
  ['Household', 'Books & Pens', '', 'no'],
];

export interface CategorySheetResult {
  rows: CategoryImportSheetRow[];
  fileError: string | null;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value).trim();
}

/**
 * A sheet (first row with any text = the header) -> rows keyed by the
 * header text, each with `row` = its spreadsheet row number. Blank rows are
 * skipped. The API matches the header names loosely ("Main", "Sub-category",
 * "Sidebar", "Active"...).
 */
export function categoryRowsFromMatrix(matrix: unknown[][]): CategorySheetResult {
  const headerIndex = matrix.findIndex((r) => r.some((c) => cellText(c) !== ''));
  if (headerIndex < 0) return { rows: [], fileError: 'The file is empty.' };
  const header = matrix[headerIndex]!.map(cellText);
  const normalised = header.map((h) => h.toLowerCase().replace(/[\s_-]+/g, ''));
  if (!normalised.some((h) => h.startsWith('main')) || !normalised.includes('category')) {
    return { rows: [], fileError: 'The header row needs at least the columns main and category (and optionally sub_category, active).' };
  }
  const rows: CategoryImportSheetRow[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const cells = matrix[i] ?? [];
    if (!cells.some((c) => cellText(c) !== '')) continue;
    const row: CategoryImportSheetRow = { row: i + 1 };
    header.forEach((key, col) => {
      if (key && key.toLowerCase() !== 'row') row[key] = cellText(cells[col]);
    });
    rows.push(row);
  }
  if (rows.length === 0) return { rows, fileError: 'The file has a header row but no categories.' };
  if (rows.length > MAX_CATEGORY_IMPORT_ROWS) {
    return { rows, fileError: `The file has ${rows.length} rows; import at most ${MAX_CATEGORY_IMPORT_ROWS} at a time.` };
  }
  return { rows, fileError: null };
}

type Xlsx = typeof import('xlsx');
let xlsxPromise: Promise<Xlsx> | null = null;
/** SheetJS, loaded only when a file is read or the template is built. */
const loadXlsx = () => (xlsxPromise ??= import('xlsx'));

/** Parse an uploaded .xlsx or .csv file (first sheet), like the product import does. */
export async function parseCategoryFile(file: File): Promise<CategorySheetResult> {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.csv')) {
    return { rows: [], fileError: 'Choose an .xlsx or .csv file.' };
  }
  const XLSX = await loadXlsx();
  const bytes = await file.arrayBuffer();
  let workbook;
  try {
    workbook = lower.endsWith('.csv')
      ? XLSX.read(new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, ''), { type: 'string', raw: true })
      : XLSX.read(new Uint8Array(bytes), { type: 'array' });
  } catch {
    return { rows: [], fileError: 'Could not read that file. Save it as .xlsx or .csv and try again.' };
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], fileError: 'The file is empty.' };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, {
    header: 1,
    defval: '',
    blankrows: true,
    raw: true,
  });
  return categoryRowsFromMatrix(matrix);
}

/** The category template as an .xlsx file. */
export async function buildCategoryTemplateXlsx(): Promise<Blob> {
  const XLSX = await loadXlsx();
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(CATEGORY_TEMPLATE_ROWS), 'Categories');
  const out = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
