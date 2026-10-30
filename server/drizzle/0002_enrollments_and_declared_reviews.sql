CREATE TABLE "enrollment_professors" (
	"enrollment_id" uuid NOT NULL,
	"professor_id" uuid NOT NULL,
	CONSTRAINT "pk_enrollment_professors" PRIMARY KEY("enrollment_id","professor_id")
);
--> statement-breakpoint
CREATE TABLE "review_recommendation_dismissals" (
	"user_id" uuid NOT NULL,
	"professor_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_review_rec_dismissals" PRIMARY KEY("user_id","professor_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "subject_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"commission_id" uuid,
	"academic_year" integer,
	"term" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "professor_reviews" ADD COLUMN "attended_declared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollment_professors" ADD CONSTRAINT "enrollment_professors_enrollment_id_subject_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."subject_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_professors" ADD CONSTRAINT "enrollment_professors_professor_id_professors_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_recommendation_dismissals" ADD CONSTRAINT "review_recommendation_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_recommendation_dismissals" ADD CONSTRAINT "review_recommendation_dismissals_professor_id_professors_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_recommendation_dismissals" ADD CONSTRAINT "review_recommendation_dismissals_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_enrollments" ADD CONSTRAINT "subject_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_enrollments" ADD CONSTRAINT "subject_enrollments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_enrollments" ADD CONSTRAINT "subject_enrollments_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_enrollment_professors_prof" ON "enrollment_professors" USING btree ("professor_id");--> statement-breakpoint
CREATE INDEX "idx_review_rec_dismissals_user" ON "review_recommendation_dismissals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_review_rec_dismissals_prof" ON "review_recommendation_dismissals" USING btree ("professor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subject_enrollment_period" ON "subject_enrollments" USING btree ("user_id","subject_id","academic_year","term") WHERE "subject_enrollments"."academic_year" IS NOT NULL AND "subject_enrollments"."term" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_subject_enrollments_user" ON "subject_enrollments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_subject_enrollments_user_subject" ON "subject_enrollments" USING btree ("user_id","subject_id");