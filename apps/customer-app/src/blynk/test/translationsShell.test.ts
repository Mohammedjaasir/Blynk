import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n/lang';
import { HOME, HOME_LIVE, LIVE_LOCATION_SHEET } from '../ui/homeWords';
import { CATEGORIES, PLACED, PRICE_ROLL, PROFILE_HERO, TABS } from '../ui/strings';
import { COMPONENT_WORDS } from '../ui/componentWords';
import { claimLine, claimPromoLine } from '../store/freeClaim';
import { POINTS_COPY } from '../store/pointsPromo';
import { filterChips } from '../lib/filters';
import { formatClock, hoursSummary } from '../lib/storeText';
import { COUNTDOWN_WORDS, countdownText } from '../promo/homeSections';
import { flashSpeech } from '../promo/flashDeals';
import { HERO_COPY, resolveHero } from '../promo/heroBanner';
import { bundleBadgeText, progressText } from '../bundles/model';
import { API_WORDS } from '../api/words';
import { graphemes } from '../lib/graphemes';
import { liveFees, livePromo } from '../../demo/homeLive';
import { store } from './fixtures';

const SI = /[඀-෿]/;
const TA = /[஀-௿]/;
afterEach(() => setLang('en'));

describe('Sinhala and Tamil render for the shell and Home words', () => {
  it('English stays the default', () => {
    expect(TABS.shop).toBe('Shop');
    expect(HOME.under('LKR 300')).toBe('Under LKR 300');
    expect(PRICE_ROLL.save('LKR 20')).toBe('Save LKR 20');
    expect(bundleBadgeText({ buy_qty: 2, get_qty: 1 })).toBe('Buy 2 get 1 free');
  });

  it('blocks and functions follow the language', () => {
    setLang('si');
    expect(TABS.shop).toMatch(SI);
    expect(HOME.under('LKR 300')).toMatch(SI);
    expect(HOME.under('LKR 300')).toContain('LKR 300');
    expect(CATEGORIES.itemCount(3)).toContain('3');
    expect(PLACED.stagesNow).toHaveLength(2);
    expect(PROFILE_HERO.hi('Nimal')).toContain('Nimal');
    expect(COMPONENT_WORDS.items(3)).toMatch(SI);
    setLang('ta');
    expect(TABS.shop).toMatch(TA);
    expect(HOME.seeAll).toMatch(TA);
    expect(PRICE_ROLL.pctOff(5)).toContain('5%');
    expect(LIVE_LOCATION_SHEET.title).toMatch(TA);
    expect(PROFILE_HERO.pointsUnit(2)).toMatch(TA);
  });

  it('logic that builds sentences uses the language', () => {
    const rule = { earnPoints: 1, earnPerLkr: 100 };
    setLang('si');
    expect(POINTS_COPY.rule(rule)).toMatch(SI);
    expect(POINTS_COPY.rule(rule)).toContain('LKR 100');
    expect(claimLine({ kind: 'personal', count: 2 })).toMatch(SI);
    expect(claimPromoLine({ kind: 'new-customer', count: 1 })).toMatch(SI);
    expect(filterChips(300)[1]!.label).toContain('300');
    expect(filterChips(300)[0]!.label).toMatch(SI);
    expect(formatClock('21:30')).toBe('9:30 ප.ව.');
    expect(hoursSummary({ ...store, hours: undefined, delivery_hours: { start: '08:00', end: '21:00' } } as never)).toContain('ප.ව.');
    expect(countdownText(2 * 86_400_000 + 4 * 3_600_000)).toBe('දින 2 04:00');
    expect(flashSpeech(Date.now() + 90 * 60_000, Date.now())).toMatch(SI);
    expect(bundleBadgeText({ buy_qty: 2, get_qty: 1 })).toMatch(SI);
    expect(progressText({ offer_id: 'o', title: 't', type: 'BUY_X_GET_Y', remaining_units: 1, get_qty: 1 })).toMatch(SI);
    expect(HOME_LIVE.itemCount(4)).toContain('4');
    expect(liveFees(store)[0]![1]).toMatch(SI);
    expect(livePromo(store).fees).toHaveLength(2);
    expect(API_WORDS.feedbackLong(500)).toContain('500');
    setLang('ta');
    expect(POINTS_COPY.placed(3)).toMatch(TA);
    expect(COUNTDOWN_WORDS.endsIn('01:00:00')).toContain('01:00:00');
    expect(resolveHero(null, { minPrice: null, freeCount: 0 }).cta).toMatch(TA);
    expect(HERO_COPY.titleFresh[0]).toMatch(TA);
  });

  it('splits Sinhala and Tamil words into whole letters, Latin into characters', () => {
    expect(graphemes('FRESH')).toEqual(['F', 'R', 'E', 'S', 'H']);
    expect(graphemes('නැවුම්').join('')).toBe('නැවුම්');
    expect(graphemes('නැවුම්').length).toBeLessThan('නැවුම්'.length);
    expect(graphemes('புள்ளிகள்').join('')).toBe('புள்ளிகள்');
    expect(graphemes('புள்ளிகள்').every((g) => g.length >= 1)).toBe(true);
    expect(graphemes('ක්‍රම').join('')).toBe('ක්‍රම');
    expect(graphemes('ක්‍රම')).toHaveLength(2);
  });
});
