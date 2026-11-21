# Plan de Despliegue y Ensayo — Etapa 2 (Tramo 2C completo: `0014` → `0015` → `0016`)

> **Alcance actual:** Este documento define la secuencia segura de despliegue en producción para **Etapa 2 hasta Tramo 2C completo (Partes A, B, C y D)** (tags locales **`2c-d1`** y **`2c-d2`** más commits de Partes B–D en rama `etapa2`), incluyendo respaldo sin expiración en Neon, rollback SQL seguro y el protocolo completo de ensayo en una sola rama temporal de Neon (`>= 7 días`).
> **Restricción del entorno local:** Desde desarrollo nunca se ejecuta `git push` automático ni migraciones contra Neon/Render/Vercel reales sin aprobación explícita.

---

## 1. Mapa de servicios e infraestructura (`render.yaml`, `vercel.json`, Neon)

| Capa / Consola | Configuración real verificada | Ventana crítica en despliegue | Qué revisar manualmente en consola |
|---|---|---|---|
| **Base de datos (Neon)** | PostgreSQL gestionado con `DATABASE_URL` (`-pooler`) y `DIRECT_URL` (conexión directa para DDL en `db:migrate`). | Al aplicar DDL de `0015` (`NOT NULL`, nueva `PK(user_id, plan_id)`, drop de `uq_user_schedule_selection`) y `0016` (`library_files.subject_id` → `ON DELETE RESTRICT`). | Rama snapshot **sin expiración** creada antes de migrar; verificar endpoint (`ep-...`) antes de cualquier comando. |
| **Backend API (Render)** (`render.yaml`) | `rootDir: server`<br>`buildCommand: npm install && npm run build && npm run db:migrate`<br>`startCommand: npm run start`<br>`healthCheckPath: /api/health` | Durante el `buildCommand` de **`2c-d2`** (o Tramo 2C completo), `db:migrate` aplica **`0015`** y **`0016`** sobre Neon **mientras el contenedor previo (`2c-d1`) sigue atendiendo tráfico en producción** hasta pasar `/api/health`. | Confirmar `Auto-Deploy`, variables `DATABASE_URL`, `DIRECT_URL`, `CLIENT_ORIGIN`, secretos JWT/Refresh/Pepper, `R2_*` y estado de `/api/health`. |
| **Frontend SPA (Vercel)** (`vercel.json`) | Build raíz: `npm run build` (`tsc -b && vite build`), rewrites `/api/:path*` → Render backend. | Si se publica frontend de Etapa 2 antes que su backend correspondiente, endpoints nuevos (`/api/admin/plans/*`, filtros `careerId`/`planId`) responderán `404` o incompletos. | Verificar `Production Branch`, variables `VITE_*` y mantener deploy frontend posterior a Render. |

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

#### Paso B.1 — Deploy de **`2c-d2` / Tramo 2C completo** en Render *(Render)*

1. Llevar la rama productiva al commit/tag **`2c-d2`** (o cierre de Tramo 2C en `etapa2`).
2. Durante `npm install && npm run build && npm run db:migrate`:
   - El contenedor **`2c-d1`** sigue respondiendo sin cortes mientras `0015_user_state_composite_keys.sql` (`when = 1793750000000`) y `0016_library_files_restrict_delete.sql` (`when = 1793760000000`) ejecutan en Neon:
     - **Paso A (`0015`):** backfill de `plan_id IS NULL` seguido de bloque `DO $$` con `RAISE EXCEPTION`: **no elimina filas ni muta nada** — si queda cualquier `plan_id IS NULL` en `user_settings`, `schedule_selections` o `schedule_proposals`, aborta la transacción única de Drizzle e interrumpe el `buildCommand` de Render antes de reemplazar el servicio vivo.
     - **Paso B (`0015`):** `SET NOT NULL` en `user_settings`, `schedule_selections` y `schedule_proposals`; cambio de `PK` de `user_settings` a `(user_id, plan_id)`; drop de `uq_user_schedule_selection`.
     - **Paso C (`0015`):** expansión segura de `extra_settings->'perPlan'` y `selections_by_plan` validando formato UUID por regex antes de `::uuid` y filtrando `JOIN study_plans`.
     - **Migración `0016`:** cambia de forma idempotente la FK `library_files(subject_id) -> subjects(id)` de `ON DELETE CASCADE` a `ON DELETE RESTRICT`, impidiendo que el borrado en BD de una materia o plan borre archivos con objetos vivos en R2.
   - Render conmuta tráfico al nuevo deploy tras pasar `/api/health`.

> [!NOTE]
> **Índices equivalentes en `user_settings(user_id, plan_id)` tras `0015`:**
> Con `0015` quedan presentes tanto `user_settings_pkey` (`PRIMARY KEY (user_id, plan_id)`) como el índice/restricción previa `uq_user_settings_user_plan` (introducido en `0008`). Ambos cubren el mismo par `(user_id, plan_id)` en forma equivalente; **se deja `uq_user_settings_user_plan` deliberadamente durante Etapa 2** para mantener compatibilidad sin sobresaltos con despliegues intermedios (`2c-d1`) y su eliminación se difiere a una migración limpia posterior (`Etapa 3`).

#### Paso B.2 — Verificación post-B *(SQL Editor Neon + logs Render)*

```sql
-- 1. Confirmar 0015 y 0016 aplicadas (1793750000000 y 1793760000000)
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

-- 4. Confirmar ON DELETE RESTRICT (confdeltype = 'r') en library_files.subject_id
SELECT conname, confdeltype
FROM pg_constraint
WHERE conrelid = 'public.library_files'::regclass
  AND conname = 'library_files_subject_id_subjects_id_fk';
```

#### Procedimiento de Rollback SQL de `0015` → `0014` *(SOLO emergencia después de backup y ensayado en rama temporal)*

> [!CAUTION]
> **Uso estricto del `DELETE FROM "drizzle"."__drizzle_migrations"`:**
> La eliminación manual de filas de `"drizzle"."__drizzle_migrations"` es un recurso **EXCLUSIVO DE EMERGENCIA que solo debe usarse DESPUÉS de haber creado una rama de respaldo sin expiración en Neon** y **después de haberlo ensayado completo sobre la rama temporal de pruebas**. Nunca se ejecuta sin respaldo previo ni para reescribir migraciones ya aplicadas de producción (`0000`–`0014`).

1. **Primero revertir el servicio en Render** a **`2c-d1`** (que soporta tanto `0015` como `0014`), **antes** de tocar el esquema SQL.
2. Si además necesitás revertir `0016` antes de revertir `0015` (solo si el despliegue había llegado hasta `0016`): restaurar temporalmente la FK anterior en `library_files(subject_id)` con `ON DELETE cascade` y eliminar `"created_at" = 1793760000000` de `"drizzle"."__drizzle_migrations"`.
3. Luego, para revertir `0015` a `0014` en Neon **preservando datos**, ejecutá este bloque en una transacción: la **guarda anti-pérdida** aborta si algún usuario ya creó más de 1 fila en `user_settings` o `(user_id, schedule_term_id)` en `schedule_selections`:

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

1. Recién cuando Tramo 2C (Partes A–D, con los bloqueantes de BD, Biblioteca, Moderación multi-plan, Mails y Docentes ya resueltos) y Tramo 2D (compuerta y ciclo `publish`/`unpublish`/`archive`, más tests completos) estén mergeados y **Render** ya esté corriendo ese backend:
2. Publicar el deploy en **Vercel** (`npm run build`), verificando:
   - Pestaña `/#admin` → **Carreras** (carga plantilla, preview, confirmación en `draft`, placeholder `Ej: IND`).
   - Filtros **Carrera** / **Plan** e insignias `[careerCode] · [planName]` en **Biblioteca** y **Reseñas**, y gestión de docentes por `planId` sin depender de `selected_plan_id`.
   - Estado de publicación y selector público sin exponer planes `draft`.

---

## 3. Reglas Operativas Obligatorias (Etapa 2+)

1. **Secuencia inquebrantable de compatibilidad (`D1` → `D2`/migración → Frontend):** nunca mezclar en un mismo deploy un `NOT NULL`/cambio de PK destructivo con código previo incompatible en producción; todo cambio de esquema restrictivo pasa primero por una versión dual (`2c-d1`).
2. **Respaldo Neon sin expiración antes de DDL irreversible:** toda rama `backup-pre-0015-*` debe crearse sin fecha de expiración automática y conservarse hasta confirmar estabilidad real en producción.
3. **Inmutabilidad de migraciones y fin de línea LF:** `.gitattributes` impone `server/drizzle/*.sql text eol=lf`. Nunca editar una migración ya aplicada (`0000`–`0014`); la advertencia de hash en `0007` es esperada y no bloqueante; toda migración se aplica únicamente vía `npm --prefix server run db:migrate`.
4. **Aborto seguro sin pérdida (`0015`) y protección R2 (`0016`):** `0015` aborta con `RAISE EXCEPTION` (sin `DELETE`) si quedaran filas `plan_id IS NULL`; `0016` impone `ON DELETE RESTRICT` en `library_files.subject_id` y ningún bloqueo `409` en administración ni cancelación de registro llama a `r2.deleteObject`.

---

## 4. Secuencia completa del ensayo en UNA rama temporal de Neon (`>= 7 días` de retención)

Esta prueba integral ejercita la transición completa `0013/0014` → `2c-d1` → `0015` & `0016` (`etapa2` final de Tramo 2C) → ventana mixta `2c-d1 sobre 0015` → rollback SQL → re-migración idempotente → limpieza en **10 pasos** sobre **una única rama temporal de Neon** con retención mínima **`>= 7 días`**:

1. **[Consola Neon — Paso 1]** Crear UNA rama temporal copiada de producción (ej. `ensayo-etapa2-2c`) con **retención `>= 7 días`**. Copiar `DATABASE_URL` (`-pooler`) y `DIRECT_URL` (directa) en `server/.env` local (omitir claves reales de Brevo/Resend/R2/Google). Confirmar visualmente que el endpoint `ep-...` **no** sea el de producción.
2. **[Terminal local — Paso 2: `2c-d1` + migración `0014`]**
   ```powershell
   git checkout 2c-d1
   npm --prefix server run build
   npm --prefix server run db:migrate
   ```
   Verificar en Neon SQL Editor que `__drizzle_migrations` llegue a `1793740000000` (`0014_subject_display_code`).
3. **[Navegador `/#admin` + SQL Editor Neon — Paso 3: Siembra de `IND` y datos sucios pre-`0015`]**
   - Levantar `npm --prefix server run dev` y `npm run dev`.
   - En `/#admin` → **Carreras**, importar `artifacts/industrial/industrial-plan-2023.xlsx` con código **`IND`** en modo `draft` y verificar vista previa e inspección (`56 materias · 222 correlativas`), sin aparecer aún en `/api/catalog/*`.
   - En el SQL Editor de la rama temporal, sembrar para un usuario de prueba filas en `user_settings.extra_settings->'perPlan'` y `schedule_selections.selections_by_plan` apuntando al UUID real del plan **`IND`** recién creado, **más** una clave **no-UUID** (p. ej. `"isi-old"`) y un UUID inexistente, dejando un escenario válido de backfill antes de `0015`.
4. **[Terminal local — Paso 4: `verify:user-state-neon` (D1) sobre `0014`]**
   ```powershell
   $env:ALLOW_DESTRUCTIVE_TEST = "1"
   npm --prefix server run verify:user-state-neon -- --host-ok=<host> --expect-schema=0014
   Remove-Item Env:ALLOW_DESTRUCTIVE_TEST -ErrorAction SilentlyContinue
   ```
   Confirmar los 6 escenarios en verde, `user_settings`/`schedule_selections` = `1` fila cada uno en `0014`, `0` nulos y `diff: 0` en conteos globales.
5. **[Terminal local — Paso 5: Commit final Tramo 2C + `db:migrate` (`0015` y `0016`)]**
   ```powershell
   git checkout etapa2
   npm --prefix server run build
   npm --prefix server run db:migrate
   ```
   Aplica de una sola pasada `0015_user_state_composite_keys` (`1793750000000`) y `0016_library_files_restrict_delete` (`1793760000000`). *(Nota: ante filas `plan_id IS NULL` sin ningún plan disponible en BD, `0015` aborta toda la transacción con `RAISE EXCEPTION` mostrando conteos por tabla sin borrar nada).*
6. **[SQL Editor Neon — Paso 6: Verificación SQL de `0015`, `0016` y datos migrados]**
   - Confirmar en `drizzle.__drizzle_migrations` las filas hasta `1793760000000` (`0016`).
   - Confirmar `0` filas con `plan_id IS NULL` en `user_settings`, `schedule_selections` y `schedule_proposals`, `PRIMARY KEY (user_id, plan_id)` en `user_settings` y ausencia de `uq_user_schedule_selection`.
   - Confirmar que los ajustes de **`IND`** en `perPlan`/`selections_by_plan` se expandieron a filas reales, mientras que `"isi-old"` y el UUID inexistente fueron ignorados sin error.
   - Confirmar que la FK `library_files_subject_id_subjects_id_fk` tiene `confdeltype = 'r'` (`ON DELETE RESTRICT`).
7. **[Terminal local — Paso 7: Verificación `verify:user-state-neon` con `D1` y `D2` sobre esquema `0015`]**
   ```powershell
   # 7a. Ventana de despliegue: D1 (2c-d1) corriendo contra BD ya migrada a 0015/0016
   git checkout 2c-d1
   npm --prefix server run build
   $env:ALLOW_DESTRUCTIVE_TEST = "1"
   npm --prefix server run verify:user-state-neon -- --host-ok=<host> --expect-schema=0015

   # 7b. Store directo final (etapa2 / 2c-d2+) corriendo contra esquema 0015/0016
   git checkout etapa2
   npm --prefix server run build
   npm --prefix server run verify:user-state-neon -- --host-ok=<host> --expect-schema=0015
   Remove-Item Env:ALLOW_DESTRUCTIVE_TEST -ErrorAction SilentlyContinue
   ```
   Confirmar que tanto **`2c-d1`** como **`etapa2`** pasan íntegramente contra esquema `0015` (`6/6` escenarios, `0` nulos, `0` notificaciones duplicadas). *(También verificar en UI `/#admin` → Biblioteca/Reseñas los filtros y badges `[IND] · [Plan 2023]` y la creación/vinculación de docentes en `IND` con usuario cuyo `selected_plan_id` sea `ISI` o `NULL`).*
8. **[SQL Editor Neon — Paso 8: Rollback SQL controlado en la rama temporal]**
   - Limpiar las filas multi-plan sintéticas creadas en el Paso 3 si hace falta comprobar la guarda anti-pérdida primero (confirmando que aborta con >1 fila) y luego ejecutar el **Rollback SQL** de la Sección 2 (`0016` → `0015` → `0014`) sobre esta **rama temporal únicamente**.
9. **[Terminal local — Paso 9: Re-migración `db:migrate` e idempotencia]**
   ```powershell
   npm --prefix server run db:migrate
   npm --prefix server run db:migrate
   ```
   Confirmar que la **1ra corrida** reaplica `0015` y `0016` limpiamente y la **2da corrida** termina sin cambios (`no-op` idempotente).
10. **[Terminal local — Paso 10: Verificación `verify:import-neon` y cierre]**
    ```powershell
    $env:ALLOW_DESTRUCTIVE_TEST = "1"
    npm --prefix server run verify:import-neon -- --host-ok=<host>
    Remove-Item Env:ALLOW_DESTRUCTIVE_TEST -ErrorAction SilentlyContinue
    ```
    Confirmar limpieza completa de `verify:import-neon` (`diff: 0`, salvo filas inmutables de `admin_audit_log`), eliminar el borrador temporal de `IND` desde `/#admin` → **Carreras** si se desea dejar conteos iguales a producción, y regresar localmente con `git checkout etapa2` (conservando o eliminando la rama temporal al vencer la ventana de prueba).
11. **[Ensayo del fix de cursadas (`fix-cursada-estado`) contra Postgres real en la rama TEMPORAL]**
    - **a)** Con el backend apuntando a la rama **TEMPORAL** de Neon, ejecutar `PUT /api/enrollments/:subjectId` (o usar **"Agregar cursada"** en la UI) con `status: "promocionada"` sobre una materia sin estado previo, y comprobar con `SELECT` que `subject_progress` quedó en `'promocionada'`:
      ```sql
      SELECT status, grade, updated_at
      FROM subject_progress
      WHERE user_id = '<user_uuid>' AND subject_id = '<subject_uuid>';
      ```
    - **b)** Repetir con `PUT /api/enrollments/:subjectId` y `status: "regularizada"` sobre una materia ya en `'aprobada'` con nota (p. ej. `8` o `9`): comprobar que `subject_progress.status` sigue en `'aprobada'` y conserva su nota intacta.
    - **c)** Comprobar en ambos casos que el `subjectStatus` devuelto por `PUT /api/enrollments/:subjectId` coincide exactamente con el `status` persistido en `subject_progress` (y que `GET /api/enrollments` omite `subjectStatus`).
    - **d)** *(Opcional — concurrencia `ON CONFLICT DO UPDATE`)*: enviar dos `PUT /api/enrollments/:subjectId` simultáneos (p. ej. con `'regularizada'` y `'promocionada'`) sobre una materia sin fila previa en `subject_progress`, y comprobar que ninguno devuelve error `500` / `23505`, no queda una cursada perdida y `subject_progress.status` termina en `'promocionada'`.
    - *(Eliminar o revertir las cursadas/progresos sintéticos creados en este punto antes de cerrar el ensayo).*
