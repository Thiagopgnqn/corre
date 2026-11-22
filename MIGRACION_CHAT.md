# Memoria Técnica y Migración de Sesión — Stack (`correlativas`)

> **Fecha de corte:** 2026-11-14  
> **Rama activa:** `etapa2` (commit `HEAD`: `dddf65a`)  
> **Estado de Git al migrar:** Árbol de trabajo limpio (`git status -s` vacío) antes de crear este documento; **sin `git push`** de `etapa2` ni cambios en Neon/R2 reales.

---

## 1. Objetivo General del Proyecto y Estado Actual

### Qué se está construyendo
**Stack** (`Tu carrera, materia a materia`) es una aplicación web full-stack para seguimiento académico universitario, mapa interactivo de correlativas, planificación/armado de horarios, reseñas de docentes y biblioteca colaborativa de material de estudio. Inicialmente nació acoplada a **UTN FRC — Ingeniería en Sistemas de Información (ISI Plan 2023)** y está en plena evolución hacia una plataforma **multi-institución, multi-facultad, multi-carrera y multi-plan**:

- **Etapa 1 (CERRADA y DESPLEGADA en producción sobre `master` / `7bdf590`):** Catálogo dinámico multi-carrera desde PostgreSQL (`institutions` -> `faculties` -> `careers` -> `study_plans`), tabla de materias compartidas por facultad (`shared_subjects`), desacoplamiento del motor de correlativas (`src/utils/correlativas.ts`) respecto a constantes fijas de Sistemas, parametrización completa de textos y vistas UI (`planText.ts`, `planViewSelectors.ts`), aislamiento de `localStorage` por plan (`::plan:${planId}`), caché versionada por `planId` (`CATALOG_CACHE_SCHEMA`), migraciones `0008`–`0013` y guarda runtime de migraciones.
- **Etapa 2 (EN CURSO sobre rama `etapa2` desde `master` `7bdf590`):** Panel de administración (`/#admin`) para carga de nuevas carreras y planes mediante archivo `.xlsx` con vista previa de solo lectura, vinculación explícita de `shared_subjects` dentro de la misma facultad, ciclo de vida de planes (`draft` -> `published` / `archived`) y desbloqueo real multi-plan en base de datos para `user_settings` y `schedule_selections`. La primera carrera real prevista para cargar una vez listos los tramos es **Ingeniería Industrial de UTN FRC** (con título intermedio, electivas y PPS).

### Punto exacto de desarrollo
Etapa 2 se organizó en 4 tramos secuenciales (**2A**, **2B**, **2C**, **2D**):
- **Tramo 2A + Ajustes `a)–g)` — COMPLETADO (`4faf3c1`..`dddf65a` en `etapa2`):**
  - Dependencia SheetJS `0.18.5` reemplazada en `server/` por tarball vendored oficial `0.20.3`.
  - Migración aditiva e idempotente `0014_subject_display_code.sql` (código aún **no** desplegado ni aplicado en producción).
  - Generador de plantilla `.xlsx` neutra de 6 hojas (`Plan Ingeniería Ficticia 2026`, 5 niveles, 0 datos de Sistemas/Industrial), parser endurecido dentro de `worker_threads` con mutex global de concurrencia = 1, validaciones estructurales/seguridad, 6 endpoints bajo `/api/admin/plans*`, matching intra-facultad romano-arábigo (`exact/high`) + candidatos `similar/low` sin autovincular y 54 tests en `server/test/planImport.test.ts`.
- **Estado actual — FRENADO antes de Tramo 2B:** Se ejecutó la auditoría de solo lectura **d)** sobre `src/utils/correlativas.ts`, `Navbar.tsx`, `StatsDashboard.tsx`, `SubjectDrawer.tsx` y `planText.ts` y se confirmó que el motor frontend actual **no** soporta correctamente dos requisitos clave de carreras como Ingeniería Industrial (título intermedio sin materia hito especial y subconjunto no contiguo de obligatorias). Por indicación explícita del usuario, se frenó al completar `a)–g)` sin tocar `src/utils/correlativas.ts` ni comenzar Tramo 2B hasta aprobar la extensión mínima del motor/plantilla.

### Qué funciona y qué no funciona todavía
- **Funciona y pasa tests:**
  - Todo el flujo de Etapa 1 desplegado en producción (`master`, solo `ISI Plan 2023` publicado).
  - Generación de plantilla descargable (`GET /api/admin/plans/template`), vista previa estrictamente solo lectura con sugerencias `shared_subjects` y `previewHash` (`POST /api/admin/plans/preview`), importación/re-importación idempotente en `draft` con `requireRecentReauth` (`POST /api/admin/plans/import`), listado enriquecido (`GET /api/admin/plans`), detalle en borrador (`GET /api/admin/plans/:id`) y borrado seguro de borradores sin referencias (`DELETE /api/admin/plans/:id`).
  - Matching romano-arábigo (`Análisis Matemático I` === `Análisis Matemático 1`, `exact/high`), variantes cercanas (`Probabilidad y Estadística` ~ `Probabilidad y Estadísticas`, `similar/low`), aislamiento estricto por niveles numéricos (`Física 1` != `Física 2`), y preservación de vínculos cruzados previos al re-subir sobre un mismo `draft`.
  - Tests offline verificados post-último commit (`dddf65a`): **Backend `482/0`**, **Frontend `15/15` archivos en verde**, ambos builds (`npm run build` y `npm --prefix server run build`) con salida `0`.
- **NO implementado / NO habilitado aún:**
  - **Tramo 2B (Frontend `"Carreras"` en `/#admin`):** Todavía no existe `AdminCareersTab.tsx` ni los métodos cliente en `src/api/admin.api.ts`.
  - **Tramo 2C (`DrizzleUserStateStore` + migración `0015`):** En `server/src/db/schema.ts`, `user_settings.user_id` sigue siendo `PRIMARY KEY` única y `schedule_selections` conserva restricción por `(user_id, schedule_term_id)` sin PK/clave por plan; `DrizzleUserStateStore` guarda snapshots secundarios en JSON (`extraSettings.perPlan`), por lo que **está bloqueado publicar un segundo plan (`status = 'published'`) en producción** hasta completar Tramo 2C (ver `docs/plan-multicarrera.md` §7.4). Además `planImport.service.ts` solo fue ejercitado contra `InMemoryPlanImportStore`, no contra Neon real (`DrizzlePlanImportStore`).
  - **Tramo 2D:** Faltan endpoints/UI de ciclo de vida (`publish`, `unpublish`, `archive`), resolución de los 4 bloqueantes del panel admin (`a–d` §7.4: colas de moderación con carrera/plan, `planId`/UUID explícito al crear/vincular docentes, período horario por facultad, desacoples en `AdminScheduleTab`), y `docs/api-multicarrera.md`.
  - **Auditoría `d)` en motor (`src/utils/correlativas.ts`):**
    - Caso **(i)** título intermedio **sin** materia hito (`specialRuleSubjectCode` omitido): al no haber fila en `plan_special_rules` con `approved_range`, `checkAnalistaTitle` obtiene `missingCoreIds = []` y `seminarioApproved = true` -> devuelve **`eligible: true` con 0 materias aprobadas** si el requisito de electivas es `0` o se satisface.
    - Caso **(ii)** subconjunto **no contiguo** de materias obligatorias para título intermedio: `evaluateSpecialRule` para `approved_range` filtra únicamente `s.id >= fromCode && s.id <= toCode`, sin excepciones ni lista discreta.
    - Caso **(iii)** título intermedio sin créditos de electivas (`0`), switch en `Navbar.tsx` sin materias `isOptionalTrack`, y `isPPSEligible` apuntando tanto a obligatorias como a electivas **sí funcionan** hoy.

---

## 2. Arquitectura, Stack y Configuraciones Clave

### Topología y Despliegue
- **Frontend SPA (Vercel):** Root del repositorio (`/`). `package.json` compila con `tsc -b && vite build` hacia `dist/`. `vercel.json` configura header `COOP: same-origin-allow-popups` y rewrites: `/api/:path*` -> `https://corre-lbhv.onrender.com/api/:path*` y `/(.*)` -> `/index.html`. Production Branch: `master` (Auto-Deploy).
- **Backend API (`mi-carrera-api` en Render):** `render.yaml` define `runtime: node`, `rootDir: server`, `buildCommand: npm install && npm run build && npm run db:migrate`, `startCommand: npm run start` (`node dist/app.js`), `healthCheckPath: /api/health`. Rama activa: `master` (Auto-Deploy). `server/src/app.ts` configura `instance.set('trust proxy', true)` por la cadena `Vercel -> Render`.
- **Desarrollo local:**
  - Frontend Vite en puerto **`5173`** (`vite.config.ts` proxea `/api` hacia `http://localhost:4000`).
  - Backend Express en puerto **`4000`** (default de `PORT` en `server/src/config/env.ts`).

### Stack y Librerías Principales
- **Frontend (`package.json` raíz):**
  - `react` / `react-dom` `^19.3.1`, `vite` `^8.3.5`, `@tailwindcss/vite` / `tailwindcss` `^4.3.3`, `typescript` `~7.0.2`, `tsx` `^4.23.15`, `oxlint` `^1.89.0`.
  - `@xyflow/react` `^12.12.0` (mapa de correlativas), `lucide-react`, `framer-motion`, `canvas-confetti`, `clsx`, `tailwind-merge`, `sharp` (generación de assets de marca).
  - **`xlsx` `^0.18.5` en `devDependencies` raíz:** se conserva **exclusivamente** para scripts offline locales (`scripts/importSchedule.ts`, `test/scheduleImport.test.ts`). **No** entra al bundle `dist/` de Vite.
- **Backend (`server/package.json`):**
  - `express` `^4.21.2`, `typescript` `^5.7.3` (en `dependencies` porque Render instala con `NODE_ENV=production` durante `buildCommand`), `@types/*` también en `dependencies`, `tsx` `^4.19.3` (en `devDependencies`).
  - ORM/DB: `drizzle-orm` `^0.40.0`, `drizzle-kit` `^0.30.4`, `pg` `^8.13.3` (`server/src/db/index.ts` con SSL habilitado).
  - Seguridad/Auth/Validación: `helmet` `^8.0.0`, `cors` `^2.8.5`, `cookie-parser` `^1.4.7`, `@node-rs/argon2` `^2.0.2`, `jsonwebtoken` `^9.0.2`, `google-auth-library` `^11.3.2`, `zod` `^3.24.2`, `dotenv` `^16.4.7`.
  - Almacenamiento R2: `@aws-sdk/client-s3` `3.1161.0`, `@aws-sdk/s3-request-presigner` `3.1161.0`.
  - **Excel / Planillas (`server/`):** `"xlsx": "file:vendor/xlsx-0.20.3.tgz"` (tarball oficial SheetJS `0.20.3`, `2.409.319` bytes, SHA-256 `8DC73FC3B00203E72D176E85B50938627C7B086E607C682E8D3C22C02BB99FE8`, **versionado en Git** en `server/vendor/xlsx-0.20.3.tgz`, sin ninguna copia de `0.18.5` en `server/`).

### Variables de Entorno Requeridas (solo nombres y propósito)
Definidas y validadas en [`server/src/config/env.ts`](server/src/config/env.ts) (en `NODE_ENV=test` no carga `.env`; en `NODE_ENV=production` aborta con `exit 1` si falta alguna obligatoria):
- **Base de datos Neon PostgreSQL:**
  - `DATABASE_URL` *(obligatoria)*: cadena de conexión pooled para runtime (`pg.Pool` en `server/src/db/index.ts`).
  - `DIRECT_URL` *(opcional en dev, configurada en Render)*: conexión directa sin pooler PgBouncer, priorizada por `server/src/db/migrate.ts` y `server/drizzle.config.ts` para ejecutar DDL.
- **Servidor, CORS y JWT / Verificación:**
  - `NODE_ENV`: `'development' | 'production' | 'test'`.
  - `PORT`: puerto HTTP Express (default `4000`).
  - `CLIENT_ORIGIN`: origen permitido en CORS con credenciales (default `http://localhost:5173`; en Render apunta al dominio de Vercel).
  - `JWT_SECRET` *(obligatoria, min. 16 chars)*: firma de access tokens en cookie HttpOnly.
  - `REFRESH_SECRET` *(obligatoria, min. 16 chars)*: firma/gestión de refresh tokens.
  - `VERIFICATION_CODE_PEPPER` *(obligatoria en prod, min. 16 chars)*: secreto HMAC-SHA256 para códigos de verificación de email.
- **Google Identity Services:**
  - `GOOGLE_CLIENT_ID` *(obligatoria en prod)*: Audience/Client ID verificado por backend (`googleAuth.service.ts`).
  - `VITE_GOOGLE_CLIENT_ID` *(frontend)*: Client ID consumido en `src/components/auth/GoogleLoginButton.tsx`.
- **Correo transaccional:**
  - `EMAIL_PROVIDER` *(obligatoria en prod: `'resend' | 'brevo'`)*.
  - `BREVO_API_KEY` *(obligatoria en prod si `EMAIL_PROVIDER='brevo'`; es el proveedor confirmado en Render)* o `RESEND_API_KEY` *(si `'resend'`)*.
  - `EMAIL_FROM`, `EMAIL_FROM_NAME`, `CONTACT_EMAIL` (y `VITE_CONTACT_EMAIL` opcional en frontend, `src/config/brand.ts`).
- **Cloudflare R2 (Biblioteca de Material):**
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` *(todas obligatorias en `NODE_ENV=production`)*.
  - `ADMIN_NOTIFICATION_EMAIL` *(opcional; correos separados por coma para notificaciones de subidas pendientes)*.
  - Opcionales de tuning Biblioteca: `LIBRARY_MAX_PENDING_UPLOADS`, `LIBRARY_UPLOAD_INIT_RATE_LIMIT_MAX`, `LIBRARY_UPLOAD_INIT_RATE_LIMIT_WINDOW_MS`, `LIBRARY_UPLOADING_EXPIRATION_MINUTES`, `LIBRARY_ADMIN_NOTIFY_COOLDOWN_SECONDS`, `LIBRARY_MAX_REJECTIONS_THRESHOLD`, `LIBRARY_REJECTIONS_WINDOW_DAYS`.

### Base de Datos PostgreSQL (`server/src/db/schema.ts`)
- **Catálogo multi-carrera:** `institutions`, `faculties`, `careers` (`status`: `'draft'|'published'|'archived'`), `study_plans` (`status`, `is_active`, `config` JSONB, `career_id`), `shared_subjects` (`faculty_id`, `stable_code`, `normalized_name`, `display_name`), `subjects` (`plan_id`, `shared_subject_id`, `code_in_plan`, `display_code` agregado en `0014`, `short_name`, `is_integrator`, `is_optional_track`, `track_key`, `credits`, `kind`), `subject_prerequisites`, `plan_special_rules`, `acronyms`, `catalog_versions`.
- **Horarios y Docentes:** `schedule_terms`, `course_groups`, `commissions`, `commission_slots`, `commission_professors`, `reserved_elective_slots`, `elective_offerings`, `elective_offering_professors`, `professors`, `professor_aliases`, `professor_stats`, `professor_subject_stats`, `professor_subject_links`, `professor_reviews`, `review_helpful_votes`, `review_reports`.
- **Usuarios, Progreso y Biblioteca:** `users` (`selected_plan_id`), `user_identities`, `email_verification_codes`, `refresh_tokens`, `user_settings` *(atención: `user_id` sigue siendo PK hasta `0015`)*, `subject_progress`, `elective_assignments`, `user_basket`, `schedule_selections` *(único sobre `(user_id, schedule_term_id)` hasta `0015`)*, `schedule_proposals`, `subject_enrollments`, `enrollment_professors`, `final_exam_attempts`, `review_recommendation_dismissals`, `admin_audit_log`, `library_files` *(con `subject_id NOT NULL ON DELETE CASCADE`)*, `library_file_professors`, `library_downloads`, `library_download_logs`, `library_helpful_votes`, `library_reports`, `library_orphan_deletions`.
- **Estado de migraciones en `_journal.json`:** `idx 0..13` (`0000`..`0013` con `when` desde `1730230000000` hasta `1793730000000`, desplegadas en producción) y `idx 14` (`0014_subject_display_code`, `when: 1793740000000`, solo en `etapa2`).

---

## 3. Registro de Cambios Realizados en esta Sesión

> Se distingue explícitamente qué quedó en `master` (`7bdf590`, Etapa 1 desplegada) y qué vive únicamente en la rama `etapa2` (`7bdf590..dddf65a`).

### A. Cambios realizados al inicio de la sesión ya integrados en `master` (`7bdf590`, Etapa 1)
1. **Parametrización UI Tandas 2b / 2c y textos oficiales ISI:**
   - `src/utils/planViewSelectors.ts`, `src/utils/planText.ts`, `src/components/common/PlanSelectorModal.tsx`, `src/components/library/LibraryHome.tsx`, `src/components/library/LibraryTermsPage.tsx`, `src/components/professors/ProfessorsDirectory.tsx`, `src/components/schedule/ScheduleBuilder.tsx`, `src/components/schedule/ScheduleSummaryPanel.tsx`, `src/components/schedule/ScheduleWeeklyGrid.tsx`, `src/components/admin/tabs/AdminReviewsTab.tsx`, `src/components/admin/tabs/AdminScheduleTab.tsx`, `src/utils/libraryUploadLogic.ts`: eliminación de textos fijos de Sistemas, resolución de `shortName` desde catálogo (`getSubjectShortName`) y selectores puros compartidos entre pantalla/export/admin.
   - `server/drizzle/0013_isi_plan_intermediate_and_pps_copy.sql`, `server/seed-data/plan2023-catalog.json`, `server/tools/generateSeedData.ts`, `test/fixtures/subjectShortNames.ts` (nuevo fixture histórico de 59 claves de `ScheduleWeeklyGrid.tsx` anterior a 2c), `test/scheduleImport.test.ts`, `test/planText.test.ts`: actualización idempotente al nombre oficial `"Analista Universitario de Sistemas de Información"` contemplando tanto el nombre original como `"Analista Universitario de Sistemas"`, y test de paridad de `41` materias en `schedule.json` + `15` diferencias esperadas.
2. **Reparación de timestamps de `_journal.json` y guarda runtime de migraciones:**
   - `server/drizzle/meta/_journal.json`: corregidos `when` de `0011` (`1793710000000`), `0012` (`1793720000000`) y `0013` (`1793730000000`) tras descubrir en ensayo con copia de Neon que `drizzle-orm` los salteaba por ser menores a `0010` (`1793700000000`).
   - `server/src/db/migrationGuard.ts` *(nuevo)*, `server/src/db/migrate.ts`, `server/src/app.ts`, `server/test/catalogConfigAndSecurity.test.ts`: verificación estática de monotonicidad estricta, verificación post-`migrate()` contra `drizzle.__drizzle_migrations` (`db:migrate` aborta con `exit 1` si falta una migración; `app.ts` solo hace `console.error`; diferencia de hash solo `console.warn`).
3. **Blindaje de fallbacks `selectedPlanId = null` y despliegue Etapa 1:**
   - `server/src/modules/auth/auth.store.ts` *(nuevo)*, `server/src/modules/auth/auth.service.ts`, `server/src/modules/reviews/reviews.store.ts`, `server/src/modules/library/library.controller.ts`, `server/src/modules/user-state/userState.store.ts` y tests (`authVerification.test.ts`, `reviews.test.ts`, `library.test.ts`, `multicarreraIsolation.test.ts`): todo fallback cuando `selected_plan_id IS NULL` resuelve únicamente planes `published` (nunca `draft`) e invalida caché de estado al hacer backfill.
   - `docs/deploy-etapa1.md` *(nuevo)*, `docs/prueba-manual-multicarrera.md`, `docs/plan-multicarrera.md`, `test/multicarreraEngine.test.ts` (test payload viejo de `master` -> error + reintentar sin fallback): estrategia "Backend Primero" (`deploy/backend-etapa1`) y corrección de IDs de integradoras (`16, 23, 30, 36, 99`).

### B. Cambios exclusivos de la rama `etapa2` (`7bdf590..dddf65a`, Tramo 2A + Ajustes `a)–g)`)

#### 1) SheetJS vendored y scripts compatibles con ESM (`4faf3c1`, `69d9b5b`)
- `server/vendor/xlsx-0.20.3.tgz` *(creado, 2.409.319 bytes, tracked en Git)*: tarball oficial de SheetJS `0.20.3`.
- `server/package.json` y `server/package-lock.json` *(modificados)*: reemplazo de `"xlsx": "^0.18.5"` por `"xlsx": "file:vendor/xlsx-0.20.3.tgz"` (sin copias de `0.18.5` en `server/`).
- `server/src/scripts/mergeProfessors.ts` y `server/src/scripts/migrateProfessors.ts` *(modificados)*: ajuste de import ESM (`(xlsxModule as any).default || xlsxModule`) para interoperar correctamente con el tarball `0.20.3`.

#### 2) Migración `0014` (`display_code`) y desacoplamiento de prefijos `E-`/`X-` (`db878f8`)
- `server/drizzle/0014_subject_display_code.sql` *(creado)* y `server/drizzle/meta/_journal.json` *(modificado, `idx: 14`, `when: 1793740000000`)*: agrega columna nullable `subjects.display_code varchar(32)`, puebla `E-<code_in_plan>` / `X-<code_in_plan>` (`408, 512, 513, 514`) **solo** en `ISI 2023`, `code_in_plan::text` en el resto de materias/carreras (`WHERE display_code IS NULL`), y actualiza `catalog_versions` (`id = 'default'`) en la misma CTE únicamente si `upd` modificó filas.
- `server/src/db/schema.ts`, `server/src/modules/catalog/catalog.store.ts`, `server/src/modules/catalog/planConfig.helpers.ts`, `server/seed-data/plan2023-catalog.json`, `server/src/scripts/seed.ts`, `server/tools/generateSeedData.ts` *(modificados)*: `formatSubjectDisplayCode` dejó de inventar prefijos `E-`/`X-` para planes no-ISI y consume `subject.displayCode` explícito si existe (`catalog.store.ts` selecciona `displayCode`). Se ajustaron fixtures en `test/plan2023Oracle.test.ts`, `test/planText.test.ts`, `test/scheduleImport.test.ts` y se agregaron pruebas en `server/test/catalogConfigAndSecurity.test.ts`.

#### 3) Motor de plantillas, parser aislado en Worker y matching intra-facultad (`60a4ae0`, `8156f86`, `bb4a6f0`, `c2387ed`, `b3b0be7`)
- `server/src/modules/admin/planImport.rules.ts` *(creado y ampliado)*:
  - Constantes de hojas (`Plan`, `Materias`, `Correlativas`, `Reglas`, `Acrónimos`, `Instrucciones`), encabezados exactos (incluyendo `Reglas` con columnas planas `Código materia`, `Tipo regla`, `Desde código`, `Hasta código`, `Trayectos excluidos`, `Descripción`, e `Instrucciones` con 5ª columna `Ejemplo`).
  - Límites: `5 MB`, `10` hojas, `2000` filas, timeout `5000 ms`, `SUPPORTED_SPECIAL_RULE_TYPES = ['approved_range', 'all_previous_core_approved']` (bloqueando `min_credits` y cualquier tipo no implementado en `correlativas.ts`).
  - Validadores puros: `validateModalityAndContraCuatrimestral` (coherencia estricta `1C-CC`/`2C-CC`), `validateSpecialRuleColumns` (genera `defaultDescription` si `Descripción` viene vacía), `normalizeSharedSubjectName` (NFD + lowercase + romanos `I..XX` -> `1..20`) y `classifySharedSubjectMatch` (`exact`/`high` vs `similar`/`low` por plurales españoles, stopwords y distancia acotada, retornando `null` ante cualquier diferencia en tokens numéricos de nivel).
- `server/src/modules/admin/planImport.types.ts` *(creado)*: interfaces del payload parseado (`ParsedPlanWorkbookData`, `ParsePlanWorkbookResult`, `PlanImportIssue`, etc.).
- `server/src/modules/admin/planImport.template.ts` *(creado y actualizado)*: `buildPlanImportTemplateBuffer()` genera el `.xlsx` descargable usando exclusivamente el plan neutro de 5 niveles **`"Plan Ingeniería Ficticia 2026"`** (`8` obligatorias, `2` electivas `101..102`, título intermedio `'Técnico/a Universitario/a Ficticio/a'` en materia `5`, PPS en `7`, integradora final en `8`, sin datos de ISI/IND) + ejemplos concretos en todas las filas de `Instrucciones`.
- `server/src/modules/admin/planImport.worker.ts` *(creado y endurecido)*: ejecuta en `worker_threads` leyendo solo valores (rechaza celdas con `.f` y strings con prefijo `=`/`+`/`-`/`@`/control), bloquea `FORBIDDEN_KEYS` (`__proto__`, `constructor`, `prototype`) en encabezados y celdas, deriva `totalLevels` como `max(Nivel)` si se omite en `Plan`, ejecuta DFS anti-ciclos sobre `Correlativas`, valida `ppsRequirement`, `intermediateDegrees`, `Reglas` y `Acrónimos`.
- `server/src/modules/admin/planImport.parser.ts` *(creado)*: prevalidaciones rápidas previas al worker (`.xlsx`, tamaño `<= 5 MB`, firma `PK\x03\x04`, rechazo de `vbaProject.bin`), mutex global de concurrencia = 1 (`withPlanImportLock` -> HTTP `409 PLAN_IMPORT_IN_PROGRESS`), `Worker` con `resourceLimits` (`128 MB` old gen / `32 MB` young gen), `env: {}` en build JS compilado para no exponer `DATABASE_URL`/`JWT_SECRET`, y timeout `5000 ms` con `worker.terminate()` (`408 PLAN_IMPORT_TIMEOUT`).

#### 4) Servicio, stores, endpoints Admin y contratos (`a67c02a`, `bb4a6f0`, `b3b0be7`)
- `server/src/modules/admin/planImport.service.ts` *(creado y ampliado)*:
  - `DrizzlePlanImportStore` (PostgreSQL transaccional) + `InMemoryPlanImportStore` (testing con snapshot/rollback transaccional) compartiendo `buildSharedSubjectSuggestionMap` (`matchType`, `confidence`).
  - `previewPlanImport` (estrictamente solo lectura; calcula diff sobre `existing_draft_plan`, detecta materias bloqueadas por referencias en Biblioteca/cursadas/reseñas/horarios, sugiere `shared_subjects` de la misma facultad preseleccionando solo vínculos cruzados existentes en `listDraftCrossPlanSharedLinks`, nunca autovincula nuevos, y emite `previewHash` SHA-256).
  - `confirmPlanImport` (valida `previewHash` recalculando hash de `archivo + target + decisiones` -> `409 PREVIEW_HASH_MISMATCH`, re-parsea crudo en worker, ejecuta en transacción creando/actualizando `draft`, bloquea re-importar `published`/`archived` con `409 PLAN_NOT_DRAFT`, bloquea quitar materias referenciadas con `409 DRAFT_SUBJECT_REMOVAL_BLOCKED`, registra en `admin_audit_log` solo resumen/hashes sin el archivo).
  - `listAdminPlans`, `getAdminPlanDetail` (inclusive `draft`), y `deleteDraftPlan` (solo `draft`, bloquea `409` ante cualquier referencia en BD/Biblioteca, limpia `shared_subjects` huérfanas preservando las compartidas).
- `server/src/modules/admin/admin.controller.ts` y `server/src/modules/admin/admin.routes.ts` *(modificados)*: eliminados los stubs rotos previos `POST /api/admin/careers` y `POST /api/admin/plans`; registradas las 6 rutas bajo `/api/admin/plans*` con `/plans/template` **antes** de `/plans/:id`, `csrfProtection` en mutaciones y `requireRecentReauth` en `/import` y `DELETE /plans/:id`.

#### 5) Tests y Documentación de etapa (`a67c02a`, `8156f86`, `c2387ed`, `a95af0b`, `b3b0be7`, `dddf65a`)
- `server/test/planImport.test.ts` *(creado y ampliado a 54 aserciones)*: cubre plantilla e `Instrucciones`, controles de archivo/fórmulas/`__proto__`/`constructor`, DFS/reglas/modalidad, timeout/concurrencia worker, RBAC/CSRF/reauth/orden de rutas, espía solo lectura de `/preview`, `previewHash`, sugerencias romano-arábigas y `similar/low`, rollback transaccional, re-importación idempotente de borrador y bloqueos de borrado.
- `test/correlativas.test.ts`: sección 21 de paridad entre `SUPPORTED_SPECIAL_RULE_TYPES` y `evaluateSpecialRule`.
- `test/apiContract.test.ts`: verificación de contrato para rutas `/api/admin/plans/*`.
- `test/multicarreraEngine.test.ts`: evaluación de `"Plan Ingeniería Ficticia 2026"` contra el motor real (`evaluatePlanProgress`, `checkAnalistaTitle`, `isPPSEligible`, `evaluateSpecialRule`, `canRenderProyectoFinal`) y paridad carácter por carácter de `0014` sobre las `60` materias ISI + valores custom.
- `docs/plan-multicarrera.md`: decisiones aprobadas de Etapa 2, hallazgo `d)` y línea base actualizada a `482/0` backend y `15/15` frontend.

---

## 4. Decisiones Técnicas y Problemas Resueltos

1. **Silencioso salto de migraciones `0011`–`0013` en `drizzle-orm`:**
   - *Causa raíz:* En `_journal.json`, `0011`–`0013` tenían `"when"` en abril 2026 (`1776729600000`–`1776902400000`), menor que `0010` (`1793700000000`) y `0007` (`1793670000000`). `drizzle-orm` (`PgDialect.migrate`) solo consulta la fila más reciente (`ORDER BY created_at DESC LIMIT 1`) y aplica migraciones con `Number(created_at) < folderMillis`, por lo que las saltaba devolviendo `exit 0`.
   - *Solución:* Corregir timestamps a `1793710000000`..`1793730000000` (`0014` quedó en `1793740000000`), blindar con `server/src/db/migrationGuard.ts` (`db:migrate` aborta con `exit 1`; `app.ts` loguea error visible) y tests estáticos/simulación en `server/test/catalogConfigAndSecurity.test.ts` sección `1f`.
2. **Despliegue de Etapa 1 sin ruptura de transición Vercel/Render:**
   - Como Vercel termina antes que Render ante un push a `master` y el frontend nuevo valida forma estricta de catálogo (`isValidPlanCatalogShape`), se estableció la estrategia **"Backend Primero"** (`deploy/backend-etapa1`).
3. **Vulnerabilidad en `xlsx@0.18.5`:**
   - No se usó alias npm ni se dejó copia en `server/`; se instaló `file:vendor/xlsx-0.20.3.tgz` directamente bajo `"xlsx"`, validado con instalación limpia (`NODE_ENV=production`) y smokes de los scripts de profesores.
4. **Aislamiento total de parseo `.xlsx` no confiable:**
   - `parsePlanWorkbookBuffer` rechaza binarios inválidos antes de instanciar `Worker`, corre dentro de `worker_threads` con `resourceLimits`, `env: {}` en JS compilado (en `tsx` dev pasa solo `TMPDIR/TEMP/TMP` + `TSX_DISABLE_CACHE`), timeout con `worker.terminate()` y lock global = 1 (`withPlanImportLock`). Ojo en tests: invocar siempre `await parsePlanWorkbookBuffer(...)` secuencialmente para archivos válidos o se dispara `409 PLAN_IMPORT_IN_PROGRESS`.
5. **Reconciliación `plan_special_rules` vs `src/utils/correlativas.ts`:**
   - Se detectó que `min_credits` no existe en `evaluateSpecialRule` ni en `src/types/career.ts`. Se prohibió en el importador hasta ser implementado y probado en el motor frontend.
6. **Preservación de vínculos cruzados en re-subidas `draft` sin exponer UUID/`stable_code` en Excel (Opción B):**
   - Mantener `stable_code` fuera de la planilla evita errores de edición humana; `previewPlanImport` consulta `listDraftCrossPlanSharedLinks(planId)` y preselecciona la decisión existente salvo cambio explícito del admin.
7. **Matching de `shared_subjects` compatible con filas legadas de `seed.ts`:**
   - Como `seed.ts` persistió nombres compartidos sin convertir romanos (ej. `"analisis matematico i"`), `findSharedSubjectSuggestions` trae las filas de `shared_subjects` de la misma `facultyId` y clasifica en TS contra `sh.displayName || sh.normalizedName` usando `classifySharedSubjectMatch`. Así matchea `"Análisis Matemático I"` (DB) con `"Análisis Matemático 1"` (plan nuevo) sin mutar datos previos.
8. **Nota sobre corrida paralela de tests en Windows:**
   - En un encadenamiento previo inmediatamente tras `npm test`, `authVerification.test.ts` arrojó un único error transitorio `fetch failed / ECONNRESET` sobre socket local HTTP; re-ejecutando `npm --prefix server test` y `npm test` de forma limpia pasaron **`482/0`** y **`15/15` archivos en verde** sin modificar código.
9. **Observación en `test/multicarreraEngine.test.ts` (API real de `evaluatePlanProgress`):**
   - `evaluatePlanProgress` requiere `{ plan, userState, settings, examAttempts }` (`examAttempts` obligatorio) y usa `'regularizada'` (no `'regular'`).

---

## 5. Restricciones y Reglas del Código

- **Control de cambios y Git:**
  - Trabajar sobre `etapa2`; **no** ejecutar `git push` sin autorización ni tocar Neon o Cloudflare R2 reales.
  - Flujo obligatorio por tramo: presentar plan corto antes de codear y esperar aprobación -> 1 commit por bloque lógico -> correr tests + builds reales después de la última edición -> frenar al terminar el tramo.
- **Integridad de tests y oráculo:**
  - **Prohibido relajar aserciones existentes.** Los `25` escenarios del oráculo ISI Plan 2023 en `test/plan2023Oracle.test.ts` quedan congelados como invariante.
- **Reglas estrictas de migraciones SQL:**
  - Solo aditivas e idempotentes (`IF NOT EXISTS`, `WHERE ... IS NULL`, `ON CONFLICT DO NOTHING`).
  - Toda migración de datos de catálogo usa el patrón CTE actualizando `catalog_versions` (`id = 'default'`) **solo si cambió al menos una fila** (`WHERE EXISTS (SELECT 1 FROM upd)`).
  - Todo `"when"` nuevo en `server/drizzle/meta/_journal.json` debe ser estrictamente mayor al anterior (`0014` = `1793740000000`, próximo `0015` = `1793750000000`).
- **Regla de despliegue de `0015` (Tramo 2C):**
  - Siempre en **2 despliegues separados**: 1º subir código nuevo de `DrizzleUserStateStore` y confirmar `0` filas con `plan_id IS NULL` en `user_settings` y `schedule_selections` en Neon; recién en un 2º despliegue aplicar `0015` (`PRIMARY KEY ("user_id", "plan_id")` en `user_settings`).
- **Aislamiento `server/` y builds limpios:**
  - **Cero** importaciones desde `server/src/` o `server/scripts/` hacia fuera de `server/` (únicamente `server/tools/generateSeedData.ts` lee `../../test/fixtures/`, excluido de `server/tsconfig.json`). Verificar siempre con `git grep` que Render (`NODE_ENV=production npm install && npm run build`) compile por sí solo.
- **Neutralidad multi-carrera y UI:**
  - Prohibido meter datos reales de ISI o Ingeniería Industrial en plantillas descargables, textos neutros o tests genéricos de importación.
  - Prohibido inyectar prefijos automáticos `E-`/`X-` fuera de ISI Plan 2023 (`display_code` explícito manda).
  - **No refactorizar `CorrelativeGraph.tsx` en Etapa 2:** la vista de detalle de plan en admin (Tramo 2B) usa un componente de solo lectura tipo tabla/árbol por nivel.
- **Seguridad y auditoría en importación de planes:**
  - `GET /api/admin/plans/template` registrado estrictamente **antes** de `GET /api/admin/plans/:id`.
  - Confirmación de `/import` siempre desde `.xlsx` crudo + validación `previewHash` en servidor (nunca aceptar JSON pre-parseado desde el navegador).
  - `/preview` nunca escribe en BD ni dispara transacciones; `admin_audit_log` guarda solo hashes y conteos resumidos (nunca el binario `.xlsx`).
  - Nunca autovincular `shared_subjects` nuevos.
- **Semántica de ciclo de vida de planes (Tramo 2D):**
  - `draft -> published`: requiere >= 1 materia, reglas válidas y `shared_subjects` sin huérfanos en el plan.
  - `published -> draft` (despublicar): permitido **solo si `0` usuarios tienen ese `selected_plan_id`**.
  - `published -> archived`: permitido con usuarios activos; oculto para registro/selector de nuevos usuarios, pero sigue sirviéndose en catálogo/estado para quienes ya lo tienen seleccionado.
- **Shell del proyecto (Windows):** PowerShell no acepta `&&`; encadenar comandos condicionales con `; if ($LASTEXITCODE -eq 0) { ... }`.

---

## 6. Plan de Acción Inmediato (Próximos Pasos)

### Paso 0: Setup rápido en la nueva computadora
1. Verificar rama activa `etapa2` (`git checkout etapa2` y confirmar último commit `dddf65a` + presencia de `server/vendor/xlsx-0.20.3.tgz`).
2. Instalar dependencias en **ambas** carpetas (`npm install` en raíz y `npm --prefix server install` en `server/`) y configurar `.env` en `server/` si se va a conectar a una rama temporal de Neon.
3. Línea base de partida verificada tras `dddf65a`:
   - `npm test` -> `15 / 15` archivos en verde
   - `npm --prefix server test` -> `482` pasaron, `0` fallaron (`reviews 92`, `authVerification 59`, `admin 37`, `library 149`, `multicarreraIsolation 28`, `catalogConfigAndSecurity 63`, `planImport 54`)
   - `npm run build` (`2604` módulos) y `npm --prefix server run build` -> exit `0`.

### Paso 1 (INMEDIATO al retomar — esperar confirmación del usuario)
Antes de escribir código nuevo ni empezar Tramo 2B, pedir/confirmar al usuario dos resoluciones pendientes:
1. **Resultado de su verificación independiente del SHA-256 de `server/vendor/xlsx-0.20.3.tgz`** (`8DC73FC3B00203E72D176E85B50938627C7B086E607C682E8D3C22C02BB99FE8`, ítem **h)** pendiente del dueño).
2. **Aprobación de la propuesta mínima para habilitar casos `(i)` y `(ii)` de título intermedio en `correlativas.ts` + plantilla** (necesarios antes de importar Ingeniería Industrial UTN FRC):
   - Extender `PlanIntermediateDegree` (`src/types/career.ts`) y `NormalizedIntermediateDegree` (`server/src/modules/catalog/planConfig.helpers.ts`) con `requiredSubjectCodes?: number[]` y/o `requiredSubjectRange?: { fromCode: number; toCode: number; excludeCodes?: number[] }`.
   - Actualizar `checkAnalistaTitle` (`src/utils/correlativas.ts`) para evaluar esos requisitos directamente contra `userState` **sin exigir `specialRuleSubjectCode` ni fila en `plan_special_rules`**, y actualizar `planText.ts` (`getIntermediateDegreeMilestoneDesc`, `getIntermediateDegreeRangeLabel`, `getIntermediateDegreeRangeProgressText`) para mostrar el total real en lugar de `0 / 0`.
   - Agregar la columna opcional correspondiente en la hoja `Plan` (`planImport.rules.ts`, `planImport.template.ts`, `planImport.worker.ts`) manteniendo **100% intacto** el comportamiento actual y los `25` tests del oráculo ISI 2023.
   - *(Opcionalmente definir junto al dueño si `isPPSEligible` debe además validar reglas especiales sobre la materia referenciada cuando aplique.)*

### Paso 2: Implementar extensión de título intermedio `(i)/(ii)` (si el usuario la aprueba)
- Aplicar el cambio acotado en `src/types/career.ts`, `src/utils/correlativas.ts`, `src/utils/planText.ts`, `server/src/modules/catalog/planConfig.helpers.ts` e importador/plantilla Excel; sumar tests en `test/multicarreraEngine.test.ts`, `test/planText.test.ts` y `server/test/planImport.test.ts`; verificar que `test/plan2023Oracle.test.ts` (`25/25`) sigue intacto.

### Paso 3: Ejecutar **Tramo 2B** (Frontend `"Carreras"` en `/#admin`) — *pedir OK de plan corto antes de codear*
- Crear `src/components/admin/tabs/AdminCareersTab.tsx` + integrar pestaña `"Carreras"` en `src/components/admin/AdminDashboard.tsx` y métodos en `src/api/admin.api.ts`.
- Flujo UI: descarga plantilla `.xlsx`, carga de archivo para `POST /api/admin/plans/preview`, render de errores/avisos, diff de borrador (`toCreate`/`toUpdate`/`toRemove`/`blockedRemoval`), resolución explícita de `shared_subjects` distinguiendo `exact`/`high` vs `similar`/`low` y vínculos cruzados preseleccionados en re-subidas (sin autovincular nuevos), confirmación modal con ticket de reautenticación reciente (`POST /api/admin/plans/import` y `DELETE /api/admin/plans/:id`), y componente nuevo de **solo lectura en formato tabla/árbol por nivel** para inspeccionar correlativas/reglas/acrónimos sin modificar `CorrelativeGraph.tsx`.
- Añadir cobertura frontend y ampliar `test/apiContract.test.ts`. Frenar al cierre de Tramo 2B.

### Paso 4: Ejecutar **Tramo 2C** (Multi-plan real en `DrizzleUserStateStore` + migración `0015`)
- Presentar plan corto antes de codear.
- Actualizar `DrizzleUserStateStore` (`server/src/modules/user-state/userState.store.ts` y `userState.helpers.ts`) para leer/escribir filas separadas por `(user_id, plan_id)` y `(user_id, plan_id, schedule_term_id)` con `onConflictDoUpdate` y backfill desde `extraSettings.perPlan` / `selectionsByPlan`.
- Agregar tests de integración contra PostgreSQL real en rama temporal de Neon.
- Preparar `server/drizzle/0015_*.sql` (`when: 1793750000000`, `ALTER TABLE user_settings` PK compuesta `(user_id, plan_id)` y ajuste de índice en `schedule_selections`) **respetando estrictamente la secuencia de 2 despliegues** posterior a verificar `0` filas con `plan_id IS NULL`. Frenar al cierre de Tramo 2C.

### Paso 5: Ejecutar **Tramo 2D** (Bloqueantes Admin `a–d`, ciclo de vida y `docs/api-multicarrera.md`)
- Resolver los 4 bloqueantes de `docs/plan-multicarrera.md` §7.4 (`(a)` colas de moderación con carrera+plan, `(b)` `planId`/UUID explícito en creación/vínculo de docentes, `(c)` desacoples de `AdminScheduleTab`, `(d)` alcance explícito por facultad de períodos horarios).
- Implementar endpoints/UI de ciclo de vida (`publish`, `unpublish` con bloqueo si hay usuarios con `selected_plan_id`, `archive` preservando acceso a usuarios ya enrolados).
- Documentar API multi-carrera en `docs/api-multicarrera.md`.

### Paso 6: Cierre y verificación en rama Neon temporal (previo a producción)
- Ensayar `db:migrate` (`0014` y `0015`) y probar `DrizzlePlanImportStore` (preview + import + re-upload + delete) en rama temporal de Neon antes de habilitar/cargar **Ingeniería Industrial UTN FRC** vía `/#admin`.
