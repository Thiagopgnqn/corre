DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT c.conname
  INTO v_conname
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f'
    AND nsp.nspname = 'public'
    AND rel.relname = 'library_files'
    AND array_length(c.conkey, 1) = 1
    AND a.attname = 'subject_id'
    AND c.confrelid = '"public"."subjects"'::regclass
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "public"."library_files" DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "library_files"
    ADD CONSTRAINT "library_files_subject_id_subjects_id_fk"
    FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id")
    ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
