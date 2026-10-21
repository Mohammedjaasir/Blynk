/**
 * The product import template (.xlsx), shared word for word by the Admin
 * site and the Ops app: apps/admin/src/lib/importTemplate.ts and
 * apps/operations/src/lib/importTemplate.ts must stay IDENTICAL (a test in
 * each app compares them).
 *
 * Sheets, in order:
 *   1. "Products"    - only the header row. It is the ONLY sheet an import
 *                      reads, so nothing sample-looking can be imported.
 *   2. "How to fill" - what each column means, how prices work, variants and
 *                      delivery lead time.
 *   3. "Examples"    - example rows: one per pricing rule, a product with
 *                      two variants, and a product with a delivery lead time.
 *
 * Pricing (migration 044; owner, 2026-10-13):
 *   selling_price filled  -> a FIXED price, exactly;
 *   markup_percent filled -> the product's own markup;
 *   both empty            -> a NEW product uses the category / parent /
 *                            global markup; an EXISTING product (same SKU)
 *                            keeps its current pricing;
 *   both filled           -> the row is refused.
 *
 * Variants (migration 045; owner, 2026-10-14): a row with `variant` filled is
 * a variant (size/pack, e.g. "100 g", "3 pack") of the product whose SKU is
 * in `parent_sku`. Variant rows need parent_sku, variant and purchase_cost;
 * name, category and unit come from the product. Each variant has its own
 * price (same rules), its own optional sku/barcode and its own stock
 * (tracked / opening_stock). Re-importing matches a variant by its product
 * and name, so nothing is created twice.
 *
 * delivery_lead_days (migration 045): the product can be delivered only N
 * days after ordering (0 or empty = same day). Product rows only.
 *
 * mrp (migration 048; owner, 2026-10-14): optional Maximum Retail Price of
 * the product (product row) or the size (variant row). A selling price above
 * it is capped at it; blank = none for a new product, unchanged for an
 * existing one.
 *
 * sub_category (owner, 2026-10-14): optional; with `category` = "Rice &
 * Flour" and `sub_category` = "Rice" the product goes in that sidebar item.
 * "Rice & Flour > Rice" in the category cell works too. Product rows only.
 */

/** Exact template header text, in order. */
export const TEMPLATE_COLUMNS = [
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
  // Migration 048: last, so older files and column positions stay as they were.
  'mrp',
] as const;

export const TEMPLATE_SHEETS = ['Products', 'How to fill', 'Examples'] as const;

/** The "Examples" sheet: header plus example rows. */
export const TEMPLATE_EXAMPLE_ROWS: Array<Array<string | number>> = [
  [...TEMPLATE_COLUMNS],
  ['Kotmale Fresh Milk 1L', 'Dairy', '', '1 L', '', 300, 360, '', 'KOT-MILK-1L', '', 'Fixed price: customers pay LKR 360 (MRP LKR 380 shown struck)', 'yes', 12, '', '', '', '', 380],
  ['Samba Rice 5kg', 'Rice & Flour', 'Rice', '5 kg', '', 1000, '', 25, 'RICE-SAMBA-5KG', '', 'Markup 25% gives LKR 1250: capped at the MRP, customers pay LKR 1200', 'yes', 10, '', '', '', '', 1200],
  ['Sunlight Soap 100g', 'Household', '', '100 g', '', 80, '', '', 'SUN-SOAP-100', '', 'Category / global markup applies', 'no', '', '', '', '', '', ''],
  ['Chilli Powder', 'Spices', '', '1 pack', '', 40, '', '', 'CHILLI-PWD', '', 'Sold in sizes: see the variant rows below', 'no', '', '', '', '', '', ''],
  ['', '', '', '', '', 40, 50, '', 'CHILLI-PWD-50G', '', 'Variant 50 g: fixed LKR 50, its own MRP LKR 60', 'yes', 20, '', 'CHILLI-PWD', '50 g', '', 60],
  ['', '', '', '', '', 70, '', 30, 'CHILLI-PWD-100G', '', 'Variant 100 g: cost 70 + 30% = LKR 91', 'yes', 15, '', 'CHILLI-PWD', '100 g', '', ''],
  ['Ribbon Cake 1kg', 'Bakery', '', '1 kg', '', 2500, 3500, '', 'CAKE-RIBBON-1KG', '', 'Delivered from 2 days after ordering', 'no', '', '', '', '', 2, ''],
];

/** How the price columns work (the import screens and the "How to fill" sheet). */
export const PRICING_RULES = [
  'purchase_cost is required, unless selling_price is filled: then it may be left empty until the supplier confirms the cost (older files with a cost_price column still work).',
  'selling_price filled: the product gets that FIXED selling price, exactly. A price below the purchase cost is allowed and shown as a warning.',
  'markup_percent filled: the selling price is purchase_cost + that markup (0 to 999.99, up to 2 decimals).',
  'Both empty on a NEW product: the category markup applies, else its parent category markup, else the global default markup.',
  'Both empty on an EXISTING product (same SKU): its current pricing is kept, like any other empty cell.',
  'Fill selling_price or markup_percent, not both: a row with both is an error.',
  'Older files that have only selling_price now set a FIXED price (they used to become a markup).',
  'mrp (optional): the Maximum Retail Price. If the selling price is higher, customers pay the MRP (the check lists these rows as "Capped at MRP"). Empty on an existing SKU keeps its MRP.',
] as const;

/** How variant rows and the delivery lead time work (the import screens and the "How to fill" sheet). */
export const VARIANT_RULES = [
  'A row with variant filled is a VARIANT (size or pack, e.g. 50 g, 100 g, 3 pack) of the product whose SKU is in parent_sku.',
  'Variant rows need parent_sku, variant and purchase_cost. name, category and unit come from the product and can be left empty.',
  'The product row can be in the same file (any order) or the product can already exist.',
  "Each variant has its own price: selling_price = fixed price, markup_percent = its own markup, both empty = the product's markup, else category / parent / global.",
  "sku and barcode on a variant row are the variant's own (optional; never the product's SKU).",
  "tracked and opening_stock on a variant row count that variant's stock (opening stock only when the variant is new).",
  'Importing again matches a variant by its product and name: nothing is created twice, empty cells change nothing.',
  'Customers see a product with variants as a price range (LKR 50 - 91) and pick a size to add to the basket.',
  'delivery_lead_days (product rows): delivered only that many days after ordering (0 or empty = same day; up to 30).',
] as const;

/** The "How to fill" sheet. */
export const TEMPLATE_NOTES: string[][] = [
  ['column', 'required', 'what to write'],
  ['name', 'yes', 'Product name customers see, e.g. Kotmale Fresh Milk 1L (empty on variant rows)'],
  ['category', 'yes', 'An existing category name or slug (empty on variant rows). For a sub-category write "Category > Sub-category", e.g. Rice & Flour > Rice'],
  ['sub_category', 'no', 'Optional: the sub-category (sidebar item) inside category, e.g. category Rice & Flour + sub_category Rice (empty on variant rows)'],
  ['unit', 'yes', 'e.g. 1 L, 500 g, each (empty on variant rows)'],
  ['pack_size', 'no', 'e.g. 6 x 1 L'],
  ['purchase_cost', 'yes', 'LKR you pay, 0 or more, up to 2 decimals (older files may call this column cost_price). May be left empty when selling_price is filled'],
  ['selling_price', 'no', 'LKR. Filled = a FIXED price: customers pay exactly this. Below the cost is allowed (shown as a warning)'],
  ['markup_percent', 'no', "Filled = this product's own markup (0 to 999.99): price = purchase_cost + this %"],
  ['', '', 'Neither selling_price nor markup_percent: a NEW product uses the category markup, else the parent category markup, else the global default markup'],
  ['', '', 'Neither on an EXISTING product (same SKU): its current pricing is kept unchanged'],
  ['', '', 'Fill selling_price OR markup_percent, never both (that row is refused)'],
  ['', '', 'Old files with only selling_price now set a FIXED price for those products'],
  ['mrp', 'no', "LKR above 0: the Maximum Retail Price on the pack. If the selling price is higher, customers pay the MRP. On a variant row: that size's own MRP. Empty = none (new) or unchanged (existing)"],
  ['sku', 'yes', "Unique code; an existing SKU is updated with this row (empty cells change nothing). On a variant row: the variant's own SKU (optional)"],
  ['barcode', 'no', ''],
  ['description', 'no', ''],
  ['tracked', 'no', 'yes to count stock, no (or blank) to source on order. Customers never see the count; when it reaches 0 they cannot order'],
  ['opening_stock', 'no', 'Whole number; only with tracked = yes; only used for new products (and new variants)'],
  ['image_url', 'no', 'https:// link to the product photo'],
  ['parent_sku', 'variant rows', 'Variant rows only: the SKU of the product this variant belongs to'],
  ['variant', 'variant rows', 'Variant rows only: the size or pack customers pick, e.g. 50 g, 100 g, 1 piece, 3 pack'],
  ['', '', 'A product with variants: one product row, then one row per variant with parent_sku = the product SKU (see the Examples sheet)'],
  ['', '', "Each variant has its own purchase_cost and price; empty price cells = the product's markup, else category / parent / global"],
  ['', '', 'Importing the same file again changes nothing: a variant is matched by its product and its name'],
  ['delivery_lead_days', 'no', 'Product rows: whole days before it can be delivered (0 or empty = same day, up to 30). Customers then pick a delivery day on or after it'],
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
