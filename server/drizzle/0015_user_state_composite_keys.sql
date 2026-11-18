-- Migration 0015: Enforce non-null plan_id and composite keys on user_settings & schedule_selections
-- Step A: Backfill NULL plan_id in user_settings, schedule_selections, schedule_proposals
-- Step B: Set NOT NULL on plan_id, switch user_settings PK to (user_id, plan_id),
--         and drop legacy uq_user_schedule_selection(user_id, schedule_term_id)
-- Step C: Expand extra_settings->'perPlan' and selections_by_plan JSONB maps into real rows,
--         safely skipping non-UUID keys and nonexistent plan UUIDs without casting errors.

UPDATE "user_settings" us
SET
  "plan_id" = COALESCE(
    (SELECT u."selected_plan_id" FROM "users" u WHERE u."id" = us."user_id"),
    (
      SELECT sp."id"
      FROM "study_plans" sp
      JOIN "careers" c ON c."id" = sp."career_id"
      WHERE sp."status" = 'published' OR sp."is_active" = true
      ORDER BY (c."code" = 'ISI' AND sp."year" = 2023) DESC, sp."is_active" DESC, sp."created_at" ASC
      LIMIT 1
    ),
    (
      SELECT sp2."id"
      FROM "study_plans" sp2
      ORDER BY sp2."created_at" ASC
      LIMIT 1
    )
  ),
  "updated_at" = now()
WHERE us."plan_id" IS NULL;--> statement-breakpoint
UPDATE "schedule_selections" ss
SET
  "plan_id" = COALESCE(
    (SELECT u."selected_plan_id" FROM "users" u WHERE u."id" = ss."user_id"),
    (
      SELECT sp."id"
      FROM "study_plans" sp
      JOIN "careers" c ON c."id" = sp."career_id"
      WHERE sp."status" = 'published' OR sp."is_active" = true
      ORDER BY (c."code" = 'ISI' AND sp."year" = 2023) DESC, sp."is_active" DESC, sp."created_at" ASC
      LIMIT 1
    ),
    (
      SELECT sp2."id"
      FROM "study_plans" sp2
      ORDER BY sp2."created_at" ASC
      LIMIT 1
    )
  ),
  "updated_at" = now()
WHERE ss."plan_id" IS NULL;--> statement-breakpoint
UPDATE "schedule_proposals" spr
SET
  "plan_id" = COALESCE(
    (SELECT u."selected_plan_id" FROM "users" u WHERE u."id" = spr."user_id"),
    (
      SELECT sp."id"
      FROM "study_plans" sp
      JOIN "careers" c ON c."id" = sp."career_id"
      WHERE sp."status" = 'published' OR sp."is_active" = true
      ORDER BY (c."code" = 'ISI' AND sp."year" = 2023) DESC, sp."is_active" DESC, sp."created_at" ASC
      LIMIT 1
    ),
    (
      SELECT sp2."id"
      FROM "study_plans" sp2
      ORDER BY sp2."created_at" ASC
      LIMIT 1
    )
  ),
  "updated_at" = now()
WHERE spr."plan_id" IS NULL;--> statement-breakpoint
DELETE FROM "user_settings" WHERE "plan_id" IS NULL;--> statement-breakpoint
DELETE FROM "schedule_selections" WHERE "plan_id" IS NULL;--> statement-breakpoint
DELETE FROM "schedule_proposals" WHERE "plan_id" IS NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "plan_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_selections" ALTER COLUMN "plan_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_proposals" ALTER COLUMN "plan_id" SET NOT NULL;--> statement-breakpoint
DO $$
DECLARE
  pk_cols text[];
  pk_name text;
BEGIN
  SELECT array_agg(a.attname ORDER BY array_position(i.indkey, a.attnum))
  INTO pk_cols
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = 'public.user_settings'::regclass
    AND i.indisprimary;

  IF pk_cols IS DISTINCT FROM ARRAY['user_id', 'plan_id']::text[] THEN
    SELECT conname
    INTO pk_name
    FROM pg_constraint
    WHERE conrelid = 'public.user_settings'::regclass
      AND contype = 'p'
    LIMIT 1;

    IF pk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE "user_settings" DROP CONSTRAINT %I', pk_name);
    END IF;

    ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id", "plan_id");
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "schedule_selections" DROP CONSTRAINT IF EXISTS "uq_user_schedule_selection";--> statement-breakpoint
DROP INDEX IF EXISTS "uq_user_schedule_selection";--> statement-breakpoint
WITH raw_per_plan AS (
  SELECT
    us."user_id",
    us."notify_library_email",
    us."created_at",
    us."updated_at",
    CASE
      WHEN kv.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN kv.key::uuid
      ELSE NULL
    END AS plan_uuid,
    kv.value AS val
  FROM "user_settings" us
  CROSS JOIN LATERAL jsonb_each(
    CASE
      WHEN jsonb_typeof(us."extra_settings"->'perPlan') = 'object'
      THEN us."extra_settings"->'perPlan'
      ELSE '{}'::jsonb
    END
  ) AS kv(key, value)
)
INSERT INTO "user_settings" (
  "user_id",
  "plan_id",
  "include_promotions_in_gpa",
  "min_passing_grade",
  "include_analista_track",
  "allow_blocked_electives_planning",
  "include_electives_in_progress",
  "sound_enabled",
  "tutorial_completed",
  "notify_library_email",
  "extra_settings",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON (r."user_id", r."plan_uuid")
  r."user_id",
  r."plan_uuid",
  CASE
    WHEN jsonb_typeof(r."val"->'includePromotionsInGPA') = 'boolean'
    THEN (r."val"->>'includePromotionsInGPA')::boolean
    ELSE true
  END,
  CASE
    WHEN (r."val"->>'minPassingGrade') ~ '^-?\d+$'
    THEN (r."val"->>'minPassingGrade')::integer
    ELSE 4
  END,
  CASE
    WHEN jsonb_typeof(r."val"->'includeAnalistaTrack') = 'boolean'
    THEN (r."val"->>'includeAnalistaTrack')::boolean
    ELSE false
  END,
  CASE
    WHEN jsonb_typeof(r."val"->'allowBlockedElectivesPlanning') = 'boolean'
    THEN (r."val"->>'allowBlockedElectivesPlanning')::boolean
    ELSE false
  END,
  CASE
    WHEN jsonb_typeof(r."val"->'includeElectivesInProgress') = 'boolean'
    THEN (r."val"->>'includeElectivesInProgress')::boolean
    ELSE true
  END,
  CASE
    WHEN jsonb_typeof(r."val"->'soundEnabled') = 'boolean'
    THEN (r."val"->>'soundEnabled')::boolean
    ELSE true
  END,
  CASE
    WHEN jsonb_typeof(r."val"->'tutorialCompleted') = 'boolean'
    THEN (r."val"->>'tutorialCompleted')::boolean
    ELSE false
  END,
  r."notify_library_email",
  '{}'::jsonb,
  r."created_at",
  r."updated_at"
FROM raw_per_plan r
JOIN "study_plans" sp ON sp."id" = r."plan_uuid"
WHERE r."plan_uuid" IS NOT NULL
  AND jsonb_typeof(r."val") = 'object'
ORDER BY r."user_id", r."plan_uuid", r."updated_at" DESC
ON CONFLICT ("user_id", "plan_id") DO NOTHING;--> statement-breakpoint
WITH raw_by_plan AS (
  SELECT
    ss."user_id",
    ss."schedule_term_id",
    ss."created_at",
    ss."updated_at",
    CASE
      WHEN kv.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN kv.key::uuid
      ELSE NULL
    END AS plan_uuid,
    kv.value AS val
  FROM "schedule_selections" ss
  CROSS JOIN LATERAL jsonb_each(
    CASE
      WHEN jsonb_typeof(ss."selections_by_plan") = 'object'
      THEN ss."selections_by_plan"
      ELSE '{}'::jsonb
    END
  ) AS kv(key, value)
)
INSERT INTO "schedule_selections" (
  "user_id",
  "plan_id",
  "schedule_term_id",
  "selections",
  "selections_by_plan",
  "created_at",
  "updated_at"
)
SELECT DISTINCT ON (r."user_id", r."plan_uuid", r."schedule_term_id")
  r."user_id",
  r."plan_uuid",
  r."schedule_term_id",
  r."val",
  jsonb_build_object(r."plan_uuid"::text, r."val"),
  r."created_at",
  r."updated_at"
FROM raw_by_plan r
JOIN "study_plans" sp ON sp."id" = r."plan_uuid"
WHERE r."plan_uuid" IS NOT NULL
  AND jsonb_typeof(r."val") = 'object'
ORDER BY r."user_id", r."plan_uuid", r."schedule_term_id", r."updated_at" DESC
ON CONFLICT ("user_id", "plan_id", "schedule_term_id") DO NOTHING;
