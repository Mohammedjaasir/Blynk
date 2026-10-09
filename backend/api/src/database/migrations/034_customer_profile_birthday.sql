-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 034: customer profile (birthday, favourites) and the birthday offer
-- ============================================================================
-- 2026-10-09 (owner): "the user can create a profile like name, dob, fav foods
-- and snacks - not mandatory, completely optional - ... so when there is a
-- birthday we can give some offers, which can be controlled by ops and admin".
--
-- 1. PROFILE - every field optional, editable in the app's Profile.
--    * users.date_of_birth DATE NULL - a date, no time. The API keeps it to an
--      age of 5..120 and never in the future; the CHECK only stops nonsense.
--    * users.favourite_category_ids UUID[] - the Blynk categories they tapped
--      (no FK on array elements: a deleted category simply stops showing).
--    * users.favourites_note VARCHAR(200) NULL - "Anything else you love?".
--
-- 2. BIRTHDAY OFFER - X% off ONE order placed in the birthday week
--    (birthday +-3 days, Asia/Colombo); the switch and the % live in
--    system_configurations 'birthday_offer' (no row = off).
--    * orders.birthday_discount_amount - the part of discount_amount that is
--      the birthday gift. The gift and a coupon never stack (the larger one
--      is taken), so it is either 0 or the whole discount_amount;
--      total_amount = subtotal + delivery_fee - discount_amount still holds.
--    * birthday_offer_redemptions - one row per order that used the gift.
--      offer_year is the year of the birthday the gift is for, and only one
--      live (not released) row per customer per offer_year may exist.
--      Cancelling the order releases it (released_at), like a coupon.

-- ----------------------------------------------------------------------------
-- 1. Profile
-- ----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS favourite_category_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS favourites_note VARCHAR(200);

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_date_of_birth;
ALTER TABLE users ADD CONSTRAINT chk_users_date_of_birth
  CHECK (date_of_birth IS NULL OR date_of_birth >= DATE '1900-01-01');
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_favourite_categories;
ALTER TABLE users ADD CONSTRAINT chk_users_favourite_categories
  CHECK (cardinality(favourite_category_ids) <= 50);

-- The birthday SMS pass and "Birthdays this week" look customers up by
-- month and day, as MMDD (e.g. 1012 for 12 October).
CREATE INDEX IF NOT EXISTS idx_users_birthday_month_day
  ON users ((EXTRACT(MONTH FROM date_of_birth) * 100 + EXTRACT(DAY FROM date_of_birth)))
  WHERE date_of_birth IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Birthday offer redemptions
-- ----------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS birthday_discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_birthday_discount;
ALTER TABLE orders ADD CONSTRAINT chk_order_birthday_discount
  CHECK (birthday_discount_amount >= 0 AND birthday_discount_amount <= discount_amount);

CREATE TABLE IF NOT EXISTS birthday_offer_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    offer_year SMALLINT NOT NULL,
    percent NUMERIC(5,2) NOT NULL,
    discount_amount NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at TIMESTAMPTZ,
    CONSTRAINT chk_birthday_redemption_percent CHECK (percent > 0 AND percent < 100),
    CONSTRAINT chk_birthday_redemption_discount CHECK (discount_amount >= 0)
);
-- Once per customer per birthday: a released (cancelled) use does not count.
CREATE UNIQUE INDEX IF NOT EXISTS uq_birthday_offer_redemptions_live
  ON birthday_offer_redemptions (customer_id, offer_year)
  WHERE released_at IS NULL;
