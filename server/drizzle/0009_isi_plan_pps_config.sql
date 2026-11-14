-- Migration 0009: Backfill study_plans.config (ppsRequirement & finalDegreeTitle) for ISI Plan 2023
-- Data-only, additive and idempotent:
--   1. Left-merges default keys ("finalDegreeTitle": "Ingeniero/a" and
--      "ppsRequirement": {"referenceSubjectCode": 36, "label": "Habilitación PPS"})
--      so existing keys win both at the top level and inside "ppsRequirement".
--   2. Only updates rows missing at least one of those keys ("finalDegreeTitle",
--      "ppsRequirement.referenceSubjectCode", or "ppsRequirement.label").
--   3. Increments catalog_versions (id = 'default') in the same statement via CTE ONLY if
--      at least one row in study_plans was updated, using the exact same version format
--      as bumpCatalogVersion() in admin.service.ts ('v-<ms>-<6hex>').

WITH upd AS (
  UPDATE "study_plans" sp
  SET "config" = (
    '{"finalDegreeTitle":"Ingeniero/a"}'::jsonb
    || COALESCE(sp."config", '{}'::jsonb)
    || jsonb_build_object(
      'ppsRequirement',
      '{"referenceSubjectCode":36,"label":"Habilitación PPS"}'::jsonb
      || CASE
           WHEN jsonb_typeof(COALESCE(sp."config", '{}'::jsonb)->'ppsRequirement') = 'object'
           THEN COALESCE(sp."config", '{}'::jsonb)->'ppsRequirement'
           ELSE '{}'::jsonb
         END
    )
  )
  FROM "careers" c
  WHERE sp."career_id" = c."id"
    AND c."code" = 'ISI'
    AND sp."year" = 2023
    AND (
      NOT (COALESCE(sp."config", '{}'::jsonb) ? 'finalDegreeTitle')
      OR jsonb_typeof(COALESCE(sp."config", '{}'::jsonb)->'ppsRequirement') IS DISTINCT FROM 'object'
      OR NOT ((COALESCE(sp."config", '{}'::jsonb)->'ppsRequirement') ? 'referenceSubjectCode')
      OR NOT ((COALESCE(sp."config", '{}'::jsonb)->'ppsRequirement') ? 'label')
    )
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
