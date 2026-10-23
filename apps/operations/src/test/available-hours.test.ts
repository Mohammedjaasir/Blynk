import { describe, expect, it } from 'vitest';
import { clockText, isOpenNow, windowLabel, windowProblem, windowsPayload } from '../lib/availability';

/** Available hours (owner, 2026-10-23); the API contract is in backend/api/tests/availability-windows.test.ts. */
const JUICE = { kind: 'CATEGORY' as const, id: 'c-juice', from: '06:00', until: '18:00', name: 'Juices', parent_name: 'Beverages', open_now: true };

describe('available hours rules (same as the API)', () => {
  it('says times as people do', () => {
    expect(clockText('06:00')).toBe('6 am');
    expect(clockText('18:30')).toBe('6:30 pm');
    expect(clockText('00:00')).toBe('12 am');
  });

  it('needs two different times', () => {
    expect(windowProblem({ from: '06:00', until: '18:00' })).toBeNull();
    expect(windowProblem({ from: '22:00', until: '02:00' })).toBeNull();
    expect(windowProblem({ from: '06:00', until: '06:00' })).toMatch(/differ/);
    expect(windowProblem({ from: '', until: '18:00' })).toMatch(/both times/);
  });

  it('opens from the first minute to just before the last, past midnight when it runs over', () => {
    const at = (hhmm: string) => new Date(`2026-10-06T${hhmm}:00+05:30`);
    expect(isOpenNow({ from: '06:00', until: '18:00' }, at('05:59'))).toBe(false);
    expect(isOpenNow({ from: '06:00', until: '18:00' }, at('17:59'))).toBe(true);
    expect(isOpenNow({ from: '06:00', until: '18:00' }, at('18:00'))).toBe(false);
    expect(isOpenNow({ from: '22:00', until: '02:00' }, at('23:00'))).toBe(true);
  });

  it('names a sub-category with its main category and sends only the four fields', () => {
    expect(windowLabel(JUICE)).toBe('Beverages › Juices');
    expect(windowsPayload([JUICE])).toEqual({ windows: [{ kind: 'CATEGORY', id: 'c-juice', from: '06:00', until: '18:00' }] });
  });
});
