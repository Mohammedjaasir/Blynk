-- Migration 034 DOWN: no customer profile fields, no birthday offer. Orders
-- that used the gift keep their discount_amount (and total), so they read as
-- an ordinary discount; the redemption records and the profiles are lost.
DROP TABLE IF EXISTS birthday_offer_redemptions;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_birthday_discount;
ALTER TABLE orders DROP COLUMN IF EXISTS birthday_discount_amount;

DROP INDEX IF EXISTS idx_users_birthday_month_day;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_favourite_categories;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_date_of_birth;
ALTER TABLE users DROP COLUMN IF EXISTS favourites_note;
ALTER TABLE users DROP COLUMN IF EXISTS favourite_category_ids;
ALTER TABLE users DROP COLUMN IF EXISTS date_of_birth;

DELETE FROM system_configurations WHERE key = 'birthday_offer';
