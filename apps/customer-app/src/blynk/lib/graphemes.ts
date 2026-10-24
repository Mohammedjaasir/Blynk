/*
 * Splits text into the letters a person sees. Sinhala and Tamil letters carry vowel signs and a
 * virama (and Sinhala's rakaransaya / yansaya use a zero-width joiner) that must stay with the
 * letter before them; splitting by code unit would tear them apart in the Home banner's
 * letter-by-letter jump. Latin text splits exactly as `split('')` does.
 */
const CLUSTER = /[^\p{M}‍](?:\p{M}|‍[^\p{M}‍])*/gu;

export function graphemes(text: string): string[] {
  return text.match(CLUSTER) ?? [];
}

/** Sinhala or Tamil text: letter-spacing would pull its joined letters apart, so callers leave it at 0. */
export const hasIndic = (text: string): boolean => /[඀-෿஀-௿]/.test(text);
