-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 028: Admin and Inventory accounts have no phone number
-- ============================================================================
-- 2026-10-07 (owner). ADMIN (Admin website) and PACKING_STAFF (Inventory
-- website) sign in with email + password only; they are never sent an SMS
-- code and keep no phone number. OPERATIONS and RIDER keep their phones and
-- SMS-code sign-in; CUSTOMER is unchanged.
--
-- users.phone stays NOT NULL UNIQUE VARCHAR(20), so every ADMIN and
-- PACKING_STAFF phone is replaced by a placeholder: 'nophone:' + 12 lowercase
-- hex (exactly 20 characters), the same format the API writes
-- (src/utils/phone.ts generatePlaceholderPhone). It is never a valid Sri
-- Lankan mobile, so no OTP lookup can match it, and APIs show it as null.
-- The freed numbers can register again (e.g. as a customer).
--
-- The hex comes from md5(random() || id), so it differs per row; the loop
-- retries the (vanishingly unlikely) clash with an existing placeholder.

DO $$
DECLARE
  r RECORD;
  placeholder TEXT;
BEGIN
  FOR r IN
    SELECT id FROM users
     WHERE role IN ('ADMIN', 'PACKING_STAFF')
       AND phone NOT LIKE 'nophone:%'
  LOOP
    LOOP
      placeholder := 'nophone:' || substr(md5(random()::text || r.id::text || clock_timestamp()::text), 1, 12);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE phone = placeholder);
    END LOOP;
    UPDATE users SET phone = placeholder, updated_at = now() WHERE id = r.id;
  END LOOP;
END $$;
