import { describe, it, expect } from 'vitest';
import {
  clockLabel,
  colomboWhen,
  cooldownLeft,
  lastSentText,
  normalizeLkPhone,
  partsLabel,
  phoneProblem,
  readableLkPhone,
  reportParts,
  sameDraft,
} from '../lib/dailyReport';

/** Daily report helpers (owner, 2026-10-25): numbers, SMS parts, the time and the cooldown. */
describe('daily report helpers', () => {
  it('normalises Sri Lankan mobile numbers like the server', () => {
    expect(normalizeLkPhone('0771234567')).toBe('+94771234567');
    expect(normalizeLkPhone('077 123 4567')).toBe('+94771234567');
    expect(normalizeLkPhone('94771234567')).toBe('+94771234567');
    expect(normalizeLkPhone('+94 77-123-4567')).toBe('+94771234567');
    expect(normalizeLkPhone('0112345678')).toBeNull(); // a landline
    expect(normalizeLkPhone('12345')).toBeNull();
    expect(normalizeLkPhone('')).toBeNull();
  });

  it('says why a number cannot be added', () => {
    expect(phoneProblem('', [])).toMatch(/Type a mobile number/);
    expect(phoneProblem('abc', [])).toMatch(/Sri Lankan mobile number/);
    expect(phoneProblem('0771234567', ['+94771234567'])).toMatch(/already on the list/);
    expect(phoneProblem('0771234568', ['+94770000001', '+94770000002', '+94770000003', '+94770000004', '+94770000005'])).toMatch(/At most 5/);
    expect(phoneProblem('0771234568', ['+94771234567'])).toBeNull();
  });

  it('shows numbers the way people write them', () => {
    expect(readableLkPhone('+94771234567')).toBe('077 123 4567');
  });

  it('counts SMS parts: 160 in one, then 153 per part', () => {
    expect([0, 1, 160, 161, 306, 307, 459, 460].map(reportParts)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    expect(partsLabel(1)).toBe('1 SMS part');
    expect(partsLabel(3)).toBe('3 SMS parts');
  });

  it('reads the time in words', () => {
    expect(clockLabel('21:00')).toBe('9 pm');
    expect(clockLabel('21:30')).toBe('9:30 pm');
    expect(clockLabel('00:05')).toBe('12:05 am');
    expect(clockLabel('12:00')).toBe('12 pm');
  });

  it('shows a stored instant in Sri Lanka time and when it was last sent', () => {
    expect(colomboWhen('2026-10-25T15:31:00.000Z')).toBe('25 Oct 2026, 9:01 pm (Sri Lanka time)');
    expect(lastSentText({ last_sent_at: null, last_sent_kind: null })).toBe('Not sent yet.');
    expect(lastSentText({ last_sent_at: '2026-10-25T15:31:00.000Z', last_sent_kind: 'auto' })).toBe('Last sent 25 Oct 2026, 9:01 pm (Sri Lanka time), automatically.');
    expect(lastSentText({ last_sent_at: '2026-10-25T15:31:00.000Z', last_sent_kind: 'manual' })).toContain('with Send now');
  });

  it('counts down the 2-minute Send now cooldown', () => {
    const at = '2026-10-25T10:00:00.000Z';
    const t = new Date(at).getTime();
    expect(cooldownLeft(null, t)).toBe(0);
    expect(cooldownLeft(at, t)).toBe(120);
    expect(cooldownLeft(at, t + 30_000)).toBe(90);
    expect(cooldownLeft(at, t + 120_000)).toBe(0);
    expect(cooldownLeft(at, t + 500_000)).toBe(0);
  });

  it('compares drafts', () => {
    const a = { enabled: true, send_at: '21:00', phones: ['+94771234567'] };
    expect(sameDraft(a, { ...a })).toBe(true);
    expect(sameDraft(a, { ...a, send_at: '21:30' })).toBe(false);
    expect(sameDraft(a, { ...a, phones: [] })).toBe(false);
  });
});
