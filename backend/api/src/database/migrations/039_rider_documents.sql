-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 039: rider documents (owner, 2026-10-10)
-- ============================================================================
-- Rider sign-up needs documents - Vehicle book (CR), Revenue licence,
-- Insurance certificate, Driving licence, plus any custom one Ops/Admin add -
-- and Ops/Admin verify each one before approving the rider.
--
-- Which documents are required (per vehicle type), and which need an expiry
-- date, is a setting: system_configurations 'rider_documents' (no row means
-- the defaults in riders/rider.documents.settings.ts). No migration needed
-- for that.
--
--   rider_id      the application (riders.id) the document belongs to. NULL
--                 while the applicant is still filling the form (the
--                 application is not sent yet): the document is then a draft
--                 keyed by the applicant's SMS-verified phone (draft_phone)
--                 and is moved onto the riders row when the application is
--                 sent. Exactly one of the two is set.
--   doc_type      VEHICLE_BOOK | REVENUE_LICENCE | INSURANCE | DRIVING_LICENCE
--                 or a custom document's key (CUSTOM_xxxxxxxx).
--   custom_name   the custom document's name when it was uploaded.
--   images        JSON array of the stored pages, in order (front, back):
--                 [{"key": "<document id>/<uuid>.jpg", "content_type":
--                 "image/jpeg", "bytes": 123456, "uploaded_at": "..."}].
--                 The files live in PRIVATE storage (RIDER_DOCUMENTS_ROOT),
--                 never under the public /uploads folder, and are served
--                 only through authenticated endpoints.
--   expiry_date   optional; Ops/Admin can set it when verifying.
--   status        PENDING | VERIFIED | REJECTED. Any new upload by the
--                 applicant puts it back to PENDING.
--   reject_reason BLURRY | EXPIRED | NAME_MISMATCH | WRONG_DOCUMENT | OTHER,
--   reject_note   with an optional note (required for OTHER by the API).
--
-- Deleting the application (riders row) deletes its documents (CASCADE);
-- the API deletes the stored files too.

CREATE TABLE IF NOT EXISTS rider_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NULL REFERENCES riders(id) ON DELETE CASCADE,
  draft_phone VARCHAR(20) NULL,
  doc_type VARCHAR(40) NOT NULL,
  custom_name VARCHAR(80) NULL,
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  expiry_date DATE NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  reject_reason VARCHAR(32) NULL,
  reject_note TEXT NULL,
  reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_rider_documents_owner CHECK ((rider_id IS NULL) <> (draft_phone IS NULL)),
  CONSTRAINT chk_rider_documents_status CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  CONSTRAINT chk_rider_documents_reject_reason CHECK (
    reject_reason IS NULL OR reject_reason IN ('BLURRY', 'EXPIRED', 'NAME_MISMATCH', 'WRONG_DOCUMENT', 'OTHER')
  ),
  CONSTRAINT chk_rider_documents_images_array CHECK (jsonb_typeof(images) = 'array')
);

-- One document of each type per application, and per draft.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rider_documents_rider_type
  ON rider_documents (rider_id, doc_type) WHERE rider_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rider_documents_draft_type
  ON rider_documents (draft_phone, doc_type) WHERE draft_phone IS NOT NULL;

-- "Insurance expiring soon / expired" badges on the Riders list.
CREATE INDEX IF NOT EXISTS idx_rider_documents_expiry
  ON rider_documents (expiry_date) WHERE expiry_date IS NOT NULL AND rider_id IS NOT NULL;

-- Stale drafts (an applicant who never sent the application) are swept.
CREATE INDEX IF NOT EXISTS idx_rider_documents_draft_updated
  ON rider_documents (updated_at) WHERE draft_phone IS NOT NULL;
