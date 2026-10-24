import type { Product } from '../api/types';
import { localized } from '../i18n/localized';
import { effectivePrice, isOfferActive } from './pricing';

/** Filter chips that really filter the products on screen. */
export type FilterId = 'offer' | 'under300' | 'instock';

const FILTER_WORDS = localized(
  {
    onOffer: 'On offer',
    under: (amount: string) => `Under LKR ${amount}`,
    inStock: 'In stock',
  },
  {
    si: { onOffer: 'දීමනා ඇති', under: (amount: string) => `LKR ${amount} ට අඩු`, inStock: 'තොගයේ ඇත' },
    ta: { onOffer: 'ஆஃபர் உள்ளவை', under: (amount: string) => `LKR ${amount} க்கு கீழ்`, inStock: 'ஸ்டாக்கில் உள்ளவை' },
  },
  'lib.FILTER_WORDS',
);

/** The chips; "Under LKR n" follows Admin / Ops' amount (app_texts.home_under_amount, default 300). */
export const filterChips = (under = 300): { id: FilterId; label: string }[] => [
  { id: 'offer', label: FILTER_WORDS.onOffer },
  { id: 'under300', label: FILTER_WORDS.under(under.toLocaleString('en-US')) },
  { id: 'instock', label: FILTER_WORDS.inStock },
];
/** The default chips; read on every access so the labels follow the chosen language (it behaves as the array). */
export const FILTERS: ReturnType<typeof filterChips> = new Proxy([] as ReturnType<typeof filterChips>, {
  get: (_t, p) => Reflect.get(filterChips(), p),
  has: (_t, p) => p in filterChips(),
});

export function applyFilters(products: Product[], on: FilterId[], now: Date = new Date(), under = 300): Product[] {
  if (!on.length) return products;
  return products.filter((p) =>
    (!on.includes('offer') || isOfferActive(p, now))
    && (!on.includes('under300') || effectivePrice(p, now) <= under)
    && (!on.includes('instock') || p.is_available));
}

export const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
