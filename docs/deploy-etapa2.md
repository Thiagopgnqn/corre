# Plan de Despliegue y Ensayo — Etapa 2 (Tramo 2C Parte A: `0014` → `0015`)

> **Alcance actual:** Este documento define la secuencia segura de despliegue en producción para **Etapa 2 hasta Tramo 2C — Parte A** (tags locales **`2c-d1`** y **`2c-d2`**), incluyendo respaldo sin expiración en Neon, rollback SQL seguro y el protocolo completo de ensayo en una sola rama temporal de Neon.
> **Restricción del entorno local:** Desde desarrollo nunca se ejecuta `git push` automático ni migraciones contra Neon/Render/Vercel reales sin aprobación explícita.

---

## 1. Mapa de servicios e infraestructura (`render.yaml`, `vercel.json`, Neon)

| Capa / Consola | Configuración real verificada | Ventana crítica en despliegue | Qué revisar manualmente en consola |
|---|---|---|---|
| **Base de datos (Neon)** | PostgreSQL gestionado con `DATABASE_URL` (`-pooler`) y `DIRECT_URL` (conexión directa para DDL en `db:migrate`). | Al aplicar DDL de `0015` (`NOT NULL`, nueva `PK(user_id, plan_id)`, drop de `uq_user_schedule_selection`). | Rama snapshot **sin expiración** creada antes de migrar; verificar endpoint (`ep-...`) antes de cualquier comando. |
| **Backend API (Render)** (`render.yaml`) | `rootDir: server`<br>`buildCommand: npm install && npm run build && npm run db:migrate`<br>`startCommand: npm run start`<br>`healthCheckPath: /api/health` | Durante el `buildCommand` de **`2c-d2`**, `db:migrate` aplica **`0015`** sobre Neon **mientras el contenedor previo sigue atendiendo tráfico en producción** hasta pasar `/api/health`. | Confirmar `Auto-Deploy`, variables `DATABASE_URL`, `DIRECT_URL`, `CLIENT_ORIGIN`, secretos JWT/Refresh/Pepper, `R2_*` y estado de `/api/health`. |
| **Frontend SPA (Vercel)** (`vercel.json`) | Build raíz: `npm run build` (`tsc -b && vite build`), rewrites `/api/:path*` → Render backend. | Si se publica frontend de Etapa 2 antes que su backend correspondiente, endpoints nuevos (`/api/admin/plans/*`) responderán `404`. | Verificar `Production Branch`, variables `VITE_*` y mantener deploy frontend posterior a Render. |

### Por qué Tramo 2C Parte A se divide en **dos commits/despliegues (`2c-d1` y `2c-d2`)**

1. Cuando Render construye **`2c-d2`**, `npm run db:migrate` ejecuta **`0015_user_state_composite_keys.sql`** contra Neon **antes** de reiniciar el proceso Node.
2. Durante esos segundos/minutos de build y arranque, el backend vivo atendiendo usuarios es el despliegue anterior.
3. Si el backend vivo fuera anterior a **`2c-d1`**, asumiría `PK(user_id)` única por usuario y fallaría ante `plan_id NOT NULL` o ante múltiples filas por usuario tras `0015`.
4. Con **`2c-d1`** desplegado previamente en **Despliegue A**, el backend vivo funciona de forma idéntica bajo **esquema `0014`** (sin insertar segunda fila ni `plan_id NULL`) **y bajo esquema `0015`** (usando filtros por `(user_id, plan_id)`, actualización segura multi-fila y `notifyLibraryEmail` sincronizado).

---

## 2. Secuencia de Despliegues (A → B → C · Render primero, Vercel después)

### Despliegue A — Backend compatible dual (`2c-d1`, sin `0015` ni `0016`)

1. **Consola Neon (opcional si venís de `0013`):** verificá que tengas un backup reciente antes de cualquier avance de migración.
2. **Git / Render:** llevar el código de backend hasta el tag **`2c-d1`** (contiene `0014_subject_display_code`, eliminación de tope `1..5`, fixes de callers sin `plan_id` y compatibilidad dual `0014`/`0015`; **no** contiene `0015` ni `0016`).
3. **Render (`mi-carrera-api`):**
   - `buildCommand` ejecuta `db:migrate` (aplica `0014` si la BD venía de `0013`).
   - Esperar estado **`Live`** y **`/api/health` 200 OK**.
4. **Verificación rápida post-Despliegue A (SQL Editor de Neon):**
   - `SELECT count(*) FROM user_settings WHERE plan_id IS NULL;`
   - `SELECT count(*) FROM schedule_selections WHERE plan_id IS NULL;`
   - `SELECT count(*) FROM schedule_proposals WHERE plan_id IS NULL;`

---

### Despliegue B — Endurecimiento BD (`0015`) + Store compuesto directo (`2c-d2`)

#### Paso B.0 — Respaldo permanente y control 0-nulos *(Consola Neon)*

1. En **Consola Neon → Branches**, crear una rama snapshot desde producción llamada por ejemplo **`backup-pre-0015-YYYYMMDD`** configurada **SIN expiración** (*Never expire* / sin TTL automático).
2. En el **SQL Editor** de Neon (sobre la rama principal antes de migrar), inspeccionar si existen nulos previos y anotar la última migración registrada:
   ```sql
   SELECT id, hash, created_at
   FROM "drizzle"."__drizzle_migrations"
   ORDER BY created_at DESC
   LIMIT 3;

   SELECT 'user_settings' AS tabla, count(*) AS nulls FROM "user_settings" WHERE "plan_id" IS NULL
   UNION ALL
   SELECT 'schedule_selections', count(*) FROM "schedule_selections" WHERE "plan_id" IS NULL
   UNION ALL
   SELECT 'schedule_proposals', count(*) FROM "schedule_proposals" WHERE "plan_id" IS NULL;
   ```
   *(Nota: `0015` vuelve a ejecutar backfill para cualquier `NULL` residual de transición antes de imponer `SET NOT NULL`, pero este conteo previo confirma que `2c-d1` no está generando nulos).*

#### Paso B.1 — Deploy de **`2c-d2`** en Render *(Render)*

1. Llevar la rama productiva al commit/tag **`2c-d2`**.
2. Durante `npm install && npm run build && npm run db:migrate`:
   - El contenedor **`2c-d1`** sigue respondiendo sin cortes mientras `0015_user_state_composite_keys.sql` (`when = 1793750000000`) ejecuta en Neon:
     - **Paso A:** backfill de `plan_id IS NULL`.
     - **Paso B:** `SET NOT NULL` en `user_settings`, `schedule_selections` y `schedule_proposals`; cambio de `PK` de `user_settings` a `(user_id, plan_id)`; drop de `uq_user_schedule_selection`.
     - **Paso C:** expansión segura de `extra_settings->'perPlan'` y `selections_by_plan` validando formato UUID por regex antes de `::uuid` y filtrando `JOIN study_plans`.
   - Render conmuta tráfico a **`2c-d2`** tras pasar `/api/health`.

#### Paso B.2 — Verificación post-B *(SQL Editor Neon + logs Render)*

```sql
-- 1. Confirmar 0015 aplicada (when = 1793750000000)
SELECT id, hash, created_at
FROM "drizzle"."__drizzle_migrations"
ORDER BY created_at DESC
LIMIT 5;

-- 2. Confirmar 0 nulos en las 3 tablas
SELECT
  (SELECT count(*) FROM "user_settings" WHERE "plan_id" IS NULL) AS settings_nulls,
  (SELECT count(*) FROM "schedule_selections" WHERE "plan_id" IS NULL) AS selections_nulls,
  (SELECT count(*) FROM "schedule_proposals" WHERE "plan_id" IS NULL) AS proposals_nulls;

-- 3. Confirmar PK compuesta en user_settings y ausencia de uq_user_schedule_selection
SELECT a.attname AS pk_col
FROM pg_index i
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
WHERE i.indrelid = 'public.user_settings'::regclass AND i.indisprimary
ORDER BY array_position(i.indkey, a.attnum);

SELECT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.schedule_selections'::regclass
    AND conname = 'uq_user_schedule_selection'
) AS legacy_unique_exists;
```

#### Procedimiento de Rollback SQL de `0015` → `0014` *(solo si hiciera falta volver a `2c-d1` sobre `0014`)*

1. **Primero revertir el servicio en Render** a **`2c-d1`** (que soporta tanto `0015` como `0014`), **antes** de tocar el esquema SQL.
2. Si además necesitás revertir el esquema de `0015` a `0014` en Neon **preservando datos**, ejecutá este bloque en una transacción: la **guarda anti-pérdida** aborta si algún usuario ya creó más de 1 fila en `user_settings` o `(user_id, schedule_term_id)` en `schedule_selections` (para compactar antes en `extra_settings->'perPlan'` / `selections_by_plan` sin perder datos):

```sql
BEGIN;

-- Guarda obligatoria: aborta si ya existen múltiples filas por usuario / usuario+término
DO $$
DECLARE
  multi_settings bigint;
  multi_selections bigint;
BEGIN
  SELECT count(*) INTO multi_settings
  FROM (SELECT user_id FROM "user_settings" GROUP BY user_id HAVING count(*) > 1) s;

  SELECT count(*) INTO multi_selections
  FROM (SELECT user_id, schedule_term_id FROM "schedule_selections" GROUP BY user_id, schedule_term_id HAVING count(*) > 1) ss;

  IF multi_settings > 0 OR multi_selections > 0 THEN
    RAISE EXCEPTION
      'Rollback abortado: hay % usuario(s) con >1 fila en user_settings y % en schedule_selections. Compactá esas filas en extra_settings->perPlan / selections_by_plan antes de restaurar PK simple.',
      multi_settings, multi_selections;
  END IF;
END $$;

ALTER TABLE "user_settings" DROP CONSTRAINT IF EXISTS "user_settings_pkey";
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id");

DO $$ BEGIN
  ALTER TABLE "schedule_selections"
    ADD CONSTRAINT "uq_user_schedule_selection" UNIQUE ("user_id", "schedule_term_id");
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

ALTER TABLE "user_settings" ALTER COLUMN "plan_id" DROP NOT NULL;
ALTER TABLE "schedule_selections" ALTER COLUMN "plan_id" DROP NOT NULL;
ALTER TABLE "schedule_proposals" ALTER COLUMN "plan_id" DROP NOT NULL;

DELETE FROM "drizzle"."__drizzle_migrations"
WHERE "created_at" = 1793750000000;

COMMIT;
```

> [!WARNING]
> Si ya hay múltiples filas tras haber corrido `2c-d2`, **la alternativa recomendada sin pérdida es mantener `0015` aplicada y revertir únicamente Render a `2c-d1`** (que es compatible con `0015`), en lugar de forzar rollback de esquema.

---

### Despliegue C — Frontend Etapa 2 + Cierre Tramo 2D *(Vercel después de Render)*

1. Recién cuando Tramo 2C (Partes A–D) y Tramo 2D (bloqueantes admin `a–d`, ciclo `publish`/`unpublish`/`archive`, y tests completos) estén mergeados y **Render** ya esté corriendo ese backend:
2. Publicar el deploy en **Vercel** (`npm run build`), verificando:
   - Pestaña `/#admin` → **Carreras** (carga plantilla, preview, confirmación en `draft`, placeholder `Ej: IND`).
   - Estado de publicación y selector público sin exponer planes `draft`.

---

## 3. Reglas Operativas Obligatorias (Etapa 2+)

1. **Secuencia inquebrantable de compatibilidad (`D1` → `D2`/migración → Frontend):** nunca mezclar en un mismo deploy un `NOT NULL`/cambio de PK destructivo con código previo incompatible en producción; todo cambio de esquema restrictivo pasa primero por una versión dual (`2c-d1`).
2. **Respaldo Neon sin expiración antes de DDL irreversible:** toda rama `backup-pre-0015-*` debe crearse sin fecha de expiración automática y conservarse hasta confirmar estabilidad real en producción.
3. **Inmutabilidad de migraciones y fin de línea LF:** `.gitattributes` impone `server/drizzle/*.sql text eol=lf`. Nunca editar una migración ya aplicada (`0000`–`0014`); la advertencia de hash en `0007` es esperada y no bloqueante; toda migración se aplica únicamente vía `npm --prefix server run db:migrate`.

---

## 4. Secuencia completa del ensayo en UNA rama temporal de Neon (copia de producción)

Esta prueba integral ejercita la transición completa `0013/0014` → `2c-d1` → `0015` (`2c-d2`) → ventana mixta `2c-d1 sobre 0015` → `2c-d2` → rollback SQL → re-migración idempotente → limpieza sobre **una única rama temporal de Neon** (con retención `>= 7 días` si se ejecuta en etapas).

1. **[Consola Neon]** Crear una rama temporal copiada de producción (ej. `ensayo-etapa2-2c`). Copiar `DATABASE_URL` (`-pooler`) y `DIRECT_URL` (directa) en `server/.env` local (omitir claves reales de Brevo/Resend/R2/Google). Confirmar visualmente que el endpoint `ep-...` **no** sea el de producción.
2. **[Terminal local — `2c-d1` + migración hasta `0014`]**
   ```powershell
   git checkout 2c-d1
   npm --prefix server run build
   npm --prefix server run db:migrate
   ```
   Verificar en Neon SQL Editor que `__drizzle_migrations` llegue a `1793740000000` (`0014`).
3. **[Navegador `/#admin` + SQL Editor Neon — Datos semilla realistas y sucios]**
   - Levantar `npm --prefix server run dev` y `npm run dev`.
   - En `/#admin` → **Carreras**, importar `artifacts/industrial/industrial-plan-2023.xlsx` con código **`IND`** en modo `draft` y confirmar vista previa, inspección (`56 materias · 222 correlativas`) y ausencia en `/api/catalog/*`.
   - Además, en el SQL Editor de la rama temporal (para un usuario ficticio temporal o fila temporal de prueba), sembrar en `user_settings.extra_settings->'perPlan'` y `schedule_selections.selections_by_plan` un UUID válido de plan existente + una **clave no-UUID** (p. ej. `"isi-old"`) + un UUID inexistente, y dejar alguna fila con `plan_id IS NULL`.
4. **[Terminal local — Verificación UserState sobre `0014` con `2c-d1`]**
   ```powershell
   $env:ALLOW_DESTRUCTIVE_TEST = "1"
   npm --prefix server run verify:user-state-neon -- --host-ok=<host> --expect-schema=0014
   Remove-Item Env:ALLOW_DESTRUCTIVE_TEST -ErrorAction SilentlyContinue
   ```
   Confirmar los 6 escenarios en verde, `user_settings`/`schedule_selections` = `1` fila cada uno en `0014`, `0` nulos y `diff: 0` en conteos globales.
5. **[Terminal local — `2c-d2` + migración `0015`]**
   ```powershell
   git checkout 2c-d2
   npm --prefix server run build
   npm --prefix server run db:migrate
   ```
   Verificar en Neon SQL Editor:
   - `1793750000000` registrada (`0015_user_state_composite_keys`).
   - Las entradas válidas de `perPlan` / `selections_by_plan` se expandieron a filas reales.
   - Las claves no-UUID (`"isi-old"`) y UUIDs inexistentes fueron ignoradas sin error de casteo.
   - `0` filas con `plan_id IS NULL`.
6. **[Terminal local — Ventana de deploy: `2c-d1` corriendo sobre esquema `0015`]**
   ```powershell
   git checkout 2c-d1
   npm --prefix server run build
   $env:ALLOW_DESTRUCTIVE_TEST = "1"
   npm --prefix server run verify:user-state-neon -- --host-ok=<host> --expect-schema=0015
   Remove-Item Env:ALLOW_DESTRUCTIVE_TEST -ErrorAction SilentlyContinue
   ```
   Confirmar que el código **`2c-d1`** pasa íntegro contra Neon ya migrado a `0015` sin fallar por `NOT NULL` ni duplicar notificaciones de biblioteca.
7. **[Terminal local — Store directo `2c-d2` sobre esquema `0015`]**
   ```powershell
   git checkout 2c-d2
   npm --prefix server run build
   $env:ALLOW_DESTRUCTIVE_TEST = "1"
   npm --prefix server run verify:user-state-neon -- --host-ok=<host> --expect-schema=0015
   Remove-Item Env:ALLOW_DESTRUCTIVE_TEST -ErrorAction SilentlyContinue
   ```
8. **[SQL Editor Neon + Terminal local — Rollback SQL `0015 -> 0014` e idempotencia]**
   - Ejecutar el bloque de **Rollback SQL** de la Sección 2 sobre la rama temporal (limpiando primero si el usuario de prueba dejó >1 fila sintética, para probar la guarda y luego el rollback real).
   - Volver a correr `npm --prefix server run db:migrate` (reaplica `0015` limpiamente).
   - Correr una segunda vez `npm --prefix server run db:migrate` (confirma `0` cambios, idempotente).
9. **[Terminal local — Verificación `verify:import-neon` tras correcciones]**
   ```powershell
   $env:ALLOW_DESTRUCTIVE_TEST = "1"
   npm --prefix server run verify:import-neon -- --host-ok=<host>
   Remove-Item Env:ALLOW_DESTRUCTIVE_TEST -ErrorAction SilentlyContinue
   ```
   Confirmar limpieza completa (`diff: 0`, salvo filas inmutables en `admin_audit_log`), borrar el borrador temporal de `IND` desde la UI si no se necesita en ese ensayo y regresar a `git checkout etapa2`.
