-- Migration 027 DOWN: drop SMS offers and the customer SMS preferences.
DROP TABLE IF EXISTS sms_offers;
ALTER TABLE users DROP COLUMN IF EXISTS sms_offers_opted_out_at;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_sms_language;
ALTER TABLE users DROP COLUMN IF EXISTS sms_language;
