# Plan de Deploy — Etapa 1 (Multi-Carrera / Catálogo Dinámico)

> **Alcance:** Despliegue de la rama `multicarrera` (Etapa 1 completa, migraciones `0008`–`0013` y guarda runtime de migraciones). **Sin** cambios de Etapa 2 (panel de administración).
> **Estado de referencia:** Producción actual en `master` (`bbbf257`) corre migración hasta `0007` (`1793670000000`). En este entorno local **no** se ejecuta el deploy ni comandos contra producción o Neon real.

---

## 1. Configuración actual de deploy (`render.yaml` y `vercel.json`)

| Servicio | Archivo en repo | Configuración observada en repo | Qué **NO** se puede verificar desde el repo (revisar en panel) |
|---|---|---|---|
| **Backend API (`mi-carrera-api`)** | `render.yaml` | `runtime: node`, `rootDir: server`, `plan: free`<br>`buildCommand: npm install && npm run build && npm run db:migrate`<br>`startCommand: npm run start` (`node dist/app.js`)<br>`healthCheckPath: /api/health` | Rama activa en el servicio, si **Auto-Deploy** está encendido, si la UI pisa comandos del Blueprint, valores reales de secretos/env vars y si existen instancias/deploys previos para rollback instantáneo. |
| **Frontend SPA (Vercel)** | `vercel.json` + `package.json` | Build raíz: `npm run build` (`tsc -b && vite build`).<br>`headers`: COOP `same-origin-allow-popups`.<br>`rewrites`: `/api/:path*` -> `https://corre-lbhv.onrender.com/api/:path*` y `/(.*)` -> `/index.html`. | **Production Branch**, estado de **Auto-Deploy** (*Automatic Production Deployments* / *Ignored Build Step*), Root Directory en Dashboard, valores reales de env vars e historial de *Deployments* para *Instant Rollback*. |

### Por qué NO deben auto-desplegarse en paralelo al pushear a `master`

Si Render y Vercel siguen ambos a `master` con auto-deploy activo:
1. Un `push` directo de `multicarrera` a `master` dispara **ambos deploys a la vez**.
2. Vercel termina en segundos; Render tarda más (`npm install && npm run build && npm run db:migrate` en Neon + arranque de `node dist/app.js`).
3. Durante esa ventana queda **frontend nuevo (`multicarrera`) contra backend viejo (`master`)**: `isValidPlanCatalogShape()` (`src/api/catalog.api.ts`) rechaza el payload de `master` (sin `career`, `plan.config.totalLevels`, `plan.config.levelLabel` ni `subjects[].shortName`), dispara `CatalogShapeError` (`"El servidor está desactualizado: el catálogo recibido está incompleto."`) y bloquea la app en `"No pudimos cargar tu plan de estudio"` con botón `"Reintentar"`.
4. A la inversa (**backend nuevo de Etapa 1 contra frontend viejo `master`**), el sistema sigue operativo sin errores bloqueantes.

**Regla de oro:** desplegar y verificar **Backend + DB primero**, y **recién después** desplegar el Frontend en Vercel.

---

## 2. Verificaciones limpias y hallazgos previos al deploy

### 2.1 Simulaciones de build limpio y arranque en frío (entornos aislados)
Antes de preparar el deploy se verificaron en clones temporales fuera del repositorio (sin compartir `node_modules`):
- **Vercel (clon aislado de `multicarrera`, sin `server/node_modules`):** `npm ci` + `npm run build` (`tsc -b && vite build`) terminan con código `0`.
- **Render (clon aislado de `multicarrera/server`, sin `node_modules` en raíz):** `npm install` con `NODE_ENV=production` omite `devDependencies` (`tsx`, `drizzle-kit`) e instala `typescript` y `@types/*` (`dependencies`), `npm run build` (`tsc`) termina con código `0`, y el arranque en frío `node dist/app.js` con `NODE_ENV=production` y credenciales ficticias carga módulos y configuración sin `ERR_MODULE_NOT_FOUND` (escucha Express y solo falla la conexión TCP hacia Postgres `ECONNREFUSED`).
- **Aislamiento de `server/`:** ningún archivo dentro de `server/src/` ni `server/scripts/` importa módulos fuera de `server/`. Las únicas referencias hacia afuera están en `server/tools/generateSeedData.ts` (`../../test/fixtures/*.js`, excluido de `server/tsconfig.json`) y rutas opcionales de CLI (`../../../data-source` en `mergeProfessors.ts` / `migrateProfessors.ts`).

### 2.2 Verificación en rama temporal `"Backend Primero"` (`deploy/backend-etapa1`)
- Se probó localmente una rama temporal creada desde `master` aplicando únicamente la carpeta `server/` de `multicarrera` (`git checkout multicarrera -- server`), sin tocar código ni dependencias del frontend de `master`:
  - `server/package.json`, `server/tsconfig.json`, `server/drizzle/*`, `server/src/**`, `server/seed-data/*` y `server/test/**` son autocontenidos para compilar, migrar, testear y ejecutar en Render (`npm --prefix server run build` exit `0`, `npm --prefix server test` `406` pasaron / `0` fallaron, y `npm run build` del frontend `master` exit `0`).
  - Lo único dentro de `server/` que depende de archivos fuera de `server/` no incluidos en esa rama es `server/tools/generateSeedData.ts` (requiere `test/fixtures/`, no ejecutado por Render ni tests).

### 2.3 Auditoría de `users.selected_plan_id IS NULL`
- La migración `0008_multicarrera_and_shared_subjects.sql` ejecuta un backfill inicial sobre `users` donde `selected_plan_id IS NULL`.
- No obstante, en el código actual de `auth.service.ts` (Google Caso B, `verifyEmail`, `refreshToken` con `selectedPlanId: null` en `liveUser`), `library.controller.ts` / `library.service.ts` (`listSubjectsWithCounts(null)` / `listFiles`), `reviews.store.ts` (`resolvePlanContext` con fallback por `isActive = true`) e `InMemoryUserStateStore`, todavía existen caminos que no normalizan un `NULL` en memoria al plan publicado por defecto.
- **Acción operativa en DB:** al finalizar Fase 2 (post-migración en Neon), verificar que `SELECT count(*) FROM users WHERE selected_plan_id IS NULL;` devuelva `0`. Si por alguna razón quedara alguna fila en `NULL` (por ejemplo, usuarios creados mientras corría código previo o un flujo parcial), es seguro re-ejecutar manualmente el `UPDATE` idempotente de `0008`.

---

## 3. Auditoría de variables de entorno (`master..HEAD`)

Verificado sobre `git diff master..multicarrera` en `server/src/config/env.ts` y `src/`: **no se agregaron variables de entorno nuevas** en Etapa 1 (el único cambio en `server/src/config/env.ts` evita `dotenv.config()` cuando `NODE_ENV === 'test'`).

### Backend (Render — revisar **nombres** en *Environment*, valores reales no visibles en repo)
- **Base de datos Neon:**
  - `DATABASE_URL` *(requerida, conexión pooled Neon para runtime).*
  - `DIRECT_URL` *(fuertemente recomendada: `server/src/db/migrate.ts` prioriza `process.env.DIRECT_URL || process.env.DATABASE_URL`; en Neon el DDL de migraciones debe usar conexión directa sin pooler PgBouncer).*
- **Auth, CORS y correo (obligatorias si `NODE_ENV=production`; `env.ts` aborta con `exit 1` si falta alguna):**
  - `NODE_ENV` *(debe valer `production`)*
  - `CLIENT_ORIGIN` *(URL exacta del frontend en Vercel, p. ej. `https://corre-ten.vercel.app`)*
  - `JWT_SECRET`, `REFRESH_SECRET`, `VERIFICATION_CODE_PEPPER` *(mínimo 16 caracteres)*
  - `GOOGLE_CLIENT_ID`
  - `EMAIL_PROVIDER` (`resend` o `brevo`) + `RESEND_API_KEY` o `BREVO_API_KEY`
- **Cloudflare R2 / Biblioteca (obligatorias si `NODE_ENV=production`):**
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- **Opcionales con default:** `PORT`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `CONTACT_EMAIL`, `ADMIN_NOTIFICATION_EMAIL`, `LIBRARY_MAX_PENDING_UPLOADS`, `LIBRARY_UPLOAD_INIT_RATE_LIMIT_MAX`, `LIBRARY_UPLOAD_INIT_RATE_LIMIT_WINDOW_MS`, `LIBRARY_UPLOADING_EXPIRATION_MINUTES`, `LIBRARY_ADMIN_NOTIFY_COOLDOWN_SECONDS`, `LIBRARY_MAX_REJECTIONS_THRESHOLD`, `LIBRARY_REJECTIONS_WINDOW_DAYS`.

### Frontend (Vercel — revisar **nombres** en *Environment Variables*)
- `VITE_GOOGLE_CLIENT_ID` *(requerida para login con Google)*
- `VITE_CONTACT_EMAIL` *(opcional, fallback `stackacademicapp@gmail.com` en `src/config/brand.ts`)*

---

## 4. Checklist de consola (Render y Vercel) antes de desplegar

> **Importante:** nada de esta tabla puede inspeccionarse desde el repositorio git; confirmarlo manualmente en los paneles web antes de hacer `git push`.

### En Render (`mi-carrera-api`)
- [ ] **Branch / Deploy source:** anotar qué rama sigue el servicio (habitualmente `master`).
- [ ] **Auto-Deploy:** verificar si está en *On Commit* o *Manual*.
- [ ] **Root Directory:** confirmar `server` (coincidente con `render.yaml`).
- [ ] **Build Command:** confirmar `npm install && npm run build && npm run db:migrate`.
- [ ] **Start Command:** confirmar `npm run start` (`node dist/app.js`).
- [ ] **Health Check Path:** confirmar `/api/health`.
- [ ] **Environment Variables:** verificar presencia de todas las variables de la Sección 3 (`DATABASE_URL`, `DIRECT_URL`, `NODE_ENV=production`, `CLIENT_ORIGIN`, secrets, `GOOGLE_CLIENT_ID`, correo y `R2_*`).
- [ ] **Rollback plan conocido:** tener ubicado el botón de *Redeploy* / deploy previo exitoso en la pestaña *Events / Deploys* de Render.

### En Vercel (Frontend)
- [ ] **Production Branch:** confirmar qué rama dispara producción (habitualmente `master`).
- [ ] **Auto-Deploy / Ignored Build Step:** saber cómo pausarlo temporalmente si se va a pushear a `master` antes de terminar el deploy del backend.
- [ ] **Root Directory & Build Command:** confirmar raíz `.` y `npm run build`.
- [ ] **Environment Variables:** confirmar `VITE_GOOGLE_CLIENT_ID` (y `VITE_CONTACT_EMAIL` si se definió).
- [ ] **Rollback plan conocido:** tener ubicado *Deployments -> `...` -> Instant Rollback* sobre el último deploy estable de `master`.

---

## 5. Estrategia principal recomendada: "Backend Primero"

La estrategia verificada para eliminar la ventana de incompatibilidad (`CatalogShapeError` en Vercel) consiste en desplegar primero **únicamente `server/`** mediante una rama temporal desde `master` (por ejemplo `deploy/backend-etapa1`, creada con `git checkout -b deploy/backend-etapa1 master && git checkout multicarrera -- server`).

### Fase 0 — Snapshot en Neon *(requiere consola Neon)*
1. En **Neon**, crear una rama de respaldo desde producción antes de migrar (ej. `backup-pre-etapa1-YYYYMMDD`).
2. En el **SQL Editor** de Neon (lectura), confirmar el punto de partida exacto en `0007`:
   ```sql
   SELECT id, hash, created_at
   FROM drizzle.__drizzle_migrations
   ORDER BY id ASC;
   ```
   Esperado antes de desplegar: **8 filas** (`id` `1`..`8`, terminando en `created_at = 1793670000000`).

### Fase 1 — Llevar solo el Backend a Render *(según configuración del panel)*

Elegir **una** de las dos variantes según cómo quieras manejar Render/Vercel:

#### Variante A (sin tocar Vercel): apuntar Render temporalmente a `deploy/backend-etapa1`
1. Pushear `deploy/backend-etapa1` al remoto (cuando el usuario apruebe el `git push`). **Vercel ni se entera** porque `master` no cambia.
2. En el dashboard de Render (*Settings -> Branch*), cambiar temporalmente la rama del servicio a `deploy/backend-etapa1` y disparar **Manual Deploy -> Deploy latest commit** (si no se disparó solo).
3. Seguir con **Fase 2** y **Fase 3**. Al final, antes de desplegar Vercel o inmediatamente tras hacer merge a `master`, volver a poner Render apuntando a `master` y borrar `deploy/backend-etapa1`.

#### Variante B (manteniendo Render siempre en `master`): pausar Vercel primero
1. En Vercel (*Settings -> Git*), pausar los deploys de producción (por ejemplo activando temporalmente un *Ignored Build Step* que salga con `exit 0` o desconectando temporalmente el deploy automático).
2. Hacer `fast-forward` / merge de `deploy/backend-etapa1` en `master` y pushear `master`. Esto dispara **solo Render** mientras Vercel sigue sirviendo el frontend viejo `master`.
3. Seguir con **Fase 2**. Recién cuando Fase 2 pase 100%, reactivar Vercel y pushear `multicarrera` completo a `master` (**Fase 3**).

### Fase 2 — Logs de Render y Verificación Post-Deploy Backend *(antes de actualizar Vercel)*

1. **En Render Build Log** confirmar:
   - `npm install && npm run build && npm run db:migrate`
   - `🔄 Ejecutando migraciones de base de datos con DIRECT_URL...`
   - `✅ Migraciones aplicadas y verificadas exitosamente en Neon.`
   - Si apareciera `⚠️ Diferencia de hash para migración ya aplicada [...]`: es una advertencia no bloqueante (`console.warn`, p. ej. por fin de línea previo) y **no** detiene el build.
   - Si apareciera `❌ db:migrate abortado:` o `❌ Error al ejecutar o verificar las migraciones:`: el deploy falló con `process.exit(1)` **sin reemplazar la instancia viva**; **no avanzar** a Vercel hasta resolverlo.
2. **En Render Runtime Log** confirmar arranque sin `❌ ERROR al verificar/aplicar migraciones al iniciar el servidor`.
3. **Verificaciones HTTP públicas (`curl`):**
   ```bash
   curl -fsS https://corre-lbhv.onrender.com/api/health
   curl -fsS https://corre-lbhv.onrender.com/api/catalog/version
   curl -fsS https://corre-lbhv.onrender.com/api/catalog/plans/current
   curl -fsS https://corre-lbhv.onrender.com/api/catalog/careers
   ```
   Esperado:
   - `/api/health`: HTTP `200`, `{"status":"ok","environment":"production","timestamp":"..."}`.
   - `/api/catalog/version`: HTTP `200` y nueva `version` generada por el bump condicional de `0009`–`0013`.
   - `/api/catalog/plans/current`: `career` (`code: "ISI"`, `facultyName`, `institutionName`), `plan.config.totalLevels === 5`, `levelLabel === "Año"`, `finalDegreeTitle`, `ppsRequirement.referenceSubjectCode === 36`, `intermediateDegrees[0].name === "Analista Universitario de Sistemas de Información"` (`shortLabel: "Analista"`, `shortTitle: "Analista Universitario"`), **ausencia total de `ppsSubjectCode`**, `60` materias con `shortName`, `kind`, `code`, `5` integradoras (`isIntegrator: true` en `16, 23, 30, 36, 99`) y `specialRule` en `36` y `99`.
   - `/api/catalog/careers`: `ISI` Plan 2023 publicado, sin `draft` y sin `ppsSubjectCode`.
4. **Verificaciones privilegiadas en Neon SQL Editor *(usuario)*:**
   ```sql
   SELECT id, hash, created_at
   FROM drizzle.__drizzle_migrations
   ORDER BY id ASC;
   -- Esperado: 14 filas (0000..0013), terminando en created_at = 1793730000000

   SELECT status, count(*) FROM study_plans GROUP BY status;
   SELECT count(*) AS integradoras FROM subjects WHERE is_integrator = true;
   SELECT code_in_plan, description FROM plan_special_rules psr
     JOIN subjects s ON s.id = psr.subject_id WHERE s.code_in_plan IN (36, 99);
   SELECT version, updated_at FROM catalog_versions;
   SELECT count(*) AS users_sin_plan FROM users WHERE selected_plan_id IS NULL;
   ```
   - Si `users_sin_plan > 0` (caso anómalo post-deploy), ejecutar manualmente el `UPDATE` idempotente de `0008` (solo rellena `NULL`, no pisa planes ya elegidos):
     ```sql
     UPDATE "users" u
     SET "selected_plan_id" = (
       SELECT sp."id"
       FROM "study_plans" sp
       JOIN "careers" c ON c."id" = sp."career_id"
       WHERE sp."status" = 'published' OR sp."is_active" = true
       ORDER BY (c."code" = 'ISI' AND sp."year" = 2023) DESC, sp."is_active" DESC, sp."created_at" ASC
       LIMIT 1
     )
     WHERE u."selected_plan_id" IS NULL
       AND EXISTS (
         SELECT 1 FROM "study_plans" sp2 WHERE sp2."status" = 'published' OR sp2."is_active" = true
       );
     ```
5. *(Opcional)* Probar la app ya productiva en `https://corre-ten.vercel.app` (todavía con frontend `master`) verificando login, mapa, horarios y guardado de progreso contra el backend nuevo.

### Fase 3 — Deploy del Frontend en Vercel y Smoke Final
1. Llevar `multicarrera` a `master` (merge fast-forward o regular) y pushear a `master`.
   - Si se usó **Variante A**: volver a configurar Render en rama `master` para que quede alineado y eliminar la rama temporal `deploy/backend-etapa1`.
   - Si se usó **Variante B**: rehabilitar primero Auto-Deploy / quitar *Ignored Build Step* en Vercel antes de pushear `multicarrera` a `master` (o disparar **Redeploy** manual en Vercel tras pushear).
2. Confirmar en Vercel que `tsc -b && vite build` finaliza con éxito y que `https://corre-ten.vercel.app/api/health` responde `200`.
3. Smoke funcional en navegador (`https://corre-ten.vercel.app`):
   - El mapa carga desde `/api/catalog/plans/current` (sin pantalla de error ni fallback) y muestra los `5` badges violeta `"int"`.
   - `StatsDashboard` muestra `"Título Intermedio: Analista Universitario de Sistemas de Información"` y `"Habilitación PPS"`.
   - `ScheduleBuilder` / `ScheduleWeeklyGrid`, `ProfessorsDirectory` y `Library` muestran nombres/códigos cortos correctos y guardan cambios (`PUT /api/progress/:subjectId` o `PUT /api/settings`) sin errores.

---

## 6. Alternativa: "Desplegar todo junto" (merge directo de `multicarrera` a `master`)

Consiste en mergear `multicarrera` a `master` de una sola vez sin rama intermedia de solo backend.

- **Cuándo sirve:** solo si Vercel tiene Auto-Deploy pausado de antemano (en cuyo caso equivale a desplegar Render primero desde `master` y luego liberar Vercel) o si se acepta explícitamente una ventana breve de indisponibilidad visual del frontend.
- **Riesgos concretos frente a "Backend Primero":**
  1. **Ventana rota para usuarios:** si ambos servicios tienen Auto-Deploy en `master`, Vercel publica el frontend nuevo en segundos mientras Render sigue ejecutando `npm install`, `tsc`, `0008`–`0013` y reiniciando Node. Durante ese lapso todo visitante recibe `CatalogShapeError` (`"El servidor está desactualizado: el catálogo recibido está incompleto."`).
  2. **Mayor impacto ante fallo de migración:** si `db:migrate` aborta en Render (`exit 1`), Render mantiene el backend viejo de `master`, pero Vercel **ya quedó adelantado** en `multicarrera`, obligando a un *Instant Rollback* inmediato en Vercel.
  3. **Diagnóstico menos aislado:** mezcla cambios de frontend y backend en un mismo corte cuando el problema se deba al orden de despliegue o a un endpoint nuevo.

---

## 7. Plan de Rollback (por servicio y base de datos)

### Caso 1 — Falla durante build/migraciones en Render (`db:migrate` sale con código `1`)
- Render **no reemplaza** el servicio vivo de producción.
- Si se usó `"Backend Primero"`, Vercel sigue en `master` sin impacto para usuarios. Si se desplegó Vercel por error, ejecutar *Instant Rollback* en Vercel al deploy previo de `master`.
- Si una migración dejara estado inconsistente fuera de transacción, restaurar Neon desde `backup-pre-etapa1-YYYYMMDD`.

### Caso 2 — Necesidad de revertir código después de haber migrado la DB (`0008`–`0013` aplicadas)
De acuerdo con el análisis de compatibilidad retroactiva (`master` vs `0008`–`0013`):
- **Orden obligatorio de rollback de código:**
  1. **Vercel primero:** en Vercel (*Deployments -> `...` -> Instant Rollback / Promote*), promover el último deployment de `master` (si Vercel ya había subido Etapa 1).
  2. **Render después:** en Render (*Events / Deploys*), re-desplegar el commit/deploy previo de `master` (o revertir la rama configurada a `master` previo).
  - *Por qué Vercel primero:* mientras Vercel esté en `multicarrera` y Render retroceda a `master`, `isValidPlanCatalogShape()` bloquea la UI con `"El servidor está desactualizado..."`. Al volver Vercel primero a `master`, frontend `master` + backend `master` conviven sin fallos SQL sobre la DB ya migrada (`0008`–`0013`).
- **Salvedades operativas tras un rollback de código sobre DB migrada:**
  1. Altas de carreras o planes desde admin bajo `master` quedarían con `status = 'draft'` (habrá que publicarlas al volver a subir Etapa 1).
  2. Archivos subidos a Biblioteca mientras corre `master` quedarán con `shared_subject_id`, `source_subject_id` y `source_plan_id` en `NULL` (requieren backfill al volver a Etapa 1 si se publican otros planes).
  3. Si mientras corrió Etapa 1 algún usuario usó un segundo plan publicado, `master` pisará `schedule_selections.selections` sin actualizar `selections_by_plan` y listará `schedule_proposals` sin filtrar por `plan_id`.
- **Rollback de base de datos (Neon Branch/Restore):** únicamente si hubiera corrupción de datos posterior al corte; revertir ambos servicios a `master` y restaurar desde `backup-pre-etapa1-YYYYMMDD` *(implica perder cambios de usuarios posteriores al deploy)*.
