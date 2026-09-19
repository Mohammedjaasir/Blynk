/// The one place the customer app decides what a valid input is.
///
/// Every rule here is aligned with the backend contract it maps to:
///   - phone: backend/api/src/utils/phone.ts (normalizeSriLankanPhone)
///   - address fields: backend/api/src/modules/users/address.schema.ts
///   - OTP: backend/api/src/modules/auth/auth.schema.ts (verifyOtpSchema)
///   - search: backend/api/src/modules/catalog/catalog.schema.ts
///
/// Where a rule here is deliberately stricter than the backend, it is
/// marked "tighter than backend" and listed in
/// docs/05-implementation/blynk-input-validation-audit.md. Nothing here is
/// looser than the backend, and the backend still validates independently -
/// this layer exists to catch mistakes early and keep junk off the wire,
/// not to be the security boundary.
library;

class AppValidators {
  AppValidators._();

  // ---------------------------------------------------------------- limits
  static const int addressNameMin = 2;
  static const int addressNameMax = 30; // tighter than backend (64)
  static const int recipientNameMin = 2;
  static const int recipientNameMax = 80; // tighter than backend (128)
  static const int addressLineMin = 3;
  static const int addressLineMax = 150; // tighter than backend (500)
  static const int cityMin = 2;
  static const int cityMax = 64; // matches backend
  static const int postalCodeLength = 5; // Sri Lankan postal codes
  static const int instructionsMax = 300; // tighter than backend (1000)
  static const int searchMax = 100; // matches backend
  static const int otpLength = 6; // matches backend
  static const int quantityMin = 1; // matches backend order item schema
  static const int quantityMax = 100;

  // --------------------------------------------------------- normalization
  /// Trims the ends and collapses runs of whitespace:
  /// "  Mohammed   Jaasir  " -> "Mohammed Jaasir".
  static String normalizeText(String? value) =>
      (value ?? '').trim().replaceAll(RegExp(r'\s+'), ' ');

  /// Normalized text, or null when nothing is left - what an optional
  /// backend field expects instead of an empty string.
  static String? optionalText(String? value) {
    final normalized = normalizeText(value);
    return normalized.isEmpty ? null : normalized;
  }

  /// Search text: normalized and hard-capped so an accidental paste can't
  /// send an unbounded string to the catalog API.
  static String normalizeSearch(String? value) {
    final normalized = normalizeText(value);
    return normalized.length <= searchMax
        ? normalized
        : normalized.substring(0, searchMax);
  }

  /// Mirrors the backend's normalizeSriLankanPhone: strips spaces, hyphens
  /// and brackets, accepts 0xxxxxxxxx / 94xxxxxxxxx / +94xxxxxxxxx / bare
  /// 9-digit, and only the real mobile prefixes. Returns E.164
  /// (+94XXXXXXXXX), or null when the number isn't one the backend accepts.
  static String? normalizePhone(String? value) {
    if (value == null) return null;
    final cleaned = value.replaceAll(RegExp(r'[\s\-()]'), '');
    if (cleaned.isEmpty) return null;

    String normalized;
    if (cleaned.startsWith('0')) {
      normalized = '+94${cleaned.substring(1)}';
    } else if (cleaned.startsWith('94')) {
      normalized = '+$cleaned';
    } else if (!cleaned.startsWith('+')) {
      normalized = '+94$cleaned';
    } else {
      normalized = cleaned;
    }

    // Same expression as the backend: +94, a real mobile prefix, 7 digits.
    final valid = RegExp(r'^\+94(70|71|72|74|75|76|77|78)[0-9]{7}$');
    return valid.hasMatch(normalized) ? normalized : null;
  }

  static bool isValidPhone(String? value) => normalizePhone(value) != null;

  // ------------------------------------------------------------ validators
  // Each returns null when the value is acceptable, or a short, human
  // message to show under the field.

  static final RegExp _nameChars = RegExp(r"^[\p{L} '\-.]+$", unicode: true);
  static final RegExp _addressNameChars =
      RegExp(r"^[\p{L}\p{N} '\-.,&/()]+$", unicode: true);
  static final RegExp _addressChars =
      RegExp(r"^[\p{L}\p{N} '\-.,/#()]+$", unicode: true);
  static final RegExp _cityChars =
      RegExp(r"^[\p{L}\p{N} '\-.]+$", unicode: true);
  static final RegExp _hasLetter = RegExp(r'\p{L}', unicode: true);
  static final RegExp _instructionChars =
      RegExp(r"^[\p{L}\p{N} '\-.,/#()!?:;&+]+$", unicode: true);

  static String? addressName(String? value) {
    final text = normalizeText(value);
    if (text.isEmpty ||
        text.length < addressNameMin ||
        text.length > addressNameMax ||
        !_addressNameChars.hasMatch(text)) {
      return 'Enter a valid address name';
    }
    return null;
  }

  /// Names hold letters, spaces, apostrophes, hyphens and dots - not digits
  /// and not arbitrary symbols.
  static String? recipientName(String? value) {
    final text = normalizeText(value);
    if (text.isEmpty ||
        text.length < recipientNameMin ||
        text.length > recipientNameMax ||
        !_nameChars.hasMatch(text)) {
      return 'Enter a valid recipient name';
    }
    return null;
  }

  static String? phone(String? value) =>
      isValidPhone(value) ? null : 'Enter a valid Sri Lankan mobile number';

  static String? addressLine1(String? value) {
    final text = normalizeText(value);
    if (text.length < addressLineMin ||
        text.length > addressLineMax ||
        !_addressChars.hasMatch(text)) {
      return 'Enter your street address';
    }
    return null;
  }

  /// Optional: empty is fine, anything present must still be sane.
  static String? addressLine2(String? value) {
    final text = normalizeText(value);
    if (text.isEmpty) return null;
    if (text.length > addressLineMax || !_addressChars.hasMatch(text)) {
      return 'Enter a valid address line';
    }
    return null;
  }

  /// Cities are commonly written with a number here ("Colombo 7"), so
  /// digits are allowed - what isn't allowed is a value with no letters.
  static String? city(String? value) {
    final text = normalizeText(value);
    if (text.length < cityMin ||
        text.length > cityMax ||
        !_cityChars.hasMatch(text) ||
        !_hasLetter.hasMatch(text)) {
      return 'Enter a valid city';
    }
    return null;
  }

  /// Optional. Sri Lankan postal codes are five digits; the backend only
  /// caps the length, so this is tighter on purpose.
  static String? postalCode(String? value) {
    final text = normalizeText(value);
    if (text.isEmpty) return null;
    return RegExp('^[0-9]{$postalCodeLength}\$').hasMatch(text)
        ? null
        : 'Enter a valid $postalCodeLength-digit postal code';
  }

  static String? latitude(String? value) =>
      _coordinate(value, 90, 'Enter a valid latitude');

  static String? longitude(String? value) =>
      _coordinate(value, 180, 'Enter a valid longitude');

  static String? _coordinate(String? value, double bound, String message) {
    final text = normalizeText(value);
    final parsed = double.tryParse(text);
    if (parsed == null ||
        !parsed.isFinite ||
        parsed < -bound ||
        parsed > bound) {
      return message;
    }
    return null;
  }

  /// Optional free text, but not whitespace-only and not unbounded.
  static String? deliveryInstructions(String? value) {
    final text = normalizeText(value);
    if (text.isEmpty) return null;
    if (text.length > instructionsMax || !_instructionChars.hasMatch(text)) {
      return 'Enter valid delivery instructions';
    }
    return null;
  }

  static String? otp(String? value) {
    final text = normalizeText(value);
    return RegExp('^[0-9]{$otpLength}\$').hasMatch(text)
        ? null
        : 'Enter the $otpLength-digit OTP';
  }

  /// Search stays permissive - grocery queries include digits, units and
  /// punctuation ("rice 5kg") - but it can't be blank or unbounded.
  static bool isSearchable(String? value) => normalizeSearch(value).isNotEmpty;

  /// Cart quantities are whole numbers within the backend's per-item range.
  static bool isValidQuantity(num? value) =>
      value != null &&
      value is int &&
      value >= quantityMin &&
      value <= quantityMax;
}
