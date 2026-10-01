DROP INDEX IF EXISTS idx_deliveries_rider_failed_at;
DROP INDEX IF EXISTS idx_deliveries_rider_delivered_at;
DELETE FROM system_configurations WHERE key = 'rider_batching';
