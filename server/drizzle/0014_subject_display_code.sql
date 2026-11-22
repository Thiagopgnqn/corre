-- Migration 0014: Add subjects.display_code and backfill explicit display codes
-- Additive and idempotent:
--   1. Adds nullable varchar(32) column "display_code" on "subjects" with ADD COLUMN IF NOT EXISTS.
--   2. Backfills ONLY rows where "display_code" IS NULL:
--      - For ISI Plan 2023 electives: 'X-' prefix on (408, 512, 513, 514), 'E-' on remaining electives.
--      - For all other subjects (and all other careers): s."code_in_plan"::text.
--   3. Increments catalog_versions (id = 'default') in the same CTE ONLY if at least one row changed.

ALTER TABLE "subjects" ADD COLUMN IF NOT EXISTS "display_code" varchar(32);--> statement-breakpoint
WITH upd AS (
  UPDATE "subjects" s
  SET
    "display_code" = CASE
      WHEN c."code" = 'ISI' AND sp."year" = 2023 AND s."kind" = 'electiva' THEN
        CASE
          WHEN s."code_in_plan" IN (408, 512, 513, 514) THEN 'X-' || s."code_in_plan"::text
          ELSE 'E-' || s."code_in_plan"::text
        END
      ELSE s."code_in_plan"::text
    END,
    "updated_at" = now()
  FROM "study_plans" sp, "careers" c
  WHERE s."plan_id" = sp."id"
    AND sp."career_id" = c."id"
    AND s."display_code" IS NULL
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
