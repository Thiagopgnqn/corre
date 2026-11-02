ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "library_terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "library_terms_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "library_last_checked_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "library_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploader_user_id" uuid,
	"subject_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"academic_year" integer,
	"term" text,
	"exam_instance" text,
	"has_solution" boolean DEFAULT false NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"original_filename" text NOT NULL,
	"storage_key" text NOT NULL UNIQUE,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"status" text DEFAULT 'uploading' NOT NULL,
	"rejection_reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"download_count" integer DEFAULT 0 NOT NULL,
	"helpful_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_file_professors" (
	"file_id" uuid NOT NULL,
	"professor_id" uuid NOT NULL,
	CONSTRAINT "library_file_professors_file_id_professor_id_pk" PRIMARY KEY("file_id","professor_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_downloads" (
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"first_downloaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_downloads_file_id_user_id_pk" PRIMARY KEY("file_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_download_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_helpful_votes" (
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_helpful_votes_file_id_user_id_pk" PRIMARY KEY("file_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lib_reports_file_reporter" UNIQUE("file_id","reporter_user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "library_orphan_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_files" ADD CONSTRAINT "library_files_uploader_user_id_users_id_fk" FOREIGN KEY ("uploader_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_files" ADD CONSTRAINT "library_files_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_files" ADD CONSTRAINT "library_files_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_file_professors" ADD CONSTRAINT "library_file_professors_file_id_library_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."library_files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_file_professors" ADD CONSTRAINT "library_file_professors_professor_id_professors_id_fk" FOREIGN KEY ("professor_id") REFERENCES "public"."professors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_downloads" ADD CONSTRAINT "library_downloads_file_id_library_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."library_files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_downloads" ADD CONSTRAINT "library_downloads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_download_logs" ADD CONSTRAINT "library_download_logs_file_id_library_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."library_files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_download_logs" ADD CONSTRAINT "library_download_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_helpful_votes" ADD CONSTRAINT "library_helpful_votes_file_id_library_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."library_files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_helpful_votes" ADD CONSTRAINT "library_helpful_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_reports" ADD CONSTRAINT "library_reports_file_id_library_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."library_files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_reports" ADD CONSTRAINT "library_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_files" ADD CONSTRAINT "chk_lib_files_status" CHECK ("status" IN ('uploading', 'pending', 'approved', 'rejected', 'hidden', 'removed'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_files" ADD CONSTRAINT "chk_lib_files_kind" CHECK ("kind" IN ('parcial', 'final', 'apunte', 'resumen', 'tp', 'guia', 'otro'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_files" ADD CONSTRAINT "chk_lib_files_term" CHECK ("term" IS NULL OR "term" IN ('1C', '2C', 'A'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_reports" ADD CONSTRAINT "chk_lib_reports_reason" CHECK ("reason" IN ('derechos_de_autor', 'contenido_inapropiado', 'incorrecto_o_enganoso', 'duplicado', 'otro'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_reports" ADD CONSTRAINT "chk_lib_reports_status" CHECK ("status" IN ('open', 'dismissed', 'actioned'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lib_files_subject_status" ON "library_files" USING btree ("subject_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lib_files_status_created" ON "library_files" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lib_files_uploader" ON "library_files" USING btree ("uploader_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_lib_files_sha256_active" ON "library_files" USING btree ("sha256") WHERE status NOT IN ('removed', 'rejected') AND sha256 IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lib_prof_file" ON "library_file_professors" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lib_prof_professor" ON "library_file_professors" USING btree ("professor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lib_downloads_user" ON "library_downloads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lib_dl_logs_user_time" ON "library_download_logs" USING btree ("user_id","downloaded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lib_reports_status_time" ON "library_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lib_reports_reason" ON "library_reports" USING btree ("reason");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lib_orphans_created" ON "library_orphan_deletions" USING btree ("created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_log_library_file_deletion()
RETURNS trigger AS $$
BEGIN
  INSERT INTO library_orphan_deletions (storage_key)
  VALUES (OLD.storage_key);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_library_files_cascade_orphan ON library_files;--> statement-breakpoint
CREATE TRIGGER trg_library_files_cascade_orphan
AFTER DELETE ON library_files
FOR EACH ROW
EXECUTE FUNCTION trg_log_library_file_deletion();
