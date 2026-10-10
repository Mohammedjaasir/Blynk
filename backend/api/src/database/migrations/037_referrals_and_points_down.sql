-- Migration 037 DOWN: no refer-a-friend, no Blynk Points. Orders that used a
-- referral reward or points keep their discount_amount (and total), so they
-- read as an ordinary discount; codes, referrals, credits and the points
-- ledger are lost.
DROP TABLE IF EXISTS points_ledger;
DROP TABLE IF EXISTS referral_rewards;
DROP TABLE IF EXISTS referrals;
DROP TABLE IF EXISTS referral_codes;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_reward_discounts;
ALTER TABLE orders DROP COLUMN IF EXISTS points_discount_amount;
ALTER TABLE orders DROP COLUMN IF EXISTS points_redeemed;
ALTER TABLE orders DROP COLUMN IF EXISTS referral_discount_amount;

DELETE FROM system_configurations WHERE key IN ('referral_program', 'points_program');
