-- PostgreSQL cannot drop a value from an enum type; a SELLER user would have to be
-- removed first. Intentionally a no-op so a rollback of 052 does not need this.
SELECT 1;
