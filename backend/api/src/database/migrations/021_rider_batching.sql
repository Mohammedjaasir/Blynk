-- Rider batching (2026-09-30): a rider may carry up to two orders in one
-- trip. Both limits are store settings read at assignment time
-- (modules/riders/batching.ts); a missing or malformed row falls back to the
-- same defaults.
--   max_active_deliveries   - open deliveries one rider may hold at once
--   max_dropoff_distance_km - how far apart (straight line) two drop-offs in
--                             one trip may be before staff must confirm
INSERT INTO system_configurations (key, value, description)
VALUES (
  'rider_batching',
  '{"max_active_deliveries": 2, "max_dropoff_distance_km": 1.5}'::jsonb,
  'Rider trips: how many open deliveries one rider may hold, and how far apart two drop-offs may be without a confirmation'
)
ON CONFLICT (key) DO NOTHING;

-- "My day" in the Rider app: a rider's finished deliveries by time.
CREATE INDEX IF NOT EXISTS idx_deliveries_rider_delivered_at
  ON deliveries (rider_id, delivered_at) WHERE assignment_status = 'DELIVERED';
CREATE INDEX IF NOT EXISTS idx_deliveries_rider_failed_at
  ON deliveries (rider_id, failed_at) WHERE assignment_status = 'FAILED';
