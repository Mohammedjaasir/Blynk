/**
 * The product import template (.xlsx), shared word for word by the Admin
 * site and the Ops app: apps/admin/src/lib/importTemplate.ts and
 * apps/operations/src/lib/importTemplate.ts must stay IDENTICAL (a test in
 * each app compares them).
 *
 * Sheets, in order:
 *   1. "Products"    - only the header row. It is the ONLY sheet an import
 *                      reads, so nothing sample-looking can be imported.
 *   2. "How to fill" - what each column means and how prices work.
 *   3. "Examples"    - three example rows, one per pricing rule.
 *
 * Pricing (migration 044; owner, 2026-10-13):
 *   selling_price filled  -> a FIXED price, exactly;
 *   markup_percent filled -> the product's own markup;
 *   both empty            -> a NEW product uses the category / parent /
 *                            global markup; an EXISTING product (same SKU)
 *                            keeps its current pricing;
 *   both filled           -> the row is refused.
 */

/** Exact template header text, in order. */
export const TEMPLATE_COLUMNS = [
  'name',
  'category',
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
] as const;

export const TEMPLATE_SHEETS = ['Products', 'How to fill', 'Examples'] as const;

/** The "Examples" sheet: header plus one row per pricing rule. */
export const TEMPLATE_EXAMPLE_ROWS: Array<Array<string | number>> = [
  [...TEMPLATE_COLUMNS],
  ['Kotmale Fresh Milk 1L', 'Dairy', '1 L', '', 300, 360, '', 'KOT-MILK-1L', '', 'Fixed price: customers pay LKR 360', 'yes', 12, ''],
  ['Samba Rice 5kg', 'Rice', '5 kg', '', 1000, '', 25, 'RICE-SAMBA-5KG', '', 'Product markup 25%: LKR 1250', 'yes', 10, ''],
  ['Sunlight Soap 100g', 'Household', '100 g', '', 80, '', '', 'SUN-SOAP-100', '', 'Category / global markup applies', 'no', '', ''],
];

/** How the price columns work (the import screens and the "How to fill" sheet). */
export const PRICING_RULES = [
  'purchase_cost is required (older files with a cost_price column still work).',
  'selling_price filled: the product gets that FIXED selling price, exactly. A price below the purchase cost is allowed and shown as a warning.',
  'markup_percent filled: the selling price is purchase_cost + that markup (0 to 999.99, up to 2 decimals).',
  'Both empty on a NEW product: the category markup applies, else its parent category markup, else the global default markup.',
  'Both empty on an EXISTING product (same SKU): its current pricing is kept, like any other empty cell.',
  'Fill selling_price or markup_percent, not both: a row with both is an error.',
  'Older files that have only selling_price now set a FIXED price (they used to become a markup).',
] as const;

/** The "How to fill" sheet. */
export const TEMPLATE_NOTES: string[][] = [
  ['column', 'required', 'what to write'],
  ['name', 'yes', 'Product name customers see, e.g. Kotmale Fresh Milk 1L'],
  ['category', 'yes', 'An existing category name or slug'],
  ['unit', 'yes', 'e.g. 1 L, 500 g, each'],
  ['pack_size', 'no', 'e.g. 6 x 1 L'],
  ['purchase_cost', 'yes', 'LKR you pay, 0 or more, up to 2 decimals (older files may call this column cost_price)'],
  ['selling_price', 'no', 'LKR. Filled = a FIXED price: customers pay exactly this. Below the cost is allowed (shown as a warning)'],
  ['markup_percent', 'no', "Filled = this product's own markup (0 to 999.99): price = purchase_cost + this %"],
  ['', '', 'Neither selling_price nor markup_percent: a NEW product uses the category markup, else the parent category markup, else the global default markup'],
  ['', '', 'Neither on an EXISTING product (same SKU): its current pricing is kept unchanged'],
  ['', '', 'Fill selling_price OR markup_percent, never both (that row is refused)'],
  ['', '', 'Old files with only selling_price now set a FIXED price for those products'],
  ['sku', 'yes', 'Unique code; an existing SKU is updated with this row (empty cells change nothing)'],
  ['barcode', 'no', ''],
  ['description', 'no', ''],
  ['tracked', 'no', 'yes to count stock, no (or blank) to source on order'],
  ['opening_stock', 'no', 'Whole number; only with tracked = yes; only used for new products'],
  ['image_url', 'no', 'https:// link to the product photo'],
  ['', '', 'Only the first sheet (Products) is imported. The Examples sheet is never imported.'],
];

type SheetJs = typeof import('xlsx');

/** The template workbook as .xlsx bytes. */
export function buildTemplateWorkbook(XLSX: SheetJs): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[...TEMPLATE_COLUMNS]]), TEMPLATE_SHEETS[0]);
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(TEMPLATE_NOTES), TEMPLATE_SHEETS[1]);
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(TEMPLATE_EXAMPLE_ROWS), TEMPLATE_SHEETS[2]);
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
