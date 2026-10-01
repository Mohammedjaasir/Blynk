-- Back to the previous flat delivery fee, LKR 70.
UPDATE system_configurations
   SET value = '{"fee_lkr": 70.00}'::jsonb, updated_at = CURRENT_TIMESTAMP
 WHERE key = 'delivery_fee';
