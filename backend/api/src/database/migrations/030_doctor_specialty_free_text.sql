-- ============================================================================
-- BLYNK PLATFORM DATABASE SCHEMA (POSTGRESQL 15+)
-- Migration 030: a dental doctor's specialty is free text
-- ============================================================================
-- 2026-10-09 (owner). Operations and Admin can write any specialty for a
-- doctor (e.g. "Cosmetic dentist", "Prosthodontist"); the six old enum
-- values stay only as quick suggestions in the apps.
--
-- doctors.specialty changes from dental_specialty_enum to VARCHAR(64)
-- NOT NULL. Every existing value becomes its readable label:
--   GENERAL_DENTIST   -> General dentist
--   ORTHODONTIST      -> Orthodontist
--   PERIODONTIST      -> Periodontist
--   ENDODONTIST       -> Endodontist
--   ORAL_SURGEON      -> Oral surgeon
--   PEDIATRIC_DENTIST -> Pediatric dentist
-- Nothing else uses dental_specialty_enum, so the type is dropped.

ALTER TABLE doctors
  ALTER COLUMN specialty TYPE VARCHAR(64)
  USING (
    CASE specialty::text
      WHEN 'GENERAL_DENTIST' THEN 'General dentist'
      WHEN 'ORTHODONTIST' THEN 'Orthodontist'
      WHEN 'PERIODONTIST' THEN 'Periodontist'
      WHEN 'ENDODONTIST' THEN 'Endodontist'
      WHEN 'ORAL_SURGEON' THEN 'Oral surgeon'
      WHEN 'PEDIATRIC_DENTIST' THEN 'Pediatric dentist'
      ELSE specialty::text
    END
  );

ALTER TABLE doctors ALTER COLUMN specialty SET NOT NULL;

DROP TYPE IF EXISTS dental_specialty_enum;
