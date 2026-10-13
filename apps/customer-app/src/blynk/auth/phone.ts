/**
 * Sri Lankan mobile numbers, the backend's own rule (backend utils/phone.ts): spaces,
 * hyphens and brackets are dropped; "07…", "94…", "+94…" and bare 9 digits all become
 * E.164 "+94XXXXXXXXX" with an operator prefix 70-72 or 74-78. Anything else is null.
 */
export const SL_MOBILE = /^\+94(70|71|72|74|75|76|77|78)[0-9]{7}$/;

export function toE164(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/[\s\-()]/g, '');
  if (!cleaned) return null;
  let out = cleaned;
  if (cleaned.startsWith('0')) out = '+94' + cleaned.slice(1);
  else if (cleaned.startsWith('94')) out = '+' + cleaned;
  else if (!cleaned.startsWith('+')) out = '+94' + cleaned;
  return SL_MOBILE.test(out) ? out : null;
}

/** "+94771234567" → "+94 77 123 4567" for the screens. */
export function formatPhone(e164: string): string {
  const m = /^\+94(\d{2})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+94 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
