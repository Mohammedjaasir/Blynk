/*
 * Customer support and the help answers (Flutter: Services/store_info.dart, Screens/help_screen.dart,
 * owner 2026-10-08). The delivery fee is never quoted: the cart shows the one that applies.
 */
export const SUPPORT = {
  phone: '+94717107374',
  phoneLabel: '+94 71 710 7374',
  whatsAppUrl: 'https://wa.me/94717107374',
  hubName: 'Dharga Town',
  country: 'Sri Lanka',
  serviceRadiusKm: 4,
  paymentMethodLabel: 'Cash on delivery',
} as const;

/** Stands for the store's live week of hours in an answer. */
export const HOURS_TOKEN = '{hours}';

export const FAQS: { q: string; a: string }[] = [
  {
    q: 'Where do you deliver?',
    a: `We deliver within ${SUPPORT.serviceRadiusKm} km of our ${SUPPORT.hubName} hub. If your address falls outside that range, checkout will let you know before your order is placed.`,
  },
  { q: 'What are your delivery hours?', a: `We take orders and deliver ${HOURS_TOKEN}. Orders can't be placed outside those hours.` },
  { q: 'How much is delivery?', a: 'The delivery fee is shown in your cart before you place your order.' },
  {
    q: 'How can I pay?',
    a: `${SUPPORT.paymentMethodLabel}. Pay the rider when your groceries arrive - no card or online payment needed.`,
  },
  {
    q: 'Can I cancel my order?',
    a: 'Yes, while your order is still Placed or Packed. Once it is out for delivery we can no longer cancel it. Open the order from Orders to cancel.',
  },
  { q: 'Something was missing or wrong', a: 'Open the order from the Orders tab and check the item list first.' },
];

/** The FAQ answers with the hours filled in. */
export const faqsWithHours = (hours: string) => FAQS.map((f) => ({ q: f.q, a: f.a.split(HOURS_TOKEN).join(hours) }));
