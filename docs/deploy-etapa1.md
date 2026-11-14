# Plan de Deploy — Etapa 1 (Multi-Carrera / Catálogo Dinámico)

> **Alcance:** Despliegue de la rama `multicarrera` (Etapa 1 completa, migraciones `0008`–`0013` y guarda runtime de migraciones). **Sin** cambios de Etapa 2 (panel de administración).
> **Estado de referencia:** Producción actual en `master` corre migración hasta `0007` (`1793670000000`). En este entorno local **no** se ejecuta el deploy ni comandos contra producción.

---

## 1. Configuración actual de deploy (`render.yaml` y `vercel.json`)

| Servicio | Archivo en repo | Configuración observada | Qué **sí** sabemos del repo | Qué debe verificar el usuario en el panel |
|---|---|---|---|---|
| **Backend API (`mi-carrera-api`)** | `render.yaml` | `runtime: node`, `rootDir: server`, `plan: free`<br>`buildCommand: npm install && npm run build && npm run db:migrate`<br>`startCommand: npm run start` (`node dist/app.js`)<br>`healthCheckPath: /api/health` | `render.yaml` ejecuta `tsc` (`dist/`) y luego `node dist/db/migrate.js` antes de levantar la nueva instancia. El archivo **no** fija `branch` ni `autoDeploy: false`. | Confirmar en el dashboard de Render qué rama sigue el servicio (habitualmente `master`) y si **Auto-Deploy** está activado (*On Commit*). |
| **Frontend SPA (Vercel)** | `vercel.json` + `package.json` | Build raíz: `npm run build` (`tsc -b && vite build`).<br>`headers`: COOP `same-origin-allow-popups`.<br>`rewrites`: `/api/:path*` -> `https://corre-lbhv.onrender.com/api/:path*` y `/(.*)` -> `/index.html`. | No hay `.github/workflows` ni `ignoreCommand` en `vercel.json`. Toda petición `/api/*` del dominio de Vercel hace proxy directo hacia Render. | Confirmar en **Project Settings -> Git** qué Production Branch tiene Vercel (habitualmente `master`) y que auto-deploy esté pausado antes del deploy del backend. |

### Por qué NO deben auto-desplegarse en paralelo al pushear a `master`

Si `Render` y `Vercel` están ambos conectados a `master` con auto-deploy:
1. Un `push` a `master` dispara **ambos deploys a la vez**.
2. Vercel termina en segundos; Render tarda más (`npm install && npm run build && npm run db:migrate` en Neon + arranque Node).
3. Durante esa ventana queda **frontend nuevo (`HEAD`) contra backend viejo (`master`)**: la nueva validación estricta `isValidPlanCatalogShape()` (`src/api/catalog.api.ts`) rechaza el payload de `master` (que carece de `career`, `plan.config.totalLevels`, `plan.config.levelLabel` y `subjects[].shortName`), dispara `CatalogShapeError` (`"El servidor está desactualizado: el catálogo recibido está incompleto."`) y bloquea la app en la pantalla `"No pudimos cargar tu plan de estudio"` con botón `"Reintentar"`.
4. A la inversa (**backend nuevo `HEAD` contra frontend viejo `master`**), el sistema sigue operativo sin errores (ver análisis de compatibilidad en el reporte técnico / sección de rollback).

**Regla de oro:** desplegar **Backend + DB primero**, verificarlo, y **recién después** desplegar el Frontend en Vercel.

---

## 2. Auditoría de variables de entorno (`master..HEAD`)

Verificado sobre `git diff master..HEAD` en `server/src/config/env.ts` y `src/`: **no se agregaron variables de entorno nuevas** en Etapa 1 (el único cambio en `server/src/config/env.ts` evita ejecutar `dotenv.config()` cuando `NODE_ENV === 'test'`).

### Backend (Render — `server/src/config/env.ts`, `render.yaml`, `server/src/config/library.config.ts`)
Verificar que sigan presentes en **Environment** del servicio `mi-carrera-api` en Render:
- **Base de datos Neon:**
  - `DATABASE_URL` *(requerida, conexión pooled Neon para runtime).*
  - `DIRECT_URL` *(fuertemente recomendada: `server/src/db/migrate.ts` prioriza `process.env.DIRECT_URL || process.env.DATABASE_URL`; en Neon las migraciones DDL deben correr contra conexión directa sin pooler PgBouncer).*
- **Auth, CORS y correo (obligatorias cuando `NODE_ENV=production`):**
  - `NODE_ENV=production`
  - `CLIENT_ORIGIN` *(URL exacta del frontend, p. ej. `https://corre-ten.vercel.app`)*
  - `JWT_SECRET`, `REFRESH_SECRET`, `VERIFICATION_CODE_PEPPER` *(mínimo 16 caracteres)*
  - `GOOGLE_CLIENT_ID`
  - `EMAIL_PROVIDER` (`resend` o `brevo`) + `RESEND_API_KEY` o `BREVO_API_KEY`
- **Cloudflare R2 / Biblioteca (obligatorias cuando `NODE_ENV=production`):**
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- **Opcionales con fallback/default (no requieren cambio):** `PORT`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `CONTACT_EMAIL`, `ADMIN_NOTIFICATION_EMAIL`, `LIBRARY_MAX_PENDING_UPLOADS`, `LIBRARY_UPLOAD_INIT_RATE_LIMIT_MAX`, `LIBRARY_UPLOAD_INIT_RATE_LIMIT_WINDOW_MS`, `LIBRARY_UPLOADING_EXPIRATION_MINUTES`, `LIBRARY_ADMIN_NOTIFY_COOLDOWN_SECONDS`, `LIBRARY_MAX_REJECTIONS_THRESHOLD`, `LIBRARY_REJECTIONS_WINDOW_DAYS`.

### Frontend (Vercel)
Sin variables nuevas:
- `VITE_GOOGLE_CLIENT_ID` (`src/components/auth/GoogleLoginButton.tsx`)
- `VITE_CONTACT_EMAIL` *(opcional, fallback a `stackacademicapp@gmail.com` en `src/config/brand.ts`)*

---

## 3. Procedimiento paso a paso de Deploy

> Cada paso marca explícitamente si se verifica desde código/endpoints públicos o requiere acceso administrativo del usuario en Neon/Render/Vercel.

### Fase 0 — Backup y control de disparadores *(requiere cuenta Neon + Vercel + Render)*

1. **Snapshot / rama de respaldo en Neon (obligatorio antes de migrar):**
   - En la consola de **Neon**, sobre el proyecto de producción, crear una rama puntual (ej. `backup-pre-etapa1-YYYYMMDD`) a partir del estado actual de `main` / producción **o** registrar fecha/hora UTC y LSN actuales para *Point-in-time restore*.
   - Confirmar en el **SQL Editor** de Neon (lectura en producción) que el historial parte exactamente de `0007`:
     ```sql
     SELECT id, hash, created_at
     FROM drizzle.__drizzle_migrations
     ORDER BY id ASC;
     ```
     Esperado antes de desplegar: **8 filas** (`id` 1..8, terminando en `created_at = 1793670000000` correspondiente a `0007_enrollment_status_and_exam_attempts`).
2. **Pausar el auto-deploy del frontend en Vercel:**
   - **Opción recomendada:** en Vercel (`Settings -> Git -> Ignored Build Step`), configurar temporalmente un comando que aborte el build (ej. `exit 0` con salida limpia para ignorar build, o desconectar/pausar temporalmente el *Automatic Production Deployments* en Vercel) **antes** de pushear a `master`.
   - *(Alternativa sin pausar Vercel)*: si Render permite cambiar temporalmente la rama conectada o desplegar manualmente `multicarrera` **antes** de hacer merge a `master`, desplegar Render primero desde `multicarrera` y recién después mergear/pushear `master` para Vercel. En ese caso, verificar igualmente después que Render quede apuntando de nuevo a `master`.

### Fase 1 — Deploy del Backend y Migraciones `0008`–`0013` *(Render)*

1. Pushear `HEAD` a la rama configurada en Render (o disparar **Manual Deploy -> Deploy latest commit**).
2. `render.yaml` ejecutará:
   ```bash
   npm install && npm run build && npm run db:migrate
   ```
   Donde `npm run db:migrate` (`node dist/db/migrate.js`) ahora ejecuta:
   - Validación estática previa del orden estrictamente creciente de `"when"` en `server/drizzle/meta/_journal.json` (`assertJournalStrictlyIncreasing`).
   - `drizzle-orm` `migrate()` aplicando `0008` -> `0009` -> `0010` -> `0011` -> `0012` -> `0013` (`created_at` `1793680000000` hasta `1793730000000`).
   - Verificación posterior contra `"drizzle"."__drizzle_migrations"` (`verifyMigrationState`): si falta **cualquier** migración registrada en `_journal.json`, lanza `Error` con `idx`, `tag` y `when` y sale con `process.exit(1)` **abortando el deploy en Render antes de reemplazar el contenedor activo**.
3. **Qué revisar en los logs de Render:**
   - **Build log:** buscar:
     - `🔄 Ejecutando migraciones de base de datos con DIRECT_URL...`
     - `✅ Migraciones aplicadas y verificadas exitosamente en Neon.`
     - Si apareciera `⚠️ Diferencia de hash para migración ya aplicada [...]`: es una advertencia no bloqueante (`console.warn`, p. ej. por fin de línea CRLF/LF en migraciones previas) y **no** detiene el build.
     - Si apareciera `❌ db:migrate abortado:` o `❌ Error al ejecutar o verificar las migraciones:`: el deploy falló de forma segura; **no avanzar** a Vercel hasta inspeccionar la causa.
   - **Deploy / Runtime log:** confirmar arranque normal del proceso Express sin `❌ ERROR al verificar/aplicar migraciones al iniciar el servidor`. Recordar que en `server/src/app.ts` esta corrida al inicio registra errores con `console.error` sin matar el proceso si la DB ya está viva.

### Fase 2 — Verificación Post-Deploy Backend *(antes de actualizar Vercel)*

#### 2.1 Verificaciones públicas (sin privilegios, ejecutables con `curl`)
1. **Healthcheck directo en Render:**
   ```bash
   curl -fsS https://corre-lbhv.onrender.com/api/health
   ```
   Esperado: HTTP `200`, `{"status":"ok","environment":"production","timestamp":"..."}`.
2. **Versión de catálogo actualizada:**
   ```bash
   curl -fsS https://corre-lbhv.onrender.com/api/catalog/version
   ```
   Esperado: HTTP `200` y una nueva `version` generada por el bump condicional de `0009`–`0013`.
3. **Payload nuevo de catálogo en `/api/catalog/plans/current`:**
   ```bash
   curl -fsS https://corre-lbhv.onrender.com/api/catalog/plans/current
   ```
   Verificar en la respuesta JSON (`data`):
   - `career` presente (`code: "ISI"`, `facultyName`, `institutionName`).
   - `plan.config.totalLevels === 5`, `levelLabel === "Año"`, `finalDegreeTitle` presente, `ppsRequirement.referenceSubjectCode === 36`, `intermediateDegrees[0].name === "Analista Universitario de Sistemas de Información"` (con `shortLabel: "Analista"`, `shortTitle: "Analista Universitario"`), y **ausencia total de `ppsSubjectCode`**.
   - `subjects`: 60 materias con `shortName` (`short_name` normalizado en `0010`), `kind`, `code` formateado (`"1"`, `"E-301"`), exactamente 5 integradoras con `isIntegrator: true` (`id` `12, 16, 23, 30, 36`), y `specialRule` poblado en `36` y `99`.
4. **Árbol de carreras publicadas:**
   ```bash
   curl -fsS https://corre-lbhv.onrender.com/api/catalog/careers
   ```
   Esperado: HTTP `200`, contiene `ISI` Plan 2023 publicado y ningún plan/carrera `draft`, sin `ppsSubjectCode`.

#### 2.2 Verificaciones privilegiadas en Neon *(requiere acceso al SQL Editor del usuario)*
1. Confirmar las **14 filas** exactas en `drizzle.__drizzle_migrations`:
   ```sql
   SELECT id, hash, created_at
   FROM drizzle.__drizzle_migrations
   ORDER BY id ASC;
   ```
   Esperado: filas `1`..`14` (`0000`..`0013`), con último `created_at = 1793730000000`.
2. Verificación rápida de datos migrados (`0008`–`0013`):
   ```sql
   SELECT status, count(*) FROM study_plans GROUP BY status;
   SELECT count(*) AS integradoras FROM subjects WHERE is_integrator = true;
   SELECT code_in_plan, description FROM plan_special_rules psr
     JOIN subjects s ON s.id = psr.subject_id WHERE s.code_in_plan IN (36, 99);
   SELECT version, updated_at FROM catalog_versions;
   ```
   Esperado: `ISI Plan 2023` en `published`, `5` integradoras, ambas descripciones actualizadas y `catalog_versions` actualizado.
3. *(Opcional)* Prueba rápida de la app actual en `https://corre-ten.vercel.app` (todavía en frontend `master`) verificando login, mapa, horarios y guardado de estado contra el backend nuevo.

### Fase 3 — Deploy del Frontend en Vercel y Smoke Final *(requiere panel de Vercel + navegador)*

1. Restaurar el trigger normal de Vercel (quitar el *Ignored Build Step* temporal o reactivar auto-deploy en `master`) y disparar el deploy de producción en Vercel (**Redeploy** o push si ya quedó en `master`).
2. Confirmar en el build log de Vercel que `tsc -b && vite build` finaliza con éxito y que la ruta `/api/*` responde a través del proxy (`https://corre-ten.vercel.app/api/health`).
3. Smoke funcional en navegador (con sesión real en `https://corre-ten.vercel.app`):
   - El mapa carga desde `/api/catalog/plans/current` (sin pantalla de error ni fallback estático) y muestra los `5` badges violeta `"int"`.
   - `StatsDashboard` muestra `"Título Intermedio: Analista Universitario de Sistemas de Información"` y `"Habilitación PPS"`.
   - `ScheduleBuilder` / `ScheduleWeeklyGrid`, `ProfessorsDirectory` y `Library` muestran nombres/códigos cortos correctos y guardan cambios (`PUT /api/progress/:subjectId` o `PUT /api/settings`) sin errores.

---

## 4. Plan de Rollback

### Caso 1 — Falla durante el build/migraciones en Render (`db:migrate` sale con código `1`)
- Render **no reemplaza** el servicio vivo de producción.
- Si una migración SQL dejó algún cambio parcial fuera de transacción (no debería ocurrir dentro de una misma migración porque `drizzle-orm` ejecuta `migrate` en transacción única por ejecución), restaurar producción desde la rama/snapshot `backup-pre-etapa1-YYYYMMDD` en Neon.
- Verificar que Vercel siga intacto en `master` y corregir el problema en rama antes de reintentar.

### Caso 2 — Necesidad de revertir código después de haber migrado la DB (`0008`–`0013` aplicadas)
De acuerdo con el análisis de compatibilidad retroactiva (`master` vs `0008`–`0013`):
- **Orden de rollback de código:** revertir **primero Vercel** (promoviendo el *Deployment* previo de `master` con *Instant Rollback* desde el dashboard de Vercel) y **luego Render** (desplegando el commit de `master` o revert commit en `master`).
  - *Por qué Vercel primero:* mientras Vercel esté en `HEAD` y Render retroceda a `master`, los usuarios sin caché coincidente verán la pantalla `"El servidor está desactualizado..."` con `"Reintentar"`. En cuanto Vercel vuelve a `master`, frontend `master` + backend `master` funcionan sobre la DB ya migrada (`0008`–`0013`) sin fallos SQL de `INSERT`/`UPDATE`/`SELECT` (las columnas agregadas son nullable o tienen `DEFAULT`, y `user_settings`/`schedule_selections` mantienen sus índices únicos legacy intactos).
- **Salvedades operativas tras un rollback de código sobre DB migrada:**
  1. Altas de carreras o planes desde admin bajo `master` quedarían con `status = 'draft'` (habrá que publicarlas al volver a subir Etapa 1).
  2. Archivos subidos a Biblioteca mientras corre `master` quedarán con `shared_subject_id`, `source_subject_id` y `source_plan_id` en `NULL` (requieren backfill al volver a Etapa 1 si se publican otros planes).
  3. Si mientras corrió Etapa 1 algún usuario usó un segundo plan publicado, `master` pisará `schedule_selections.selections` sin actualizar `selections_by_plan` y listará `schedule_proposals` sin filtrar por `plan_id`.
- **Cuándo usar rollback de base de datos (Neon Branch/Restore):** únicamente si una falla de datos introducida en producción requiriera deshacer filas de usuario/catálogo modificadas tras el deploy; en ese caso, revertir ambos servicios a `master` y restaurar la rama de Neon desde `backup-pre-etapa1-YYYYMMDD` *(implica perder cambios de usuarios ocurridos después del corte de deploy)*.
