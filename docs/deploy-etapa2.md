# Guía de Despliegue y Ensayo en Neon Temporal — Etapa 2 (`deploy-a` -> `deploy-b` -> `deploy-c`)

> **Regla crítica de orden de migraciones (`drizzle-orm`):**
> **Ninguna migración se despliega antes que otra de menor `when`.**
> `drizzle-orm` solo ejecuta las entradas de `server/drizzle/meta/_journal.json` cuyo `when` sea estrictamente mayor que el `created_at` de la **última** fila en `drizzle.__drizzle_migrations`. Si `0016` (`when: 1793760000000`) se aplicara antes que `0015` (`when: 1793750000000`), Drizzle registraría `1793760000000` como último `created_at` y **saltearía `0015` silenciosamente sin error**.

---

## 1. Estructura de los 3 Despliegues (Rama `etapa2-deploy`)

La rama de desarrollo `etapa2` conserva la historia completa del Tramo 2C sin reescribir. Para desplegar en producción sin corte de servicio y respetando estrictamente el orden `when` de Drizzle, el código se organiza en la rama `etapa2-deploy` (confirmado con `git merge-base --is-ancestor origin/master deploy-a` = salida `0`):

| Tag / Despliegue | Última migración (`_journal.json`) | Qué contiene | Propósito en el rollout |
| :--- | :--- | :--- | :--- |
| **`deploy-a`** (`ed34f49`) | `0014_subject_display_code` (`idx: 14`, `when: 1793740000000`) | Importador `.xlsx` + pestaña Carreras (Tramo 2A/2B), compatibilidad dual `0014`/`0015` + tope dinámico `> 5` (`D1`), guards `409` y limpieza sin tocar R2 (Parte B sin `0016`), moderación multi-plan + mailer dinámico (Parte C), docentes desacoplados de `selected_plan_id` (Parte D) y `verify:user-state-neon` por `--mode`. | Se despliega primero para convivir con `0014` y dejar el servicio listo **antes** de endurecer el esquema. Tolerante tanto al esquema `0014` como al esquema posterior a `0015`. |
| **`deploy-b`** (`5348f9f` · mismo runtime que `etapa2-deploy`) | `0016_library_files_restrict_delete` (`idx: 16`, `when: 1793760000000`) después de `0015` (`when: 1793750000000`) | Todo `deploy-a` + **`0015`** (backfill + `DO $$ RAISE EXCEPTION` si quedara `plan_id NULL` + `NOT NULL` + claves compuestas + expansión CTE de `extra_settings.perPlan` y `selections_by_plan`) + `schema.ts`/`UserStateStore` compuestos (`D2`) + **`0016`** (`ON DELETE restrict` en `library_files.subject_id`) + `schema.ts` `restrict`. Frontend `src/` **idéntico** a `deploy-a`, y todo el runtime, `schema.ts` y migraciones de `etapa2-deploy` son **idénticos** a `deploy-b`. | Aplica `0015` y `0016` en el mismo despliegue y en orden estricto. En los **Pasos 6 a 10** se usa directamente la rama `etapa2-deploy` (mismo runtime que `deploy-b` con los scripts/guía actualizados). |
| **`deploy-c`** *(futuro Tramo 2D)* | Posterior a `0016` *(todavía sin implementar)* | Compuerta de publicación (`Publicar` / `Despublicar`) y selector multi-plan para estudiantes. | Se implementará recién cuando este ensayo en Neon esté aprobado. |

---

## 2. Garantías de Seguridad, Rollback, Hosts e Índices

1. **Respaldo previo sin expiración:** antes de migrar producción, crear en Neon un snapshot manual **sin vencimiento (sin TTL)**. Para este ensayo, crear una rama temporal en Neon clonada desde `production` con retención `>= 7 días`.
2. **Sin archivo `server/.env` durante el ensayo:** todas las variables del ensayo se cargan únicamente en la ventana activa de PowerShell usando **comillas simples** (`'...'`, obligatorio porque las cadenas de Neon contienen `&`). Verificar siempre `Test-Path server\.env` = `False` para impedir que `db:migrate` o `env.ts` lean credenciales reales de un `.env` local. Además, `verifyUserStateNeon.ts` y `verifyImportNeon.ts` omiten `dotenv` si `DATABASE_URL` ya está definida en el entorno.
3. **Regla explícita de `--host-ok` y paridad `-pooler`:** tanto `verify:user-state-neon` como `verify:import-neon` imprimen el host de `DATABASE_URL` y el de `DIRECT_URL`, **abortan si `DIRECT_URL` apunta a un endpoint distinto de `DATABASE_URL` (deben coincidir salvo por `-pooler`)**, y exigen que **`--host-ok` coincida exactamente con el host de `DATABASE_URL`** (`([uri]$env:DATABASE_URL).Host`). Por su parte, `db:migrate` usa `DIRECT_URL` si está definida (o `DATABASE_URL` como fallback).
4. **Comparación obligatoria contra el host de `production`:** antes de cada migración o comando que escriba en la base, se verifica tanto en PowerShell como en ambos scripts que `DATABASE_URL` y `DIRECT_URL` sean iguales salvo por `-pooler`, y que **ninguno** coincida con los hostnames de `production` (copiados de la consola de Neon **sin credenciales**).
5. **Solo lectura salvo migraciones vía `db:migrate` y excepción única del Paso 8:** ninguna migración (`0014`, `0015`, `0016`) se ejecuta con SQL manual; todas corren exclusivamente via `npm --prefix server run db:migrate`. La **única excepción** de SQL de escritura a mano en toda la guía es el rollback controlado del **Paso 8**, válido **únicamente en la rama temporal**.
6. **Índices duplicados temporales tras `0015`:** en `user_settings` coexisten temporalmente `user_settings_pkey` (`0015`) y `uq_user_settings_user_plan` (`0008`) sobre `(user_id, plan_id)`. Su limpieza queda diferida a Etapa 3.
7. **Sincronización de scripts solo en `deploy-a` (`Pasos 2 a 5` y `Paso 8.3`) vs uso directo de `etapa2-deploy` (`Pasos 6 a 10`):**
   - Los tags `deploy-a` (`ed34f49`) y `deploy-b` (`5348f9f`) no se mueven. La rama **`etapa2-deploy`** tiene **exactamente el mismo runtime, `schema.ts`, dependencias y migraciones que `deploy-b`** (`git diff --stat deploy-b etapa2-deploy -- src server/src ':!server/src/scripts' server/drizzle server/package.json package.json` es **vacío**), y ya incluye `verifyUserStateNeon.ts`, `verifyImportNeon.ts` y esta guía actualizados.
   - Por eso, **todos los pasos posteriores a `0015` (Pasos 6 a 10) usan directamente la rama `etapa2-deploy`** (sin hacer `git checkout deploy-b`), y **solo al bajar a `deploy-a`** (Pasos 2 y 8.3) se traen temporalmente los 2 scripts con `git checkout etapa2-deploy -- server/src/scripts/verifyUserStateNeon.ts server/src/scripts/verifyImportNeon.ts`.
   - **Limpieza obligatoria al salir de `deploy-a`:** como `git checkout etapa2-deploy -- <archivos>` deja los archivos modificados en el **index** (`M ` en `git status`), `git checkout -- <archivos>` sería un **no-op**. Antes de cambiar de tag/rama hay que ejecutar **`git restore --source=HEAD --staged --worktree -- server/src/scripts/verifyUserStateNeon.ts server/src/scripts/verifyImportNeon.ts`** para limpiar index y working tree dejando `git status --short` vacío.

---

## 3. Guía Paso a Paso del Ensayo en Neon Temporal (PowerShell)

> **Convención importante:**
> - Ejecutá todos los pasos **en la misma ventana de PowerShell** desde la raíz del repositorio (`...\corre`) para conservar las variables de sesión.
> - Nunca pegues secretos, contraseñas ni URLs completas de Neon en chats ni en archivos versionados.

### Paso 1 — Crear la rama temporal en Neon y configurar variables en PowerShell (sin `server/.env`)

1. En **Neon Console**:
   - Anotá **ÚNICAMENTE los hostnames** (SOLO el host, p. ej. `ep-xxxx-pooler.region.aws.neon.tech` y `ep-xxxx.region.aws.neon.tech`; **nunca** copies ni pegues la cadena completa con usuario ni contraseña de producción) del endpoint `production`.
   - Creá una **rama temporal** clonada desde `production` (con retención **`>= 7 días`** o sin expiración) y copiá sus cadenas `DATABASE_URL` (pooled) y `DIRECT_URL` (direct) para cargarlas únicamente en variables de PowerShell.
2. Verificá que **NO** exista `server\.env` en el repositorio:

```powershell
Test-Path server\.env
```

**Resultado esperado:** `False`. *(Si da `True`, mové o renombrá `server\.env` temporalmente fuera del directorio del repo antes de continuar para que no interfiera con `db:migrate` ni con `env.ts`.)*

3. Limpiá cualquier variable sensible previa en la ventana actual y definí las variables de ensayo con **comillas simples** (por los caracteres `&` de Neon) y **valores ficticios locales**:

```powershell
Remove-Item Env:EMAIL_PROVIDER, Env:BREVO_API_KEY, Env:RESEND_API_KEY, Env:R2_ACCOUNT_ID, Env:R2_ACCESS_KEY_ID, Env:R2_SECRET_ACCESS_KEY, Env:R2_BUCKET, Env:GOOGLE_CLIENT_ID, Env:ADMIN_NOTIFICATION_EMAIL -ErrorAction SilentlyContinue

# Hosts del endpoint de PRODUCCIÓN (solo hostname, copiados de Neon Console para bloquear errores):
$prodDbHost = '<host-pooled-de-produccion>'
$prodDirectHost = '<host-direct-de-produccion>'

# Variables de la RAMA TEMPORAL y configuración ficticia local (SIN mail ni R2 reales):
$env:DATABASE_URL = 'postgresql://<user>:<pass>@<host-pooled-rama-temporal>/<db>?sslmode=require&channel_binding=require'
$env:DIRECT_URL = 'postgresql://<user>:<pass>@<host-direct-rama-temporal>/<db>?sslmode=require&channel_binding=require'
$env:NODE_ENV = 'development'
$env:PORT = '4000'
$env:CLIENT_ORIGIN = 'http://localhost:5173'
$env:JWT_SECRET = 'ensayo_neon_jwt_secret_ficticio_min_16_chars'
$env:REFRESH_SECRET = 'ensayo_neon_refresh_secret_ficticio_min_16_chars'
$env:VERIFICATION_CODE_PEPPER = 'ensayo_neon_pepper_ficticio_min_16_chars'
$env:CONTACT_EMAIL = 'ensayo-ficticio@stack.local'
```

*(Recordá: **NO** definir `EMAIL_PROVIDER`, `BREVO_*`, `RESEND_*`, `R2_*`, `GOOGLE_CLIENT_ID` ni `ADMIN_NOTIFICATION_EMAIL`. El comando `Remove-Item` anterior elimina **únicamente** esas variables por nombre explícito; **nunca** ejecutes `Remove-Item Env:*` ni comodines globales que puedan borrar `PATH`, `TEMP` u otras variables del sistema.)*

4. Verificá los hosts extraídos de `DATABASE_URL` y `DIRECT_URL`, validá que ambos son **idénticos salvo por `-pooler`**, y comparalos contra `production`:

```powershell
$dbHost = ([uri]$env:DATABASE_URL).Host.ToLower()
$directHost = ([uri]$env:DIRECT_URL).Host.ToLower()
$dbBase = $dbHost -replace '-pooler(?=\.|$)', ''
$directBase = $directHost -replace '-pooler(?=\.|$)', ''
$prodDbBase = $prodDbHost.ToLower() -replace '-pooler(?=\.|$)', ''
$prodDirectBase = $prodDirectHost.ToLower() -replace '-pooler(?=\.|$)', ''

Write-Host "TEMP DB     (DATABASE_URL): $dbHost"
Write-Host "TEMP DIRECT (DIRECT_URL):   $directHost"
Write-Host "PROD DB     (solo host):    $prodDbHost"
Write-Host "PROD DIRECT (solo host):    $prodDirectHost"

if ($prodDbHost -like '<*>' -or $prodDirectHost -like '<*>') { throw 'Completá $prodDbHost y $prodDirectHost solo con los hostnames de producción de Neon Console.' }
if ($dbBase -ne $directBase) { throw "BLOQUEADO: DATABASE_URL ($dbHost) y DIRECT_URL ($directHost) deben ser iguales salvo por '-pooler'." }
if ($dbHost -eq $prodDbHost -or $directHost -eq $prodDirectHost -or $dbBase -eq $prodDbBase -or $directBase -eq $prodDirectBase) { throw 'BLOQUEADO: un host coincide con PRODUCCIÓN.' }
```

**Resultado esperado:** `TEMP DB` y `TEMP DIRECT` comparten el mismo endpoint base (solo difieren en `-pooler`) y ambos son **distintos** de `PROD DB` y `PROD DIRECT`.

**Consulta SQL de solo lectura (Neon SQL Editor sobre la rama temporal, antes de migrar):**

```sql
-- Estado inicial copiado de producción: 14 filas hasta 0013 (created_at = 1793730000000)
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

### Paso 2 — Posicionarse en `deploy-a`, sincronizar los 2 scripts de ensayo, compilar y verificar `_journal.json`

Cambiar al tag `deploy-a` y traer temporalmente en disco las versiones actualizadas de `verifyUserStateNeon.ts` y `verifyImportNeon.ts` desde `etapa2-deploy` (sin tocar código de producción ni migraciones, y sin hacer commit):

```powershell
git checkout deploy-a
git checkout etapa2-deploy -- server/src/scripts/verifyUserStateNeon.ts server/src/scripts/verifyImportNeon.ts
git status --short
```

**Resultado esperado de `git status --short`:**

```text
M server/src/scripts/verifyImportNeon.ts
M server/src/scripts/verifyUserStateNeon.ts
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

---

### Paso 3 — Aplicar migraciones de `deploy-a` (`0014`) mediante `db:migrate`

La rama temporal copiada de producción parte de la migración **`0013`** (**`14` filas** en `drizzle.__drizzle_migrations`, última fila con `created_at = 1793730000000`). Por lo tanto, `db:migrate` en `deploy-a` aplica **únicamente `0014_subject_display_code`**.

1. Verificar paridad `-pooler` y comparar ambos hosts contra producción antes de migrar:

```powershell
$dbHost = ([uri]$env:DATABASE_URL).Host.ToLower(); $directHost = ([uri]$env:DIRECT_URL).Host.ToLower()
Write-Host "TEMP DB: $dbHost | TEMP DIRECT: $directHost | PROD DB: $prodDbHost | PROD DIRECT: $prodDirectHost"
if (($dbHost -replace '-pooler(?=\.|$)', '') -ne ($directHost -replace '-pooler(?=\.|$)', '')) { throw 'BLOQUEADO: DATABASE_URL y DIRECT_URL apuntan a endpoints distintos' }
if ($dbHost -eq $prodDbHost -or $directHost -eq $prodDirectHost -or ($dbHost -replace '-pooler(?=\.|$)', '') -eq ($prodDirectHost.ToLower() -replace '-pooler(?=\.|$)', '')) { throw 'BLOQUEADO: host coincide con PRODUCCIÓN' }
```

2. Ejecutar `db:migrate` (única vía habilitada para aplicar migraciones):

```powershell
npm --prefix server run db:migrate
```

**Resultado esperado:**
- Aplica únicamente **`0014_subject_display_code`** (`1793740000000`) y termina con código `0`, pasando de **`14` a `15` filas** en `drizzle.__drizzle_migrations`.
- Los mensajes `⚠️ Diferencia de hash en migración aplicada ...` para las migraciones **`0006`, `0007` y `0008` a `0013`** son **solo advertencias** esperadas y no bloquean.

**Consulta SQL de solo lectura (post-`0014`):**

```sql
-- Esperado: 15 filas totales, última con created_at = 1793740000000 (0014_subject_display_code)
SELECT COUNT(*) AS total_migraciones, MAX(created_at) AS ultima_created_at
FROM drizzle.__drizzle_migrations;

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

Verificar host (`DATABASE_URL`, que es el validado por `--host-ok`) contra producción:

```powershell
$dbHost = ([uri]$env:DATABASE_URL).Host; $directHost = ([uri]$env:DIRECT_URL).Host
Write-Host "HOST PARA --host-ok (DATABASE_URL): $dbHost | DIRECT: $directHost | PROD DB: $prodDbHost"
if ($dbHost -eq $prodDbHost -or $directHost -eq $prodDirectHost) { throw 'BLOQUEADO: host coincide con PRODUCCIÓN' }
```

Correr `--mode=verify` con `--expect-schema=0014`:

```powershell
$env:ALLOW_DESTRUCTIVE_TEST='1'; npm --prefix server run verify:user-state-neon -- --mode=verify --expect-schema=0014 --host-ok=$dbHost
```

**Resultado esperado:**
- Detecta esquema `0014` (`PK(user_settings)=(user_id)`, `uq_user_schedule_selection=true`, `plan_id NOT NULL=false`).
- Pasan los **6 escenarios** usando handlers HTTP y stores reales de `deploy-a` contra Neon, limpia sus registros `__VERIFY_US_RUN_<id>__` e imprime `diff: 0` en todas las tablas.

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

Verificar host contra producción antes de sembrar:

```powershell
$dbHost = ([uri]$env:DATABASE_URL).Host; $directHost = ([uri]$env:DIRECT_URL).Host
Write-Host "SEMBRARÁ EN HOST (--host-ok=$dbHost) | DIRECT: $directHost | PROD DB: $prodDbHost"
if ($dbHost -eq $prodDbHost -or $directHost -eq $prodDirectHost) { throw 'BLOQUEADO: host coincide con PRODUCCIÓN' }
```

Correr `--mode=seed`:

```powershell
$env:ALLOW_DESTRUCTIVE_TEST='1'; npm --prefix server run verify:user-state-neon -- --mode=seed --host-ok=$dbHost
```

**Resultado esperado:**
- Crea (y **NO borra**) los registros determinísticos bajo prefijo `__VERIFY_US_SEED__`:
  - Usuario `__verify_us_seed__@verify.local` (`selected_plan_id = plan1`, usando ISI 2023 publicado).
  - Segundo plan `__VERIFY_US_SEED__Plan2` + materia `9901` (`__VERIFY_US_SEED__S2`) + período `__VERIFY_US_SEED__1C2026`.
  - 1 fila en `user_settings` (`0014`) cuyo `extra_settings.perPlan` contiene `plan1`, `plan2` (`minPassingGrade=7`, `includeAnalistaTrack=true`, `includeElectivesInProgress=false`, `soundEnabled=false`, `tutorialCompleted=true`), `"isi-old"` y `"00000000-0000-4000-8000-000000000999"`.
  - 1 fila en `schedule_selections` (`0014`) con `selections_by_plan` análogo.
  - 1 fila en `schedule_proposals` (`__VERIFY_US_SEED__LegacyProposal`) con `plan_id = NULL`.

**Consulta SQL de solo lectura (ver los datos pre-0015 reales en Neon):**

```sql
SELECT u.id AS user_id, u.email, u.selected_plan_id
FROM users u
WHERE u.email = '__verify_us_seed__@verify.local';

SELECT us.user_id, us.plan_id, us.min_passing_grade, us.extra_settings
FROM user_settings us
JOIN users u ON u.id = us.user_id
WHERE u.email = '__verify_us_seed__@verify.local';

SELECT ss.id, ss.user_id, ss.plan_id, ss.schedule_term_id, ss.selections, ss.selections_by_plan
FROM schedule_selections ss
JOIN users u ON u.id = ss.user_id
WHERE u.email = '__verify_us_seed__@verify.local';

SELECT sp.id, sp.name, sp.plan_id
FROM schedule_proposals sp
JOIN users u ON u.id = sp.user_id
WHERE u.email = '__verify_us_seed__@verify.local';
```

---

### Paso 6 — Limpiar la copia temporal de scripts, pasar directo a `etapa2-deploy` (mismo runtime que `deploy-b`), compilar y aplicar `0015` y `0016` via `db:migrate`

> *(Nota: `git checkout etapa2-deploy -- ...` dejó los 2 scripts stageados en el index, por eso debés usar **`git restore --source=HEAD --staged --worktree -- ...`** —no `git checkout --`, que no limpia el index— antes de pasar a `etapa2-deploy`. Todos los **Pasos 6 a 10** se ejecutan directamente sobre `etapa2-deploy` porque su runtime, `schema.ts` y migraciones son idénticos a `deploy-b`, ya con los scripts actualizados.)*

```powershell
git restore --source=HEAD --staged --worktree -- server/src/scripts/verifyUserStateNeon.ts server/src/scripts/verifyImportNeon.ts
git status --short
git checkout etapa2-deploy
git status --short
git diff --stat deploy-b etapa2-deploy -- src server/src ':!server/src/scripts' server/drizzle server/package.json package.json
```

**Resultado esperado:** ambos `git status --short` imprimen vacío (`0` archivos modificados), y `git diff --stat ...` también imprime vacío (confirmando paridad total de runtime entre `deploy-b` y `etapa2-deploy`).

Compilar backend:

```powershell
npm --prefix server run build
```

Verificar paridad `-pooler` y comparar ambos hosts contra producción antes de correr `db:migrate`:

```powershell
$dbHost = ([uri]$env:DATABASE_URL).Host.ToLower(); $directHost = ([uri]$env:DIRECT_URL).Host.ToLower()
Write-Host "MIGRARÁ 0015 + 0016 SOBRE -> DB: $dbHost | DIRECT: $directHost | PROD DB: $prodDbHost | PROD DIRECT: $prodDirectHost"
if (($dbHost -replace '-pooler(?=\.|$)', '') -ne ($directHost -replace '-pooler(?=\.|$)', '')) { throw 'BLOQUEADO: DATABASE_URL y DIRECT_URL apuntan a endpoints distintos' }
if ($dbHost -eq $prodDbHost -or $directHost -eq $prodDirectHost -or ($dbHost -replace '-pooler(?=\.|$)', '') -eq ($prodDirectHost.ToLower() -replace '-pooler(?=\.|$)', '')) { throw 'BLOQUEADO: host coincide con PRODUCCIÓN' }
```

Aplicar `0015` (`1793750000000`) y `0016` (`1793760000000`) exclusivamente via `db:migrate`:

```powershell
npm --prefix server run db:migrate
```

**Resultado esperado:** `db:migrate` aplica en orden `0015_user_state_composite_keys` (`1793750000000`) y `0016_library_files_restrict_delete` (`1793760000000`) sin errores (`17` filas totales en `drizzle.__drizzle_migrations`).

**Consulta SQL de solo lectura (post-`0015` y post-`0016`):**

```sql
-- 1. Total = 17 migraciones; últimas dos = 1793750000000 y 1793760000000 en ese orden
SELECT COUNT(*) AS total_migraciones, MAX(created_at) AS ultima_created_at
FROM drizzle.__drizzle_migrations;

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

-- 3. Ausencia de uq_user_schedule_selection y nullabilidad NO en las 3 tablas
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

-- 4. Cero plan_id NULL + FK RESTRICT en library_files (0016)
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

Verificar host contra producción:

```powershell
$dbHost = ([uri]$env:DATABASE_URL).Host; $directHost = ([uri]$env:DIRECT_URL).Host
Write-Host "CHECK + VERIFY POST-0015 EN HOST (--host-ok=$dbHost) | DIRECT: $directHost | PROD DB: $prodDbHost"
if ($dbHost -eq $prodDbHost -or $directHost -eq $prodDirectHost) { throw 'BLOQUEADO: host coincide con PRODUCCIÓN' }
```

Correr `--mode=check-post-0015`:

```powershell
$env:ALLOW_DESTRUCTIVE_TEST='1'; npm --prefix server run verify:user-state-neon -- --mode=check-post-0015 --host-ok=$dbHost
```

Correr `--mode=verify --expect-schema=0015`:

```powershell
$env:ALLOW_DESTRUCTIVE_TEST='1'; npm --prefix server run verify:user-state-neon -- --mode=verify --expect-schema=0015 --host-ok=$dbHost
```

**Resultado esperado:** `--mode=check-post-0015` confirma 2 filas en `user_settings`, 2 filas en `schedule_selections`, backfill de `schedule_proposals.plan_id`, ignorado de `"isi-old"` + `...0999` y `0` filas con `plan_id IS NULL`; `--mode=verify` pasa los 6 escenarios con `diff: 0`, manteniendo intacto el `seed` para el Paso 8.

---

### Paso 8 — Prueba de Rollback Controlado de `0016` + `0015` y Re-migración Adelante

> **ÚNICA EXCEPCIÓN A «NUNCA SQL A MANO» (SOLO EN LA RAMA TEMPORAL):**
> En toda la guía, este bloque de retroceso es el único SQL de escritura manual permitido, exclusivamente en la rama temporal y nunca en producción sin snapshot sin TTL verificado.

1. **ANTES del SQL de retroceso — `SELECT` de solo lectura para guardar la foto exacta del usuario semilla (Neon SQL Editor):**

```sql
-- Foto ANTES del rollback: user_settings (todas las columnas incluyendo extra_settings)
SELECT
  us.user_id, us.plan_id, sp.name AS plan_name,
  us.include_promotions_in_gpa, us.min_passing_grade, us.include_analista_track,
  us.allow_blocked_electives_planning, us.include_electives_in_progress,
  us.sound_enabled, us.tutorial_completed, us.notify_library_email,
  us.extra_settings, us.updated_at
FROM user_settings us
JOIN users u ON u.id = us.user_id
JOIN study_plans sp ON sp.id = us.plan_id
WHERE u.email = '__verify_us_seed__@verify.local'
ORDER BY sp.name;

-- Foto ANTES del rollback: schedule_selections (incluyendo selections y selections_by_plan)
SELECT
  ss.id, ss.user_id, ss.plan_id, sp.name AS plan_name,
  ss.schedule_term_id, ss.selections, ss.selections_by_plan, ss.updated_at
FROM schedule_selections ss
JOIN users u ON u.id = ss.user_id
JOIN study_plans sp ON sp.id = ss.plan_id
WHERE u.email = '__verify_us_seed__@verify.local'
ORDER BY sp.name;
```

*(Guardá o copiá ambas tablas de resultado para compararlas después de re-migrar en el punto 4.)*

2. **Verificar host en PowerShell antes de ejecutar el SQL de retroceso:**

```powershell
$dbHost = ([uri]$env:DATABASE_URL).Host; $directHost = ([uri]$env:DIRECT_URL).Host
Write-Host "ATENCIÓN ROLLBACK SQL MANUAL SOLO EN RAMA TEMPORAL -> DB: $dbHost | DIRECT: $directHost | PROD DB: $prodDbHost | PROD DIRECT: $prodDirectHost"
if ($dbHost -eq $prodDbHost -or $directHost -eq $prodDirectHost) { throw 'BLOQUEADO: host coincide con PRODUCCIÓN' }
```

SQL de retroceso (`0016` -> `0015` -> `0014`, usando únicamente columnas verificadas en `schema.ts`: `user_settings` sin `id` y con `updated_at`; `schedule_selections` con `id` y `updated_at`; `schedule_proposals` con `plan_id`):

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
ALTER TABLE "schedule_selections" DROP CONSTRAINT IF EXISTS "uq_user_schedule_selection";
ALTER TABLE "schedule_selections" ADD CONSTRAINT "uq_user_schedule_selection" UNIQUE ("user_id", "schedule_term_id");

ALTER TABLE "schedule_proposals" ALTER COLUMN "plan_id" DROP NOT NULL;

-- C) Desregistrar 0015 y 0016 de Drizzle (cuando se hace rollback de código a deploy-a)
DELETE FROM drizzle.__drizzle_migrations WHERE created_at >= 1793750000000;

COMMIT;
```

3. **Comprobar `deploy-a` contra la BD revertida y volver a `etapa2-deploy` re-migrando via `db:migrate`:**

Bajar a `deploy-a`, sincronizar temporalmente los 2 scripts y verificar `git status --short`:

```powershell
git checkout deploy-a
git checkout etapa2-deploy -- server/src/scripts/verifyUserStateNeon.ts server/src/scripts/verifyImportNeon.ts
git status --short
```

**Resultado esperado de `git status --short`:** `M server/src/scripts/verifyImportNeon.ts` y `M server/src/scripts/verifyUserStateNeon.ts`.

Ejecutar `--mode=verify --expect-schema=0014` sobre `deploy-a` (verificando paridad `-pooler` y host distinto de producción):

```powershell
$dbHost = ([uri]$env:DATABASE_URL).Host.ToLower(); $directHost = ([uri]$env:DIRECT_URL).Host.ToLower()
if (($dbHost -replace '-pooler(?=\.|$)', '') -ne ($directHost -replace '-pooler(?=\.|$)', '')) { throw 'BLOQUEADO: DATABASE_URL y DIRECT_URL apuntan a endpoints distintos' }
if ($dbHost -eq $prodDbHost -or $directHost -eq $prodDirectHost -or ($dbHost -replace '-pooler(?=\.|$)', '') -eq ($prodDirectHost.ToLower() -replace '-pooler(?=\.|$)', '')) { throw 'BLOQUEADO: host coincide con PRODUCCIÓN' }
$env:ALLOW_DESTRUCTIVE_TEST='1'; npm --prefix server run verify:user-state-neon -- --mode=verify --expect-schema=0014 --host-ok=$dbHost
```

Limpiar los 2 scripts temporales del index y working tree antes de volver a `etapa2-deploy`:

```powershell
git restore --source=HEAD --staged --worktree -- server/src/scripts/verifyUserStateNeon.ts server/src/scripts/verifyImportNeon.ts
git status --short
git checkout etapa2-deploy
git status --short
```

**Resultado esperado de ambos `git status --short`:** salida vacía (`0` archivos modificados).

Re-migrar adelante (`0015` + `0016`) y validar `--mode=check-post-0015`:

```powershell
$dbHost = ([uri]$env:DATABASE_URL).Host.ToLower(); $directHost = ([uri]$env:DIRECT_URL).Host.ToLower()
if (($dbHost -replace '-pooler(?=\.|$)', '') -ne ($directHost -replace '-pooler(?=\.|$)', '')) { throw 'BLOQUEADO: DATABASE_URL y DIRECT_URL apuntan a endpoints distintos' }
if ($dbHost -eq $prodDbHost -or $directHost -eq $prodDirectHost -or ($dbHost -replace '-pooler(?=\.|$)', '') -eq ($prodDirectHost.ToLower() -replace '-pooler(?=\.|$)', '')) { throw 'BLOQUEADO: host coincide con PRODUCCIÓN' }
npm --prefix server run db:migrate
$env:ALLOW_DESTRUCTIVE_TEST='1'; npm --prefix server run verify:user-state-neon -- --mode=check-post-0015 --host-ok=$dbHost
```

4. **DESPUÉS de re-migrar — repetir los mismos `SELECT` del punto 1 y comparar:**

```sql
-- Foto DESPUÉS de re-migrar: comparar filas y JSONB contra la captura previa al rollback
SELECT
  us.user_id, us.plan_id, sp.name AS plan_name,
  us.include_promotions_in_gpa, us.min_passing_grade, us.include_analista_track,
  us.allow_blocked_electives_planning, us.include_electives_in_progress,
  us.sound_enabled, us.tutorial_completed, us.notify_library_email,
  us.extra_settings, us.updated_at
FROM user_settings us
JOIN users u ON u.id = us.user_id
JOIN study_plans sp ON sp.id = us.plan_id
WHERE u.email = '__verify_us_seed__@verify.local'
ORDER BY sp.name;

SELECT
  ss.id, ss.user_id, ss.plan_id, sp.name AS plan_name,
  ss.schedule_term_id, ss.selections, ss.selections_by_plan, ss.updated_at
FROM schedule_selections ss
JOIN users u ON u.id = ss.user_id
JOIN study_plans sp ON sp.id = ss.plan_id
WHERE u.email = '__verify_us_seed__@verify.local'
ORDER BY sp.name;
```

**Resultado esperado:** `user_settings` conserva ambas filas (`plan1` y `plan2`) con idénticos valores y `extra_settings`, y `schedule_selections` conserva las selecciones de ambos planes y `selections_by_plan` completo.

---

### Paso 9 — Verificación de Partes B, C, D e Importador contra Postgres real

1. **Verificar ausencia total de mail real, R2 real, Google real y `server\.env`**, más verificación de host contra producción:

```powershell
if (Test-Path server\.env) { throw 'Existe server/.env; retiralo antes de levantar el servidor de prueba' }
$leakedVars = Get-ChildItem Env: | Where-Object { $_.Name -match '^(EMAIL_PROVIDER|BREVO|RESEND|R2_|GOOGLE|ADMIN_NOTIFICATION)' }
if ($leakedVars) { $leakedVars | Format-Table Name; throw 'Hay variables de mail/R2/Google definidas; eliminálas' }
$dbHost = ([uri]$env:DATABASE_URL).Host; $directHost = ([uri]$env:DIRECT_URL).Host
Write-Host "OK sin mail ni R2 reales. IMPORT-NEON EN HOST (--host-ok=$dbHost) | DIRECT: $directHost | PROD DB: $prodDbHost"
if ($dbHost -eq $prodDbHost -or $directHost -eq $prodDirectHost) { throw 'BLOQUEADO: host coincide con PRODUCCIÓN' }
$env:ALLOW_DESTRUCTIVE_TEST='1'; npm --prefix server run verify:import-neon -- --host-ok=$dbHost
```

2. **Levantar servidor y frontend en terminales con las mismas variables ficticias de esta sesión** (`npm --prefix server run dev` y `npm run dev`) y probar en `/#admin`:
   - **Carreras (Tramo 2B):** importar en `draft` el `.xlsx` de Ingeniería Industrial (`IND`) e inspeccionar el visor de solo lectura sin publicar.
   - **Parte B (409 / RESTRICT sin tocar R2):** con una materia de biblioteca que tenga registros en `library_files` (p. ej. si probaste asociar un archivo al draft o en una materia existente), validar en Neon SQL Editor que la FK `RESTRICT` bloquea el borrado físico dentro de una transacción revertida:

```sql
BEGIN;
DELETE FROM subjects WHERE id = '<UUID_MATERIA_CON_LIBRARY_FILES>';
-- Esperado: ERROR PostgreSQL SQLSTATE 23503 (violación FK library_files_subject_id_subjects_id_fk)
ROLLBACK;
```

   - **Parte C (Biblioteca y Reseñas Multi-Plan):** verificar filtros por **Carrera** y **Plan** y los badges `[careerCode] · [planName]`.
   - **Parte D (Docentes desde admin sin `selected_plan_id`):** en `/#admin` -> `Reseñas`, crear el docente histórico de prueba con nombre **`__VERIFY_US_SEED__Docente`** y vincularlo a la **materia semilla `9901` (`__VERIFY_US_SEED__S2` del plan `__VERIFY_US_SEED__Plan2`)** —**no** a una materia de `IND`— mientras el admin mantiene `selected_plan_id = ISI`.

**Consulta SQL de solo lectura (confirmar vínculo docente sobre materia `9901`):**

```sql
SELECT p.display_name, s.code_in_plan, s.name AS subject_name, sp.name AS plan_name, c.code AS career_code
FROM professor_subject_links psl
JOIN professors p ON p.id = psl.professor_id
JOIN subjects s ON s.id = psl.subject_id
JOIN study_plans sp ON sp.id = s.plan_id
JOIN careers c ON c.id = sp.career_id
WHERE s.name LIKE '!_!_VERIFY!_US!_SEED!_%' ESCAPE '!'
ORDER BY psl.created_at DESC
LIMIT 5;
```

3. **Limpieza manual obligatoria ANTES del Paso 10:**
   - Si cargaste algún archivo de prueba en `library_files` sobre el borrador `IND`, eliminalo primero desde admin (`Biblioteca`).
   - En `/#admin` -> **`Carreras`**, pulsá **`Eliminar`** -> **`Eliminar borrador`** sobre **`IND · Plan 2023`** y confirmá que el borrador `IND` y su carrera draft desaparecen por completo **antes de ejecutar el Paso 10**. *(El docente `__VERIFY_US_SEED__Docente` será eliminado en el Paso 10 por su prefijo literal `__VERIFY_US_%` o por vínculo exclusivo a la materia semilla `9901`, sin usar nunca `faculty_id` ni tocar docentes reales.)*

---

### Paso 10 — Limpieza Final (`--mode=cleanup`) y Auditoría de Conteos Exactos

Verificar host contra producción antes de limpiar:

```powershell
$dbHost = ([uri]$env:DATABASE_URL).Host; $directHost = ([uri]$env:DIRECT_URL).Host
Write-Host "CLEANUP EN HOST (--host-ok=$dbHost) | DIRECT: $directHost | PROD DB: $prodDbHost"
if ($dbHost -eq $prodDbHost -or $directHost -eq $prodDirectHost) { throw 'BLOQUEADO: host coincide con PRODUCCIÓN' }
```

Ejecutar `--mode=cleanup`:

```powershell
$env:ALLOW_DESTRUCTIVE_TEST='1'; npm --prefix server run verify:user-state-neon -- --mode=cleanup --host-ok=$dbHost
```

**Resultado esperado:** borra todos los registros `__VERIFY_US_%` (incluido `__VERIFY_US_SEED__`, docentes con prefijo `__VERIFY_US_%` o vinculados exclusivamente a la materia semilla `9901` sin comisiones ni reseñas ni materias reales, las selecciones/configuración semilla y cualquier residuo previo) en orden FK sin tocar `admin_audit_log` ni docentes reales, e imprime `0` residuos restantes.

**Consulta SQL de solo lectura (auditoría final):**

```sql
-- 1. Cero filas residuales de verify:user-state-neon ni de verify:import-neon
SELECT
  (SELECT COUNT(*) FROM users WHERE email LIKE '!_!_verify!_us!_%' ESCAPE '!') AS verify_users,
  (SELECT COUNT(*) FROM study_plans WHERE name LIKE '!_!_VERIFY!_%' ESCAPE '!') AS verify_plans,
  (SELECT COUNT(*) FROM careers WHERE name LIKE '!_!_VERIFY!_%' ESCAPE '!') AS verify_careers,
  (SELECT COUNT(*) FROM library_files WHERE title LIKE '!_!_VERIFY!_%' ESCAPE '!') AS verify_library_files;

-- 2. Conteos finales esperados tras eliminar IND y ejecutar cleanup:
--    careers=1, study_plans=1, subjects=60, shared_subjects=60, subject_prerequisites=147
--    + admin_audit_log (resto esperado por diseño inmutable; nunca se borra)
SELECT 'careers' AS tbl, COUNT(*) FROM careers
UNION ALL SELECT 'study_plans', COUNT(*) FROM study_plans
UNION ALL SELECT 'subjects', COUNT(*) FROM subjects
UNION ALL SELECT 'shared_subjects', COUNT(*) FROM shared_subjects
UNION ALL SELECT 'subject_prerequisites', COUNT(*) FROM subject_prerequisites
UNION ALL SELECT 'admin_audit_log', COUNT(*) FROM admin_audit_log;

-- 3. Últimas filas de drizzle.__drizzle_migrations (esperado: 17 filas; últimas 1793750000000 y 1793760000000)
SELECT id, hash, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 5;
```

---

### Paso 11 — Cierre del Ensayo y Chequeos Previos a Producción (`deploy-a` -> `deploy-b` -> `deploy-c`)

#### Evidencia de ramas y referencia correcta de producción (`origin/master`)
- **Referencia correcta de producción (`origin/master`):** la rama local `master` quedó atrasada `49` commits respecto de `origin/master` (`792d984` vs `7bdf590`), sin divergencia (`git log --oneline origin/master..master` vacío). Por lo tanto, todo chequeo contra producción debe tomar **`origin/master`** (no `master` local sin actualizar).
- **(a) `origin/master` ancestro de `deploy-a` y `deploy-b`:** confirmado tras `git fetch origin` (`merge-base = 7bdf590`, salida `0`).
- **(b) Frontend idéntico entre `deploy-a` y `deploy-b`:** `git diff --stat deploy-a deploy-b -- src` dio **vacío** (`0` archivos modificados).
- **(c) Runtime idéntico entre `deploy-b` y `etapa2-deploy`:** `git diff --stat deploy-b etapa2-deploy -- src server/src ':!server/src/scripts' server/drizzle server/package.json package.json` dio **vacío**.

Verificar explícitamente antes de desplegar en producción:

```powershell
git fetch origin
git merge-base --is-ancestor origin/master deploy-a; Write-Host "ANCESTOR_DEPLOY_A=$LASTEXITCODE"
git merge-base --is-ancestor origin/master deploy-b; Write-Host "ANCESTOR_DEPLOY_B=$LASTEXITCODE"
```

**Resultado esperado:** ambos comandos imprimen `0` (`ANCESTOR_DEPLOY_A=0` y `ANCESTOR_DEPLOY_B=0`).

#### Chequeos obligatorios antes de desplegar en producción
1. Crear un **backup/snapshot manual en Neon SIN vencimiento (sin TTL)** antes de cualquier cambio en producción.
2. Verificar en producción que hay **`0` filas con `plan_id IS NULL`** en `user_settings`, `schedule_selections` y `schedule_proposals` antes de pasar de `deploy-a` a `deploy-b`.
3. **Orden de despliegue en producción:** desplegar **backend primero y frontend después**.
4. Para la subida de transición **`deploy-a` -> `deploy-b`**, hacer una **primera subida que solo cambie `server/`** (dado que `src/` no cambió entre `deploy-a` y `deploy-b`).
5. Al aprobar los Pasos 1 a 10 en la rama temporal, descartar la rama temporal de Neon Console (sin dejar credenciales persistidas en disco) y recién entonces habilitar **Tramo 2D (`deploy-c`)**.
