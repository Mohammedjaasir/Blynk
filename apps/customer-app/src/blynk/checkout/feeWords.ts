import { localized } from '@/blynk/i18n/localized';

/*
 * The delivery-fee explanation and the small-order fee (owner's brother, 2026-10-25; contract
 * docs/superpowers/plans/2026-10-25-fees.md) in English, Sinhala and Tamil. Plain .ts so the
 * completeness test can check it. Amounts arrive already formatted ("LKR 120").
 */
export const FEE_WORDS = localized(
  {
    smallOrderFee: 'Small-order fee',
    /** While the small-order fee applies: how much more to add to avoid it. */
    addMore: (amount: string) => `Add ${amount} more to avoid the small-order fee.`,
    /** The "base + per km" fee in one line: base amount, the km it covers, the amount per extra km. */
    formula: (base: string, km: string, perKm: string) => `${base} up to ${km} km, then ${perKm} for each extra km`,
    /** Added to the formula line when Admin set a cap. */
    formulaCap: (max: string) => `Never more than ${max}.`,
  } as const,
  {
    si: {
      smallOrderFee: 'කුඩා ඇණවුම් ගාස්තුව',
      addMore: (amount: string) => `කුඩා ඇණවුම් ගාස්තුව මගහරින්න තව ${amount} ක් එකතු කරන්න.`,
      formula: (base: string, km: string, perKm: string) => `කි.මී. ${km} ක් දක්වා ${base}, ඊට පස්සේ අමතර කි.මී. එකකට ${perKm}`,
      formulaCap: (max: string) => `උපරිමය ${max}.`,
    },
    ta: {
      smallOrderFee: 'சிறிய ஆர்டர் கட்டணம்',
      addMore: (amount: string) => `சிறிய ஆர்டர் கட்டணத்தைத் தவிர்க்க இன்னும் ${amount} சேர்க்கவும்.`,
      formula: (base: string, km: string, perKm: string) => `${km} கி.மீ. வரை ${base}, அதற்குப் பிறகு ஒவ்வொரு கூடுதல் கி.மீ.க்கும் ${perKm}`,
      formulaCap: (max: string) => `அதிகபட்சம் ${max}.`,
    },
  },
  'checkout.FEE_WORDS',
);
