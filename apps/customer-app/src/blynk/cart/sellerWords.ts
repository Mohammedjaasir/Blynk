import { localized } from '@/blynk/i18n/localized';

/*
 * "One seller per order" (owner's brother, 2026-10-27): the words of the "Start a new cart?" question,
 * the notes about items that were left out, and the checkout refusal (MIXED_SELLERS_NOT_ALLOWED).
 * `seller` is a shop name from the server (or "Blynk"), shown as it comes.
 */
export const SELLER_RULE_WORDS = localized(
  {
    title: 'Start a new cart?',
    body: (seller: string) => `Your cart has items from ${seller}. Start a new cart?`,
    clearAndAdd: 'Clear cart and add',
    keep: 'Keep current cart',
    /** Shown in place of a shop name when the server sent a seller id without a name. */
    unnamedSeller: 'another seller',
    leftOut: (n: number) => `${n} item${n === 1 ? '' : 's'} from other sellers ${n === 1 ? 'was' : 'were'} not added.`,
    removed: (n: number) => `${n} item${n === 1 ? '' : 's'} from other sellers ${n === 1 ? 'was' : 'were'} removed from your cart.`,
    checkout: {
      title: 'Items from different sellers',
      message: 'Your cart has items from different sellers. Please order from one seller at a time.',
      messageNamed: (names: string) => `Your cart has items from ${names}. Please order from one seller at a time.`,
      startNew: 'Start a new cart',
    },
  } as const,
  {
    si: {
      title: 'අලුත් කරත්තයක් පටන් ගමුද?',
      body: (seller: string) => `ඔබේ කරත්තයේ ${seller} ගෙන් ගත් භාණ්ඩ තිබෙනවා. අලුත් කරත්තයක් පටන් ගමුද?`,
      clearAndAdd: 'කරත්තය හිස් කර එකතු කරන්න',
      keep: 'දැන් ඇති කරත්තය තබාගන්න',
      unnamedSeller: 'වෙනත් විකුණුම්කරුවෙකු',
      leftOut: (n: number) => `වෙනත් විකුණුම්කරුවන්ගේ භාණ්ඩ ${n}ක් එකතු කළේ නැහැ.`,
      removed: (n: number) => `වෙනත් විකුණුම්කරුවන්ගේ භාණ්ඩ ${n}ක් කරත්තයෙන් ඉවත් කළා.`,
      checkout: {
        title: 'වෙනස් විකුණුම්කරුවන්ගේ භාණ්ඩ',
        message: 'ඔබේ කරත්තයේ වෙනස් විකුණුම්කරුවන්ගේ භාණ්ඩ තිබෙනවා. කරුණාකර එක වරකට එක විකුණුම්කරුවෙකුගෙන් පමණක් ඇණවුම් කරන්න.',
        messageNamed: (names: string) => `ඔබේ කරත්තයේ ${names} ගේ භාණ්ඩ තිබෙනවා. කරුණාකර එක වරකට එක විකුණුම්කරුවෙකුගෙන් පමණක් ඇණවුම් කරන්න.`,
        startNew: 'අලුත් කරත්තයක් පටන් ගන්න',
      },
    },
    ta: {
      title: 'புதிய கார்ட் தொடங்கலாமா?',
      body: (seller: string) => `${seller} இன் பொருட்கள் உங்கள் கார்ட்டில் உள்ளன. புதிய கார்ட் தொடங்கலாமா?`,
      clearAndAdd: 'கார்ட்டை காலி செய்து சேர்',
      keep: 'இப்போதைய கார்ட்டை வைத்திரு',
      unnamedSeller: 'வேறு விற்பனையாளர்',
      leftOut: (n: number) => `மற்ற விற்பனையாளர்களின் ${n} பொருட்கள் சேர்க்கப்படவில்லை.`,
      removed: (n: number) => `மற்ற விற்பனையாளர்களின் ${n} பொருட்கள் கார்ட்டிலிருந்து நீக்கப்பட்டன.`,
      checkout: {
        title: 'வெவ்வேறு விற்பனையாளர்களின் பொருட்கள்',
        message: 'உங்கள் கார்ட்டில் வெவ்வேறு விற்பனையாளர்களின் பொருட்கள் உள்ளன. ஒரு நேரத்தில் ஒரு விற்பனையாளரிடம் மட்டும் ஆர்டர் செய்யுங்கள்.',
        messageNamed: (names: string) => `உங்கள் கார்ட்டில் ${names} இன் பொருட்கள் உள்ளன. ஒரு நேரத்தில் ஒரு விற்பனையாளரிடம் மட்டும் ஆர்டர் செய்யுங்கள்.`,
        startNew: 'புதிய கார்ட் தொடங்கு',
      },
    },
  },
  'cart.SELLER_RULE_WORDS',
);
