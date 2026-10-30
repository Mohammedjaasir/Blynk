import { MAX_MONEY, margin, type MapPoint } from './sellers';

/*
 * Staff tools for one seller's shop (2026-10-30 plan E2): the seller's products and adding one for
 * them, the shop location, and the commission-free period. Contract: docs/superpowers/plans/
 * 2026-10-30-seller-orders-commission-admin.md (B2). Pure helpers, no React.
 */

// ---------------------------------------------------------------- products

export type SellerProductStatus = 'LIVE' | 'PAUSED' | 'OFF';

/** One row of GET /admin/sellers/:id/products. */
export interface SellerShopProduct {
  id: string;
  name: string;
  image_url: string | null;
  category_name: string | null;
  selling_price: number | null;
  seller_price: number | null;
  is_active: boolean;
  is_available: boolean;
  /** LIVE = active and available, PAUSED = active but unavailable, OFF = not active. */
  status: SellerProductStatus;
  /** null = stock is not tracked. */
  stock_on_hand: number | null;
}

export const PRODUCT_STATUS_LABEL: Record<SellerProductStatus, string> = { LIVE: 'Live', PAUSED: 'Paused', OFF: 'Off' };
export const PRODUCT_STATUS_HELP: Record<SellerProductStatus, string> = {
  LIVE: 'On sale',
  PAUSED: "Paused by the seller, customers can't order it",
  OFF: 'Switched off',
};

/** "3 live, 1 paused, 2 off" for the Products card. */
export function productCountsText(rows: ReadonlyArray<{ status: SellerProductStatus }>): string {
  if (rows.length === 0) return 'No products yet.';
  const n = (s: SellerProductStatus) => rows.filter((r) => r.status === s).length;
  const parts = [`${n('LIVE')} live`];
  if (n('PAUSED')) parts.push(`${n('PAUSED')} paused`);
  if (n('OFF')) parts.push(`${n('OFF')} off`);
  return parts.join(', ');
}

/** "4 products live" for the sellers list ("of 6" when the API also sends the total). */
export function productsLiveText(live: number, total?: number | null): string {
  const word = (n: number) => `${n} ${n === 1 ? 'product' : 'products'}`;
  return typeof total === 'number' && total > live ? `${live} of ${word(total)} live` : `${word(live)} live`;
}

export interface NewShopProductForm {
  name: string;
  category_id: string;
  unit: string;
  pack_size: string;
  description: string;
  image_url: string | null;
  seller_price: string;
  selling_price: string;
  barcode: string;
  stock_quantity: string;
}

export const EMPTY_SHOP_PRODUCT: NewShopProductForm = {
  name: '',
  category_id: '',
  unit: '',
  pack_size: '',
  description: '',
  image_url: null,
  seller_price: '',
  selling_price: '',
  barcode: '',
  stock_quantity: '',
};

export type ShopProductField = 'name' | 'category_id' | 'unit' | 'image_url' | 'seller_price' | 'selling_price' | 'stock_quantity';

/** The body of POST /admin/sellers/:id/products. */
export interface NewShopProductBody {
  name: string;
  category_id: string;
  unit: string;
  pack_size?: string;
  description?: string;
  image_url: string;
  seller_price: number;
  selling_price: number;
  barcode?: string;
  stock_quantity?: number;
}

export const PHOTO_REQUIRED_TEXT = 'Add a photo of the product.';

function priceProblem(text: string, what: string): { value: number } | { error: string } {
  const t = text.trim().replace(/,/g, '');
  if (!t) return { error: `Enter the ${what}.` };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: `The ${what} must be a number with at most 2 decimals.` };
  const value = Number(t);
  if (!(value > 0)) return { error: `The ${what} must be more than 0.` };
  if (value > MAX_MONEY) return { error: `The ${what} is too large.` };
  return { value };
}

/** The add-product form read into the POST body, or every problem found (one text per field). */
export function newShopProductBody(form: NewShopProductForm): { body: NewShopProductBody } | { errors: Partial<Record<ShopProductField, string>> } {
  const errors: Partial<Record<ShopProductField, string>> = {};
  const name = form.name.trim();
  if (name.length < 2) errors.name = 'Enter the product name (at least 2 characters).';
  else if (name.length > 160) errors.name = 'The name can be at most 160 characters.';
  if (!form.category_id) errors.category_id = 'Choose a category.';
  const unit = form.unit.trim();
  if (!unit) errors.unit = 'Enter the unit, like 1 kg or each.';
  if (!form.image_url) errors.image_url = PHOTO_REQUIRED_TEXT;
  const seller = priceProblem(form.seller_price, "seller's price");
  if ('error' in seller) errors.seller_price = seller.error;
  const selling = priceProblem(form.selling_price, 'customer price');
  if ('error' in selling) errors.selling_price = selling.error;
  let stock: number | null = null;
  const stockText = form.stock_quantity.trim();
  if (stockText) {
    if (!/^\d+$/.test(stockText) || Number(stockText) > 100_000) errors.stock_quantity = 'Opening stock must be a whole number from 0 to 100000.';
    else stock = Number(stockText);
  }
  if (Object.keys(errors).length > 0 || 'error' in seller || 'error' in selling || !form.image_url) return { errors };
  return {
    body: {
      name,
      category_id: form.category_id,
      unit,
      ...(form.pack_size.trim() ? { pack_size: form.pack_size.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      image_url: form.image_url,
      seller_price: seller.value,
      selling_price: selling.value,
      ...(form.barcode.trim() ? { barcode: form.barcode.trim() } : {}),
      ...(stock !== null ? { stock_quantity: stock } : {}),
    },
  };
}

/** A gentle note under the prices when Blynk would sell below what the seller is paid (not a block). */
export function belowSellerPriceNote(sellerText: string, sellingText: string): string | null {
  const s = priceProblem(sellerText, 'x');
  const c = priceProblem(sellingText, 'x');
  if ('error' in s || 'error' in c) return null;
  return margin(c.value, s.value).belowCost ? "The customer price is lower than the seller's price: Blynk would lose money on each sale." : null;
}

// ---------------------------------------------------------------- shop location

const NUM = '-?\\d+(?:\\.\\d+)?';

/**
 * A pasted Google Maps position: "7.290572, 80.633728", "7.29 80.63", a maps link with @lat,lng or
 * ?q=lat,lng (or !3dlat!4dlng). null when no valid position is in the text.
 */
export function parseLatLng(text: string): MapPoint | null {
  const t = decodeURIComponent(safe(text)).trim();
  if (!t) return null;
  const patterns = [
    new RegExp(`^\\s*(${NUM})\\s*[,;\\s]\\s*(${NUM})\\s*$`),
    new RegExp(`@(${NUM}),(${NUM})`),
    new RegExp(`[?&](?:q|ll|query|destination)=(${NUM}),\\s*(${NUM})`),
    new RegExp(`!3d(${NUM})!4d(${NUM})`),
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

/** decodeURIComponent that does not throw on a stray "%". */
function safe(text: string): string {
  try {
    decodeURIComponent(text);
    return text;
  } catch {
    return text.replace(/%/g, '%25');
  }
}

export const HOW_TO_FIND_MAX = 200;

export interface LocationForm {
  latitude: string;
  longitude: string;
  how_to_find: string;
}

/** A coordinate typed in its own field, or null when it is not a valid number in range. */
export function parseCoordinate(text: string, kind: 'lat' | 'lng'): number | null {
  const t = text.trim();
  if (!new RegExp(`^${NUM}$`).test(t)) return null;
  const n = Number(t);
  return Math.abs(n) <= (kind === 'lat' ? 90 : 180) ? n : null;
}

/** The shop location form read into the PUT body, or the problem per field. */
export function locationBody(
  form: LocationForm
): { body: { latitude: number; longitude: number; how_to_find?: string } } | { errors: Partial<Record<'latitude' | 'longitude' | 'how_to_find', string>> } {
  const errors: Partial<Record<'latitude' | 'longitude' | 'how_to_find', string>> = {};
  const lat = parseCoordinate(form.latitude, 'lat');
  const lng = parseCoordinate(form.longitude, 'lng');
  if (lat === null) errors.latitude = 'Enter the latitude, a number from -90 to 90 (like 7.290572).';
  if (lng === null) errors.longitude = 'Enter the longitude, a number from -180 to 180 (like 80.633728).';
  if (form.how_to_find.trim().length > HOW_TO_FIND_MAX) errors.how_to_find = `At most ${HOW_TO_FIND_MAX} characters.`;
  if (lat === null || lng === null || Object.keys(errors).length > 0) return { errors };
  return { body: { latitude: lat, longitude: lng, ...(form.how_to_find.trim() ? { how_to_find: form.how_to_find.trim() } : {}) } };
}

// ---------------------------------------------------------------- commission-free period

const DAY_MS = 86_400_000;
export const EXTEND_DAYS = 30;

export type FreePeriod =
  | { state: 'none' }
  | { state: 'active'; until: string; daysLeft: number }
  | { state: 'ended'; until: string };

/** Where a seller's commission-free period stands. `until` null/absent = no period. */
export function freePeriod(until: string | null | undefined, now: Date = new Date()): FreePeriod {
  if (!until) return { state: 'none' };
  const end = new Date(until).getTime();
  if (Number.isNaN(end)) return { state: 'none' };
  if (end <= now.getTime()) return { state: 'ended', until };
  return { state: 'active', until, daysLeft: Math.max(1, Math.ceil((end - now.getTime()) / DAY_MS)) };
}

/** "23 days left", "1 day left". */
export const daysLeftText = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'} left`;

/** Extend by 30 days: from the end of the running period, or from now when it is over or never was. */
export function extendedUntil(until: string | null | undefined, now: Date = new Date(), days = EXTEND_DAYS): string {
  const end = until ? new Date(until).getTime() : NaN;
  const from = Number.isNaN(end) ? now.getTime() : Math.max(end, now.getTime());
  return new Date(from + days * DAY_MS).toISOString();
}

/** The last moment (Sri Lanka time) of a YYYY-MM-DD day, as an ISO instant. */
export const endOfColomboDay = (day: string): string => new Date(`${day}T23:59:59+05:30`).toISOString();

/** The Colombo day (YYYY-MM-DD) of an ISO instant, for the date field. */
export function colomboDayOf(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return parts;
}

/** "Free month for new sellers (days)": a whole number 0 to 365 (0 = none). */
export function parseFreeDays(text: string): { value: number } | { error: string } {
  const t = text.trim();
  if (!/^\d+$/.test(t) || Number(t) > 365) return { error: 'Use a whole number of days from 0 to 365 (0 for none).' };
  return { value: Number(t) };
}
