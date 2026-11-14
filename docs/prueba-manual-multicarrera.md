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

### Por qué funciona sin Brevo, Resend, Google ni R2 reales
- En `server/src/config/env.ts`, cuando `NODE_ENV=development`, las variables `BREVO_API_KEY`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_BUCKET` **son opcionales**.
- La **Biblioteca** usa automáticamente el simulador en memoria **`MemoryMockR2Service`**, sin conectarse a Cloudflare R2.
- Para cuentas de prueba registradas localmente con email y contraseña (ya que no habrá envío real de mails): verificá el usuario desde terminal sin tocar Brevo/Resend:
  ```bash
  npm --prefix server run verify-user -- --email tu-usuario-de-prueba@ejemplo.com
  ```
- Si querés probar vistas de administrador (`/#admin`):
  ```bash
  npm --prefix server run make-admin -- --email tu-usuario-de-prueba@ejemplo.com
  ```

---

## 3. Aplicar migraciones `0008` y `0009` en la rama temporal y levantar el backend
En la raíz del repo (`correlativas/`):

```bash
npm --prefix server run build
npm --prefix server run db:migrate
npm --prefix server run dev
```

Verificaciones rápidas antes de abrir el navegador (por ejemplo con `curl` o en otra pestaña del navegador):
1. `GET http://localhost:4000/api/health` -> debe responder `200 OK`.
2. `GET http://localhost:4000/api/catalog/plans/current` -> confirmá en el JSON:
   - `data.plan.config.ppsRequirement` vale `{"referenceSubjectCode":36}`
   - **No existe** el campo `ppsSubjectCode` en `data.plan.config`
   - `data.subjects` contiene las `60` materias (`37` obligatorias + `23` electivas) con `shortName` y `kind`
   - `data.rules` contiene las reglas `99` (`approved_range` 1..23) y `36` (`all_previous_core_approved` excluyendo track `analista`)
3. `GET http://localhost:4000/api/catalog/version` -> debe devolver `{"success":true,"version":"..."}`.

---

## 4. Levantar el frontend local contra `http://localhost:4000`
En producción, `vercel.json` redirige `/api/:path*` al backend. En desarrollo local con Vite (`http://localhost:5173`), `src/api/client.ts` hace fetch relativo a `/api/...`, por lo que `vite.config.ts` necesita el proxy hacia `http://localhost:4000`.

- En **PARTE 1B-2** ese proxy queda configurado de forma permanente en `vite.config.ts`.
- Si corrés esta prueba antes de aplicar 1B-2, podés agregar temporalmente en `vite.config.ts` (y revertirlo con `git checkout -- vite.config.ts` al terminar):

```ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
```

Luego en otra terminal (raíz del repo):

```bash
npm run dev
```

Abrí **`http://localhost:5173`** en el navegador, registrate o iniciá sesión con un usuario de prueba verificado (paso 2) y ejecutá el checklist de comparación.

---

## 5. Checklist de comparación en navegador (Sistemas Plan 2023 vs Producción)

Compará lado a lado (o pestaña a pestaña) con la versión actual en producción:

1. **Mapa de Correlativas (`CorrelativeGraph`) y Vista Lista (`SubjectListView`):**
   - Deben verse **5 columnas** (`1° Año` a `5° Año`) y exactamente **36 materias obligatorias** con Analista desactivado.
   - Activá el interruptor **Analista (99)**: debe aparecer **Seminario Integrador (99)** en **3° Año** (total **37** obligatorias) y actualizarse inmediatamente el avance y camino crítico.
2. **Cajón de Detalle (`SubjectDrawer`):**
   - Abrí **`99` (Seminario Integrador)**: debe mostrar la tarjeta especial verificando materias **1 a 23 aprobadas**.
   - Abrí **`36` (Proyecto Final)**: debe validar todas las obligatorias previas aprobadas; con Analista **OFF** no debe exigir la `99`, y con Analista **ON** sí debe exigirla.
3. **Electivas (`ElectivesPicker`):**
   - Deben listarse las **23 electivas** agrupadas por nivel sugerido, meta de **20 créditos totales** (**4 créditos** para Analista) y bloqueo de duplicados entre años.
4. **Tablero Kanban (`KanbanBoard`) y Planificador (`SemesterPlanner`):**
   - Comprobá filtros por nivel/estado, drag & drop y armado de canasta cuatrimestral con conteo de horas semanales y materias desbloqueadas.
5. **Estadísticas (`StatsDashboard`):**
   - Con *Incluir electivas en progreso* activo: denominador equivalente **`43`** (`36 + 7`) con Analista OFF, y **`44`** (`37 + 7`) con Analista ON.
   - Verificá que la tarjeta **"Habilitación PPS"** aparece visible y responde al cumplimiento de correlativas de la materia **`36`** (bloqueada inicialmente, habilitada cuando se cumplen las regulares `[25, 26, 30]` y aprobadas `[12, 20, 23]`).
   - Con Analista ON: debe verse el seguimiento de **Analista Universitario** (`23` materias + `99` aprobada + `4` cr. de electivas).
   - Confirmá el cálculo del **Camino Crítico**.
6. **Armador de Horarios, Profesores y Biblioteca:**
   - **Armador (`ScheduleBuilder` / `ScheduleWeeklyGrid`):** grilla semanal con nombres cortos, detección de conflictos y sugeridor de combinaciones sin choques.
   - **Profesores (`ProfessorsDirectory`):** listado de docentes y reseñas funcionando normalmente.
   - **Biblioteca (`LibraryHome` / `SubjectLibraryView`):** listado de materias/archivos y flujo de subida usando el simulador en memoria (`MemoryMockR2Service`, sin errores de R2).
7. **DevTools -> `Application` -> `Local Storage` (`http://localhost:5173`):**
   - Verificá que exista la clave `mi_carrera_catalog_cache_v1:<planId>` conteniendo `"schema": 2` y `"version"`.
   - Verificá que las claves de progreso locales se guarden bajo `mi_carrera_*::plan:<planId>`.
   - Si cargaste claves legadas previas (`mi_carrera_user_state_v1`, etc.) antes de iniciar, comprobá que `migrateLegacyLocalStorageToPlan` las copió a `::plan:<planId>` **sin borrar las claves originales**.

---

## 6. Limpieza al terminar
1. Borrá o revertí cualquier cambio temporal en `vite.config.ts` (`git checkout -- vite.config.ts`).
2. Eliminá la rama temporal creada en la consola de Neon.
3. Si querés, borrá `server/.env` local (o verificá con `git status` que no haya secretos sin ignorar).
