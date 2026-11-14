# Guía de Prueba Manual Local Multi-Carrera (Rama Temporal de Neon)

Esta guía te permite levantar **backend + frontend en tu máquina** apuntando a una **rama temporal de Neon**, sin tocar producción, sin credenciales reales de Brevo/Resend, Google OAuth ni Cloudflare R2, y comparar el comportamiento de **Ing. en Sistemas de Información (Plan 2023)** contra lo que hoy está en producción.

---

## 1. Crear una rama temporal en Neon
1. Ingresá a la consola de **Neon** (o usá la Neon CLI) y creá una rama temporal desde tu base actual (por ejemplo, `test-multicarrera-1b`).
2. Copiá las dos cadenas de conexión **de esa rama temporal** (nunca de `main` / producción):
   - **Pooled connection string** (`-pooler`) -> para `DATABASE_URL`
   - **Direct connection string** (sin `-pooler`) -> para `DIRECT_URL`

> **Seguridad:** no commitees `server/.env` ni compartas contraseñas o cadenas reales en chats o repositorios.

---

## 2. Configurar `server/.env` con valores locales ficticios
Creá o actualizá `server/.env` (ignorado por Git) con estos valores:

```env
NODE_ENV=development
PORT=4000
CLIENT_ORIGIN=http://localhost:5173

# Cadena pooled y directa DE TU RAMA TEMPORAL DE NEON
DATABASE_URL=postgresql://usuario:clave@ep-rama-temporal-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
DIRECT_URL=postgresql://usuario:clave@ep-rama-temporal.us-east-2.aws.neon.tech/neondb?sslmode=require

# Secretos ficticios de desarrollo (>= 16 caracteres)
JWT_SECRET=dev_local_jwt_secret_key_minimo_16_chars
REFRESH_SECRET=dev_local_refresh_secret_minimo_16_chars
VERIFICATION_CODE_PEPPER=dev_local_pepper_secret_minimo_16_chars
CONTACT_EMAIL=contacto@stack.local
```

### Por qué funciona sin Brevo, Resend, Google ni R2 reales — y qué pasa con ramas de Neon que contienen usuarios reales

> [!CAUTION]
> **NO configures credenciales reales ni copies tu `.env` de producción en `server/.env`.**
> - **NO definas** `EMAIL_PROVIDER`, `BREVO_API_KEY`, `RESEND_API_KEY` ni `ADMIN_NOTIFICATION_EMAIL`.
> - **NO definas** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` ni `R2_BUCKET`.
> - Si `server/.env` incluyera por error `EMAIL_PROVIDER` + `BREVO_API_KEY`/`RESEND_API_KEY`, las tareas de arranque de `server/src/app.ts` enviarían correos reales a usuarios y administradores presentes en la rama temporal de Neon. Si incluyera `R2_*`, las limpiezas o subidas operarían sobre tu bucket real.

Con `NODE_ENV=development` y las variables opcionales **omitidas** (tal como figuran en el bloque anterior):
1. **Envío de correos totalmente desactivado en red (`MailerService` — `server/src/modules/mailer/mailer.service.ts`):**
   - `initAdapter()` solo instancia `ResendAdapter` o `BrevoAdapter` cuando se configuran `EMAIL_PROVIDER` y su API key; al omitirlas deja `this.adapter = null`.
   - En ese estado y con `NODE_ENV !== 'production'`, tanto `sendVerificationCode()` como `sendEmail()` imprimen el mensaje localmente en consola (`📧 [DEV EMAIL CONSOLE] ...`) y retornan `{ success: true, provider: 'dev-console' }` sin realizar ninguna llamada HTTP externa ni enviar mails reales a los usuarios copiados en la rama de Neon.
2. **Almacenamiento en memoria (`getR2Service()` — `server/src/services/r2.service.ts`):**
   - Sin credenciales `R2_*`, la Biblioteca utiliza automáticamente **`MemoryMockR2Service`**, sin conectarse a Cloudflare R2.
3. **Qué tareas de arranque SÍ corren contra la rama temporal de Neon (`server/src/app.ts`, líneas 190–225):**
   - Al ejecutar `npm --prefix server run dev`, `app.ts` lanza en segundo plano: `runMigrations()`, `AuthService.cleanupUnverifiedAccounts(7)`, `libraryService.cleanupAbandonedUploads()` (repetidas cada `12h`), `getAdminNotificationRecipients()`, `processPendingAdminNotifications({ force: true })` y `processPendingUploaderNotifications({ force: true })`.
   - Todo impacto en base de datos ocurre **exclusivamente dentro de tu rama temporal de Neon** (nunca en `main`), y con el mailer simulado en `dev-console` (`result.success === true`), `processPendingAdminNotifications` y `processPendingUploaderNotifications` solo imprimirán en tu terminal local y marcarán esos avisos como notificados (`markAdminNotified` / `markUploaderNotified`) dentro de dicha rama descartable.
4. **Cuentas de prueba locales (sin envío real de mails):**
   - Verificá usuarios de prueba desde terminal sin tocar Brevo/Resend:
     ```bash
     npm --prefix server run verify-user -- --email tu-usuario-de-prueba@ejemplo.com
     ```
   - Si querés probar vistas de administrador (`/#admin`):
     ```bash
     npm --prefix server run make-admin -- --email tu-usuario-de-prueba@ejemplo.com
     ```

---

## 3. Verificación anti-producción, migraciones (`0008`–`0013`) y arranque del backend

> [!CAUTION]
> **PASO OBLIGATORIO ANTES DE EJECUTAR MIGRACIONES O LEVANTAR EL BACKEND:**
> 1. Compará manualmente el **host** de `DATABASE_URL` y `DIRECT_URL` en `server/.env` contra el host de tu base de **producción** en Neon (ej. verificá que el endpoint `ep-...` pertenece a la rama temporal y **NO** al endpoint de `main`).
> 2. **Si el host coincide con producción o tenés cualquier duda, ABORTÁ de inmediato** y regenerá `server/.env` con la cadena de tu rama temporal.
> 3. Confirmá además que `server/.env` no copia secretos ni variables de producción (`EMAIL_PROVIDER`, `BREVO_API_KEY`, `RESEND_API_KEY`, `R2_*`, `NODE_ENV=production`).
> 4. **Nunca pegues los archivos `.sql` a mano en el ensayo:** correr SQL manualmente deja el estado de tablas/datos inconsistente respecto del registro interno `drizzle.__drizzle_migrations`, oculta errores del migrador y **vuelve inválido el ensayo**.

### Verificación estricta de migración en una sola corrida + segunda corrida no-op

Trabajando **siempre sobre una copia limpia de producción en la rama temporal de Neon**:

1. **Antes de migrar**, anotá la línea base exacta ejecutando en SQL sobre la rama temporal:
   ```sql
   SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id;
   SELECT version, updated_at FROM catalog_versions WHERE id = 'default';
   ```
   En una copia limpia de producción deben existir **`8` filas** (`0000` a `0007`), con la última fila en `created_at = 1793670000000`. Anotá también la `version` inicial del catálogo (si ya existiera la fila `'default'`).
2. Compilá y corré **ÚNICAMENTE** `db:migrate` (1ª corrida):
   ```bash
   npm --prefix server run build
   npm --prefix server run db:migrate
   ```
3. **Después de la 1ª corrida**, verificá en SQL:
   - `SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id;` -> debe tener **`14` filas** (última fila en `1793730000000`, `0008` a `0013` aplicadas en una sola corrida).
   - `SELECT version, updated_at FROM catalog_versions WHERE id = 'default';` -> la versión del catálogo **cambió** respecto del paso 1. Anotá ese valor exacto (`v_1`).
4. Volvé a correr `npm --prefix server run db:migrate` una **2ª vez** y re-consultá ambas tablas:
   - `drizzle.__drizzle_migrations` sigue teniendo **`14` filas** (sin cambios).
   - `catalog_versions` sigue teniendo exactamente la misma `version` (`v_1`) y `updated_at` (no-op idempotente).
5. Recién entonces levantá el backend local:
   ```bash
   npm --prefix server run dev
   ```

Verificaciones rápidas antes de abrir el navegador (por ejemplo con `curl` o en otra pestaña del navegador):
1. `GET http://localhost:4000/api/health` -> debe responder `200 OK`.
2. `GET http://localhost:4000/api/catalog/plans/current` -> confirmá en el JSON:
   - `data.plan.config.ppsRequirement` vale `{"referenceSubjectCode":36,"label":"Habilitación PPS","description":"Cumplís los requisitos para cursar la Práctica Profesional"}` y `data.plan.config.finalDegreeTitle` vale `"Ingeniero/a"`
   - `data.plan.config.intermediateDegrees[0]` actualizado por la migración `0013` contiene `name: "Analista Universitario de Sistemas de Información"`, `shortLabel: "Analista"` y `shortTitle: "Analista Universitario"`
   - **No existe** el campo `ppsSubjectCode` en `data.plan.config`
   - `data.subjects` contiene las `60` materias (`37` obligatorias + `23` electivas) con `code` en formato fixture (`"1".."36"`, `"99"`, `"E-301"`, `"X-408"`...), `shortName` actualizado por la migración `0010` en las 28 materias alineadas, `"isIntegrator": true` en las 5 integradoras (`16`, `23`, `30`, `36`, `99`), y `"specialRule"` exacto en `99` y `36` (`"Para RENDIRLO ..."`, ausente en el resto)
   - `data.rules` contiene las reglas `99` (`approved_range` 1..23) y `36` (`all_previous_core_approved` excluyendo track `analista`) con las descripciones exactas actualizadas por la migración `0012`
3. `GET http://localhost:4000/api/catalog/version` -> debe devolver `{"success":true,"version":"..."}`.

---

## 4. Levantar el frontend local contra `http://localhost:4000`
En producción, `vercel.json` redirige `/api/:path*` al backend. En desarrollo local (`http://localhost:5173`), `src/api/client.ts` hace fetch relativo a `/api/...`, y el proxy de desarrollo (`/api` -> `http://localhost:4000`) **ya está configurado de forma permanente en `vite.config.ts`** (solo aplica a `vite` / `npm run dev`, sin alterar `npm run build`).

En otra terminal (raíz del repo):

```bash
npm run dev
```

Abrí **`http://localhost:5173`** en el navegador, registrate o iniciá sesión con tu **cuenta de prueba local verificada** (paso 2) y ejecutá el checklist de comparación.

---

## 5. Checklist de comparación en navegador (Sistemas Plan 2023 vs Producción)

### Preparación para comparar progreso de forma segura
- En el entorno local (`http://localhost:5173`), creá y verificá una **cuenta de prueba local** nueva (nunca alteres ni dependas de modificar tu progreso real de producción en una rama descartable, salvo lectura comparativa).
- Repetí en la cuenta local las mismas acciones/escenarios clave en paralelo con tu cuenta real de producción:
  - Cargá ~`10` materias en estados variados (`aprobada` con nota, `promocionada`, `regularizada`, `cursando`, `libre`).
  - Asigná electivas en distintos años y verificá créditos totales y bloqueo de duplicados.
  - Alterná **Analista (99)** `ON` / `OFF` y confirmá que el avance, denominadores, habilitación PPS y camino crítico coinciden exactamente con producción.
- Ejecutá el checklist tanto en **escritorio (desktop)** como en **mobile** (modo dispositivo de DevTools / viewport angosto).

Compará lado a lado (o pestaña a pestaña) con la versión actual en producción:

1. **Mapa de Correlativas (`CorrelativeGraph`) y Vista Lista (`SubjectListView`):**
   - Deben verse **5 columnas** (`1° Año` a `5° Año`) y exactamente **36 materias obligatorias** con Analista desactivado.
   - Activá el interruptor **Analista (99)**: debe aparecer **Seminario Integrador (99)** en **3° Año** (total **37** obligatorias) y actualizarse inmediatamente el avance y camino crítico.
   - Verificá que **el ícono `INT` violeta de las 5 materias integradoras (`16`, `23`, `99`, `30`, `36`) se ve igual que en producción**.
   - Comprobá en badges, nodos, drawer, buscador y listas que los códigos muestran **`#1`, `#2`, ..., `#36`, `#99`, `#E-301`, `#X-408`** (y **NO** `#Análisis Matemático 1` ni el nombre completo de la materia).
2. **Cajón de Detalle (`SubjectDrawer`) y Modal Rápido (`QuickStatusModal`):**
   - Con **Analista ON**, abrí `SubjectDrawer` de **`99` (Seminario Integrador)**: debe mostrar la tarjeta violeta **Regla Especial de Aprobación** con `"Para RENDIRLO hay que tener aprobadas todas las materias de 1 a 23."` en la misma posición y diseño que producción.
   - Abrí `SubjectDrawer` de **`36` (Proyecto Final)**: con Analista **OFF** debe mostrar `"(1 a 35 + Electivas)"` y contar 35 previas; con Analista **ON** debe mostrar `"(1 a 35 + Seminario 99 + Electivas)"` y contar 36 previas (badge verde cuando todas estén aprobadas o rojo con el conteo faltante).
   - Abrí `QuickStatusModal` de **`36` (Proyecto Final)** (y de **`99`** con Analista ON): verificá que el aviso `★ Para RENDIRLO ...` aparece en el bloque de requisitos igual que en producción en texto y ubicación.
3. **Electivas (`ElectivesPicker`):**
   - Deben listarse las **23 electivas** agrupadas por nivel sugerido, meta de **20 créditos totales** (**4 créditos** para Analista) y bloqueo de duplicados entre años.
4. **Tablero Kanban (`KanbanBoard`) y Planificador (`SemesterPlanner`):**
   - Comprobá filtros por nivel/estado, drag & drop y armado de canasta cuatrimestral con conteo de horas semanales y materias desbloqueadas.
5. **Estadísticas (`StatsDashboard`):**
   - Con *Incluir electivas en progreso* activo: denominador equivalente **`43`** (`36 + 7`) con Analista OFF, y **`44`** (`37 + 7`) con Analista ON.
   - Verificá que la tarjeta **"Habilitación PPS"** aparece visible y responde al cumplimiento de correlativas de la materia **`36`** (bloqueada inicialmente, habilitada cuando se cumplen las regulares `[25, 26, 30]` y aprobadas `[12, 20, 23]`).
   - Con Analista ON: debe verse el seguimiento de **Analista Universitario** (`23` materias + `99` aprobada + `4` cr. de electivas). El encabezado de la tarjeta de requisitos muestra **`"Título Intermedio: Analista Universitario de Sistemas de Información"`** (única diferencia visible intencional respecto de producción, donde decía `"Título Intermedio: Analista Universitario de Sistemas"`).
   - Confirmá el cálculo del **Camino Crítico**.
6. **Armador de Horarios, Exportación `.ics`, Profesores y Biblioteca:**
   - **Armador (`ScheduleBuilder` / `ScheduleWeeklyGrid`):** seleccioná comisiones sin conflictos ni duplicados y verificá que las etiquetas cortas de la grilla semanal coinciden exactamente con producción en las `41` materias con oferta (`schedule.json` + migración `0010`), detección de conflictos y sugeridor de combinaciones sin choques.
   - **Exportación `.ics` y Portapapeles (`ScheduleSummaryPanel`):** ejecutá **Exportar calendario (`.ics`)** (descarga `horarios-utn-YYYY-MM-DD.ics` con `PRODID:-//Stack//Armador de Horarios//ES` y UIDs `@micarrera.utn`) y **Copiar resumen** (encabezado `📅 MI HORARIO DE CURSADA — UTN ISI (Plan 2023)`).
   - **Profesores (`ProfessorsDirectory`):** al filtrar por materia (troncal y electiva como `301`/`E-301`, tanto en desktop como en mobile), devuelve docentes/reseñas correspondientes sin fallar por formato de código.
   - **Biblioteca (`LibraryHome` / `SubjectLibraryView`):** listado de materias/archivos (`1° Año`..`5° Año` + `Electivas`) y flujo de subida usando el simulador en memoria (`MemoryMockR2Service`, sin errores de R2).
7. **Demo `"3er año"` y Tutorial completo (`Navbar`, `OnboardingModal`, `TutorialTour`):**
   - **Demo `"3er año"`:** desde el botón demo en `Navbar` u `OnboardingModal`, cargá el perfil demo de 3er año y comprobá que marca exactamente las materias previas, electivas y progreso esperado de Sistemas (mismos estados, notas y fechas que `getSample3rdYearStudent`).
   - **Tutorial completo:** ejecutá el tutorial de punta a punta en **escritorio (`17` pasos, incluyendo `schedule-builder`, `electives-tour` y `analista-switch`)** y en **celular/mobile (`16` pasos, omitiendo el paso de vista `schedule`)**, avanzando, retrocediendo y saltando pasos para verificar contador (`1 / 17`, `16 / 16`), textos y destacado de elementos sin errores.
8. **DevTools -> `Application` -> `Local Storage` (`http://localhost:5173`):**
   - **Nota sobre aislamiento por origen:** el `localStorage` de `http://localhost:5173` y el de producción son completamente distintos e independientes entre sí (aislados por origen en el navegador); probar en local no lee ni modifica el `localStorage` de producción.
   - Verificá que exista la clave `mi_carrera_catalog_cache_v1:<planId>` conteniendo `"schema": 6` y `"version"`.
   - Verificá que las claves de progreso locales se guarden bajo `mi_carrera_*::plan:<planId>`.
   - Si cargaste claves legadas previas (`mi_carrera_user_state_v1`, etc.) antes de iniciar, comprobá que `migrateLegacyLocalStorageToPlan` las copió a `::plan:<planId>` **sin borrar las claves originales** (o que el modal pide confirmación cuando falta `STORAGE_KEY_LEGACY_PLAN_ID`).

---

## 6. Limpieza obligatoria al terminar
1. **Eliminá `server/.env` local** al finalizar la prueba y confirmá con `git status` que no quedan archivos de entorno ni secretos locales sin ignorar.
2. **Eliminá la rama temporal en la consola de Neon** (`test-multicarrera-...`).
