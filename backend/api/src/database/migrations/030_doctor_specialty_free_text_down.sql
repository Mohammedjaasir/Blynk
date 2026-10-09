-- Migration 030 DOWN: a doctor's specialty is the dental_specialty_enum again.
-- The six readable labels map back to their enum values (case and spacing
-- ignored); any other free-text specialty becomes GENERAL_DENTIST - the
-- typed text is lost.
DO $$ BEGIN
    CREATE TYPE dental_specialty_enum AS ENUM (
        'GENERAL_DENTIST',
        'ORTHODONTIST',
        'PERIODONTIST',
        'ENDODONTIST',
        'ORAL_SURGEON',
        'PEDIATRIC_DENTIST'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE doctors
  ALTER COLUMN specialty TYPE dental_specialty_enum
  USING (
    CASE lower(btrim(specialty))
      WHEN 'general dentist' THEN 'GENERAL_DENTIST'
      WHEN 'general_dentist' THEN 'GENERAL_DENTIST'
      WHEN 'orthodontist' THEN 'ORTHODONTIST'
      WHEN 'periodontist' THEN 'PERIODONTIST'
      WHEN 'endodontist' THEN 'ENDODONTIST'
      WHEN 'oral surgeon' THEN 'ORAL_SURGEON'
      WHEN 'oral_surgeon' THEN 'ORAL_SURGEON'
      WHEN 'pediatric dentist' THEN 'PEDIATRIC_DENTIST'
      WHEN 'pediatric_dentist' THEN 'PEDIATRIC_DENTIST'
      ELSE 'GENERAL_DENTIST'
    END
  )::dental_specialty_enum;

ALTER TABLE doctors ALTER COLUMN specialty SET NOT NULL;
