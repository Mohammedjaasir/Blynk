-- ============================================================================
-- Migration 064: seller applications (the form at blynk.lk/seller)
-- ============================================================================
-- Owner's brother, 2026-10-27: "one form inside blynk.lk saying apply for seller registration; once
-- they submit we receive the application, then we contact them directly by phone". Anyone (no
-- account) sends the website form; Admin / Operations see the applications, ring the applicant,
-- mark them CONTACTED / APPROVED / DECLINED and, when they agree, add the seller from the
-- application (modules/sellers/seller-applications.ts).
--
--   seller_applications.phone        normalized +94XXXXXXXXX
--   seller_applications.status       NEW | CONTACTED | APPROVED | DECLINED
--   seller_applications.handled_by   the staff member who last changed the status or note
--   seller_applications.source       where it came from (WEBSITE)
--   seller_applications.ip_hash      HMAC of the sender's address (spam tracing, never the address)
--
-- The API is deployed before this runs (migrations are run by hand in Coolify): until the table
-- exists every route answers 503 SELLER_APPLICATIONS_NOT_READY.

CREATE TABLE IF NOT EXISTS seller_applications (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_name      VARCHAR(80)   NOT NULL,
    owner_name     VARCHAR(80)   NOT NULL,
    phone          VARCHAR(20)   NOT NULL,
    email          VARCHAR(120)  NULL,
    town           VARCHAR(60)   NOT NULL,
    what_they_sell VARCHAR(500)  NOT NULL,
    message        VARCHAR(1000) NULL,
    status         VARCHAR(10)   NOT NULL DEFAULT 'NEW',
    staff_note     VARCHAR(500)  NULL,
    handled_by     UUID          NULL REFERENCES users(id) ON DELETE SET NULL,
    handled_at     TIMESTAMPTZ   NULL,
    source         VARCHAR(20)   NOT NULL DEFAULT 'WEBSITE',
    ip_hash        VARCHAR(64)   NULL,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_seller_applications_status CHECK (status IN ('NEW', 'CONTACTED', 'APPROVED', 'DECLINED'))
);

-- the staff list (by status, newest first) and the "already applied" check
CREATE INDEX IF NOT EXISTS idx_seller_applications_status ON seller_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_applications_phone ON seller_applications (phone);
