-- Migration 022 DOWN: remove device tokens, stock alerts and queued pushes.
-- Postgres cannot drop an enum value, so notification_channel_enum keeps
-- 'PUSH' (unused once the rows below are gone; re-running 022 is a no-op for it).
DELETE FROM notifications WHERE channel = 'PUSH';
DROP TABLE IF EXISTS stock_alerts;
DROP TABLE IF EXISTS device_tokens;
