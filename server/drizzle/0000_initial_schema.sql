-- Migración inicial generada para PostgreSQL en Neon
CREATE TABLE IF NOT EXISTS "institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "faculties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL REFERENCES "institutions"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "careers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faculty_id" uuid NOT NULL REFERENCES "faculties"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "study_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"career_id" uuid NOT NULL REFERENCES "careers"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{"requiredElectiveCredits": 20, "defaultMinPassingGrade": 4}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL REFERENCES "study_plans"("id") ON DELETE cascade,
	"code_in_plan" integer NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"level" integer NOT NULL,
	"modality" text NOT NULL,
	"contra_cuatrimestral" boolean DEFAULT false NOT NULL,
	"weekly_hours" numeric(4, 1) NOT NULL,
	"kind" text NOT NULL,
	"credits" integer,
	"is_optional_track" boolean DEFAULT false NOT NULL,
	"track_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_subject_plan_code" UNIQUE("plan_id", "code_in_plan")
);

CREATE INDEX IF NOT EXISTS "idx_subjects_plan_level" ON "subjects" ("plan_id", "level");

CREATE TABLE IF NOT EXISTS "subject_prerequisites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL REFERENCES "subjects"("id") ON DELETE cascade,
	"requires_subject_id" uuid NOT NULL REFERENCES "subjects"("id") ON DELETE cascade,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_subject_prereq" UNIQUE("subject_id", "requires_subject_id", "type")
);

CREATE INDEX IF NOT EXISTS "idx_prereqs_subject" ON "subject_prerequisites" ("subject_id");
CREATE INDEX IF NOT EXISTS "idx_prereqs_requires" ON "subject_prerequisites" ("requires_subject_id");

CREATE TABLE IF NOT EXISTS "plan_special_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL REFERENCES "study_plans"("id") ON DELETE cascade,
	"subject_id" uuid NOT NULL REFERENCES "subjects"("id") ON DELETE cascade,
	"rule_type" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "acronyms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL REFERENCES "study_plans"("id") ON DELETE cascade,
	"acronym" text NOT NULL,
	"subject_id" uuid NOT NULL REFERENCES "subjects"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_acronym_plan" UNIQUE("plan_id", "acronym")
);

CREATE TABLE IF NOT EXISTS "schedule_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faculty_id" uuid NOT NULL REFERENCES "faculties"("id") ON DELETE cascade,
	"academic_year" integer NOT NULL,
	"term" text NOT NULL,
	"label" text NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_schedule_term" UNIQUE("faculty_id", "academic_year", "term")
);

CREATE TABLE IF NOT EXISTS "course_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_term_id" uuid NOT NULL REFERENCES "schedule_terms"("id") ON DELETE cascade,
	"code" text NOT NULL,
	"turno" text NOT NULL,
	"year_level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_course_group_term" UNIQUE("schedule_term_id", "code")
);

CREATE INDEX IF NOT EXISTS "idx_course_groups_term" ON "course_groups" ("schedule_term_id");

CREATE TABLE IF NOT EXISTS "commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL REFERENCES "subjects"("id") ON DELETE cascade,
	"schedule_term_id" uuid NOT NULL REFERENCES "schedule_terms"("id") ON DELETE cascade,
	"course_group_id" uuid REFERENCES "course_groups"("id") ON DELETE set null,
	"code" text NOT NULL,
	"turno" text NOT NULL,
	"term_offer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_commissions_subject" ON "commissions" ("subject_id");
CREATE INDEX IF NOT EXISTS "idx_commissions_term" ON "commissions" ("schedule_term_id");

CREATE TABLE IF NOT EXISTS "commission_professors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commission_id" uuid NOT NULL REFERENCES "commissions"("id") ON DELETE cascade,
	"professor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "commission_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commission_id" uuid NOT NULL REFERENCES "commissions"("id") ON DELETE cascade,
	"day" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"room" text,
	"mode" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_commission_slots_comm" ON "commission_slots" ("commission_id");

CREATE TABLE IF NOT EXISTS "reserved_elective_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_group_id" uuid NOT NULL REFERENCES "course_groups"("id") ON DELETE cascade,
	"schedule_term_id" uuid NOT NULL REFERENCES "schedule_terms"("id") ON DELETE cascade,
	"label" text NOT NULL,
	"day" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "elective_offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_group_id" uuid NOT NULL REFERENCES "course_groups"("id") ON DELETE cascade,
	"schedule_term_id" uuid NOT NULL REFERENCES "schedule_terms"("id") ON DELETE cascade,
	"subject_id" uuid NOT NULL REFERENCES "subjects"("id") ON DELETE cascade,
	"professors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL UNIQUE,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"selected_plan_id" uuid REFERENCES "study_plans"("id") ON DELETE set null,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_hash" ON "refresh_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "idx_refresh_tokens_user" ON "refresh_tokens" ("user_id");

CREATE TABLE IF NOT EXISTS "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"include_promotions_in_gpa" boolean DEFAULT true NOT NULL,
	"min_passing_grade" integer DEFAULT 4 NOT NULL,
	"include_analista_track" boolean DEFAULT false NOT NULL,
	"allow_blocked_electives_planning" boolean DEFAULT false NOT NULL,
	"include_electives_in_progress" boolean DEFAULT true NOT NULL,
	"sound_enabled" boolean DEFAULT true NOT NULL,
	"tutorial_completed" boolean DEFAULT false NOT NULL,
	"extra_settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "subject_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"subject_id" uuid NOT NULL REFERENCES "subjects"("id") ON DELETE cascade,
	"status" text NOT NULL,
	"grade" numeric(4, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_subject_progress" UNIQUE("user_id", "subject_id")
);

CREATE INDEX IF NOT EXISTS "idx_user_progress_user" ON "subject_progress" ("user_id");

CREATE TABLE IF NOT EXISTS "elective_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"subject_id" uuid NOT NULL REFERENCES "subjects"("id") ON DELETE cascade,
	"year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_elective_assignment" UNIQUE("user_id", "subject_id")
);

CREATE INDEX IF NOT EXISTS "idx_user_electives_user" ON "elective_assignments" ("user_id");

CREATE TABLE IF NOT EXISTS "user_basket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"subject_id" uuid NOT NULL REFERENCES "subjects"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_basket" UNIQUE("user_id", "subject_id")
);

CREATE INDEX IF NOT EXISTS "idx_user_basket_user" ON "user_basket" ("user_id");

CREATE TABLE IF NOT EXISTS "schedule_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"schedule_term_id" uuid NOT NULL REFERENCES "schedule_terms"("id") ON DELETE cascade,
	"selections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_schedule_selection" UNIQUE("user_id", "schedule_term_id")
);

CREATE TABLE IF NOT EXISTS "schedule_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"schedule_term_id" uuid NOT NULL REFERENCES "schedule_terms"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"selections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_schedule_proposals_user" ON "schedule_proposals" ("user_id");

