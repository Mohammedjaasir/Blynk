import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '@/blynk/i18n/lang';
import { AREA, noteText } from '@/blynk/area/copy';
import { centreName, coverageOf } from '@/blynk/area/coverage';
import { NOTIFY_ME, PRODUCT_PAGE, SEARCH } from './browseWords';
import { hoursBadge, hoursText } from './hours';
import { buildCategoryTree } from './tree';
import { dayLabel, VARIANT_COPY } from './variants';

const SI = /[඀-෿]/;
const TA = /[஀-௿]/;

afterEach(() => setLang('en'));

describe('Browse words follow the chosen language', () => {
  it('stays English by default', () => {
    expect(VARIANT_COPY.addToCart('100 g')).toBe('Add 100 g to cart');
    expect(dayLabel('2026-10-17')).toBe('Sat 17 Oct');
    expect(SEARCH.noResults('rice', 'Grocery')).toBe('No results for "rice" in Grocery');
  });

  it('Sinhala', () => {
    setLang('si');
    expect(VARIANT_COPY.soldOut).toMatch(SI);
    expect(VARIANT_COPY.addToCart('100 g')).toMatch(SI);
    expect(NOTIFY_ME.label).toMatch(SI);
    expect(PRODUCT_PAGE.inCart(2)).toMatch(SI);
    expect(SEARCH.resultsCount(4, null)).toMatch(SI);
    expect(dayLabel('2026-10-17')).toMatch(SI);
    expect(noteText('denied')).toMatch(SI);
    const cov = coverageOf({ radius_km: 4, store_location: { lat: 6.441313, lng: 80.011437 }, hub_name: 'Dharga Town' } as never);
    expect(AREA.within(cov)).toMatch(SI);
    expect(centreName(cov)).toBe('ඔරලෝසු කණුව, Dharga Town');
    const hours = { available_window: { from: '06:00', until: '18:00' }, window_closed: false, is_available: true };
    expect(hoursText(hours)).toBe('පෙ.ව. 6 – ප.ව. 6');
    expect(hoursBadge(hours)).toMatch(SI);
  });

  it('Tamil', () => {
    setLang('ta');
    expect(VARIANT_COPY.soldOut).toMatch(TA);
    expect(VARIANT_COPY.from('LKR 50')).toBe('LKR 50 முதல்');
    expect(PRODUCT_PAGE.save('LKR 20')).toMatch(TA);
    expect(SEARCH.noResults('rice', 'Grocery')).toMatch(TA);
    expect(dayLabel('2026-10-17')).toMatch(TA);
    expect(AREA.near('Aluthgama')).toBe('Aluthgama அருகில்');
  });

  it('the closing "More" group and the only-group title follow the language', () => {
    const cat = { id: 'c1', slug: 'rice', name: 'Rice', parent_id: null, display_order: 0 } as never;
    const tree = buildCategoryTree([], [cat]);
    expect(tree[0].name).toBe('Shop by category');
    setLang('si');
    expect(tree[0].name).not.toBe('Shop by category');
    const other = { id: 'c2', slug: 'oil', name: 'Oil', parent_id: null, display_order: 1 } as never;
    const withMain = buildCategoryTree([{ id: 'g', name: 'Grocery', sort_order: 0, categories: [cat] }], [cat, other]);
    expect(withMain.at(-1)?.name).toBe('තවත්');
  });
});
