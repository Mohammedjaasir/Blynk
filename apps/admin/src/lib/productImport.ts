import type { ImportResponse, ImportRow } from '../api/types';

/**
 * Bulk product import, browser side: turn an .xlsx/.csv file into the
 * ImportRow[] POST /admin/products/import expects, check each row before it
 * is sent, build the template and the errors CSV. Everything except the
 * file reading is pure so it can be unit tested; SheetJS is loaded lazily
 * (dynamic import) because only this page needs it.
 *
 * The API is the authority: it re-validates every row (and a dry run tells
 * the operator what would happen). These checks only catch the obvious
 * before a round trip.
 */

import { PRICING_RULES, TEMPLATE_COLUMNS, TEMPLATE_EXAMPLE_ROWS, buildTemplateWorkbook } from './importTemplate';

export { PRICING_RULES, TEMPLATE_COLUMNS, TEMPLATE_EXAMPLE_ROWS };

export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];
/**
 * Every header the import reads: the template's, the older cost_price
 * (= purchase_cost) and the optional sub_category (owner, 2026-10-14: the
 * sidebar item inside `category`; "Rice & Flour > Rice" in the category cell
 * works too). The shared template (importTemplate.ts, identical in the Ops
 * app) does not list sub_category; a file may add the column.
 */
export type ImportColumn = TemplateColumn | 'cost_price' | 'sub_category';
const READ_COLUMNS: readonly string[] = [...TEMPLATE_COLUMNS, 'cost_price', 'sub_category'];

/** Header spellings read as sub_category ("Sub-category", "Subcategory", "Sidebar"). */
const HEADER_ALIASES: Record<string, string> = {
  'sub-category': 'sub_category',
  subcategory: 'sub_category',
  sub_categories: 'sub_category',
  sidebar: 'sub_category',
};

/** Help text for the category cell (the import screen). */
export const CATEGORY_HELP =
  'category: an existing category name or slug. For a sub-category (sidebar item) write "Category > Sub-category" (e.g. Rice & Flour > Rice), or put the parent in category and the sub-category in an optional sub_category column. A name that exists under two categories needs its parent or its slug.';

/** Required columns; purchase_cost may be the older cost_price instead. */
const REQUIRED_COLUMNS: TemplateColumn[] = ['name', 'category', 'unit', 'purchase_cost', 'sku'];

/** The API accepts 1..1000 rows per request. */
export const MAX_IMPORT_ROWS = 1000;
/** The API's markup and price limits (catalog.import.ts). */
export const MAX_IMPORT_MARKUP = 999.99;
export const MAX_IMPORT_PRICE = 99_999_999.99;

export interface FieldError {
  field: string;
  message: string;
}

export interface ValidatedRow {
  /** 1-based spreadsheet row (header is row 1). */
  row: number;
  data: ImportRow;
  errors: FieldError[];
}

/** Two decimals at most (the API's money and markup columns). */
const atMost2Decimals = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;

export interface ParseResult {
  rows: ValidatedRow[];
  /** A problem with the file as a whole (no header, missing columns, too many rows). */
  fileError: string | null;
}

// ------------------------------------------------------------ cell helpers
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/** "1,250.50" / " 480 " / 480 -> number; blank -> null; junk -> NaN. */
function cellNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  const text = cellText(value).replace(/,/g, '');
  if (!text) return null;
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}

const normaliseHeader = (h: unknown) => {
  const key = cellText(h).toLowerCase().replace(/\s+/g, '_');
  return HEADER_ALIASES[key] ?? key;
};

// -------------------------------------------------------------- validation
/** Check one spreadsheet row and shape it for the API. */
export function validateRow(record: Partial<Record<ImportColumn, unknown>>, row: number): ValidatedRow {
  const errors: FieldError[] = [];
  const text = (key: ImportColumn) => cellText(record[key]);
  const optional = (key: ImportColumn) => text(key) || null;

  const name = text('name');
  const category = text('category');
  const unit = text('unit');
  const sku = text('sku');
  if (!name) errors.push({ field: 'name', message: 'Name is required.' });
  else if (name.length < 2) errors.push({ field: 'name', message: 'Name must be at least 2 characters.' });
  if (!category) errors.push({ field: 'category', message: 'Category is required.' });
  if (!unit) errors.push({ field: 'unit', message: 'Unit is required.' });
  if (!sku) errors.push({ field: 'sku', message: 'SKU is required.' });

  // purchase_cost, or the older cost_price; both filled must agree.
  const purchaseCell = cellNumber(record.purchase_cost);
  const costPriceCell = cellNumber(record.cost_price);
  const cost = purchaseCell !== null ? purchaseCell : costPriceCell;
  const costField = purchaseCell === null && costPriceCell !== null ? 'cost_price' : 'purchase_cost';
  if (cost === null) errors.push({ field: 'purchase_cost', message: 'Purchase cost is required.' });
  else if (Number.isNaN(cost)) errors.push({ field: costField, message: 'Purchase cost must be a number.' });
  else if (cost < 0) errors.push({ field: costField, message: 'Purchase cost cannot be negative.' });
  else if (cost > MAX_IMPORT_PRICE) errors.push({ field: costField, message: 'Purchase cost can be at most 99,999,999.99.' });
  else if (!atMost2Decimals(cost)) errors.push({ field: costField, message: 'Purchase cost can have at most 2 decimals.' });
  else if (costPriceCell !== null && purchaseCell !== null && costPriceCell !== purchaseCell) {
    errors.push({ field: 'purchase_cost', message: 'purchase_cost and cost_price differ; fill only one of them.' });
  }

  // selling_price = FIXED; markup_percent = MARKUP with that markup; neither
  // = the category / parent / global markup. Both is an error. A price below
  // cost is allowed (the dry run reports it as a warning).
  const selling = cellNumber(record.selling_price);
  const markup = cellNumber(record.markup_percent);
  if (selling !== null && markup !== null) {
    errors.push({ field: 'selling_price', message: 'Give either selling_price or markup_percent, not both.' });
  } else if (selling !== null) {
    if (Number.isNaN(selling)) errors.push({ field: 'selling_price', message: 'Selling price must be a number.' });
    else if (selling <= 0) errors.push({ field: 'selling_price', message: 'Selling price must be above 0.' });
    else if (selling > MAX_IMPORT_PRICE) errors.push({ field: 'selling_price', message: 'Selling price can be at most 99,999,999.99.' });
    else if (!atMost2Decimals(selling)) errors.push({ field: 'selling_price', message: 'Selling price can have at most 2 decimals.' });
  } else if (markup !== null) {
    if (Number.isNaN(markup)) errors.push({ field: 'markup_percent', message: 'Markup must be a number.' });
    else if (markup < 0 || markup > MAX_IMPORT_MARKUP) {
      errors.push({ field: 'markup_percent', message: 'Markup must be between 0 and 999.99.' });
    } else if (!atMost2Decimals(markup)) errors.push({ field: 'markup_percent', message: 'Markup can have at most 2 decimals.' });
  }

  const trackedText = text('tracked').toLowerCase();
  let tracked: 'yes' | 'no' | null = null;
  if (trackedText) {
    if (['yes', 'y', 'true', '1'].includes(trackedText)) tracked = 'yes';
    else if (['no', 'n', 'false', '0'].includes(trackedText)) tracked = 'no';
    else errors.push({ field: 'tracked', message: 'Tracked must be yes or no.' });
  }

  const stock = cellNumber(record.opening_stock);
  if (stock !== null) {
    if (Number.isNaN(stock) || !Number.isInteger(stock) || stock < 0) {
      errors.push({ field: 'opening_stock', message: 'Opening stock must be a whole number, 0 or more.' });
    } else if (tracked !== 'yes') {
      errors.push({ field: 'opening_stock', message: 'Opening stock needs tracked = yes.' });
    }
  }

  const imageUrl = optional('image_url');
  if (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl)) {
    errors.push({ field: 'image_url', message: 'Image URL must start with http:// or https://.' });
  }

  const data: ImportRow = {
    row,
    name,
    category,
    ...(optional('sub_category') ? { sub_category: text('sub_category') } : {}),
    unit,
    pack_size: optional('pack_size'),
    purchase_cost: cost !== null && !Number.isNaN(cost) ? cost : 0,
    selling_price: selling !== null && !Number.isNaN(selling) ? selling : null,
    markup_percent: markup !== null && !Number.isNaN(markup) ? markup : null,
    sku,
    barcode: optional('barcode'),
    description: optional('description'),
    tracked,
    opening_stock: stock !== null && !Number.isNaN(stock) ? stock : null,
    image_url: imageUrl,
  };
  return { row, data, errors };
}

/**
 * A sheet as an array of rows (first row = header) -> validated rows.
 * Blank rows are skipped; row numbers stay the spreadsheet's own.
 */
export function rowsFromMatrix(matrix: unknown[][]): ParseResult {
  const headerIndex = matrix.findIndex((r) => r.some((c) => cellText(c) !== ''));
  if (headerIndex < 0) return { rows: [], fileError: 'The file is empty.' };

  const header = matrix[headerIndex]!.map(normaliseHeader);
  const missing = REQUIRED_COLUMNS.filter(
    (c) => !header.includes(c) && !(c === 'purchase_cost' && header.includes('cost_price'))
  );
  if (missing.length) {
    return {
      rows: [],
      fileError: `Missing ${missing.length === 1 ? 'column' : 'columns'}: ${missing.join(', ')}. Use the template's header row.`,
    };
  }

  const rows: ValidatedRow[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const cells = matrix[i] ?? [];
    if (!cells.some((c) => cellText(c) !== '')) continue;
    const record: Partial<Record<ImportColumn, unknown>> = {};
    header.forEach((key, col) => {
      if (READ_COLUMNS.includes(key)) record[key as ImportColumn] = cells[col];
    });
    rows.push(validateRow(record, i + 1));
  }

  if (rows.length === 0) return { rows, fileError: 'The file has a header row but no products.' };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { rows, fileError: `The file has ${rows.length} products; import at most ${MAX_IMPORT_ROWS} at a time.` };
  }

  const seen = new Map<string, number>();
  for (const r of rows) {
    const key = r.data.sku.toLowerCase();
    if (!key) continue;
    const first = seen.get(key);
    if (first !== undefined) r.errors.push({ field: 'sku', message: `Same SKU as row ${first}.` });
    else seen.set(key, r.row);
  }
  return { rows, fileError: null };
}

// ------------------------------------------------------------- SheetJS I/O
type Xlsx = typeof import('xlsx');
let xlsxPromise: Promise<Xlsx> | null = null;
/** SheetJS is ~1 MB; load it only when the import page needs it. */
export function loadXlsx(): Promise<Xlsx> {
  xlsxPromise ??= import('xlsx');
  return xlsxPromise;
}

async function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Parse an uploaded .xlsx or .csv file (first sheet). */
export async function parseImportFile(file: File): Promise<ParseResult> {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.csv')) {
    return { rows: [], fileError: 'Choose an .xlsx or .csv file.' };
  }
  const XLSX = await loadXlsx();
  const bytes = await readBytes(file);
  let workbook;
  try {
    workbook = lower.endsWith('.csv')
      ? // raw: keep every CSV cell as text, so SKUs/barcodes keep leading zeros.
        XLSX.read(new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, ''), { type: 'string', raw: true })
      : XLSX.read(new Uint8Array(bytes), { type: 'array' });
  } catch {
    return { rows: [], fileError: 'Could not read that file. Save it as .xlsx or .csv and try again.' };
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], fileError: 'The file is empty.' };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName]!, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  return rowsFromMatrix(matrix);
}

/**
 * The template as an .xlsx file (lib/importTemplate.ts, identical in the Ops
 * app): a "Products" sheet with only the header row - the one sheet an
 * import reads - then "How to fill" and "Examples".
 */
export async function buildTemplateXlsx(): Promise<Blob> {
  const XLSX = await loadXlsx();
  const out = buildTemplateWorkbook(XLSX);
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// --------------------------------------------------------------------- CSV
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** The template as CSV: the header row only (a CSV has one sheet, so no examples that could be imported). */
export const templateCsv = () => toCsv([[...TEMPLATE_COLUMNS]]);

/**
 * One line per problem: rows the browser rejected and rows the API
 * reported as 'error'. Columns: row, sku, name, field, message.
 */
export function errorsCsv(rows: ValidatedRow[], response: ImportResponse | null): string {
  const lines: unknown[][] = [];
  const byRow = new Map(rows.map((r) => [r.row, r]));
  for (const r of rows) {
    for (const e of r.errors) lines.push([r.row, r.data.sku, r.data.name, e.field, e.message]);
  }
  for (const result of response?.results ?? []) {
    if (result.status !== 'error') continue;
    const source = byRow.get(result.row);
    const name = source?.data.name ?? '';
    const sku = result.sku ?? source?.data.sku ?? '';
    if (result.errors?.length) {
      for (const e of result.errors) lines.push([result.row, sku, name, e.field, e.message]);
    } else {
      lines.push([result.row, sku, name, '', result.message ?? 'Rejected by the server.']);
    }
  }
  lines.sort((a, b) => Number(a[0]) - Number(b[0]));
  return toCsv([['row', 'sku', 'name', 'field', 'message'], ...lines]);
}

/** Save a Blob as a file via a temporary anchor. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
