import { describe, expect, it } from 'vitest';
import { tileLabel } from './tileLabel';

const base = { available: true, offer: false, struckShown: false, lead: null };
const lead = 'Delivered from Fri 17 Oct';

describe('tileLabel: at most one label besides the price', () => {
  it('sold out wins: the photo chip is the only label', () => {
    expect(tileLabel({ ...base, available: false, offer: true, lead })).toBeNull();
  });

  it('an offer without the struck price says "Offer price"; with it, no caption', () => {
    expect(tileLabel({ ...base, offer: true, lead })).toEqual({ kind: 'offer', text: 'Offer price' });
    expect(tileLabel({ ...base, offer: true, struckShown: true })).toBeNull();
    // the struck price already says "offer": the lead time may take the label slot
    expect(tileLabel({ ...base, offer: true, struckShown: true, lead })).toEqual({ kind: 'lead', text: lead });
  });

  it('lead time, else nothing', () => {
    expect(tileLabel({ ...base, lead })).toEqual({ kind: 'lead', text: lead });
    expect(tileLabel(base)).toBeNull();
  });
});
