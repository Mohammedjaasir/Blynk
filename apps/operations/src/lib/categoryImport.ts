import type { CategoryImportNodeBase, CategoryImportSheetRow } from '../api/types';

/**
 * Category import (POST /admin/categories/import, 2026-10-14).
 *
 * Main = a home section (category group), Category = a tile in it,
 * Sub-category = the sidebar inside that category. Nothing is deleted and
 * products are never touched; the server matches by name.
 */

/**
 * The owner's list, word for word the backend's OWNER_CATEGORY_SETUP
 * (backend/api/src/modules/catalog/catalog.category-import.ts). The screen
 * pre-fills it from GET /admin/categories/import/template; this copy is only
 * used when that request fails.
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

/** The sheet columns the server reads (it also matches looser spellings). */
export const CATEGORY_SHEET_COLUMNS = ['main', 'category', 'sub_category', 'active'] as const;

/** The server takes at most this many characters of text / rows per request. */
export const MAX_CATEGORY_TEXT = 20000;
export const MAX_CATEGORY_ROWS = 1000;

export interface ParsedCategorySheet {
  rows: CategoryImportSheetRow[];
  fileErrors: string[];
}

function cellText(value: unknown): string {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * A sheet read as an array of arrays (first row = header) -> rows for the
 * API. Header cells go through as written (the server matches "Main",
 * "Main category", "Sub-category", "Sidebar", "Active"... loosely); each row
 * carries `row` = its spreadsheet row number, so the server's errors point at
 * the line the operator sees in Excel. Fully blank rows are skipped but keep
 * their numbers.
 */
export function parseCategorySheet(matrix: unknown[][]): ParsedCategorySheet {
  const header = (matrix[0] ?? []).map(cellText);
  if (matrix.length === 0 || header.every((h) => !h)) {
    return { rows: [], fileErrors: ['The file is empty. Put main, category, sub_category and active in the first row.'] };
  }
  const rows: CategoryImportSheetRow[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const line = matrix[i] ?? [];
    if (line.every((c) => cellText(c) === '')) continue;
    const row: CategoryImportSheetRow = { row: i + 1 };
    header.forEach((h, at) => {
      if (!h || h.toLowerCase() === 'row') return;
      row[h] = cellText(line[at]);
    });
    rows.push(row);
  }
  const fileErrors: string[] = [];
  if (rows.length === 0) fileErrors.push('The file has a header but no category rows.');
  if (rows.length > MAX_CATEGORY_ROWS)
    fileErrors.push(`The file has ${rows.length} rows; import at most ${MAX_CATEGORY_ROWS} at a time.`);
  return { rows, fileErrors };
}

/** The badge word for a preview node. */
export function importActionLabel(node: Pick<CategoryImportNodeBase, 'action'>): string {
  if (node.action === 'create') return 'New';
  if (node.action === 'update') return 'Update';
  return 'Keep';
}
