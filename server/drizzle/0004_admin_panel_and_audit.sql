ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commissions" ADD COLUMN "is_retired" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_terms" ADD COLUMN "is_draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid,
	"admin_email" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"target_email" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_versions" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_audit_created" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_admin" ON "admin_audit_log" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_action" ON "admin_audit_log" USING btree ("action");--> statement-breakpoint
INSERT INTO "catalog_versions" ("id", "version", "updated_at") VALUES ('default', 'v1.0.0', now()) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'admin_audit_log es inmutable y no permite eliminaciones.';
  ELSIF TG_OP = 'UPDATE' THEN
    -- Permitir EXCLUSIVAMENTE el UPDATE automático del ON DELETE SET NULL cuando se borra el usuario admin referenciado.
    -- Condición estricta:
    -- 1. admin_user_id cambia de un valor NO nulo a NULL
    -- 2. Absolutamente NINGUNA otra columna sufre modificación
    IF OLD.admin_user_id IS NOT NULL 
       AND NEW.admin_user_id IS NULL
       AND NEW.id = OLD.id
       AND NEW.admin_email = OLD.admin_email
       AND NEW.action = OLD.action
       AND NEW.target_type = OLD.target_type
       AND (NEW.target_id IS NOT DISTINCT FROM OLD.target_id)
       AND (NEW.target_email IS NOT DISTINCT FROM OLD.target_email)
       AND (NEW.details IS NOT DISTINCT FROM OLD.details)
       AND (NEW.ip IS NOT DISTINCT FROM OLD.ip)
       AND NEW.created_at = OLD.created_at THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'admin_audit_log es de solo lectura y no permite modificaciones.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_protect_admin_audit_log ON "admin_audit_log";--> statement-breakpoint
CREATE TRIGGER trg_protect_admin_audit_log
BEFORE UPDATE OR DELETE ON "admin_audit_log"
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_modification();

