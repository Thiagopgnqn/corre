-- Migration 0013: Backfill study_plans.config intermediateDegrees[0] (name, shortLabel, shortTitle)
-- and ppsRequirement.description for ISI Plan 2023.
-- Data-only, additive and idempotent:
--   1. Left-merges defaults on intermediateDegrees[0] ("shortLabel": "Analista",
--      "shortTitle": "Analista Universitario") without overwriting existing keys,
--      and upgrades legacy "Analista Universitario en Sistemas" or intermediate
--      "Analista Universitario de Sistemas" (or missing/empty name) to
--      "Analista Universitario de Sistemas de Información" while preserving any
--      custom admin name. Preserves any additional elements [1..] in intermediateDegrees.
--   2. Left-merges "description": "Cumplís los requisitos para cursar la Práctica Profesional"
--      into ppsRequirement without overwriting existing keys.
--   3. Only updates rows that actually need at least one of these changes.
--   4. Increments catalog_versions (id = 'default') in the same statement via CTE ONLY if
--      at least one row in study_plans was updated, using the exact bumpCatalogVersion() format.

WITH upd AS (
  UPDATE "study_plans" sp
  SET "config" = (
    COALESCE(sp."config", '{}'::jsonb)
    || jsonb_build_object(
      'intermediateDegrees',
      CASE
        WHEN jsonb_typeof(COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees') = 'array'
          AND jsonb_array_length(COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees') > 0
        THEN jsonb_set(
          COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees',
          '{0}',
          jsonb_set(
            '{"key":"analista","shortLabel":"Analista","shortTitle":"Analista Universitario","requiredElectiveCredits":4,"specialRuleSubjectCode":99}'::jsonb
            || (
              CASE
                WHEN jsonb_typeof(COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees'->0) = 'object'
                THEN COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees'->0
                ELSE '{}'::jsonb
              END
            ),
            '{name}',
            CASE
              WHEN COALESCE(
                NULLIF(btrim(COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees'->0->>'name'), ''),
                'Analista Universitario en Sistemas'
              ) IN ('Analista Universitario en Sistemas', 'Analista Universitario de Sistemas')
              THEN '"Analista Universitario de Sistemas de Información"'::jsonb
              ELSE COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees'->0->'name'
            END,
            true
          ),
          false
        )
        ELSE jsonb_build_array(
          '{"key":"analista","name":"Analista Universitario de Sistemas de Información","shortLabel":"Analista","shortTitle":"Analista Universitario","requiredElectiveCredits":4,"specialRuleSubjectCode":99}'::jsonb
        )
      END,
      'ppsRequirement',
      '{"referenceSubjectCode":36,"label":"Habilitación PPS","description":"Cumplís los requisitos para cursar la Práctica Profesional"}'::jsonb
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
      jsonb_typeof(COALESCE(sp."config", '{}'::jsonb)->'ppsRequirement') IS DISTINCT FROM 'object'
      OR NOT ((COALESCE(sp."config", '{}'::jsonb)->'ppsRequirement') ? 'referenceSubjectCode')
      OR NOT ((COALESCE(sp."config", '{}'::jsonb)->'ppsRequirement') ? 'label')
      OR NOT ((COALESCE(sp."config", '{}'::jsonb)->'ppsRequirement') ? 'description')
      OR jsonb_typeof(COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees') IS DISTINCT FROM 'array'
      OR jsonb_array_length(COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees') = 0
      OR jsonb_typeof(COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees'->0) IS DISTINCT FROM 'object'
      OR NOT ((COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees'->0) ? 'shortLabel')
      OR NOT ((COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees'->0) ? 'shortTitle')
      OR COALESCE(
        NULLIF(btrim(COALESCE(sp."config", '{}'::jsonb)->'intermediateDegrees'->0->>'name'), ''),
        'Analista Universitario en Sistemas'
      ) IN ('Analista Universitario en Sistemas', 'Analista Universitario de Sistemas')
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
