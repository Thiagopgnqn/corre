UPDATE "study_plans" sp
SET "config" = '{"ppsRequirement":{"referenceSubjectCode":36}}'::jsonb || COALESCE(sp."config", '{}'::jsonb)
FROM "careers" c
WHERE sp."career_id" = c."id"
  AND c."code" = 'ISI'
  AND sp."year" = 2023
  AND NOT (COALESCE(sp."config", '{}'::jsonb) ? 'ppsRequirement');
