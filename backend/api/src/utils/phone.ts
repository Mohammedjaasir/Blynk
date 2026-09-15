/**
 * Normalizes Sri Lankan mobile numbers to standard E.164 format (+94XXXXXXXXX).
 * Supported inputs:
 *  - "0771234567"   -> "+94771234567"
 *  - "94771234567"  -> "+94771234567"
 *  - "+94771234567" -> "+94771234567"
 *  - " 077 123 4567 " -> "+94771234567"
 *
 * Valid operator prefixes in Sri Lanka: 70, 71, 72, 74, 75, 76, 77, 78
 */
export function normalizeSriLankanPhone(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error('Phone number must be a non-empty string');
  }

  // Remove spaces, hyphens, and brackets
  const cleaned = input.replace(/[\s\-()]/g, '');

  let normalized = cleaned;

  if (cleaned.startsWith('0')) {
    normalized = '+94' + cleaned.slice(1);
  } else if (cleaned.startsWith('94')) {
    normalized = '+' + cleaned;
  } else if (!cleaned.startsWith('+')) {
    normalized = '+94' + cleaned;
  }

  // Strictly match E.164 Sri Lankan mobile format (+94 followed by valid 2-digit mobile prefix and 7 digits)
  const sriLankanMobileRegex = /^\+94(70|71|72|74|75|76|77|78)[0-9]{7}$/;

  if (!sriLankanMobileRegex.test(normalized)) {
    throw new Error(
      `Invalid Sri Lankan mobile phone number format: "${input}". Must be a valid 9-digit mobile number with prefix 70, 71, 72, 74, 75, 76, 77, or 78.`
    );
  }

  return normalized;
}
