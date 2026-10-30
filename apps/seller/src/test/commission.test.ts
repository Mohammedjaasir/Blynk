import { describe, it, expect } from 'vitest';
import { ENDED_MESSAGE, LAST_DAY_TEXT, daysToGoText, freePeriodView, freeProgress } from '../lib/commission';

const NOW = new Date('2026-10-30T06:00:00.000Z'); // 11:30 in Colombo

describe('days to go text', () => {
  it('says day for one and days for the rest', () => {
    expect(daysToGoText(23)).toBe('23 days to go');
    expect(daysToGoText(2)).toBe('2 days to go');
    expect(daysToGoText(1)).toBe('1 day to go');
  });
});

describe('free period progress', () => {
  it('is the days used out of the whole month', () => {
    expect(freeProgress(23, 30)).toEqual({ used: 7, percent: 23.3 });
    expect(freeProgress(30, 30)).toEqual({ used: 0, percent: 0 });
    expect(freeProgress(0, 30)).toEqual({ used: 30, percent: 100 });
  });
  it('stays inside 0 to 100 and has no bar for a month of no days', () => {
    expect(freeProgress(45, 30)).toEqual({ used: 0, percent: 0 });
    expect(freeProgress(-3, 30)).toEqual({ used: 30, percent: 100 });
    expect(freeProgress(5, 0)).toBeNull();
  });
});

describe('the commission-free card', () => {
  it('shows nothing when there is no free period (null) or the API does not know it', () => {
    expect(
      freePeriodView({ commission_free_days_left: null, commission_free_until: null, commission_free_days: 30 }, NOW)
    ).toBeNull();
    expect(freePeriodView({}, NOW)).toBeNull();
  });

  it('counts down while days are left', () => {
    const view = freePeriodView(
      { commission_free_until: '2026-11-22T06:00:00.000Z', commission_free_days_left: 23, commission_free_days: 30 },
      NOW
    );
    expect(view).toMatchObject({ kind: 'running', lead: 'Commission-free:', emphasis: '23 days to go', used: 7, total: 30 });
    expect(view?.percent).toBeCloseTo(23.3, 1);
  });

  it('says "1 day to go" when one day is left and it does not end today', () => {
    const view = freePeriodView(
      { commission_free_until: '2026-10-31T04:00:00.000Z', commission_free_days_left: 1, commission_free_days: 30 },
      NOW
    );
    expect(view).toMatchObject({ kind: 'running', emphasis: '1 day to go' });
  });

  it('says "Last commission-free day" on the day it ends', () => {
    const view = freePeriodView(
      { commission_free_until: '2026-10-30T15:00:00.000Z', commission_free_days_left: 1, commission_free_days: 30 },
      NOW
    );
    expect(view).toMatchObject({ kind: 'last-day', emphasis: LAST_DAY_TEXT, lead: '' });
    expect(view?.percent).toBeCloseTo(96.7, 1);
  });

  it('shows the "over" note for 7 days after the end, then nothing', () => {
    const base = {
      commission_free_until: '2026-10-25T06:00:00.000Z',
      commission_free_days_left: 0,
      commission_free_days: 30,
    };
    expect(freePeriodView(base, NOW)).toMatchObject({ kind: 'ended', message: ENDED_MESSAGE, percent: null });
    // 6 days and a bit after: still shown; exactly 7 days after: gone.
    expect(freePeriodView(base, new Date('2026-10-31T05:59:00.000Z'))).not.toBeNull();
    expect(freePeriodView(base, new Date('2026-11-01T06:00:00.000Z'))).toBeNull();
    expect(freePeriodView({ ...base, commission_free_until: '2026-10-01T06:00:00.000Z' }, NOW)).toBeNull();
  });

  it('shows no "over" note without an end date, and never a negative count', () => {
    expect(freePeriodView({ commission_free_days_left: 0, commission_free_days: 30 }, NOW)).toBeNull();
    expect(
      freePeriodView({ commission_free_days_left: -2, commission_free_until: '2026-10-29T06:00:00.000Z' }, NOW)
    ).toMatchObject({ kind: 'ended' });
  });

  it('uses a 30 day month when the API does not say how long it is', () => {
    const view = freePeriodView({ commission_free_until: '2026-11-22T06:00:00.000Z', commission_free_days_left: 23 }, NOW);
    expect(view?.total).toBe(30);
  });
});
