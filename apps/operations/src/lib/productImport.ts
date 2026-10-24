import type { ImportRow, ImportRowResult } from '../api/types';
import { TEMPLATE_COLUMNS, buildTemplateWorkbook } from './importTemplate';
import { MAX_MARKUP_PERCENT, MAX_SELLING_PRICE, capAtMrp, markupPrice, variantPricingSourceLabel, type VariantPricingSource } from './pricing';

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

/**
 * Exact header text, in this order (API contract §4; pricing columns since
 * migration 044, owner 2026-10-13). Pricing per row:
 *   selling_price filled  -> FIXED at exactly that price;
 *   markup_percent filled -> MARKUP with that product markup;
 *   neither               -> a new product: MARKUP on the category / parent /
 *                            global markup; an existing SKU keeps its pricing.
 * Both filled is an error.
 */
export { PRICING_RULES, TEMPLATE_COLUMNS, TEMPLATE_EXAMPLE_ROWS, VARIANT_RULES } from './importTemplate';

/** The longest delivery lead time a product row may ask for (days). */
export const MAX_IMPORT_LEAD_DAYS = 30;

export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];
/** The older header for purchase_cost, still read (the server accepts it too). */
export const LEGACY_COST_COLUMN = 'cost_price';
/**
 * Optional sub-category column (2026-10-14): `category` = "Rice & Flour" plus
 * `sub_category` = "Rice" puts the product in that sidebar item. The same can
 * be written in the category cell as "Rice & Flour > Rice" (also › or →).
 * In the shared template since the variants merge; also read under any of
 * these spellings.
 */
export const SUB_CATEGORY_COLUMN = 'sub_category';
/** Optional column, not in the template (migration 060, owner 2026-10-25): extra categories, names or slugs separated by ';'. */
export const EXTRA_CATEGORIES_COLUMN = 'extra_categories';
const SUB_CATEGORY_ALIASES: Record<string, typeof SUB_CATEGORY_COLUMN | typeof EXTRA_CATEGORIES_COLUMN> = {
  sub_category: SUB_CATEGORY_COLUMN,
  subcategory: SUB_CATEGORY_COLUMN,
  'sub-category': SUB_CATEGORY_COLUMN,
  'sub category': SUB_CATEGORY_COLUMN,
  'extra categories': EXTRA_CATEGORIES_COLUMN,
  'extra-categories': EXTRA_CATEGORIES_COLUMN,
  extra_category: EXTRA_CATEGORIES_COLUMN,
  'extra category': EXTRA_CATEGORIES_COLUMN,
};
/** Shown on the import screen next to the template columns. */
export const CATEGORY_HELP =
  'category can be a category name, its slug, or "Category > Sub-category" (e.g. Rice & Flour > Rice). Or add an optional sub_category column next to category. A name used by more than one category needs its parent or the slug. Optional extra column "Extra categories" (up to 5 names or slugs separated by ;) also lists the product in those categories; leave it empty to change nothing.';
export type ImportColumn = TemplateColumn | typeof LEGACY_COST_COLUMN | typeof EXTRA_CATEGORIES_COLUMN;
const KNOWN_COLUMNS: readonly string[] = [...TEMPLATE_COLUMNS, LEGACY_COST_COLUMN, EXTRA_CATEGORIES_COLUMN];

/** Required; purchase_cost may come as the older cost_price instead. */
const REQUIRED_COLUMNS: TemplateColumn[] = ['name', 'category', 'unit', 'purchase_cost', 'sku'];

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

/**
 * A variant row (migration 045): its `variant` or `parent_sku` cell is
 * filled. It belongs to the product whose SKU is in parent_sku.
 */
export function isVariantCells(cells: Partial<Record<ImportColumn, Cell>>): boolean {
  return text(cells.variant) !== null || text(cells.parent_sku) !== null;
}

/** True for a parsed row that is a variant row. */
export function isVariantImportRow(data: ImportRow): boolean {
  return Boolean(data.variant || data.parent_sku);
}

/** Validates and normalises one data row (cells keyed by template column). */
export function parseImportRow(cells: Partial<Record<ImportColumn, Cell>>, row: number): ParsedImportRow {
  const errors: FieldError[] = [];
  const need = (field: ImportColumn) => {
    const v = text(cells[field]);
    if (v === null) errors.push({ field, message: `${field} is required.` });
    return v ?? '';
  };
  const variantRow = isVariantCells(cells);

  // A variant row takes its name, category and unit from its product; its
  // own SKU is optional (3-64 characters, never the product's).
  let name = '';
  let category = '';
  let unit = '';
  let sku = '';
  let parentSku: string | null = null;
  let variantLabel: string | null = null;
  if (variantRow) {
    parentSku = need('parent_sku') || null;
    variantLabel = need('variant') || null;
    if (variantLabel && variantLabel.length > 64) {
      errors.push({ field: 'variant', message: 'variant can be at most 64 characters.' });
    }
    sku = text(cells.sku) ?? '';
    if (sku && (sku.length < 3 || sku.length > 64)) {
      errors.push({ field: 'sku', message: 'A variant sku must be 3 to 64 characters (or leave it empty).' });
    } else if (sku && parentSku && sku === parentSku) {
      errors.push({ field: 'sku', message: "A variant's sku must differ from parent_sku (or leave it empty)." });
    }
  } else {
    name = need('name');
    category = need('category');
    unit = need('unit');
    sku = need('sku');
  }

  // delivery_lead_days: product rows only, whole days 0-30 (blank = 0 / unchanged).
  const leadDays = variantRow ? null : number(cells.delivery_lead_days);
  if (
    leadDays !== null &&
    (Number.isNaN(leadDays) || !Number.isInteger(leadDays) || leadDays < 0 || leadDays > MAX_IMPORT_LEAD_DAYS)
  ) {
    errors.push({ field: 'delivery_lead_days', message: `delivery_lead_days must be whole days from 0 to ${MAX_IMPORT_LEAD_DAYS}.` });
  }

  // purchase_cost, or the older cost_price header; both filled must agree.
  const purchaseCost = number(cells.purchase_cost);
  const costPrice = number(cells[LEGACY_COST_COLUMN]);
  const cost = purchaseCost ?? costPrice;
  const costField = purchaseCost !== null ? 'purchase_cost' : costPrice !== null ? LEGACY_COST_COLUMN : 'purchase_cost';
  if (cost === null) {
    // Blank is fine with a selling_price: no cost yet - 0 for a new product, unchanged for an existing one (owner, 2026-10-21).
    if (number(cells.selling_price) === null) errors.push({ field: 'purchase_cost', message: 'purchase_cost is required.' });
  } else if (Number.isNaN(cost)) errors.push({ field: costField, message: `${costField} must be a number.` });
  else if (cost < 0) errors.push({ field: costField, message: `${costField} cannot be negative.` });
  else if (cost > MAX_SELLING_PRICE) errors.push({ field: costField, message: `${costField} is too large.` });
  else if (!hasTwoDecimalsAtMost(cost)) errors.push({ field: costField, message: `${costField} can have at most 2 decimals.` });
  else if (purchaseCost !== null && costPrice !== null && purchaseCost !== costPrice)
    errors.push({ field: 'purchase_cost', message: 'purchase_cost and cost_price differ; fill only one of them.' });

  // selling_price = FIXED price; markup_percent = product markup; never both.
  // A selling price below the cost is allowed (the server reports a warning).
  const selling = number(cells.selling_price);
  const markup = number(cells.markup_percent);
  if (selling !== null && markup !== null) {
    errors.push({ field: 'selling_price', message: 'Give either selling_price or markup_percent, not both.' });
  } else if (selling !== null) {
    if (Number.isNaN(selling)) errors.push({ field: 'selling_price', message: 'selling_price must be a number.' });
    else if (selling <= 0) errors.push({ field: 'selling_price', message: 'selling_price must be more than 0.' });
    else if (selling > MAX_SELLING_PRICE) errors.push({ field: 'selling_price', message: 'selling_price is too large.' });
    else if (!hasTwoDecimalsAtMost(selling))
      errors.push({ field: 'selling_price', message: 'selling_price can have at most 2 decimals.' });
  } else if (markup !== null) {
    if (Number.isNaN(markup)) errors.push({ field: 'markup_percent', message: 'markup_percent must be a number.' });
    else if (markup < 0) errors.push({ field: 'markup_percent', message: 'markup_percent cannot be negative.' });
    else if (markup > MAX_MARKUP_PERCENT)
      errors.push({ field: 'markup_percent', message: `markup_percent can be at most ${MAX_MARKUP_PERCENT}.` });
    else if (!hasTwoDecimalsAtMost(markup))
      errors.push({ field: 'markup_percent', message: 'markup_percent can have at most 2 decimals.' });
  }

  // mrp (migration 048): optional on product and variant rows, above 0;
  // blank = none for a new product / size, unchanged for an existing one.
  const mrp = number(cells.mrp);
  if (mrp !== null) {
    if (Number.isNaN(mrp)) errors.push({ field: 'mrp', message: 'MRP must be a number.' });
    else if (mrp <= 0) errors.push({ field: 'mrp', message: 'MRP must be above 0.' });
    else if (mrp > MAX_SELLING_PRICE) errors.push({ field: 'mrp', message: 'MRP can be at most 99,999,999.99.' });
    else if (!hasTwoDecimalsAtMost(mrp)) errors.push({ field: 'mrp', message: 'MRP can have at most 2 decimals.' });
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
    // Blank = null (allowed with a selling_price): the server keeps an existing product's cost.
    purchase_cost: cost !== null && !Number.isNaN(cost) ? cost : null,
    selling_price: selling !== null && !Number.isNaN(selling) ? selling : null,
    markup_percent: markup !== null && !Number.isNaN(markup) ? markup : null,
    sku,
    barcode: text(cells.barcode),
    description: text(cells.description),
    tracked: trackedValue ?? null,
    opening_stock: opening !== null && !Number.isNaN(opening) ? opening : null,
    image_url: imageUrl,
  };
  // Only sent when the row uses them, so a plain product row stays as before.
  // A variant row takes its category from the product, so no sub_category.
  if (mrp !== null && !Number.isNaN(mrp) && mrp > 0) data.mrp = mrp;
  if (variantRow) {
    data.parent_sku = parentSku;
    data.variant = variantLabel;
  } else {
    const subCategory = text(cells[SUB_CATEGORY_COLUMN]);
    if (subCategory !== null) data.sub_category = subCategory;
    const extraCategories = text(cells[EXTRA_CATEGORIES_COLUMN]);
    if (extraCategories !== null) data.extra_categories = extraCategories;
    if (leadDays !== null && !Number.isNaN(leadDays)) data.delivery_lead_days = leadDays;
  }
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
  const header = (matrix[0] ?? []).map((c) => {
    const h = (text(c) ?? '').toLowerCase();
    return SUB_CATEGORY_ALIASES[h.replace(/\s+/g, ' ')] ?? h;
  });
  const index = new Map<ImportColumn, number>();
  const ignoredColumns: string[] = [];
  header.forEach((h, i) => {
    if (!h) return;
    if (KNOWN_COLUMNS.includes(h)) {
      if (!index.has(h as ImportColumn)) index.set(h as ImportColumn, i);
    } else ignoredColumns.push(h);
  });

  const missing = REQUIRED_COLUMNS.filter(
    (c) => !index.has(c) && !(c === 'purchase_cost' && index.has(LEGACY_COST_COLUMN))
  );
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

  // Two rows naming the same variant of one product (labels match ignoring case).
  const seenVariant = new Map<string, number>();
  for (const r of rows) {
    if (!r.data.parent_sku || !r.data.variant) continue;
    const key = `${r.data.parent_sku.toLowerCase()}|${r.data.variant.toLowerCase()}`;
    const first = seenVariant.get(key);
    if (first !== undefined) r.errors.push({ field: 'variant', message: `Same variant as row ${first}.` });
    else seenVariant.set(key, r.row);
  }

  return { rows, fileErrors, ignoredColumns };
}

/** A row's name for the preview / errors CSV: a variant row reads "CHILLI-PWD - 100 g". */
export function importRowName(data: ImportRow): string {
  if (isVariantImportRow(data)) return `${data.parent_sku ?? ''} - ${data.variant ?? ''}`;
  return data.name;
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
    for (const e of p.errors) lines.push([String(p.row), p.data.sku, importRowName(p.data), e.field, e.message]);
  }
  for (const r of results) {
    if (r.status !== 'error') continue;
    const parsedRow = byRow.get(r.row);
    const name = parsedRow ? importRowName(parsedRow.data) : r.variant ? `${r.parent_sku ?? ''} - ${r.variant}` : '';
    const sku = r.sku ?? byRow.get(r.row)?.data.sku ?? '';
    if (r.errors && r.errors.length > 0) {
      for (const e of r.errors) lines.push([String(r.row), sku, name, e.field, e.message]);
    } else {
      lines.push([String(r.row), sku, name, '', r.message ?? 'Could not import this row.']);
    }
  }
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * The selling price and its source for one preview row: the dry run's word
 * when the server answered (authoritative), else what the file says - a
 * fixed price, or a product markup worked out on the cost - and for a row
 * that inherits its markup, no price until the server says which applies.
 */
export function rowPricing(
  data: ImportRow,
  server: ImportRowResult | undefined
): { price: number | null; source: VariantPricingSource | null; label: string; warnings: string[] } {
  if (server?.pricing) {
    const kept = server.pricing.kept_current ? ' (current pricing kept)' : '';
    return {
      price: server.pricing.selling_price,
      source: server.pricing.pricing_source,
      label: `${variantPricingSourceLabel(server.pricing.pricing_source)}${kept}`,
      warnings: server.warnings ?? [],
    };
  }
  const warnings = server?.warnings ?? [];
  const variant = isVariantImportRow(data);
  if (data.selling_price !== null && data.selling_price !== undefined) {
    // Migration 048: a price above the row's MRP is capped at it.
    return { price: capAtMrp(data.selling_price, data.mrp).price, source: 'FIXED', label: variantPricingSourceLabel('FIXED'), warnings };
  }
  if (data.markup_percent !== null && data.markup_percent !== undefined) {
    const source: VariantPricingSource = variant ? 'VARIANT_MARKUP' : 'PRODUCT_MARKUP';
    return {
      price: capAtMrp(markupPrice(data.purchase_cost ?? 0, data.markup_percent), data.mrp).price,
      source,
      label: variantPricingSourceLabel(source),
      warnings,
    };
  }
  return {
    price: null,
    source: null,
    label: variant
      ? 'Product / category / global markup (new) or current pricing (existing)'
      : 'Category / global markup (new) or current pricing (existing)',
    warnings,
  };
}

/** Human summary of one server result for the preview table. */
export function resultLabel(r: ImportRowResult | undefined): string {
  if (!r) return '';
  if (r.kind === 'variant') {
    if (r.status === 'created') return 'New variant will be added';
    if (r.status === 'updated') return 'Will update the existing variant';
  }
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

/**
 * The template (lib/importTemplate.ts, identical in the Admin site): a
 * "Products" sheet with only the header row (so nothing sample-looking can be
 * imported by accident), a "How to fill" sheet and an "Examples" sheet.
 */
export async function buildTemplateBlob(): Promise<Blob> {
  const XLSX = await import('xlsx');
  const out = buildTemplateWorkbook(XLSX);
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

/** The API reads at most 1 MB of JSON per request (express.json limit '1mb'); a bigger import is refused with 413 PAYLOAD_TOO_LARGE. */
export const MAX_IMPORT_PAYLOAD_BYTES = 1024 * 1024;

/** The exact size of the import request body, in bytes (UTF-8). */
export function importPayloadBytes(rows: unknown[], dryRun: boolean): number {
  return new TextEncoder().encode(JSON.stringify({ rows, dry_run: dryRun })).length;
}

/**
 * Null when the rows fit in one request; otherwise what to tell the operator
 * BEFORE sending - the API would only refuse it with a 413.
 */
export function importTooLargeMessage(rows: unknown[], dryRun: boolean): string | null {
  const bytes = importPayloadBytes(rows, dryRun);
  if (bytes <= MAX_IMPORT_PAYLOAD_BYTES) return null;
  // Aim a little under the limit so each part fits comfortably.
  const perFile = Math.max(1, Math.floor((rows.length * MAX_IMPORT_PAYLOAD_BYTES * 0.9) / bytes));
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return `This file is too big to send at once (${mb} MB; the limit is 1 MB). Split it into files of about ${perFile} rows and import them one by one. Nothing was sent.`;
}
