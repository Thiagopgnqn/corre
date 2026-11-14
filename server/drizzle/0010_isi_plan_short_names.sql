-- Migration 0010: Backfill subjects.short_name for the 28 aligned subjects in ISI Plan 2023
-- Data-only, additive and idempotent:
--   1. Updates short_name for the 28 ISI Plan 2023 subjects (21 core + 7 aligned electives)
--      matching SUBJECT_SHORT_NAMES from ScheduleWeeklyGrid, leaving the 14 misaligned electives
--      and elective 301 untouched.
--   2. Only updates rows where s."short_name" = s."name" so already customized short names are preserved.
--   3. Increments catalog_versions (id = 'default') in the same CTE statement ONLY if at least one
--      row in subjects was updated, using the exact same format as bumpCatalogVersion().

WITH target_names ("code_in_plan", "short_name") AS (
  VALUES
    (1, 'Análisis Mat. 1'),
    (2, 'Álgebra y Geom.'),
    (5, 'Lógica y Estruct.'),
    (6, 'Algoritmos (AED)'),
    (7, 'Arquitectura (ACO)'),
    (8, 'Sist. y Procesos (SPN)'),
    (9, 'Análisis Mat. 2'),
    (11, 'Ing. y Sociedad'),
    (13, 'Sintaxis (SSL)'),
    (14, 'Paradigmas (PPR)'),
    (16, 'Análisis de Sistemas'),
    (17, 'Probabilidad y Est.'),
    (20, 'Desarrollo Software (DDS)'),
    (21, 'Com. de Datos'),
    (23, 'Diseño de Sist. (DSI)'),
    (25, 'Calidad de Software'),
    (26, 'Redes de Datos (RDA)'),
    (29, 'Automatización (TPA)'),
    (30, 'Admin. de Sistemas'),
    (35, 'Seguridad en Sistemas'),
    (99, 'Seminario Integrador'),
    (405, 'Aplic. con Objetos (DAO)'),
    (408, 'Interfaces y UIX'),
    (507, 'Decisiones (DEC)'),
    (509, 'Seguridad SW (SDS)'),
    (511, 'Software Libre (ISFA)'),
    (513, 'Entornos Virtuales'),
    (514, 'PPS')
),
upd AS (
  UPDATE "subjects" s
  SET
    "short_name" = tn."short_name",
    "updated_at" = now()
  FROM "target_names" tn, "study_plans" sp, "careers" c
  WHERE s."plan_id" = sp."id"
    AND sp."career_id" = c."id"
    AND c."code" = 'ISI'
    AND sp."year" = 2023
    AND s."code_in_plan" = tn."code_in_plan"
    AND s."short_name" = s."name"
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
