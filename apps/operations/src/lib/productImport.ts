import type { ImportRow, ImportRowResult } from '../api/types';

/**
 * Bulk product import (spreadsheet -> `POST /admin/products/import`).
 *
 * Everything here except `readImportFile`/`buildTemplateBlob`/`downloadBlob`
 * is pure, so the parsing and validation rules are unit-tested directly.
 * SheetJS is only ever loaded with a dynamic `import('xlsx')`, so it lands in
 * its own chunk and never weighs down the main bundle - only an operator who
 * actually opens the Import screen and picks a file downloads it.
 *
 * The server validates every row again (and against the database, via the
 * dry run) - these client checks exist so an operator sees obvious mistakes
 * before anything is sent, not as the source of truth.
 */

/** Exact header text, in this order (API contract §4). */
export const TEMPLATE_COLUMNS = [
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
] as const;

export type ImportColumn = (typeof TEMPLATE_COLUMNS)[number];

const REQUIRED_COLUMNS: ImportColumn[] = ['name', 'category', 'unit', 'cost_price', 'sku'];

/** The API accepts 1..1000 rows per request. */
export const MAX_IMPORT_ROWS = 1000;

export interface FieldError {
  field: string;
  message: string;
}

export interface ParsedImportRow {
  /** 1-based spreadsheet row (the header is row 1, so data starts at 2). */
  row: number;
  data: ImportRow;
  errors: FieldError[];
}

export interface ParsedSheet {
  rows: ParsedImportRow[];
  /** Problems with the file as a whole (missing columns, too many rows). */
  fileErrors: string[];
  /** Header cells that are not template columns - ignored, but reported. */
  ignoredColumns: string[];
}

type Cell = unknown;

function text(value: Cell): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** "1,250.50" -> 1250.5; blank -> null; anything else unparseable -> NaN. */
function number(value: Cell): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const s = text(value);
  if (s === null) return null;
  const cleaned = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

function tracked(value: Cell): 'yes' | 'no' | null | undefined {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  const s = text(value)?.toLowerCase();
  if (s === undefined || s === null) return null;
  if (['yes', 'y', 'true', '1'].includes(s)) return 'yes';
  if (['no', 'n', 'false', '0'].includes(s)) return 'no';
  return undefined; // present but not understood
}

function hasTwoDecimalsAtMost(n: number): boolean {
  return Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
}

/** Validates and normalises one data row (cells keyed by template column). */
export function parseImportRow(cells: Partial<Record<ImportColumn, Cell>>, row: number): ParsedImportRow {
  const errors: FieldError[] = [];
  const need = (field: ImportColumn) => {
    const v = text(cells[field]);
    if (v === null) errors.push({ field, message: `${field} is required.` });
    return v ?? '';
  };

  const name = need('name');
  const category = need('category');
  const unit = need('unit');
  const sku = need('sku');

  const cost = number(cells.cost_price);
  if (cost === null) errors.push({ field: 'cost_price', message: 'cost_price is required.' });
  else if (Number.isNaN(cost)) errors.push({ field: 'cost_price', message: 'cost_price must be a number.' });
  else if (cost < 0) errors.push({ field: 'cost_price', message: 'cost_price cannot be negative.' });
  else if (!hasTwoDecimalsAtMost(cost)) errors.push({ field: 'cost_price', message: 'cost_price can have at most 2 decimals.' });

  const selling = number(cells.selling_price);
  if (selling !== null) {
    if (Number.isNaN(selling)) errors.push({ field: 'selling_price', message: 'selling_price must be a number.' });
    else if (selling < 0) errors.push({ field: 'selling_price', message: 'selling_price cannot be negative.' });
    else if (!hasTwoDecimalsAtMost(selling))
      errors.push({ field: 'selling_price', message: 'selling_price can have at most 2 decimals.' });
    else if (cost !== null && !Number.isNaN(cost) && selling < cost)
      errors.push({ field: 'selling_price', message: 'selling_price cannot be below cost_price.' });
  }

  const trackedValue = tracked(cells.tracked);
  if (trackedValue === undefined) errors.push({ field: 'tracked', message: 'tracked must be yes or no.' });

  const opening = number(cells.opening_stock);
  if (opening !== null) {
    if (Number.isNaN(opening) || !Number.isInteger(opening) || opening < 0)
      errors.push({ field: 'opening_stock', message: 'opening_stock must be a whole number, 0 or more.' });
    else if (trackedValue !== 'yes')
      errors.push({ field: 'opening_stock', message: 'opening_stock needs tracked = yes.' });
  }

  const imageUrl = text(cells.image_url);
  if (imageUrl !== null && !/^https?:\/\/\S+$/i.test(imageUrl))
    errors.push({ field: 'image_url', message: 'image_url must be a web address (http or https).' });

  const data: ImportRow = {
    row,
    name,
    category,
    unit,
    pack_size: text(cells.pack_size),
    cost_price: cost !== null && !Number.isNaN(cost) ? cost : 0,
    selling_price: selling !== null && !Number.isNaN(selling) ? selling : null,
    sku,
    barcode: text(cells.barcode),
    description: text(cells.description),
    tracked: trackedValue ?? null,
    opening_stock: opening !== null && !Number.isNaN(opening) ? opening : null,
    image_url: imageUrl,
  };
  return { row, data, errors };
}

/**
 * Turns a sheet read as an array of arrays (first row = header) into
 * validated rows. Header matching ignores case and surrounding spaces; column
 * order does not matter. Fully blank rows are skipped but keep their row
 * numbers, so a reported row always matches what the operator sees in Excel.
 */
export function parseSheet(matrix: Cell[][]): ParsedSheet {
  const fileErrors: string[] = [];
  const header = (matrix[0] ?? []).map((c) => (text(c) ?? '').toLowerCase());
  const index = new Map<ImportColumn, number>();
  const ignoredColumns: string[] = [];
  header.forEach((h, i) => {
    if (!h) return;
    if ((TEMPLATE_COLUMNS as readonly string[]).includes(h)) {
      if (!index.has(h as ImportColumn)) index.set(h as ImportColumn, i);
    } else ignoredColumns.push(h);
  });

  const missing = REQUIRED_COLUMNS.filter((c) => !index.has(c));
  if (matrix.length === 0 || header.every((h) => !h)) {
    return { rows: [], fileErrors: ['The file is empty. Start from the template.'], ignoredColumns };
  }
  if (missing.length > 0) {
    fileErrors.push(`Missing column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. Start from the template.`);
    return { rows: [], fileErrors, ignoredColumns };
  }

  const rows: ParsedImportRow[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const line = matrix[i] ?? [];
    if (line.every((c) => text(c) === null)) continue;
    const cells: Partial<Record<ImportColumn, Cell>> = {};
    for (const [column, at] of index) cells[column] = line[at];
    rows.push(parseImportRow(cells, i + 1));
  }

  if (rows.length === 0) fileErrors.push('The file has a header but no products.');
  if (rows.length > MAX_IMPORT_ROWS)
    fileErrors.push(`The file has ${rows.length} products; import at most ${MAX_IMPORT_ROWS} at a time.`);

  // Two rows with the same SKU: the server would error the later one - say so up front.
  const seen = new Map<string, number>();
  for (const r of rows) {
    const key = r.data.sku.toLowerCase();
    if (!key) continue;
    const first = seen.get(key);
    if (first !== undefined) r.errors.push({ field: 'sku', message: `Same SKU as row ${first}.` });
    else seen.set(key, r.row);
  }

  return { rows, fileErrors, ignoredColumns };
}

/** RFC 4180 quoting; also neutralises spreadsheet formula injection. */
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The "Download errors" CSV: one line per problem - rows the file itself got
 * wrong (never sent) and rows the server refused.
 */
export function errorsCsv(parsed: ParsedImportRow[], results: ImportRowResult[] = []): string {
  const lines = [['row', 'sku', 'name', 'field', 'message']];
  const byRow = new Map(parsed.map((p) => [p.row, p]));
  for (const p of parsed) {
    for (const e of p.errors) lines.push([String(p.row), p.data.sku, p.data.name, e.field, e.message]);
  }
  for (const r of results) {
    if (r.status !== 'error') continue;
    const name = byRow.get(r.row)?.data.name ?? '';
    const sku = r.sku ?? byRow.get(r.row)?.data.sku ?? '';
    if (r.errors && r.errors.length > 0) {
      for (const e of r.errors) lines.push([String(r.row), sku, name, e.field, e.message]);
    } else {
      lines.push([String(r.row), sku, name, '', r.message ?? 'Could not import this row.']);
    }
  }
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Human summary of one server result for the preview table. */
export function resultLabel(r: ImportRowResult | undefined): string {
  if (!r) return '';
  if (r.status === 'created') return 'Will be added';
  if (r.status === 'updated') return 'Will update the existing SKU';
  if (r.status === 'skipped') return 'No change';
  const first = r.errors?.[0];
  return first ? `${first.field}: ${first.message}` : (r.message ?? 'Error');
}

// ------------------------------------------------------------ browser only

function readFile(file: Blob, as: 'text' | 'buffer'): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string | ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    if (as === 'text') reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}

export function isSupportedFile(name: string): boolean {
  return /\.(xlsx|xls|csv)$/i.test(name);
}

/**
 * Reads the first sheet of an .xlsx/.csv file into an array of arrays.
 * CSV is read as text with `raw: true` so a SKU like "00123" stays text
 * instead of becoming the number 123.
 */
export async function readImportFile(file: File): Promise<Cell[][]> {
  const XLSX = await import('xlsx');
  const isCsv = /\.csv$/i.test(file.name);
  const workbook = isCsv
    ? XLSX.read(String(await readFile(file, 'text')).replace(/^﻿/, ''), { type: 'string', raw: true })
    : XLSX.read(await readFile(file, 'buffer'), { type: 'array' });
  const first = workbook.SheetNames[0];
  if (!first) return [];
  return XLSX.utils.sheet_to_json<Cell[]>(workbook.Sheets[first], { header: 1, defval: null, blankrows: true, raw: true });
}

/** The template: a "Products" sheet with only the header row (so nothing
 * sample-looking can be imported by accident) plus a "How to fill" sheet. */
export async function buildTemplateBlob(): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...TEMPLATE_COLUMNS]]), 'Products');
  const notes = [
    ['column', 'required', 'what to write'],
    ['name', 'yes', 'Product name customers see, e.g. Kotmale Fresh Milk 1L'],
    ['category', 'yes', 'An existing category name or slug'],
    ['unit', 'yes', 'e.g. 1 L, 500 g, each'],
    ['pack_size', 'no', 'e.g. 6 x 1 L'],
    ['selling_price', 'no', 'LKR; blank uses the store default markup; not below cost_price'],
    ['cost_price', 'yes', 'LKR you pay, 0 or more, up to 2 decimals'],
    ['sku', 'yes', 'Unique code; an existing SKU is updated with this row'],
    ['barcode', 'no', ''],
    ['description', 'no', ''],
    ['tracked', 'no', 'yes to count stock, no (or blank) to source on order'],
    ['opening_stock', 'no', 'Whole number; only with tracked = yes; only used for new products'],
    ['image_url', 'no', 'https:// link to the product photo'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notes), 'How to fill');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Saves a Blob via a temporary object URL + anchor - works in desktop and
 * mobile browsers. The Capacitor Android WebView does not handle blob:
 * downloads on its own, so inside the APK this may do nothing.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
