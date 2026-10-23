import type { Product } from '@/blynk/api/types';
import { VARIANT_COPY } from './variants';

/*
 * Time-limited products (owner, 2026-10-23: "juice from the morning till 6 ... product-wise,
 * category-wise"): the API sends the hours a product can be ordered (available_window, Colombo
 * 'HH:MM') and window_closed while they are shut (then is_available is false too, so the card is
 * greyed and nothing can be added). These are the words for it. Pure.
 */
type Windowed = Pick<Product, 'available_window' | 'window_closed' | 'is_available'>;

/** "6 am", "6:30 pm". */
export function clockText(t: string): string {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m === '00' ? '' : `:${m}`} ${h < 12 ? 'am' : 'pm'}`;
}

/** "6 am – 6 pm", or null when the product can be ordered any time. */
export function hoursText(p: Pick<Product, 'available_window'>): string | null {
  const w = p.available_window;
  return w && /^\d\d:\d\d$/.test(w.from) && /^\d\d:\d\d$/.test(w.until) ? `${clockText(w.from)} – ${clockText(w.until)}` : null;
}

/** True while the product is shut only because of its hours (not sold out). */
export const closedByHours = (p: Pick<Product, 'window_closed' | 'available_window'>) => p.window_closed === true && hoursText(p) !== null;

/** What replaces "Sold out" on a card or a cart line: the hours while that is the reason. */
export const unavailableText = (p: Windowed): string => (closedByHours(p) ? (hoursText(p) as string) : VARIANT_COPY.soldOut);

/** The product page's badge: "Until 6 pm" while open inside a window, "Only 6 am – 6 pm" while shut. */
export function hoursBadge(p: Windowed): string | null {
  if (closedByHours(p)) return `Only ${hoursText(p)}`;
  return p.available_window && p.is_available ? `Until ${clockText(p.available_window.until)}` : null;
}

/** The product page's disabled button while shut by hours. */
export const hoursButton = (p: Pick<Product, 'window_closed' | 'available_window'>): string | null => (closedByHours(p) ? `Available ${hoursText(p)}` : null);
