# Plan de Deploy — Etapa 1 (Multi-Carrera / Catálogo Dinámico)

> **Alcance:** Despliegue de la rama `multicarrera` (Etapa 1 completa, migraciones `0008`–`0013`, guarda runtime de migraciones y fallbacks de `selected_plan_id`). **Sin** cambios de Etapa 2 (panel de administración).
> **Estado de referencia:** Producción actual en `master` (`bbbf257`) corre migración hasta `0007` (`1793670000000`). En este entorno local **no** se ejecuta `git push` ni comandos contra producción o Neon real.

---

## 1. Configuración de deploy (`render.yaml`, `vercel.json` y paneles confirmados)

| Servicio | Archivo en repo | Configuración en repo y confirmada en panel | Qué revisar igual en panel |
|---|---|---|---|
| **Backend API (`mi-carrera-api`)** | `render.yaml` | **Rama activa confirmada:** `master`, **Auto-Deploy** encendido.<br>`runtime: node`, `rootDir: server`, `plan: free`<br>`buildCommand: npm install && npm run build && npm run db:migrate`<br>`startCommand: npm run start` (`node dist/app.js`)<br>`healthCheckPath: /api/health` | Si existen *Build Filters* / detección automática por `rootDir: server`, valores reales de env vars/secretos, consumo mensual de horas Free y deploys previos para rollback. |
| **Frontend SPA (Vercel)** | `vercel.json` + `package.json` | **Production Branch confirmada:** `master`, repositorio conectado con deploy automático al pushear a `master`.<br>Build raíz: `npm run build` (`tsc -b && vite build`).<br>`headers`: COOP `same-origin-allow-popups`.<br>`rewrites`: `/api/:path*` -> `https://corre-lbhv.onrender.com/api/:path*` y `/(.*)` -> `/index.html`. | Valores reales de env vars (`VITE_GOOGLE_CLIENT_ID`, `VITE_CONTACT_EMAIL`) e historial de *Deployments* para *Instant Rollback*. |

### Por qué NO hacer un solo push directo de `multicarrera` a `master`

Con Render y Vercel ambos siguiendo `master` con Auto-Deploy activo:
1. Un `push` directo de `multicarrera` a `master` dispara **ambos deploys en paralelo**.
2. Vercel publica el frontend en segundos; Render tarda más (`npm install && npm run build && npm run db:migrate` en Neon + arranque de `node dist/app.js`).
3. Durante esa ventana queda **frontend nuevo (`multicarrera`) contra backend viejo (`master`)**: `isValidPlanCatalogShape()` (`src/api/catalog.api.ts`) rechaza el payload de `master` (sin `career`, `plan.config.totalLevels`, `plan.config.levelLabel` ni `subjects[].shortName`), dispara `CatalogShapeError` (`"El servidor está desactualizado: el catálogo recibido está incompleto."`) y bloquea la app en `"No pudimos cargar tu plan de estudio"` con botón `"Reintentar"`.
4. A la inversa (**backend nuevo de Etapa 1 contra frontend viejo `master`**), la app sigue operativa sin errores bloqueantes.

**Regla de oro:** desplegar y verificar **Backend + DB primero**, y **recién después** llevar el Frontend nuevo a `master`.

---

## 2. Verificaciones limpias y correcciones previas al deploy

### 2.1 Simulaciones de build limpio y arranque en frío (entornos aislados)
Verificado en clones temporales fuera del repositorio (sin compartir `node_modules`):
- **Vercel (clon aislado de `multicarrera`, sin `server/node_modules`):** `npm ci` + `npm run build` (`tsc -b && vite build`) terminan con código `0`.
- **Render (clon aislado de `multicarrera/server`, sin `node_modules` en raíz):** `npm install` con `NODE_ENV=production` omite `devDependencies` (`tsx`, `drizzle-kit`) e instala `typescript` y `@types/*` (`dependencies`), `npm run build` (`tsc`) termina con código `0`, y el arranque en frío `node dist/app.js` con `NODE_ENV=production` y credenciales ficticias carga módulos y configuración sin `ERR_MODULE_NOT_FOUND`.
- **Aislamiento de `server/`:** ningún archivo dentro de `server/src/` ni `server/scripts/` importa módulos fuera de `server/`. Las únicas referencias hacia afuera están en `server/tools/generateSeedData.ts` (`../../test/fixtures/*.js`, excluido de `server/tsconfig.json`) y rutas opcionales de CLI (`../../../data-source` en `mergeProfessors.ts` / `migrateProfessors.ts`).

### 2.2 Verificación en rama puente `"Backend Primero"` (`deploy/backend-etapa1`)
- La rama local `deploy/backend-etapa1` se regenera desde `master` copiando únicamente la carpeta `server/` de `multicarrera` (`git checkout multicarrera -- server`), dejando el frontend (`src/`, `index.html`, `package.json` raíz, `vercel.json`) exactamente igual a `master`.
- Así, `server/` compila, migra, pasa toda la suite de tests y corre de manera autocontenida en Render sin exponer cambios visuales en Vercel.

### 2.3 Resolución de `users.selected_plan_id IS NULL` y `/api/health`
- La migración `0008_multicarrera_and_shared_subjects.sql` realiza un backfill inicial para asignar un plan publicado a los usuarios con `selected_plan_id IS NULL`.
- Además, se corrigieron en código los caminos de fallback en memoria/runtime para usuarios cuyo `selected_plan_id` sea `null`, garantizando **siempre** elegir un plan publicado (`status = 'published'`, `is_active = true`, carrera publicada) y **nunca** un plan en borrador (`draft`):
  - `server/src/modules/auth/auth.service.ts`: `AuthService.googleAuth` (Caso B — cuenta verificada previa sin identidad Google), `AuthService.verifyEmail` (rama normal e idempotente ya verificada), `AuthService.refresh` (flujo principal preservando `liveUser.selectedPlanId` y ventana de gracia de 20s), más el helper `ensureUserSelectedPlanId` con invalidación de caché de estado (`invalidateUserStatusCache`).
  - `server/src/modules/reviews/reviews.store.ts`: `DrizzleReviewsStore.resolvePlanContext` usa `findDefaultPublishedPlan()` en lugar de `isActive = true LIMIT 1`; `InMemoryReviewsStore.resolvePlanContext` excluye explícitamente planes `draft` / `archived` / inactivos.
  - `server/src/modules/library/library.controller.ts`: `resolveLibraryPlanId` resuelve el plan publicado por defecto para usuarios no-admin con `selectedPlanId = null` (conservando alcance global `null` para admins en detalle/descarga).
  - `server/src/modules/user-state/userState.store.ts`: `InMemoryUserStateStore.resolveUserActivePlan` resuelve el plan publicado por defecto e ignora `draft` si el usuario tiene `null`.
- **`/api/health` (`server/src/app.ts`):** responde `200 OK` directamente en memoria sin consultar PostgreSQL/Neon.
- **Verificación operativa en DB post-migración:** igualmente se mantiene el control `SELECT count(*) FROM users WHERE selected_plan_id IS NULL;` al cierre de Fase 2 (verificando resultado `0`).

---

## 3. Auditoría de variables de entorno (`master..HEAD`)

Verificado en `server/src/config/env.ts`: **no se agregaron variables de entorno nuevas** en Etapa 1 (el único cambio en `env.ts` evita `dotenv.config()` cuando `NODE_ENV === 'test'`).

### Backend (Render — contrastado con las variables cargadas por el usuario)
Variables obligatorias/recomendadas requeridas por `env.ts` en `NODE_ENV=production`, todas **confirmadas por nombre** en Render:
- **Base de datos Neon:** `DATABASE_URL` (pooled runtime), `DIRECT_URL` (priorizada por `server/src/db/migrate.ts` para aplicar DDL sin pooler PgBouncer).
- **Auth, CORS y correo:** `NODE_ENV`, `CLIENT_ORIGIN`, `JWT_SECRET`, `REFRESH_SECRET`, `VERIFICATION_CODE_PEPPER`, `GOOGLE_CLIENT_ID`, `EMAIL_PROVIDER`, `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `CONTACT_EMAIL`.
- **Cloudflare R2 / Biblioteca:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- **Variable opcional ausente:** `ADMIN_NOTIFICATION_EMAIL` **no** está cargada y está confirmada como **opcional** en `env.ts` (`library.config.ts` / `app.ts`: si no hay admins verificados en DB ni `ADMIN_NOTIFICATION_EMAIL`, solo emite `console.warn` sin impedir el arranque ni las migraciones).
- *Nota:* Desde el repositorio no pueden leerse los **valores** cargados; asegurarse de que `JWT_SECRET`, `REFRESH_SECRET` y `VERIFICATION_CODE_PEPPER` mantengan longitud `>= 16`, `NODE_ENV=production` y `CLIENT_ORIGIN` coincida exactamente con el dominio de Vercel.

### Frontend (Vercel)
- `VITE_GOOGLE_CLIENT_ID` *(requerida para login con Google)*
- `VITE_CONTACT_EMAIL` *(opcional, fallback `stackacademicapp@gmail.com` en `src/config/brand.ts`)*

---

## 4. Checklist previo de consola antes del primer push

- [ ] **Neon:** creada la rama de respaldo `backup-pre-etapa1-YYYYMMDD` desde producción y verificadas las 8 migraciones actuales (`0000`–`0007`).
- [ ] **Render (`mi-carrera-api`):** confirmado Auto-Deploy activo en `master`, `Root Directory = server`, `Build Command = npm install && npm run build && npm run db:migrate`, `Start Command = npm run start`, `Health Check Path = /api/health`, y valores válidos en las variables de la Sección 3.
- [ ] **Vercel:** confirmada Production Branch en `master`, `Root Directory = .`, `Build Command = npm run build`, variables `VITE_*` presentes, e historial de último deploy estable ubicado para rollback.

---

## 5. Estrategia principal recomendada: Dos pushes a `master`

Con **Render** (`rootDir: server`) y **Vercel** (raíz `.`) ambos en auto-deploy sobre `master`, el despliegue limpio y ordenado se logra con **dos pushes sucesivos a `master`**, **sin pausar Vercel** ni cambiar ramas en Render:

1. **Push 1 (`deploy/backend-etapa1` -> `master`):** actualiza **únicamente `server/`** en `master`.
   - **Render** detecta el nuevo commit en `master`, compila el backend, corre migraciones `0008`–`0013` contra Neon y levanta Etapa 1 en API manteniendo vivo el contenedor viejo hasta pasar `/api/health`.
   - **Vercel** recibe el push en `master`, pero recompila el **mismo frontend viejo de `master`** (cero cambios en raíz/`src/`): es completamente inocuo, no introduce `CatalogShapeError` ni rompe usuarios en ningún segundo.
2. **Pausa obligatoria de verificación (Fase 2):** con Render ya corriendo backend Etapa 1 + Neon migrada, se verifican logs, endpoints HTTP y SQL.
3. **Push 2 (`multicarrera` -> `master`):** mergea el resto de `multicarrera` (frontend Etapa 1, docs, tests) sobre `master`.
   - **Vercel** compila y publica el frontend nuevo contra un backend que **ya está listo y verificado** en Etapa 1 -> cero ventana de `CatalogShapeError`.

### Fase 0 — Snapshot y línea base en Neon *(consola Neon)*
1. En **Neon**, crear rama de respaldo desde producción antes de migrar (ej. `backup-pre-etapa1-YYYYMMDD`).
2. En el **SQL Editor** de Neon, confirmar punto de partida en `0007`:
   ```sql
   SELECT id, hash, created_at
   FROM drizzle.__drizzle_migrations
   ORDER BY id ASC;
   -- Esperado antes de desplegar: 8 filas (id 1..8), terminando en created_at = 1793670000000
   ```

### Fase 1 — Push 1: Solo Backend a `master` *(PowerShell local)*

> Ejecutar recién cuando el workspace esté limpio y estés listo para desplegar el backend:

```powershell
# 1. Ir a master local (sin cambios pendientes) y avanzar solo server/ mediante fast-forward
git checkout master
git merge --ff-only deploy/backend-etapa1

# 2. Verificar antes de pushear que solo se tocó server/
git diff --stat bbbf257..HEAD

# 3. Push 1: dispara Render (backend + migraciones 0008..0013) y rebuild inocuo del frontend viejo en Vercel
git push origin master
```

Qué hace cada paso:
- `git merge --ff-only deploy/backend-etapa1`: avanza `master` linealmente con el commit de solo-`server/`. Falla con seguridad si `master` divergió.
- `git diff --stat bbbf257..HEAD`: confirma visualmente que ningún archivo del frontend (`src/`, `index.html`, raíz) entra en Push 1.
- `git push origin master`: dispara el deploy de producción en ambas plataformas manteniendo compatibilidad total (frontend `master` + backend Etapa 1).

### Fase 2 — Verificaciones obligatorias entre Push 1 y Push 2

**No ejecutar Push 2 hasta confirmar todos estos puntos:**

1. **En Render Build Log:**
   - Confirmar `npm install && npm run build && npm run db:migrate`.
   - Confirmar:
     - `🔄 Ejecutando migraciones de base de datos con DIRECT_URL...`
     - `✅ Migraciones aplicadas y verificadas exitosamente en Neon.`
   - Si apareciera `⚠️ Diferencia de hash para migración ya aplicada [...]`: advertencia no bloqueante (`console.warn`), no aborta.
   - Si apareciera `❌ db:migrate abortado:` o `❌ Error al ejecutar o verificar las migraciones:`: el build aborta (`exit 1`) **sin reemplazar la instancia viva**. Resolver antes de avanzar.
2. **En Render Runtime Log:** confirmar arranque limpio sin `❌ ERROR al verificar/aplicar migraciones al iniciar el servidor`.
3. **Verificaciones HTTP públicas (PowerShell `curl.exe`):**
   ```powershell
   curl.exe -fsS https://corre-lbhv.onrender.com/api/health
   curl.exe -fsS https://corre-lbhv.onrender.com/api/catalog/version
   curl.exe -fsS https://corre-lbhv.onrender.com/api/catalog/plans/current
   curl.exe -fsS https://corre-lbhv.onrender.com/api/catalog/careers
   ```
   Esperado:
   - `/api/health`: HTTP `200`, `{"status":"ok","environment":"production","timestamp":"..."}`.
   - `/api/catalog/version`: HTTP `200` y nueva `version` generada por el bump condicional de `0009`–`0013`.
   - `/api/catalog/plans/current`: `career` (`code: "ISI"`, `facultyName`, `institutionName`), `plan.config.totalLevels === 5`, `levelLabel === "Año"`, `finalDegreeTitle`, `ppsRequirement.referenceSubjectCode === 36`, `intermediateDegrees[0].name === "Analista Universitario de Sistemas de Información"` (`shortLabel: "Analista"`, `shortTitle: "Analista Universitario"`), **ausencia total de `ppsSubjectCode`**, `60` materias con `shortName`, `kind`, `code`, `5` integradoras (`isIntegrator: true` en `16, 23, 30, 36 y 99`) y `specialRule` en `36` y `99`.
   - `/api/catalog/careers`: `ISI` Plan 2023 publicado, sin `draft` y sin `ppsSubjectCode`.
4. **Verificaciones en Neon SQL Editor:**
   ```sql
   SELECT id, hash, created_at
   FROM drizzle.__drizzle_migrations
   ORDER BY id ASC;
   -- Esperado: 14 filas (0000..0013), terminando en created_at = 1793730000000

   SELECT status, count(*) FROM study_plans GROUP BY status;
   SELECT count(*) AS integradoras FROM subjects WHERE is_integrator = true;
   -- Esperado: 5 filas para ISI 2023 (códigos 16, 23, 30, 36 y 99)
   SELECT s.code_in_plan, psr.description FROM plan_special_rules psr
     JOIN subjects s ON s.id = psr.subject_id WHERE s.code_in_plan IN (36, 99);
   SELECT version, updated_at FROM catalog_versions;
   SELECT count(*) AS users_sin_plan FROM users WHERE selected_plan_id IS NULL;
   -- Esperado: 0
   ```
5. **Smoke opcional pre-Push 2:** abrir `https://corre-ten.vercel.app` (aún con frontend `master`) y comprobar que login, mapa y guardado de progreso funcionan contra el backend Etapa 1.

### Fase 3 — Push 2: Frontend + Docs + Tests a `master` y Smoke Final

Con Fase 2 verde al 100%, subir el resto de `multicarrera`:

```powershell
# 1. Mergear multicarrera en master (sin conflictos: server/ ya es idéntico a multicarrera)
git checkout master
git merge multicarrera

# 2. Confirmar que el árbol resultante de master coincide byte a byte con multicarrera
git diff --stat multicarrera

# 3. Push 2: dispara el build del frontend nuevo en Vercel contra el backend ya en Etapa 1
git push origin master

# 4. Limpieza opcional de la rama puente local una vez cerrado el deploy
git branch -d deploy/backend-etapa1
```

- **Qué hace Render en Push 2:** en el segundo push **no cambia ningún archivo dentro de `server/`**. Que Render omita el rebuild automáticamente o ejecute un rebuild redundante depende de la configuración de *Build Filters* / autodetección de *Root Directory* (`server`) en el panel web de Render (dato no visible desde el repositorio). En cualquier escenario es inocuo y sin downtime: `0008`–`0013` y la guarda runtime son idempotentes y Render mantiene el servicio activo hasta que `/api/health` responde `200`.
- **Verificación final en Vercel y navegador (`https://corre-ten.vercel.app`):**
  - Build `tsc -b && vite build` en verde y `https://corre-ten.vercel.app/api/health` devolviendo `200`.
  - Mapa carga desde `/api/catalog/plans/current` (sin fallback ni errores) y muestra los `5` badges `"int"` en `16, 23, 30, 36 y 99`.
  - `StatsDashboard` muestra `"Título Intermedio: Analista Universitario de Sistemas de Información"` y `"Habilitación PPS"`.
  - `ScheduleBuilder`, `ProfessorsDirectory` y `Library` muestran nombres/códigos cortos correctos y persisten cambios (`PUT /api/progress/:subjectId` o `PUT /api/settings`).

---

## 6. Alternativas descartadas (solo referencia)

1. **Pausar Vercel (*Ignored Build Step*) o cambiar temporalmente la rama de Render a `deploy/backend-etapa1`:** descartadas como flujo principal porque los **dos pushes a `master`** logran exactamente la misma secuencia segura sin tocar configuraciones de ramas ni hooks de auto-deploy en los paneles web.
2. **Merge directo de `multicarrera` a `master` en un solo push:** no recomendada porque Vercel despliega varios minutos antes que Render y abre la ventana de `CatalogShapeError` para cualquier usuario activo durante el build de backend.

---

## 7. Plan de Rollback

### Caso 1 — Falla durante Push 1 en Render (`db:migrate` termina con `exit 1`)
- Render **no reemplaza** el servicio vivo de producción; Vercel sigue en frontend `master`. No hay impacto para usuarios.
- No avanzar a Push 2; inspeccionar logs de Render y, solo si una sentencia previa dejara un estado inconsistente, restaurar Neon desde `backup-pre-etapa1-YYYYMMDD`.

### Caso 2 — Rollback necesario entre Push 1 y Push 2 (backend Etapa 1 vivo, frontend aún en `master`)
- Revertir `master` al deploy previo de backend (`master` pre-Push 1 en `bbbf257`) o hacer `Promote / Redeploy` del deploy previo en Render.
- Como frontend aún está en `master`, no hace falta rollback en Vercel. Si ya corrieron `0008`–`0013` en Neon, tener en cuenta las salvedades operativas del Caso 3.

### Caso 3 — Necesidad de revertir después de Push 2 con DB ya migrada (`0008`–`0013`)
- **Orden obligatorio (inverso al deploy):**
  1. **Vercel primero:** *Deployments -> `...` -> Instant Rollback* al último deploy estable de `master` pre-Etapa 1 (evita ventana de `CatalogShapeError`).
  2. **Render después (o `git revert` en `master`):** re-desplegar el build previo de `master` pre-Etapa 1.
- **Salvedades operativas tras volver a código `master` con `0008`–`0013` aplicadas en Neon:**
  1. Altas de carreras o planes desde admin bajo `master` quedarían con `status = 'draft'` (habrá que publicarlas al volver a subir Etapa 1).
  2. Archivos subidos a Biblioteca bajo `master` quedarían con `shared_subject_id`, `source_subject_id` y `source_plan_id` en `NULL` (requieren backfill al volver a Etapa 1 si se publican más planes).
  3. Si bajo Etapa 1 alguien usó un segundo plan publicado, `master` pisará `schedule_selections.selections` sin actualizar `selections_by_plan` y listará `schedule_proposals` sin filtrar por `plan_id`.
- **Rollback de DB (Neon):** únicamente ante corrupción de datos posterior al corte, revertir ambos servicios a `master` y restaurar `backup-pre-etapa1-YYYYMMDD` *(implica perder cambios de usuarios posteriores al deploy)*.

---

## 8. Que Render no se apague

Actualmente `render.yaml` define `plan: free` para `mi-carrera-api`. En el plan gratuito (*Free Web Service*) de Render ocurren dos restricciones operativas clave:

1. **Suspensión automática (*spin down*) tras 15 minutos sin tráfico HTTP:** cuando nadie envía requests durante 15 minutos, Render apaga el contenedor y el primer request siguiente sufre un *cold start* lento (decenas de segundos mientras re-arranca Node y la app responde).
2. **Tope de 750 horas gratuitas por mes compartidas en todo el workspace:** la cuota de 750 h/mes aplica al **conjunto** de servicios Web gratuitos del workspace (un mes tiene `720` h en 30 días o `744` h en 31 días). Un solo servicio encendido 24/7 consume prácticamente toda la cuota del mes (`720`–`744` de `750` h).

### Opción 1: Monitor externo haciendo ping cada 5–10 minutos a `/api/health`
Configurar un monitor externo gratuito (por ejemplo UptimeRobot, Better Stack o cron-job.org) con una petición `GET` cada **5 a 10 minutos** (por debajo del umbral de 15 min) hacia:

```text
https://corre-lbhv.onrender.com/api/health
```

- **Impacto nulo sobre Neon (confirmado en código):** `GET /api/health` (`server/src/app.ts`) responde `200 OK` en memoria **sin ejecutar ninguna query contra Postgres**. Por lo tanto, mantener despierto a Render con `/api/health` **no** mantiene activo ni consume cómputo de Neon (Neon puede seguir escalando a cero cuando no hay tráfico real de usuarios).

### Riesgos del keep-alive con plan Free
- **Cuota compartida del workspace:** si tenés **otro** Web Service gratuito corriendo en el mismo workspace de Render (aunque sea de otro proyecto o pruebas), entre ambos consumirán más de `750` h/mes y Render suspenderá los servicios gratuitos del workspace hasta el siguiente ciclo mensual.
- **Margen mínimo en meses largos:** en meses de `31` días (`744` horas), un servicio siempre despierto deja apenas `6` horas de margen respecto al tope de `750` h.
- **Sin SLA ni garantía contra reinicios:** un servicio Free puede reiniciarse por mantenimiento o quedar frenado si falla el monitor externo.

### Opción 2: Alternativa paga (plan más económico)
Si la aplicación requiere disponibilidad continua y respuestas inmediatas sin depender de pings externos ni competir por las 750 horas del workspace, migrar `mi-carrera-api` en Render al **plan pago más económico** (*Starter* / primer nivel pago), que mantiene la instancia siempre encendida sin *spin down* por inactividad ni límite mensual de 750 horas. *(No inferir precio desde documentación previa: verificar el valor actual directamente en Render).*

### Qué verificar manualmente en el panel de Render
Antes de activar un monitor externo o decidir el upgrade:
1. Ir en Render a **Billing / Workspace Usage (Free Instance Hours)** para ver cuántas de las `750` horas llevás consumidas en el mes y confirmar que **no** haya otros Web Services gratuitos activos en el mismo workspace consumiendo horas en paralelo.
2. Revisar la tabla vigente de **Pricing / Instance Types** de Render en el panel del servicio para confirmar el costo actualizado del plan pago más económico.
