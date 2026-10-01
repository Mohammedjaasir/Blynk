-- Migration 014 DOWN: no OPERATIONS role, no staff disabling.
-- PostgreSQL cannot drop an enum value, so the type is rebuilt without it.
-- Operations accounts become PACKING_STAFF (the nearest staff role) rather
-- than being deleted; review them by hand afterwards.

UPDATE users SET role = 'PACKING_STAFF' WHERE role = 'OPERATIONS';

ALTER TYPE user_role_enum RENAME TO user_role_enum_014;
CREATE TYPE user_role_enum AS ENUM ('CUSTOMER', 'RIDER', 'PACKING_STAFF', 'ADMIN');
ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE users ALTER COLUMN role TYPE user_role_enum USING role::text::user_role_enum;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'CUSTOMER';
DROP TYPE user_role_enum_014;

ALTER TABLE users DROP COLUMN IF EXISTS staff_disabled_at;
