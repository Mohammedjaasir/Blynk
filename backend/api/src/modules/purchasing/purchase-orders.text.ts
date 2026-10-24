/**
 * The shareable text of a purchase order and the wa.me link (pure). Plain text, no emoji:
 *
 *   Order for Lanka Wholesale:
 *   10 x Sugar (1 kg)
 *   6 x Dhal (500 g)
 *   Needed by: 27 Oct 2026
 *   Ref: BP-0007 (Blynk)
 */

/** A phone as wa.me wants it (digits with the country code); Sri Lankan 0771234567 becomes 94771234567. null = unusable. */
export function whatsappPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) return digits.slice(2) || null;
  if (digits.startsWith('0') && digits.length === 10) return `94${digits.slice(1)}`;
  if (digits.length === 9) return `94${digits}`;
  return digits.length >= 10 ? digits : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-27" -> "27 Oct 2026". */
export function dayText(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return day;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export interface OrderTextInput {
  supplier_name: string | null;
  po_number: string;
  expected_on: string | null;
  notes: string | null;
  lines: { name: string; quantity: number }[];
}

export function purchaseOrderText(o: OrderTextInput): string {
  const lines = o.lines.filter((l) => l.quantity > 0);
  return [
    `Order for ${o.supplier_name ?? 'supplier'}:`,
    ...lines.map((l) => `${l.quantity} x ${l.name}`),
    ...(o.expected_on ? [`Needed by: ${dayText(o.expected_on)}`] : []),
    ...(o.notes ? [`Note: ${o.notes}`] : []),
    `Ref: ${o.po_number} (Blynk)`,
  ].join('\n');
}

/** wa.me link with the text filled in, to the supplier's number when it is usable, else the chooser. */
export function whatsappLink(text: string, phone: string | null | undefined): string {
  return `https://wa.me/${whatsappPhone(phone) ?? ''}?text=${encodeURIComponent(text)}`;
}
