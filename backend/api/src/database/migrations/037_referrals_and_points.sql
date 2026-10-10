-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 037: refer a friend and Blynk Points (owner, 2026-10-10)
-- ============================================================================
-- Owner, 2026-10-10: "refer a friend" and "Blynk points - admin and ops will
-- decide that". Both programs are OFF until Admin/Operations switch them on;
-- every number lives in system_configurations ('referral_program',
-- 'points_program'), seeded here switched off.
--
-- 1. REFER A FRIEND
--    * referral_codes - one personal code per customer, made on first ask.
--    * referrals - who invited whom. friend_id is UNIQUE: one referral per
--      account (one phone number = one account already), never yourself.
--      status: PENDING (waiting for the friend's first delivered order),
--      REWARDED (inviter credited), CAPPED (inviter over the monthly cap),
--      NO_REWARD (the program was off when the friend's order was delivered).
--    * referral_rewards - one reward per referral per side (FRIEND/INVITER).
--      A FRIEND row is written when the friend's first order takes the
--      reward (and deleted again if that order is cancelled). An INVITER row
--      is a credit written when the friend's first order is delivered; it is
--      used by the inviter's next order (order_id) and comes back if that
--      order is cancelled. A friend whose first order could not take the
--      reward (already free, or a bigger coupon won) gets a FRIEND credit the
--      same way when that order is delivered. mode LKR_OFF takes `amount` off the items;
--      FREE_DELIVERY takes the delivery fee off (amount 0).
--    * orders.referral_discount_amount - the part of discount_amount that is
--      a referral reward. A referral reward, a coupon and the birthday gift
--      never stack: the single larger one is used.
--
-- 2. BLYNK POINTS
--    * points_ledger - every change to a customer's points, signed:
--      EARN (+, a delivered order), REDEEM (-, used at checkout), REFUND (+,
--      the order that used them was cancelled), EXPIRE (-), ADJUST (+/-,
--      Admin/Operations with a reason, audited). Positive rows are "lots"
--      with `remaining` and `expires_at`; spending and expiry use the oldest
--      lots first, so the balance is the sum of what remains.
--    * orders.points_redeemed / points_discount_amount - points used on the
--      order and what they took off. They act like a payment applied after
--      every discount, and are part of discount_amount so
--      total_amount = subtotal + delivery_fee - discount_amount still holds
--      (total_amount is the cash the rider collects).

-- ----------------------------------------------------------------------------
-- 1. Orders
-- ----------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS referral_discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_redeemed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS points_discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_reward_discounts;
ALTER TABLE orders ADD CONSTRAINT chk_order_reward_discounts CHECK (
  referral_discount_amount >= 0
  AND points_redeemed >= 0
  AND points_discount_amount >= 0
  AND birthday_discount_amount + referral_discount_amount + points_discount_amount <= discount_amount
);

-- ----------------------------------------------------------------------------
-- 2. Refer a friend
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_codes (
    customer_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(16) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_referral_code_format CHECK (code ~ '^[A-Z0-9]{4,16}$')
);

CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    code VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    qualifying_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_referral_not_self CHECK (inviter_id <> friend_id),
    CONSTRAINT chk_referral_status CHECK (status IN ('PENDING', 'REWARDED', 'CAPPED', 'NO_REWARD'))
);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals (inviter_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_referrals_created ON referrals (created_at DESC);

CREATE TABLE IF NOT EXISTS referral_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referral_id UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    side VARCHAR(8) NOT NULL,
    mode VARCHAR(16) NOT NULL,
    amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    order_id UUID UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
    discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_referral_reward_side UNIQUE (referral_id, side),
    CONSTRAINT chk_referral_reward_side CHECK (side IN ('FRIEND', 'INVITER')),
    CONSTRAINT chk_referral_reward_mode CHECK (mode IN ('LKR_OFF', 'FREE_DELIVERY')),
    CONSTRAINT chk_referral_reward_amounts CHECK (amount >= 0 AND discount_amount >= 0)
);
-- A customer's unused credits, oldest first.
CREATE INDEX IF NOT EXISTS idx_referral_rewards_available
  ON referral_rewards (customer_id, created_at) WHERE order_id IS NULL;

-- ----------------------------------------------------------------------------
-- 3. Blynk Points
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS points_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(8) NOT NULL,
    points INTEGER NOT NULL,
    remaining INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    reason VARCHAR(200),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_points_kind CHECK (kind IN ('EARN', 'REDEEM', 'REFUND', 'EXPIRE', 'ADJUST')),
    CONSTRAINT chk_points_nonzero CHECK (points <> 0),
    CONSTRAINT chk_points_sign CHECK (
      (kind IN ('EARN', 'REFUND') AND points > 0)
      OR (kind IN ('REDEEM', 'EXPIRE') AND points < 0)
      OR kind = 'ADJUST'
    ),
    CONSTRAINT chk_points_remaining CHECK (remaining >= 0 AND (points > 0 OR remaining = 0) AND remaining <= GREATEST(points, 0))
);
CREATE INDEX IF NOT EXISTS idx_points_ledger_customer ON points_ledger (customer_id, created_at DESC);
-- Lots still holding points, soonest-expiring first.
CREATE INDEX IF NOT EXISTS idx_points_ledger_lots
  ON points_ledger (customer_id, expires_at, created_at) WHERE remaining > 0;
-- One earn and one redeem per order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_points_ledger_order_earn ON points_ledger (order_id) WHERE kind = 'EARN';
CREATE UNIQUE INDEX IF NOT EXISTS uq_points_ledger_order_redeem ON points_ledger (order_id) WHERE kind = 'REDEEM';
CREATE UNIQUE INDEX IF NOT EXISTS uq_points_ledger_order_refund ON points_ledger (order_id) WHERE kind = 'REFUND';

-- ----------------------------------------------------------------------------
-- 4. Settings, switched off
-- ----------------------------------------------------------------------------
INSERT INTO system_configurations (key, value, description) VALUES
  ('referral_program',
   '{"enabled": false, "mode": "LKR_OFF", "friend_amount_lkr": 200, "inviter_amount_lkr": 200, "monthly_cap": 10}',
   'Refer a friend: on/off, reward type and amounts, rewards per inviter per month'),
  ('points_program',
   '{"enabled": false, "earn_points": 1, "earn_per_lkr": 100, "lkr_per_point": 1, "min_redeem_points": 100, "max_redeem_percent": 20, "expiry_months": 12}',
   'Blynk Points: on/off, earn rate, point value, redeem limits, expiry')
ON CONFLICT (key) DO NOTHING;
