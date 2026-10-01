-- Flat delivery fee raised from LKR 70 to LKR 100 (owner, 2026-09-30).
-- Orders keep the fee they were placed with (orders.delivery_fee is a
-- snapshot); only new orders use 100.
INSERT INTO system_configurations (key, value, description)
VALUES ('delivery_fee', '{"fee_lkr": 100.00}'::jsonb, 'Standard flat delivery fee in LKR')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;
