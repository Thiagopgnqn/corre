-- Migration 0012: Update plan_special_rules.description for ISI Plan 2023 to match fixture specialRule texts
-- Data-only, additive and idempotent:
--   1. Sets plan_special_rules.description for ISI Plan 2023 subject codes 99 (approved_range)
--      and 36 (all_previous_core_approved) to the exact fixture strings.
--   2. Guarded by psr."description" IS DISTINCT FROM td."description" so re-runs are no-ops
--      and non-matching rows are left untouched.
--   3. Increments catalog_versions (id = 'default') in the same CTE statement ONLY if at least one
--      row in plan_special_rules was updated, using the exact same format as bumpCatalogVersion().

WITH target_descriptions ("code_in_plan", "rule_type", "description") AS (
  VALUES
    (99, 'approved_range', 'Para RENDIRLO hay que tener aprobadas todas las materias de 1 a 23.'),
    (36, 'all_previous_core_approved', 'Para RENDIRLO hay que tener aprobadas todas las materias previas del plan (1 a 35 + Seminario 99 + Electivas).')
),
upd AS (
  UPDATE "plan_special_rules" psr
  SET
    "description" = td."description",
    "updated_at" = now()
  FROM "target_descriptions" td, "subjects" s, "study_plans" sp, "careers" c
  WHERE psr."plan_id" = sp."id"
    AND psr."subject_id" = s."id"
    AND s."plan_id" = sp."id"
    AND sp."career_id" = c."id"
    AND c."code" = 'ISI'
    AND sp."year" = 2023
    AND s."code_in_plan" = td."code_in_plan"
    AND psr."rule_type" = td."rule_type"
    AND psr."description" IS DISTINCT FROM td."description"
  RETURNING psr."id"
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
