CREATE TABLE IF NOT EXISTS "professors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faculty_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"normalized_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_professor_faculty_norm" UNIQUE("faculty_id","normalized_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "professor_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professor_id" uuid NOT NULL,
	"faculty_id" uuid NOT NULL,
	"alias_raw" text NOT NULL,
	"alias_normalized" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_professor_alias_faculty_norm" UNIQUE("faculty_id","alias_normalized")
);
--> statement-breakpoint
ALTER TABLE "commission_professors" ADD COLUMN IF NOT EXISTS "professor_id" uuid;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "elective_offering_professors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"elective_offering_id" uuid NOT NULL,
	"professor_id" uuid,
	"professor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "professor_subject_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professor_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"source" text DEFAULT 'manual_admin' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_prof_subject_link" UNIQUE("professor_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "professor_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"professor_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"academic_year" integer,
	"term" text,
	"overall" integer NOT NULL,
	"clarity" integer,
	"treatment" integer,
	"availability" integer,
	"difficulty" integer,
	"would_recommend" boolean,
	"comment" text,
	"status" text DEFAULT 'published' NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_professor_subject_review" UNIQUE("user_id","professor_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_helpful_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_review_helpful_vote" UNIQUE("review_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_review_reporter" UNIQUE("review_id","reporter_user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "professor_stats" (
	"professor_id" uuid PRIMARY KEY NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"avg_overall" numeric(4, 2),
	"bayesian_score" numeric(5, 3),
	"stars_1" integer DEFAULT 0 NOT NULL,
	"stars_2" integer DEFAULT 0 NOT NULL,
	"stars_3" integer DEFAULT 0 NOT NULL,
	"stars_4" integer DEFAULT 0 NOT NULL,
	"stars_5" integer DEFAULT 0 NOT NULL,
	"avg_clarity" numeric(4, 2),
	"avg_treatment" numeric(4, 2),
	"avg_availability" numeric(4, 2),
	"avg_difficulty" numeric(4, 2),
	"recommend_rate" numeric(5, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "professor_subject_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professor_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"avg_overall" numeric(4, 2),
	"bayesian_score" numeric(5, 3),
	"stars_1" integer DEFAULT 0 NOT NULL,
	"stars_2" integer DEFAULT 0 NOT NULL,
	"stars_3" integer DEFAULT 0 NOT NULL,
	"stars_4" integer DEFAULT 0 NOT NULL,
	"stars_5" integer DEFAULT 0 NOT NULL,
	"avg_clarity" numeric(4, 2),
	"avg_treatment" numeric(4, 2),
	"avg_availability" numeric(4, 2),
	"avg_difficulty" numeric(4, 2),
	"recommend_rate" numeric(5, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_prof_subject_stats" UNIQUE("professor_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "professors" ADD CONSTRAINT "professors_faculty_id_faculties_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_aliases" ADD CONSTRAINT "professor_aliases_professor_id_professors_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_aliases" ADD CONSTRAINT "professor_aliases_faculty_id_faculties_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_professors" ADD CONSTRAINT "commission_professors_professor_id_professors_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elective_offering_professors" ADD CONSTRAINT "elective_offering_professors_elective_offering_id_elective_offerings_id_fk" FOREIGN KEY ("elective_offering_id") REFERENCES "public"."elective_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elective_offering_professors" ADD CONSTRAINT "elective_offering_professors_professor_id_professors_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_subject_links" ADD CONSTRAINT "professor_subject_links_professor_id_professors_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_subject_links" ADD CONSTRAINT "professor_subject_links_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_subject_links" ADD CONSTRAINT "professor_subject_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_reviews" ADD CONSTRAINT "professor_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_reviews" ADD CONSTRAINT "professor_reviews_professor_id_professors_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_reviews" ADD CONSTRAINT "professor_reviews_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_helpful_votes" ADD CONSTRAINT "review_helpful_votes_review_id_professor_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."professor_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_helpful_votes" ADD CONSTRAINT "review_helpful_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_professor_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."professor_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_stats" ADD CONSTRAINT "professor_stats_professor_id_professors_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_subject_stats" ADD CONSTRAINT "professor_subject_stats_professor_id_professors_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professor_subject_stats" ADD CONSTRAINT "professor_subject_stats_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_professors_faculty" ON "professors" USING btree ("faculty_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_professor_aliases_prof" ON "professor_aliases" USING btree ("professor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comm_profs_comm" ON "commission_professors" USING btree ("commission_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comm_profs_prof" ON "commission_professors" USING btree ("professor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_elective_off_profs_off" ON "elective_offering_professors" USING btree ("elective_offering_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_elective_off_profs_prof" ON "elective_offering_professors" USING btree ("professor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prof_subject_links_prof" ON "professor_subject_links" USING btree ("professor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prof_subject_links_sub" ON "professor_subject_links" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prof_reviews_prof_status" ON "professor_reviews" USING btree ("professor_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prof_reviews_prof_sub_status" ON "professor_reviews" USING btree ("professor_id","subject_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prof_reviews_user_created" ON "professor_reviews" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_review_helpful_review" ON "review_helpful_votes" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_review_reports_status" ON "review_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_review_reports_review" ON "review_reports" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prof_sub_stats_prof" ON "professor_subject_stats" USING btree ("professor_id");

