# Guía de Despliegue y Ensayo en Neon Temporal — Etapa 2 (`deploy-a` -> `deploy-b` -> `deploy-c`)

> **Regla crítica de orden de migraciones (`drizzle-orm`):**
> **Ninguna migración se despliega antes que otra de menor `when`.**
> `drizzle-orm` solo ejecuta las entradas de `server/drizzle/meta/_journal.json` cuyo `when` sea estrictamente mayor que el `created_at` de la **última** fila en `drizzle.__drizzle_migrations`. Si `0016` (`when: 1793760000000`) se aplicara antes que `0015` (`when: 1793750000000`), Drizzle registraría `1793760000000` como último `created_at` y **saltearía `0015` silenciosamente sin error**.

---

## 1. Estructura de los 3 Despliegues (Rama `etapa2-deploy`)

La rama de desarrollo `etapa2` conserva la historia completa del Tramo 2C sin reescribir. Para desplegar en producción sin corte de servicio y respetando estrictamente el orden `when` de Drizzle, el código se organiza en la rama `etapa2-deploy`:

| Tag / Despliegue | Última migración (`_journal.json`) | Qué contiene | Propósito en el rollout |
| :--- | :--- | :--- | :--- |
| **`deploy-a`** | `0014_subject_display_code` (`idx: 14`, `when: 1793740000000`) | Importador `.xlsx` + pestaña Carreras (Tramo 2A/2B), compatibilidad dual `0014`/`0015` + tope dinámico `> 5` (`D1`), guards `409` y limpieza sin tocar R2 (Parte B sin `0016`), moderación multi-plan + mailer dinámico (Parte C), docentes desacoplados de `selected_plan_id` (Parte D) y `verify:user-state-neon` por `--mode`. | Puede convivir mientras aplica `0014` y deja el servicio listo **antes** de endurecer el esquema. Tolerante tanto al esquema `0014` como al esquema posterior a `0015`. |
| **`deploy-b`** | `0016_library_files_restrict_delete` (`idx: 16`, `when: 1793760000000`) después de `0015` (`when: 1793750000000`) | Todo `deploy-a` + **`0015`** (backfill + `DO $$ RAISE EXCEPTION` si quedara `plan_id NULL` + `NOT NULL` + claves compuestas + expansión CTE de `extra_settings.perPlan` y `selections_by_plan`) + `schema.ts`/`UserStateStore` compuestos (`D2`) + **`0016`** (`ON DELETE restrict` en `library_files.subject_id`) + `schema.ts` `restrict`. | Aplica `0015` y `0016` en el mismo despliegue y en orden estricto. Durante el build de Render (`db:migrate`), el servicio anterior (`deploy-a`) sigue atendiendo sobre ambos esquemas hasta el swap del nuevo contenedor. |
| **`deploy-c`** *(futuro Tramo 2D)* | Posterior a `0016` *(todavía sin implementar)* | Compuerta de publicación (`Publicar` / `Despublicar`) y selector multi-plan para estudiantes. | Se implementará y etiquetará recién cuando este ensayo en Neon esté aprobado. |

---

## 2. Garantías de Seguridad, Rollback e Índices

1. **Respaldo previo sin expiración:** antes de migrar producción, crear en Neon un snapshot manual **sin TTL/expiración**. Para este ensayo, crear una rama temporal en Neon clonada desde `production` con retención `>= 7 días` (sin expiración automática).
2. **Migración `0015` transaccional y sin `DELETE`:** Drizzle corre las migraciones pendientes dentro de una única transacción. Si `user_settings`, `schedule_selections` o `schedule_proposals` tuviera una fila huérfana sin `plan_id` ni ningún plan al cual asignarla, el bloque `DO $$` ejecuta `RAISE EXCEPTION`, revierte toda la migración sin modificar datos y aborta `db:migrate` antes de reemplazar el servicio.
3. **Advertencia sobre `DELETE FROM drizzle.__drizzle_migrations`:** nunca borrar filas de `drizzle.__drizzle_migrations` en producción ni sin backup sin TTL verificado. El único lugar donde se utiliza es en el **Paso 8** de este ensayo (en la rama temporal) para simular un rollback controlado de `0016` + `0015` y luego re-migrar con `db:migrate`.
4. **Índices duplicados temporales tras `0015`:** en `user_settings` coexisten temporalmente `user_settings_pkey` (`0015`) y `uq_user_settings_user_plan` (`0008`) sobre `(user_id, plan_id)`. Es intencional durante Etapa 2; su limpieza queda diferida a Etapa 3.
5. **Solo lectura y scripts por modo:** ninguna migración (`0008`..`0016`) se aplica mediante SQL manual; todas corren exclusivamente con `npm --prefix server run db:migrate`. Todos los chequeos SQL intermedios son estrictamente `SELECT` de solo lectura.

---

## 3. Guía Paso a Paso del Ensayo en Neon Temporal (PowerShell)

> **Convención importante:**
> - Ejecutá **un paso por vez** en PowerShell desde la raíz del repositorio (`...\corre`).
> - Antes de **cada** comando que escribe o migra la base, imprimí los hosts de `DATABASE_URL` y `DIRECT_URL` y verificá visualmente que corresponden a tu **rama temporal de Neon** (nunca al endpoint de producción).
> - Nunca pegues secretos, contraseñas ni `postgres://...` completos en chats ni archivos versionados.

### Paso 1 — Crear la rama temporal en Neon, configurar `server/.env` e inspeccionar estado inicial

1. En **Neon Console**, creá una rama temporal desde `production` (retención **sin expiración** o **`>= 7 días`**).
2. Copiá las cadenas de conexión de la **rama temporal** en `server/.env` (`DATABASE_URL` pooled y `DIRECT_URL` direct).
3. Verificá los hosts configurados en PowerShell (sin imprimir usuario ni contraseña) y comprobá el estado base de la rama Git:

```powershell
node -e "require('dotenv').config({path:'server/.env'}); console.log('DATABASE_URL host:', new URL(process.env.DATABASE_URL).hostname); console.log('DIRECT_URL   host:', process.env.DIRECT_URL ? new URL(process.env.DIRECT_URL).hostname : '(no definido)')"
```

**Resultado esperado:** ambos hostnames coinciden con el endpoint de tu **rama temporal de Neon** (no producción).

Guardá el host en una variable de PowerShell para reutilizarlo de forma explícita después de verificarlo visualmente:

```powershell
$dbHost = node -e "require('dotenv').config({path:'server/.env'}); console.log(new URL(process.env.DATABASE_URL).hostname)"
$dbHost
```

**Consulta SQL de solo lectura (Neon SQL Editor sobre la rama temporal, antes de migrar):**

```sql
-- Estado inicial de migraciones (en producción puede ser 0007 o 0013 según rollout previo)
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at;

-- Columnas relevantes previas a 0014/0015
SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'subjects' AND column_name = 'display_code')
    OR (table_name IN ('user_settings', 'schedule_selections', 'schedule_proposals') AND column_name = 'plan_id')
  )
ORDER BY table_name, column_name;
```

---

### Paso 2 — Posicionarse en `deploy-a`, compilar y verificar `_journal.json`

```powershell
git checkout deploy-a
```

Compilar backend en `deploy-a`:

```powershell
npm --prefix server run build
```

Verificar que `deploy-a` termina en `0014_subject_display_code` y no contiene `0015` ni `0016`:

```powershell
node -e "const j = require('./server/drizzle/meta/_journal.json'); const last = j.entries[j.entries.length - 1]; console.log('Total entradas:', j.entries.length, '| Última:', last.idx, last.tag, last.when);"
```

**Resultado esperado:** `Total entradas: 15 | Última: 14 0014_subject_display_code 1793740000000`, compilación TypeScript (`tsc`) con código de salida `0`.

*(Sin SQL adicional de escritura; si querés comprobar que no cambiaron las tablas aún, repetí el `SELECT` de solo lectura del Paso 1.)*

---

### Paso 3 — Aplicar migraciones de `deploy-a` (`0008`..`0014`) mediante `db:migrate`

Verificar primero los hosts de destino:

```powershell
node -e "require('dotenv').config({path:'server/.env'}); console.log('MIGRARÁ SOBRE -> DB:', new URL(process.env.DATABASE_URL).hostname, '| DIRECT:', process.env.DIRECT_URL ? new URL(process.env.DIRECT_URL).hostname : 'N/A')"
```

Ejecutar `db:migrate` (única vía habilitada para aplicar migraciones):

```powershell
npm --prefix server run db:migrate
```

**Resultado esperado:** `db:migrate` aplica las migraciones pendientes hasta `0014_subject_display_code` (`1793740000000`) y termina con código `0`. *(Nota: la advertencia de checksum distinto en `0007_enrollment_status_and_exam_attempts.sql` por EOL histórico es esperada y no bloqueante).*

**Consulta SQL de solo lectura (post-`0014`):**

```sql
-- Confirmar última migración aplicada = 1793740000000 (0014_subject_display_code)
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 5;

-- Verificar display_code en ISI y ausencia de NULLs
SELECT
  COUNT(*) FILTER (WHERE display_code IS NULL) AS display_code_nulls,
  COUNT(*) FILTER (WHERE display_code LIKE 'X-%') AS prefijo_x,
  COUNT(*) FILTER (WHERE display_code LIKE 'E-%') AS prefijo_e,
  COUNT(*) AS total_subjects
FROM subjects;

-- Verificar que esquema sigue en 0014 (user_settings PK simple y plan_id aún nullable)
SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('user_settings', 'schedule_selections', 'schedule_proposals')
  AND column_name = 'plan_id'
ORDER BY table_name;
```

---

### Paso 4 — Ejecutar batería `verify:user-state-neon` (`--mode=verify`) contra esquema `0014` (`deploy-a`)

Verificar host antes de correr el script:

```powershell
node -e "require('dotenv').config({path:'server/.env'}); console.log('VERIFICARÁ CONTRA HOST:', new URL(process.env.DATABASE_URL).hostname)"
```

Correr `--mode=verify` con `--expect-schema=0014`:

```powershell
$env:ALLOW_DESTRUCTIVE_TEST="1"; npm --prefix server run verify:user-state-neon -- --mode=verify --expect-schema=0014 --host-ok=$dbHost
```

**Resultado esperado:**
- Detecta esquema `0014` (`PK(user_settings)=(user_id)`, `uq_user_schedule_selection=true`, `plan_id NOT NULL=false`).
- Pasan los **6 escenarios** usando los handlers HTTP y stores reales de `deploy-a` contra Neon (usuario 1 plan, usuario 2 planes con mismo período sin mezcla, `notifyLibraryEmail` sincronizado, electiva nivel 6, `markRecommendationsSeen` sin `plan_id NULL`, `getPendingUploaderFiles` sin filas duplicadas).
- Limpia sus propios registros efímeros `__VERIFY_US_RUN_<id>__` e imprime `diff: 0` en todas las tablas.

**Consulta SQL de solo lectura (confirmar cero residuos tras `--mode=verify`):**

```sql
SELECT
  (SELECT COUNT(*) FROM users WHERE email LIKE '!_!_verify!_us!_%' ESCAPE '!') AS verify_users,
  (SELECT COUNT(*) FROM study_plans WHERE name LIKE '!_!_VERIFY!_US!_%' ESCAPE '!') AS verify_plans,
  (SELECT COUNT(*) FROM library_files WHERE title LIKE '!_!_VERIFY!_US!_%' ESCAPE '!') AS verify_lib;
```

*(Resultado esperado: `0`, `0`, `0`.)*

---

### Paso 5 — Sembrar datos `0014` persistentes (`--mode=seed`) para probar el salto `0014 -> 0015`

Verificar host antes de sembrar:

```powershell
node -e "require('dotenv').config({path:'server/.env'}); console.log('SEMBRARÁ DATOS SEED EN HOST:', new URL(process.env.DATABASE_URL).hostname)"
```

Correr `--mode=seed`:

```powershell
$env:ALLOW_DESTRUCTIVE_TEST="1"; npm --prefix server run verify:user-state-neon -- --mode=seed --host-ok=$dbHost
```

**Resultado esperado:**
- Crea (y **NO borra**) los registros determinísticos bajo prefijo `__VERIFY_US_SEED__`:
  - Usuario `__verify_us_seed__@verify.local` (`selected_plan_id = plan1`, usando ISI 2023 publicado).
  - Segundo plan `__VERIFY_US_SEED__Plan2` + período `__VERIFY_US_SEED__1C2026`.
  - 1 fila en `user_settings` (`0014`) cuyo `extra_settings.perPlan` contiene `plan1`, `plan2` (valores distintos: `minPassingGrade=7`, `includeAnalistaTrack=true`, `includeElectivesInProgress=false`, `soundEnabled=false`, `tutorialCompleted=true`), `"isi-old"` (clave no-UUID) y `"00000000-0000-4000-8000-000000000999"` (UUID inexistente).
  - 1 fila en `schedule_selections` (`0014`) con `selections_by_plan` análogo (`plan1`, `plan2`, `"isi-old"`, `"00000000-0000-4000-8000-000000000999"`).
  - 1 fila en `schedule_proposals` (`__VERIFY_US_SEED__LegacyProposal`) con `plan_id = NULL`.
- Imprime los IDs sembrados y el diff positivo (`+1 users`, `+1 user_settings`, `+1 schedule_selections`, `+1 schedule_proposals`, `+1 study_plans`, etc.).

**Consulta SQL de solo lectura (ver los datos pre-0015 reales en Neon):**

```sql
SELECT u.id AS user_id, u.email, u.selected_plan_id
FROM users u
WHERE u.email = '__verify_us_seed__@verify.local';

SELECT us.user_id, us.plan_id, us.min_passing_grade, us.extra_settings->'perPlan' AS per_plan
FROM user_settings us
JOIN users u ON u.id = us.user_id
WHERE u.email = '__verify_us_seed__@verify.local';

SELECT ss.user_id, ss.plan_id, ss.schedule_term_id, ss.selections, ss.selections_by_plan
FROM schedule_selections ss
JOIN users u ON u.id = ss.user_id
WHERE u.email = '__verify_us_seed__@verify.local';

SELECT sp.id, sp.name, sp.plan_id
FROM schedule_proposals sp
JOIN users u ON u.id = sp.user_id
WHERE u.email = '__verify_us_seed__@verify.local';
```

---

### Paso 6 — Cambiar a `deploy-b`, compilar y aplicar migraciones `0015` y `0016` via `db:migrate`

```powershell
git checkout deploy-b
```

Compilar backend en `deploy-b`:

```powershell
npm --prefix server run build
```

Verificar hosts antes de correr `db:migrate`:

```powershell
node -e "require('dotenv').config({path:'server/.env'}); console.log('MIGRARÁ 0015 + 0016 SOBRE -> DB:', new URL(process.env.DATABASE_URL).hostname, '| DIRECT:', process.env.DIRECT_URL ? new URL(process.env.DIRECT_URL).hostname : 'N/A')"
```

Aplicar `0015` (`1793750000000`) y `0016` (`1793760000000`) exclusivamente via `db:migrate`:

```powershell
npm --prefix server run db:migrate
```

**Resultado esperado:** `db:migrate` aplica en orden `0015_user_state_composite_keys` y `0016_library_files_restrict_delete` sin errores (confirmando en BD real los bloques `DO $$` con `array_position`, regex UUID, expansión de `perPlan` / `selections_by_plan` y FK `RESTRICT`).

**Consulta SQL de solo lectura (post-`0015` y post-`0016`):**

```sql
-- 1. Últimas migraciones aplicadas: deben figurar 1793750000000 y 1793760000000 en ese orden
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 4;

-- 2. PK compuesta de user_settings = ('user_id', 'plan_id')
SELECT a.attname::text AS pk_col, array_position(i.indkey::int2[], a.attnum) AS pos
FROM pg_index i
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey::int2[])
WHERE i.indrelid = 'public.user_settings'::regclass AND i.indisprimary
ORDER BY pos;

-- 3. Ausencia de uq_user_schedule_selection y presencia de índice/unique por plan + nullabilidad NO
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid IN ('public.user_settings'::regclass, 'public.schedule_selections'::regclass, 'public.schedule_proposals'::regclass)
ORDER BY conrelid::regclass::text, conname;

SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('user_settings', 'schedule_selections', 'schedule_proposals')
  AND column_name = 'plan_id'
ORDER BY table_name;

-- 4. Cero plan_id NULL en producción + FK RESTRICT en library_files (0016)
SELECT
  (SELECT COUNT(*) FROM user_settings WHERE plan_id IS NULL) AS settings_null,
  (SELECT COUNT(*) FROM schedule_selections WHERE plan_id IS NULL) AS selections_null,
  (SELECT COUNT(*) FROM schedule_proposals WHERE plan_id IS NULL) AS proposals_null;

SELECT conname, confdeltype, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.library_files'::regclass
  AND contype = 'f'
  AND conname LIKE '%subject_id%';
-- Esperado en 0016: confdeltype = 'r' (RESTRICT)
```

---

### Paso 7 — Validar expansión del seed (`--mode=check-post-0015`) y batería completa (`--mode=verify --expect-schema=0015`)

Primero verificar host:

```powershell
node -e "require('dotenv').config({path:'server/.env'}); console.log('CHECK POST-0015 + VERIFY EN HOST:', new URL(process.env.DATABASE_URL).hostname)"
```

Correr `--mode=check-post-0015` (no modifica filas):

```powershell
$env:ALLOW_DESTRUCTIVE_TEST="1"; npm --prefix server run verify:user-state-neon -- --mode=check-post-0015 --host-ok=$dbHost
```

**Resultado esperado:** confirma que el usuario semilla pasó a tener exactamente 2 filas en `user_settings` (con columnas de `plan1` y `plan2` intactas), 2 filas en `schedule_selections` (`{ "1": "seed-comm-plan1" }` y `{ "9901": "seed-comm-plan2" }`), `schedule_proposals.plan_id` completado con `plan1`, `"isi-old"` + `"00000000-0000-4000-8000-000000000999"` ignorados sin errores, y `0` filas con `plan_id IS NULL`.

Ahora correr `--mode=verify --expect-schema=0015`:

```powershell
$env:ALLOW_DESTRUCTIVE_TEST="1"; npm --prefix server run verify:user-state-neon -- --mode=verify --expect-schema=0015 --host-ok=$dbHost
```

**Resultado esperado:** detecta esquema `0015`, corren los 6 escenarios sobre el esquema compuesto endurecido, limpia sus registros `__VERIFY_US_RUN_<id>__` (`diff: 0`) y deja intactos los datos semilla `__VERIFY_US_SEED__` para el Paso 8.

**Consulta SQL de solo lectura (inspeccionar filas expandidas del usuario semilla):**

```sql
SELECT us.plan_id, sp.name AS plan_name, us.min_passing_grade, us.include_analista_track,
       us.include_electives_in_progress, us.sound_enabled, us.tutorial_completed
FROM user_settings us
JOIN users u ON u.id = us.user_id
JOIN study_plans sp ON sp.id = us.plan_id
WHERE u.email = '__verify_us_seed__@verify.local'
ORDER BY sp.name;

SELECT ss.plan_id, sp.name AS plan_name, ss.selections
FROM schedule_selections ss
JOIN users u ON u.id = ss.user_id
JOIN study_plans sp ON sp.id = ss.plan_id
WHERE u.email = '__verify_us_seed__@verify.local'
ORDER BY sp.name;
```

---

### Paso 8 — Prueba de Rollback Controlado de `0016` + `0015` y Re-migración Adelante

> **ADVERTENCIA ESTRICTA:** ejecutar **únicamente en esta rama temporal** y solo para validar el procedimiento de emergencia ante un rollback en producción con snapshot sin TTL verificado. **Nunca ejecutar `DELETE FROM drizzle.__drizzle_migrations` sobre datos reales sin respaldo previo.**

1. Primero verificá el host en PowerShell (y recién después ejecutá el bloque SQL de rollback en **Neon SQL Editor** sobre la rama temporal):

```powershell
node -e "require('dotenv').config({path:'server/.env'}); console.log('ATENCIÓN ROLLBACK SQL SOLO EN RAMA TEMPORAL:', new URL(process.env.DATABASE_URL).hostname)"
```

SQL de rollback de emergencia (`0016` -> `0015` -> estado `0014`, consolidando filas secundarias dentro de `extra_settings.perPlan` y `selections_by_plan` antes de eliminar duplicados):

```sql
BEGIN;

-- A) Revertir 0016: library_files.subject_id vuelve a ON DELETE cascade
ALTER TABLE "library_files" DROP CONSTRAINT IF EXISTS "library_files_subject_id_subjects_id_fk";
ALTER TABLE "library_files"
  ADD CONSTRAINT "library_files_subject_id_subjects_id_fk"
  FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;

-- B) Revertir 0015 preservando datos multi-plan en extra_settings.perPlan y selections_by_plan
WITH per_plan_agg AS (
  SELECT
    us."user_id",
    jsonb_object_agg(
      us."plan_id"::text,
      jsonb_build_object(
        'includePromotionsInGPA', us."include_promotions_in_gpa",
        'minPassingGrade', us."min_passing_grade",
        'includeAnalistaTrack', us."include_analista_track",
        'allowBlockedElectivesPlanning', us."allow_blocked_electives_planning",
        'includeElectivesInProgress', us."include_electives_in_progress",
        'soundEnabled', us."sound_enabled",
        'tutorialCompleted', us."tutorial_completed"
      )
    ) AS per_plan_json
  FROM "user_settings" us
  GROUP BY us."user_id"
),
keep_row AS (
  SELECT DISTINCT ON (us."user_id")
    us."user_id",
    us."plan_id" AS keep_plan_id
  FROM "user_settings" us
  JOIN "users" u ON u."id" = us."user_id"
  ORDER BY us."user_id", COALESCE(us."plan_id" = u."selected_plan_id", false) DESC, us."updated_at" DESC
)
UPDATE "user_settings" us
SET "extra_settings" = jsonb_set(
  COALESCE(us."extra_settings", '{}'::jsonb),
  '{perPlan}',
  CASE
    WHEN jsonb_typeof(us."extra_settings"->'perPlan') = 'object'
    THEN (us."extra_settings"->'perPlan') || ppa.per_plan_json
    ELSE ppa.per_plan_json
  END,
  true
)
FROM per_plan_agg ppa
JOIN keep_row kr ON kr."user_id" = ppa."user_id"
WHERE us."user_id" = kr."user_id" AND us."plan_id" = kr.keep_plan_id;

DELETE FROM "user_settings" us
USING (
  SELECT DISTINCT ON (us2."user_id") us2."user_id", us2."plan_id" AS keep_plan_id
  FROM "user_settings" us2
  JOIN "users" u ON u."id" = us2."user_id"
  ORDER BY us2."user_id", COALESCE(us2."plan_id" = u."selected_plan_id", false) DESC, us2."updated_at" DESC
) kr
WHERE us."user_id" = kr."user_id" AND us."plan_id" <> kr.keep_plan_id;

WITH sel_agg AS (
  SELECT
    ss."user_id",
    ss."schedule_term_id",
    jsonb_object_agg(ss."plan_id"::text, ss."selections") AS by_plan_json
  FROM "schedule_selections" ss
  GROUP BY ss."user_id", ss."schedule_term_id"
),
keep_sel AS (
  SELECT DISTINCT ON (ss."user_id", ss."schedule_term_id")
    ss."id" AS keep_id,
    ss."user_id",
    ss."schedule_term_id"
  FROM "schedule_selections" ss
  JOIN "users" u ON u."id" = ss."user_id"
  ORDER BY ss."user_id", ss."schedule_term_id", COALESCE(ss."plan_id" = u."selected_plan_id", false) DESC, ss."updated_at" DESC
)
UPDATE "schedule_selections" ss
SET "selections_by_plan" = CASE
  WHEN jsonb_typeof(ss."selections_by_plan") = 'object'
  THEN ss."selections_by_plan" || sa.by_plan_json
  ELSE sa.by_plan_json
END
FROM sel_agg sa
JOIN keep_sel ks ON ks."user_id" = sa."user_id" AND ks."schedule_term_id" = sa."schedule_term_id"
WHERE ss."id" = ks.keep_id;

DELETE FROM "schedule_selections" ss
USING (
  SELECT DISTINCT ON (ss2."user_id", ss2."schedule_term_id")
    ss2."id" AS keep_id, ss2."user_id", ss2."schedule_term_id"
  FROM "schedule_selections" ss2
  JOIN "users" u ON u."id" = ss2."user_id"
  ORDER BY ss2."user_id", ss2."schedule_term_id", COALESCE(ss2."plan_id" = u."selected_plan_id", false) DESC, ss2."updated_at" DESC
) ks
WHERE ss."user_id" = ks."user_id"
  AND ss."schedule_term_id" = ks."schedule_term_id"
  AND ss."id" <> ks.keep_id;

ALTER TABLE "user_settings" DROP CONSTRAINT IF EXISTS "user_settings_pkey";
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id");
ALTER TABLE "user_settings" ALTER COLUMN "plan_id" DROP NOT NULL;

ALTER TABLE "schedule_selections" ALTER COLUMN "plan_id" DROP NOT NULL;
ALTER TABLE "schedule_selections" ADD CONSTRAINT "uq_user_schedule_selection" UNIQUE ("user_id", "schedule_term_id");

ALTER TABLE "schedule_proposals" ALTER COLUMN "plan_id" DROP NOT NULL;

-- C) Desregistrar 0015 y 0016 de Drizzle (cuando se hace rollback de código a deploy-a)
DELETE FROM drizzle.__drizzle_migrations WHERE created_at >= 1793750000000;

COMMIT;
```

2. Comprobar que `deploy-a` vuelve a operar limpio contra la BD revertida:

```powershell
git checkout deploy-a
$env:ALLOW_DESTRUCTIVE_TEST="1"; npm --prefix server run verify:user-state-neon -- --mode=verify --expect-schema=0014 --host-ok=$dbHost
```

3. Volver a `deploy-b` y re-aplicar `0015` y `0016` via `db:migrate`, y confirmar con `--mode=check-post-0015`:

```powershell
git checkout deploy-b
npm --prefix server run db:migrate
$env:ALLOW_DESTRUCTIVE_TEST="1"; npm --prefix server run verify:user-state-neon -- --mode=check-post-0015 --host-ok=$dbHost
```

**Resultado esperado:** `deploy-a` funciona tras rollback, `db:migrate` re-aplica `0015` y `0016` limpiamente, y `--mode=check-post-0015` vuelve a pasar (demostrando preservación ida y vuelta del seed).

---

### Paso 9 — Verificación de Partes B, C, D e Importador contra Postgres real (`deploy-b`)

1. Verificar host antes de ejecutar `verify:import-neon` (prueba ACID del importador y borrado de borradores contra Postgres real):

```powershell
node -e "require('dotenv').config({path:'server/.env'}); console.log('IMPORT-NEON EN HOST:', new URL(process.env.DATABASE_URL).hostname)"
$env:ALLOW_DESTRUCTIVE_TEST="1"; npm --prefix server run verify:import-neon -- --host-ok=$dbHost
```

2. Levantar servidor y frontend en `deploy-b` (en terminales separadas: `npm --prefix server run dev` y `npm run dev`) apuntando a la rama temporal y probar manualmente en `/#admin`:
   - **Carreras (Tramo 2B):** importar en `draft` el `.xlsx` de Ingeniería Industrial (`IND`) si no estaba cargado y comprobar el visor de solo lectura sin publicar.
   - **Parte B (409 / R2):** con al menos un `library_files` asociado a una materia del borrador, intentar quitar la materia o borrar el plan borrador -> debe responder `409` indicando cantidad exacta de archivos sin tocar R2; en SQL, intentar borrar la materia directamente debe fallar por FK `RESTRICT` (`23503`).
   - **Parte C (Biblioteca y Reseñas Multi-Plan + Mailer):** verificar filtros por Carrera y Plan en admin, badges `[careerCode] · [planName]`, y al aprobar/rechazar un archivo (si el correo está habilitado en pruebas), confirmar que el asunto/cuerpo refleja la carrera y facultad del archivo y no `Sistemas` fijo.
   - **Parte D (Docentes desde admin sin `selected_plan_id`):** en `/#admin` -> `Reseñas`, crear un docente histórico y vincularlo a una materia de `IND` (o del plan semilla) mientras el admin sigue teniendo `selected_plan_id = ISI`.

**Consulta SQL de solo lectura (confirmar vínculo docente creado en Parte D):**

```sql
SELECT p.display_name, s.name AS subject_name, sp.name AS plan_name, c.code AS career_code
FROM professor_subject_links psl
JOIN professors p ON p.id = psl.professor_id
JOIN subjects s ON s.id = psl.subject_id
JOIN study_plans sp ON sp.id = s.plan_id
JOIN careers c ON c.id = sp.career_id
ORDER BY psl.created_at DESC
LIMIT 5;
```

3. **Verificación del fix de cursadas (`fix-cursada-estado`) contra Postgres real en la rama TEMPORAL:**
   - **a)** Con el backend apuntando a la rama **TEMPORAL** de Neon, ejecutar `PUT /api/enrollments/:subjectId` (o usar **"Agregar cursada"** en la UI) con `status: "promocionada"` sobre una materia sin estado previo, y comprobar con `SELECT` en el SQL Editor de Neon que `subject_progress` quedó en `'promocionada'`:
     ```sql
     SELECT status, grade, updated_at
     FROM subject_progress
     WHERE user_id = '<user_uuid>' AND subject_id = '<subject_uuid>';
     ```
   - **b)** Repetir con `PUT /api/enrollments/:subjectId` y `status: "regularizada"` sobre una materia ya en estado `'aprobada'` con nota (p. ej. `8` o `9`), y comprobar con el mismo `SELECT` que `subject_progress.status` sigue en `'aprobada'` y conserva su `grade` intacta.
   - **c)** Comprobar en ambos casos que el campo `subjectStatus` devuelto en la respuesta JSON del `PUT /api/enrollments/:subjectId` coincide exactamente con el `status` persistido en `subject_progress` (y que `GET /api/enrollments` omite `subjectStatus`).
   - **d)** *(Opcional — concurrencia `ON CONFLICT DO UPDATE`)*: disparar dos `PUT /api/enrollments/:subjectId` simultáneos (`Promise.all` o doble petición concurrente con `'regularizada'` y `'promocionada'`) sobre una materia sin fila previa en `subject_progress`, y comprobar que ninguna falla con error `500` / `23505`, no queda ninguna cursada perdida y `subject_progress.status` queda en `'promocionada'`.

*(Si creaste datos manuales de prueba en los puntos 2 o 3 —p. ej. borrador de Industrial, un docente ficticio o cursadas de prueba—, borralos o deshacé esos registros antes de cerrar el ensayo; el plan `IND` solo se conserva si decidís mantener el borrador para el Tramo 2D, nunca en producción todavía).*

---

### Paso 10 — Limpieza Final de Registros de Verificación (`--mode=cleanup`)

Verificar host antes de limpiar:

```powershell
node -e "require('dotenv').config({path:'server/.env'}); console.log('CLEANUP VERIFY_US EN HOST:', new URL(process.env.DATABASE_URL).hostname)"
```

Ejecutar `--mode=cleanup`:

```powershell
$env:ALLOW_DESTRUCTIVE_TEST="1"; npm --prefix server run verify:user-state-neon -- --mode=cleanup --host-ok=$dbHost
```

**Resultado esperado:** borra todos los registros `__VERIFY_US_%` (tanto `__VERIFY_US_SEED__` como cualquier residuo de corridas previas) en orden FK sin tocar `admin_audit_log`, imprime `0` residuos restantes y muestra la tabla comparativa inicial -> final.

**Consulta SQL de solo lectura (auditoría final cero residuos):**

```sql
-- 1. Cero filas residuales de verify:user-state-neon ni de verify:import-neon
SELECT
  (SELECT COUNT(*) FROM users WHERE email LIKE '!_!_verify!_us!_%' ESCAPE '!') AS verify_users,
  (SELECT COUNT(*) FROM study_plans WHERE name LIKE '!_!_VERIFY!_%' ESCAPE '!') AS verify_plans,
  (SELECT COUNT(*) FROM careers WHERE name LIKE '!_!_VERIFY!_%' ESCAPE '!') AS verify_careers,
  (SELECT COUNT(*) FROM library_files WHERE title LIKE '!_!_VERIFY!_%' ESCAPE '!') AS verify_library_files;

-- 2. Conteos finales de catálogo y tablas de estado
SELECT 'careers' AS tbl, COUNT(*) FROM careers
UNION ALL SELECT 'study_plans', COUNT(*) FROM study_plans
UNION ALL SELECT 'subjects', COUNT(*) FROM subjects
UNION ALL SELECT 'subject_prerequisites', COUNT(*) FROM subject_prerequisites
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'user_settings', COUNT(*) FROM user_settings
UNION ALL SELECT 'schedule_selections', COUNT(*) FROM schedule_selections
UNION ALL SELECT 'schedule_proposals', COUNT(*) FROM schedule_proposals;

-- 3. Últimas filas de drizzle.__drizzle_migrations (esperado: 1793750000000 y 1793760000000 al tope)
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 5;
```

---

### Paso 11 — Cierre del Ensayo y Transición a Tramo 2D (`deploy-c`)

1. Confirmar que los Pasos 1 a 10 pasaron completos en la rama temporal de Neon sin errores ni residuos.
2. Guardar las capturas/salidas relevantes del ensayo y eliminar la rama temporal en Neon Console cuando finalice la revisión.
3. Dejar `server/.env` limpio apuntando únicamente al entorno local/temporal autorizado.
4. En **producción** (cuando corresponda ejecutar el rollout real):
   - Crear primero un **snapshot manual sin expiración** en Neon.
   - Desplegar **`deploy-a`** primero (el servicio corre compatible con `0014` y `0015`).
   - Luego desplegar **`deploy-b`** (`db:migrate` aplica `0015` y `0016` en orden estricto mientras los contenedores de `deploy-a` atienden sin corte hasta el swap).
5. Recién tras aprobar este ensayo se habilita **Tramo 2D (`deploy-c`)**.
