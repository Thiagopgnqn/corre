ALTER TABLE "careers" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "careers" ADD CONSTRAINT "chk_careers_status" CHECK ("status" IN ('draft', 'published', 'archived'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "study_plans" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_plans" ADD CONSTRAINT "chk_study_plans_status" CHECK ("status" IN ('draft', 'published', 'archived'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
UPDATE "study_plans" sp
SET "status" = 'published'
FROM "careers" c
WHERE sp."career_id" = c."id"
  AND sp."is_active" = true
  AND sp."status" = 'draft'
  AND (
    c."code" = 'ISI'
    OR NOT EXISTS (SELECT 1 FROM "study_plans" sp2 WHERE sp2."status" = 'published')
  );--> statement-breakpoint
UPDATE "careers" c
SET "status" = 'published'
WHERE c."status" = 'draft'
  AND EXISTS (
    SELECT 1 FROM "study_plans" sp WHERE sp."career_id" = c."id" AND sp."status" = 'published'
  );--> statement-breakpoint
UPDATE "study_plans" sp
SET "config" = '{"electiveSlotsEquivalent":7,"totalLevels":5,"levelLabel":"Año","shortTag":"ISI · Plan 2023"}'::jsonb || COALESCE(sp."config", '{}'::jsonb)
FROM "careers" c
WHERE sp."career_id" = c."id"
  AND c."code" = 'ISI'
  AND sp."year" = 2023
  AND NOT (
    COALESCE(sp."config", '{}'::jsonb) ? 'electiveSlotsEquivalent'
    AND COALESCE(sp."config", '{}'::jsonb) ? 'totalLevels'
    AND COALESCE(sp."config", '{}'::jsonb) ? 'levelLabel'
    AND COALESCE(sp."config", '{}'::jsonb) ? 'shortTag'
  );--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shared_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faculty_id" uuid NOT NULL,
	"stable_code" text NOT NULL,
	"normalized_name" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shared_subjects" ADD CONSTRAINT "shared_subjects_faculty_id_faculties_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shared_subjects" ADD CONSTRAINT "uq_shared_subjects_faculty_code" UNIQUE ("faculty_id", "stable_code");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shared_subjects_faculty_norm" ON "shared_subjects" USING btree ("faculty_id","normalized_name");--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN IF NOT EXISTS "shared_subject_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subjects" ADD CONSTRAINT "subjects_shared_subject_id_shared_subjects_id_fk" FOREIGN KEY ("shared_subject_id") REFERENCES "public"."shared_subjects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subjects_shared_subject" ON "subjects" USING btree ("shared_subject_id");--> statement-breakpoint
DO $$
DECLARE
  rec RECORD;
  v_shared_id uuid;
  v_stable_code text;
  v_norm_name text;
BEGIN
  FOR rec IN
    SELECT
      s."id" AS subject_id,
      s."code_in_plan",
      s."name",
      sp."year" AS plan_year,
      c."code" AS career_code,
      c."faculty_id"
    FROM "subjects" s
    JOIN "study_plans" sp ON sp."id" = s."plan_id"
    JOIN "careers" c ON c."id" = sp."career_id"
    WHERE s."shared_subject_id" IS NULL
    ORDER BY c."code", sp."year", s."code_in_plan"
  LOOP
    v_norm_name := TRIM(
      REGEXP_REPLACE(
        LOWER(
          TRANSLATE(
            rec."name",
            'ÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÑáéíóúàèìòùâêîôûäëïöüñ',
            'aeiouaeiouaeiouaeiounaeiouaeiouaeiouaeioun'
          )
        ),
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    );
    v_stable_code := UPPER(rec."career_code") || '-' || rec."plan_year"::text || '-' || rec."code_in_plan"::text;

    IF EXISTS (
      SELECT 1 FROM "shared_subjects" ss
      WHERE ss."faculty_id" = rec."faculty_id" AND ss."stable_code" = v_stable_code
    ) THEN
      v_stable_code := v_stable_code || '-' || SUBSTRING(rec."subject_id"::text, 1, 8);
    END IF;

    INSERT INTO "shared_subjects" ("faculty_id", "stable_code", "normalized_name", "display_name")
    VALUES (rec."faculty_id", v_stable_code, v_norm_name, rec."name")
    ON CONFLICT ("faculty_id", "stable_code") DO NOTHING
    RETURNING "id" INTO v_shared_id;

    IF v_shared_id IS NULL THEN
      SELECT ss."id" INTO v_shared_id
      FROM "shared_subjects" ss
      WHERE ss."faculty_id" = rec."faculty_id" AND ss."stable_code" = v_stable_code
      LIMIT 1;
    END IF;

    UPDATE "subjects"
    SET "shared_subject_id" = v_shared_id
    WHERE "id" = rec."subject_id" AND "shared_subject_id" IS NULL;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "library_files" ADD COLUMN IF NOT EXISTS "shared_subject_id" uuid;--> statement-breakpoint
ALTER TABLE "library_files" ADD COLUMN IF NOT EXISTS "source_subject_id" uuid;--> statement-breakpoint
ALTER TABLE "library_files" ADD COLUMN IF NOT EXISTS "source_plan_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_files" ADD CONSTRAINT "library_files_shared_subject_id_shared_subjects_id_fk" FOREIGN KEY ("shared_subject_id") REFERENCES "public"."shared_subjects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_files" ADD CONSTRAINT "library_files_source_subject_id_subjects_id_fk" FOREIGN KEY ("source_subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "library_files" ADD CONSTRAINT "library_files_source_plan_id_study_plans_id_fk" FOREIGN KEY ("source_plan_id") REFERENCES "public"."study_plans"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lib_files_shared_subject_status" ON "library_files" USING btree ("shared_subject_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lib_files_source_plan" ON "library_files" USING btree ("source_plan_id");--> statement-breakpoint
UPDATE "library_files" lf
SET
  "shared_subject_id" = COALESCE(lf."shared_subject_id", s."shared_subject_id"),
  "source_subject_id" = COALESCE(lf."source_subject_id", s."id"),
  "source_plan_id" = COALESCE(lf."source_plan_id", s."plan_id")
FROM "subjects" s
WHERE lf."subject_id" = s."id"
  AND (
    (lf."shared_subject_id" IS NULL AND s."shared_subject_id" IS NOT NULL)
    OR lf."source_subject_id" IS NULL
    OR lf."source_plan_id" IS NULL
  );--> statement-breakpoint
UPDATE "users" u
SET "selected_plan_id" = (
  SELECT sp."id"
  FROM "study_plans" sp
  JOIN "careers" c ON c."id" = sp."career_id"
  WHERE sp."status" = 'published' OR sp."is_active" = true
  ORDER BY (c."code" = 'ISI' AND sp."year" = 2023) DESC, sp."is_active" DESC, sp."created_at" ASC
  LIMIT 1
)
WHERE u."selected_plan_id" IS NULL
  AND EXISTS (
    SELECT 1 FROM "study_plans" sp2 WHERE sp2."status" = 'published' OR sp2."is_active" = true
  );--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "plan_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
UPDATE "user_settings" us
SET "plan_id" = COALESCE(
  (SELECT u."selected_plan_id" FROM "users" u WHERE u."id" = us."user_id"),
  (
    SELECT sp."id"
    FROM "study_plans" sp
    JOIN "careers" c ON c."id" = sp."career_id"
    WHERE sp."status" = 'published' OR sp."is_active" = true
    ORDER BY (c."code" = 'ISI' AND sp."year" = 2023) DESC, sp."is_active" DESC, sp."created_at" ASC
    LIMIT 1
  )
)
WHERE us."plan_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_settings_user_plan" ON "user_settings" USING btree ("user_id","plan_id");--> statement-breakpoint
ALTER TABLE "schedule_selections" ADD COLUMN IF NOT EXISTS "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "schedule_selections" ADD COLUMN IF NOT EXISTS "selections_by_plan" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_selections" ADD CONSTRAINT "schedule_selections_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
UPDATE "schedule_selections" ss
SET
  "plan_id" = COALESCE(
    ss."plan_id",
    (SELECT u."selected_plan_id" FROM "users" u WHERE u."id" = ss."user_id"),
    (
      SELECT sp."id"
      FROM "study_plans" sp
      JOIN "careers" c ON c."id" = sp."career_id"
      WHERE sp."status" = 'published' OR sp."is_active" = true
      ORDER BY (c."code" = 'ISI' AND sp."year" = 2023) DESC, sp."is_active" DESC, sp."created_at" ASC
      LIMIT 1
    )
  ),
  "selections_by_plan" = CASE
    WHEN COALESCE(ss."selections_by_plan", '{}'::jsonb) = '{}'::jsonb
      AND ss."selections" IS NOT NULL
      AND ss."selections" != '{}'::jsonb
      AND COALESCE(
        ss."plan_id",
        (SELECT u."selected_plan_id" FROM "users" u WHERE u."id" = ss."user_id"),
        (
          SELECT sp."id"
          FROM "study_plans" sp
          JOIN "careers" c ON c."id" = sp."career_id"
          WHERE sp."status" = 'published' OR sp."is_active" = true
          ORDER BY (c."code" = 'ISI' AND sp."year" = 2023) DESC, sp."is_active" DESC, sp."created_at" ASC
          LIMIT 1
        )
      ) IS NOT NULL
    THEN jsonb_build_object(
      COALESCE(
        ss."plan_id",
        (SELECT u."selected_plan_id" FROM "users" u WHERE u."id" = ss."user_id"),
        (
          SELECT sp."id"
          FROM "study_plans" sp
          JOIN "careers" c ON c."id" = sp."career_id"
          WHERE sp."status" = 'published' OR sp."is_active" = true
          ORDER BY (c."code" = 'ISI' AND sp."year" = 2023) DESC, sp."is_active" DESC, sp."created_at" ASC
          LIMIT 1
        )
      )::text,
      ss."selections"
    )
    ELSE COALESCE(ss."selections_by_plan", '{}'::jsonb)
  END
WHERE ss."plan_id" IS NULL
  OR (COALESCE(ss."selections_by_plan", '{}'::jsonb) = '{}'::jsonb AND ss."selections" IS NOT NULL AND ss."selections" != '{}'::jsonb);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_schedule_selection_user_plan_term" ON "schedule_selections" USING btree ("user_id","plan_id","schedule_term_id");--> statement-breakpoint
ALTER TABLE "schedule_proposals" ADD COLUMN IF NOT EXISTS "plan_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_proposals" ADD CONSTRAINT "schedule_proposals_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
UPDATE "schedule_proposals" sp_prop
SET "plan_id" = COALESCE(
  (SELECT u."selected_plan_id" FROM "users" u WHERE u."id" = sp_prop."user_id"),
  (
    SELECT sp."id"
    FROM "study_plans" sp
    JOIN "careers" c ON c."id" = sp."career_id"
    WHERE sp."status" = 'published' OR sp."is_active" = true
    ORDER BY (c."code" = 'ISI' AND sp."year" = 2023) DESC, sp."is_active" DESC, sp."created_at" ASC
    LIMIT 1
  )
)
WHERE sp_prop."plan_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedule_proposals_user_plan" ON "schedule_proposals" USING btree ("user_id","plan_id","schedule_term_id");
