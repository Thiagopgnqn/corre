-- Migration 0011: Add subjects.is_integrator and backfill the 5 integrator subjects in ISI Plan 2023
-- Additive and idempotent:
--   1. Adds column is_integrator boolean NOT NULL DEFAULT false with ADD COLUMN IF NOT EXISTS.
--   2. In a separate CTE statement, sets is_integrator = true ONLY for ISI Plan 2023 and ONLY for
--      the 5 subjects that have isIntegrator: true in the fixtures (codes 16, 23, 30, 36, 99),
--      guarded by WHERE s."is_integrator" = false.
--   3. Increments catalog_versions (id = 'default') in the same CTE statement ONLY if at least one
--      row in subjects was updated, using the exact same format as bumpCatalogVersion().

ALTER TABLE "subjects" ADD COLUMN IF NOT EXISTS "is_integrator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
WITH upd AS (
  UPDATE "subjects" s
  SET
    "is_integrator" = true,
    "updated_at" = now()
  FROM "study_plans" sp, "careers" c
  WHERE s."plan_id" = sp."id"
    AND sp."career_id" = c."id"
    AND c."code" = 'ISI'
    AND sp."year" = 2023
    AND s."code_in_plan" IN (16, 23, 30, 36, 99)
    AND s."is_integrator" = false
  RETURNING s."id"
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
