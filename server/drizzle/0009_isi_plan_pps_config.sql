WITH upd AS (
  UPDATE "study_plans" sp
  SET "config" = '{"ppsRequirement":{"referenceSubjectCode":36}}'::jsonb || COALESCE(sp."config", '{}'::jsonb)
  FROM "careers" c
  WHERE sp."career_id" = c."id"
    AND c."code" = 'ISI'
    AND sp."year" = 2023
    AND NOT (COALESCE(sp."config", '{}'::jsonb) ? 'ppsRequirement')
  RETURNING sp."id"
),
ins_default AS (
  INSERT INTO "catalog_versions" ("id", "version", "updated_at")
  SELECT
    'default',
    'v-' || (FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint)::text || '-' || SUBSTRING(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 6),
    now()
  WHERE EXISTS (SELECT 1 FROM upd)
  ON CONFLICT ("id") DO NOTHING
)
UPDATE "catalog_versions"
SET
  "version" = 'v-' || (FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint)::text || '-' || SUBSTRING(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 6),
  "updated_at" = now()
WHERE "id" = 'default'
  AND EXISTS (SELECT 1 FROM upd);
