ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "notify_library_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "library_files" ADD COLUMN IF NOT EXISTS "admin_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "library_files" ADD COLUMN IF NOT EXISTS "uploader_notified_at" timestamp with time zone;

