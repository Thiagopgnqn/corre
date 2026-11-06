# ⚡ Stack — Tu carrera, materia a materia

Una aplicación web moderna, interactiva y fluida para el seguimiento académico integral: correlativas, horarios y reseñas de profesores. Diseñada con estética constellation/glassmorphism, animaciones fluidas, simulador hipotético "¿Y si...?", cálculo de camino crítico, armador de horarios con calificaciones docentes y panel de analítica.

---

## 🎨 Identidad Visual y Marca (Stack)

- **Nombre**: Stack
- **Lema**: *"Tu carrera, materia a materia"*
- **Descripción corta**: *"Seguí tu carrera, tus correlativas, tus horarios y las reseñas de profesores en un solo lugar."*
- **Paleta de Marca**:
  - **Índigo vibrante**: `#2A2E8A`
  - **Índigo profundo**: `#171A52`
  - **Ámbar de acento**: `#FFB938`
  - **Blanco azulado**: `#F4F5FB`
  - **Fondo base**: `#090D16`
- **Isotipo oficial**: "S" armada con bloques y barra superior ámbar, disponible en `public/brand/stack-logo.svg`.
- **Componente**: `<BrandLogo />` (`src/components/common/BrandLogo.tsx`) con variantes `symbol` y `full`, y tamaños configurables.
- **Regeneración de Recursos y Favicons**:
  Los recursos de favicons, íconos PWA, imagen Open Graph y webmanifest se encuentran commiteados en `public/` y pueden regenerarse a demanda con:
  ```bash
  npm run generate:brand
  ```
  *(El script `scripts/generateBrandAssets.mjs` utiliza `sharp` instalado únicamente en `devDependencies`).*
- **Aviso sobre URL canónica (`SITE_URL`)**:
  La URL canónica base está centralizada en `src/config/brand.ts` (`https://corre-ten.vercel.app`) y es referenciada en las etiquetas `og:image`, `og:url` y `twitter:image` de `index.html`. Si se cambia el dominio de producción, debe actualizarse dicha constante y las etiquetas correspondientes.
- **Aviso sobre el servicio en Render**:
  En `render.yaml` se mantiene intencionalmente `name: mi-carrera-api` para preservar el subdominio `mi-carrera-api.onrender.com`, evitando romper el rewrite y proxy configurado en Vercel.

---

## 🚀 Características Principales

1. **🗺️ Mapa de Correlativas Interactivo (Skill Tree / Constelación)**:
   - Visualización con `@xyflow/react` en columnas por año (1° a 5° año).
   - Aristas diferenciadas:
     - **Línea punteada ámbar**: requiere estar **Regularizada** (o superior).
     - **Línea sólida esmeralda**: requiere estar **Aprobada** (final o promoción).
   - **Enfoque dinámico**: al posar el mouse o seleccionar una materia, se iluminan sus correlativas previas y lo que desbloquea a futuro, atenuando el resto.
   - Panel lateral desplegable (*Drawer*) con detalle de horas, requisitos faltantes y qué desbloquea al aprobar o regularizar.
   - Toggle para incluir las **Materias Electivas** en el grafo con diseño dorado punteado, ubicadas automáticamente en la columna del **año asignado por el usuario** (1° a 5°).

2. **🎓 Título de Ingeniero & Créditos Globales de Electivas (Total 20 cr)**:
   - Para recibirse de Ingeniero/a se requieren **20 créditos de electivas en total**, sin mínimos obligatorios por nivel.
   - El nivel sugerido (3°, 4°, 5°) de cada electiva solo orienta la cursada, pero podés planificarlas y ubicarlas en cualquier año donde cumplas sus correlativas.
   - El total de 20 créditos es configurable en `src/data/electives.ts` (`REQUIRED_ELECTIVE_CREDITS_TOTAL`).
   - Contador visual interactivo: créditos aprobados, créditos en curso y créditos faltantes hacia la titulación.

3. **✨ Electivas Libres por Año (1° a 5° Año)**:
   - Cada año cuenta con su zona de electivas y botón **"+ Agregar electiva"** sin cupos rígidos por nivel.
   - Selector completo de la oferta de electivas (19 materias) agrupadas por nivel sugerido con diagnóstico en tiempo real de correlativas cumplidas o bloqueadas.
   - **Validación estricta de unicidad**: una electiva nunca puede estar asignada a dos años al mismo tiempo (al moverla o reasignarla se actualiza limpiamente).
   - Interruptor opcional: *"Permitir planificar electivas con correlativas aún bloqueadas"* (se agregan con aviso preventivo de requisitos pendientes).
   - Reorganización rápida entre años (selector directo o arrastrar y soltar) y eliminación con un click.
   - **Migración transparente**: si tenías datos del esquema anterior o marcaste electivas en tu historial, se migran automáticamente sin perder estados ni notas.

4. **⚡ Interruptor "Hacer Seminario Integrador / Título de Analista"**:
   - Selector visible en la barra de navegación y en el menú de ajustes (por defecto **DESACTIVADO** y sincronizado en la cuenta).
   - **Desactivado (Solo Ingeniero/a)**:
     - El Seminario Integrador (ID 99) desaparece del mapa, del tablero kanban, del planificador de cuatrimestres, del buscador y de todas las estadísticas.
     - Total de materias obligatorias ajustado a **36**.
     - No cuenta como materia pendiente, ni en el % de carrera por materias u horas, ni en el camino crítico.
     - Para rendir Proyecto Final (36) o habilitar PPS, **no se requiere** la materia 99.
     - Se ocultan el hito y el progreso hacia el título intermedio de Analista.
   - **Activado (Con Título Intermedio de Analista)**:
     - Reaparece el Seminario Integrador (99) con su regla especial (aprobadas materias 1 a 23 para rendirlo).
     - Se muestra el avance hacia el título de **Analista Universitario de Sistemas**: materias 1 a 23 aprobadas + Seminario 99 aprobado + al menos **4 créditos de electivas en total** (cualquier nivel).

5. **🧪 Modo Simulador "¿Y si...?"**:
   - Probá aprobar o regularizar materias hipotéticamente sin tocar tu historial guardado.
   - Observá en tiempo real cómo se iluminan y desbloquean las materias siguientes.
   - Botón para **"Guardar en mi plan"** o **"Reiniciar cambios"**.

6. **📋 Vista por Niveles & Tablero Kanban**:
   - Columnas por estado (*Pendiente/Disponible*, *Cursando*, *Regularizada*, *Aprobada/Promocionada*) con **arrastrar y soltar (Drag & Drop)**.
   - Filtros rápidos por año, cuatrimestre y búsqueda de materias.
   - Registro instantáneo de nota numérica al marcar como Aprobada o Promocionada.

7. **📅 Planificador Cuatrimestral**:
   - Agrupación por cuatrimestre y año académico.
   - Canasta de cursada con cálculo dinámico de horas semanales para no sobrecargar el cuatrimestre.
   - Cálculo del impacto en materias futuras habilitadas.

8. **📊 Estadísticas & Camino Crítico**:
   - Promedio general (con o sin aplazos, configurable).
   - Porcentaje de avance de la carrera en materias y en horas reloj.
   - **Algoritmo de Camino Crítico (Longest Path)**: identifica la secuencia exacta de materias que determina el tiempo mínimo restante para recibirte.
   - Proyección estimada de fecha de graduación según tu ritmo actual.

9. **🕒 Armador de Horarios con Puntuaciones Docentes**:
   - Integración de la oferta de comisiones y horarios oficiales con algoritmo de combinación libre de choques.
   - Promedios ponderados e insignias docentes visibles en cada comisión.
   - Exportación de la propuesta a calendario (.ics).

10. **⭐ Directorio y Reseñas de Profesores**:
    - Puntuación anónima de docentes basada en estrellas con filtro estricto de elegibilidad (solo quienes cursaron o aprobaron la materia pueden reseñar).
    - Promedio Bayesiano para prevenir distorsiones por volumen bajo de opiniones.
    - Moderación de reportes de contenido con panel administrativo.

---

## 🛡️ Panel de Administración (`/#admin`)

Stack cuenta con un panel de administración integrado y protegido para usuarios con rol `admin`. Se accede mediante el menú de usuario en la esquina superior derecha o directamente en la URL `/#admin` (el código del panel se carga bajo demanda con `React.lazy` para no impactar el tamaño inicial de la app).

### 1. Pilares de Seguridad y Privacidad
- **Verificación en Base de Datos en Tiempo Real**: Toda petición a `/api/admin/*` verifica el rol `admin` y el estado `active` directamente en la base de datos (con una caché local de 5 segundos para alto rendimiento). Si se revoca el rol a un usuario, el acceso al panel se pierde inmediatamente.
- **Reautenticación Reciente Obligatoria (10 Minutos)**: Las acciones sensibles (suspensión de cuentas, cambios de rol, eliminación definitiva de usuarios, retiro de comisiones con alumnos inscriptos e importaciones masivas) exigen reautenticarse:
  - Cuentas con contraseña: verificación segura con Argon2id (`@node-rs/argon2`).
  - Cuentas solo-Google: validación del token de Google asegurando que coincida con el `sub` vinculado a la cuenta.
  - El ticket viaja en una cookie `admin_reauth_token` de tipo `httpOnly`, tiene validez por 10 minutos y queda estrictamente atado a la sesión actual del administrador.
- **Protección contra Lockout y Último Admin**: Los cambios de rol y suspensiones se ejecutan dentro de una transacción con bloqueo de filas (`SELECT ... FOR UPDATE` sobre la tabla `users`) para evitar condiciones de carrera. El sistema impide que un administrador se auto-degrade o que se elimine/suspenda al último administrador activo del sistema. Para suspender o eliminar a otro administrador, debe ser degradado a usuario común primero.
- **Auditoría Inmutable (`admin_audit_log`)**: Cada acción administrativa sensible queda registrada en la tabla `admin_audit_log`. La tabla cuenta con un disparador (*trigger*) de PostgreSQL que rechaza de forma absoluta cualquier intento de modificación (`UPDATE`) o borrado (`DELETE`). Los detalles almacenados son recursivamente sanitizados: contraseñas, hashes, tokens y secretos nunca se guardan.
- **Privacidad Estricta del Estudiante**: La vista de detalle de usuario en el panel expone metadatos de cuenta y contadores generales de uso (cantidad de cursadas, reseñas y reportes), pero **nunca** muestra notas individuales, avance de materias ni historial académico de los alumnos.
- **Moderación Anónima**: La acción "Suspender al autor" oculta la reseña y suspende la cuenta infractora sin revelar la dirección de correo ni la identidad del autor al moderador.

### 2. Pestañas y Módulos
1. **Resumen y Métricas**: Métricas de usuarios (activos, suspendidos, nuevos registros), cursadas y reseñas con selector de rango (7d, 30d, 90d), gráficos diarios de actividad, alertas de calidad de catálogo y estado del servidor.
2. **Usuarios**: Listado paginado con búsqueda por email, filtros por rol, estado y verificación de correo. Permite verificación manual, reenvío de código, revocación de sesiones, suspensión/reactivación, cambio de rol, eliminación definitiva y exportación a CSV con neutralización contra inyección de fórmulas (`=`, `+`, `-`, `@`).
3. **Horarios y Catálogo**: Gestión de períodos académicos (ciclos vigentes, borradores y duplicación de períodos), alta y edición de comisiones con validación estricta de franjas horarias (inicio < fin, horarios entre 07:00 y 23:30), análisis de impacto antes de eliminar (recomendando retiro lógico `is_retired = true` si hay alumnos cursando) e importación masiva de JSON con verificación de hash SHA-256.
4. **Docentes y Reseñas**: Cola de moderación con reportes abiertos y reseñas ocultas, acción de suspensión de autor, detección algorítmica de duplicados docentes y asistente de fusión/unificación.
5. **Auditoría**: Visor paginado del registro inmutable de auditoría con filtros por acción y administrador, y modal para inspeccionar el payload JSON sanitizado.

### 3. Asignación de Rol Administrador (CLI)
Para promover una cuenta existente a administrador desde la terminal del servidor:
```bash
npm --prefix server run make-admin -- --email tu-correo@ejemplo.com
```

---

## 🔒 Sistema de Cuentas, Privacidad y Verificación

- **Autenticación con Google**: Integración oficial vía Google Identity Services (GIS) en popup frontend y verificación con `google-auth-library` en backend.
- **Verificación obligatoria de email (6 dígitos)**: Códigos temporales con HMAC-SHA256 y expiración a los 10 minutos.
- **Protección centralizada**: `requireVerifiedEmail` bloquea cualquier endpoint de datos (`/api/reviews`, `/api/professors`, `/api/basket`, etc.) si la cuenta no ha sido verificada.
- **Mails con identidad Stack**: Despacho a través de API HTTP oficial de Resend o Brevo sin depender de puertos SMTP salientes.

---

## 🔑 Configuración de Google Login y Proveedor de Email

### 1. Configuración de Google Identity Services (Google Cloud Console)
1. Ingresá a [Google Cloud Console](https://console.cloud.google.com/) y seleccioná o creá un proyecto para **Stack**.
2. En **APIs y servicios > Pantalla de consentimiento de OAuth**:
   - Seleccioná tipo de usuario **Externo**.
   - Completá el nombre de la app (*Stack*), correo de soporte y datos de desarrollador.
   - Publicá la app (estado de publicación **En producción**) para que cualquier cuenta de Google pueda iniciar sesión sin estar agregada manualmente como usuario de prueba.
3. En **APIs y servicios > Credenciales**:
   - Creá credenciales de tipo **ID de cliente de OAuth 2.0**.
   - Tipo de aplicación: **Aplicación web**.
   - **Orígenes autorizados de JavaScript**:
     - `http://localhost:5173` (desarrollo local)
     - `https://corre-ten.vercel.app` (producción en Vercel)
   - Guardá el Client ID generado (ej: `1234567890-abcdef.apps.googleusercontent.com`).
4. Configuración de variables:
   - **Backend (Render)**: `GOOGLE_CLIENT_ID = <tu-client-id>`.
   - **Frontend (Vercel)**: `VITE_GOOGLE_CLIENT_ID = <tu-client-id>`. *(Al tener prefijo `VITE_`, recordá que se embebe al compilar: requiere un nuevo deploy / redeploy en Vercel para tomar efecto)*.

### 2. Configuración del Proveedor de Email (Resend o Brevo)
Dado que Render en su plan gratuito bloquea las conexiones SMTP salientes, el backend utiliza la API HTTP oficial:
- **Opción A — Resend (Recomendado)**:
  1. Registrate en [Resend](https://resend.com) y generá una API Key con permisos de envío.
  2. Verificá tu dominio o utilizá el dominio sandbox verificado de pruebas (`onboarding@resend.dev` solo para envíos al correo de tu cuenta).
  3. En Render configurá:
     ```env
     EMAIL_PROVIDER=resend
     RESEND_API_KEY=re_123456789...
     EMAIL_FROM=Stack <noreply@tudominio.com>
     EMAIL_FROM_NAME=Stack
     ```
- **Opción B — Brevo (Sendinblue)**:
  1. Registrate en [Brevo](https://brevo.com), ingresá a **SMTP & API** y generá una API Key v3.
  2. Verificá el remitente (Senders & IP) con el correo que usarás en `EMAIL_FROM`.
  3. En Render configurá:
     ```env
     EMAIL_PROVIDER=brevo
     BREVO_API_KEY=xkeysib-...
     EMAIL_FROM=noreply@tudominio.com
     EMAIL_FROM_NAME=Stack
     ```
- **Secretos del Servidor**:
  Configurá `VERIFICATION_CODE_PEPPER` con una cadena aleatoria de al menos 16 caracteres para hashear los códigos de verificación con HMAC-SHA256.

### 3. Reglas de Vinculación de Cuentas por Email y Seguridad
- **Regla (c) — Preservación de datos o reemplazo en cuenta no verificada**: Si un usuario intenta ingresar con Google y ya existía una cuenta registrada con contraseña pero **sin verificar**: si dicha cuenta tiene datos guardados (progreso, electivas, reseñas, cursadas, propuestas, etc.) o fue creada antes de la migración `0003`, **no se elimina**. En su lugar, se borra su `password_hash`, se revocan todos sus refresh tokens y sesiones anteriores, se vincula la identidad de Google, se marca `email_verified_at` y se inicia sesión conservando el 100% de sus datos. Únicamente se elimina la cuenta sin verificar si es una cuenta vacía (sin datos asociados) creada con posterioridad a la migración `0003`.
- **Cuentas creadas solo con Google**: No poseen contraseña (`password_hash = null`). Si alguien intenta iniciar sesión con contraseña en una cuenta solo-Google, el sistema responde con el mensaje genérico estándar `"Email o contraseña incorrectos"`.
- **Mitigación Anti-Multicuentas (`canonical_email` & dominios descartables)**:
  - Para direcciones de `gmail.com` y `googlemail.com`, se ignoran los puntos en la parte local y cualquier etiqueta de alias posterior al signo `+` (por ejemplo, `juan.perez+1@gmail.com` se normaliza a `juanperez@gmail.com`).
  - No se permite registrar una cuenta si su `canonical_email` coincide con el de una cuenta ya verificada. Si esa cuenta usa Google, el mensaje sugiere amablemente: *"Ya existe una cuenta con este correo, probá con Continuar con Google"*.
  - Se bloquean dominios de correos descartables/temporales configurados en `server/src/config/disposableDomains.ts`.

### 4. Herramientas CLI y Mantenimiento
- **Verificar manualmente una cuenta (Fallback de emergencia)**:
  ```bash
  npm --prefix server run verify-user -- --email estudiante@ejemplo.com
  ```
- **Limpieza de cuentas huérfanas**:
  ```bash
  npm --prefix server run cleanup-unverified -- --days 7
  ```
- **Fusión y renombrado de docentes**:
  ```bash
  npm --prefix server run merge-professors -- --file merges.json [--apply]
  ```

---

## 💻 Ejecución Local y Comandos del Servidor

### 1. Backend (`server/`)
```bash
cd server
npm install
npm run db:migrate
npm run seed
npm run import:schedule -- --faculty FRC --plan "Plan 2023" --year 2026 --term 1C
npm run make-admin -- --email tu-correo@ejemplo.com
npm run build
npm run start
```

### 2. Frontend (Raíz)
```bash
npm install
npm run dev
```

---

## 📚 Biblioteca de Material de Estudio y Cloudflare R2

La plataforma cuenta con un módulo de Biblioteca para compartir exámenes, apuntes, resúmenes y guías. Los archivos binarios se almacenan en un bucket privado de **Cloudflare R2** y se acceden mediante URLs prefirmadas de corta duración.

### 1. Configuración de Variables de Entorno (R2)
En producción (Render), se requieren:
- `R2_ACCOUNT_ID`: ID de cuenta de Cloudflare.
- `R2_ACCESS_KEY_ID`: Token con permisos de lectura y escritura en el bucket.
- `R2_SECRET_ACCESS_KEY`: Secreto del token.
- `R2_BUCKET`: Nombre del bucket privado (ej: `stack-library-prod`).
- `CONTACT_EMAIL`: Correo de contacto para reclamos DMCA / baja de contenido.

*(En entornos de desarrollo local y tests automatizados, la aplicación utiliza un simulador en memoria `MemoryMockR2Service`, por lo que no es necesario configurar credenciales reales ni se generan costos).*

### 2. Configuración CORS del Bucket Cloudflare R2
Para permitir subidas directas vía `PUT` desde el navegador y descargas vía `GET` con URLs prefirmadas, el bucket privado de R2 debe configurarse con la siguiente política CORS en formato JSON:

```json
[
  {
    "AllowedOrigins": [
      "https://corre-ten.vercel.app",
      "http://localhost:5173"
    ],
    "AllowedMethods": [
      "GET",
      "PUT",
      "HEAD"
    ],
    "AllowedHeaders": [
      "Content-Type",
      "Content-Length",
      "x-amz-*"
    ],
    "ExposeHeaders": [
      "ETag"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

> **Importante para el cliente de subida**:
> La petición `PUT` enviada desde el frontend a Cloudflare R2 debe incluir estrictamente el header `Content-Type` idéntico al declarado durante `POST /api/library/uploads/init` con el que se firmó la URL. Si no coincide o se omite, Cloudflare R2 rechazará la subida con error de firma (`SignatureDoesNotMatch`).

### 3. Subida de Archivos y Seguridad
- **Sin límite diario**: Los estudiantes pueden subir múltiples archivos sin restricción de 5 por día, facilitando la carga de exámenes y resúmenes en tanda.
- **Cupo de pendientes y cuota**: Límite de hasta 30 archivos pendientes de moderación en simultáneo por usuario y cuota total de 500 MB en almacenamiento activo.
- **Control de concurrencia y semáforo**: Protección atómica ante llamadas concurrentes (`SELECT ... FOR UPDATE` en Postgres y mutex en InMemory), semáforo de validación en Node (máximo 3 streams concurrentes, timeout 10 s con 503 `LIBRARY_BUSY` y `Retry-After: 2`) y rate limiting defensivo en `/uploads/init` (máximo 120 peticiones / 10 min).
- **Límites de tamaño**: 25 MB para documentos PDF (`application/pdf`) y 10 MB para imágenes (`image/jpeg`, `image/png`, `image/webp`).
- **Escáner streaming**: Al completarse la subida, el servidor valida los *magic numbers* del stream e inspecciona la presencia de marcas sospechosas en PDFs (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/OpenAction`).
- **Aviso de limitación**: Esta inspección constituye una capa de sanitización estática heurística básica; no reemplaza un motor de antivirus / sandbox de ejecución dinámica en profundidad.

### 4. Sistema de Avisos por Email y Moderación Agrupada
La Biblioteca cuenta con notificaciones automáticas por correo electrónico para mantener informados a administradores y estudiantes durante el ciclo de moderación, optimizadas con debouncing y consolidación event-driven:

- **Envíos agrupados y temporizadores event-driven**: En lugar de consultar periódicamente la base de datos (lo que impediría que Neon suspenda su cómputo a costo cero), el sistema emplea temporizadores de único disparo (`setTimeout(..., cooldown).unref()`) con ventana de espera (`ADMIN_NOTIFY_COOLDOWN_SECONDS`, por defecto 120 s). Subidas múltiples se informan en un único correo resumen con el detalle de archivos subidos, y las revisiones en lote del moderador generan un solo correo consolidado con los archivos aprobados y/o rechazados. Al arrancar el servidor se ejecuta una única pasada no bloqueante para retomar cualquier pendiente previo a un reinicio.
- **Configuración de destinatarios admin (`ADMIN_NOTIFICATION_EMAIL`)**:
  - Variable opcional en `server/.env`. Puede contener una o varias direcciones de correo separadas por coma (ej: `admin@stack.com,moderador@stack.com`).
  - **Fallback automático**: Si no se define, el backend consulta automáticamente los usuarios con rol `admin`, estado `active` y correo verificado (`email_verified_at IS NOT NULL`). Si no hay ninguna dirección disponible, emite una advertencia informativa al arrancar.
- **Preferencia del estudiante (`user_settings.notify_library_email`)**:
  - Campo booleano (por defecto `true`). El estudiante puede activar o desactivar los avisos en cualquier momento desde el menú de usuario ("Avisarme por mail sobre mis aportes a la Biblioteca").
  - Aplica exclusivamente a los avisos de aprobación y rechazo dirigidos al usuario; el aviso de material nuevo al administrador no depende de esta preferencia.
- **Eventos y reglas de privacidad**:
  1. **(a) Subida completada**: Al pasar a estado `pending`, se encola para aviso agrupado a los administradores con el título, materia, tipo, año/cuatrimestre, tamaño y fecha. **Privacidad estricta**: El correo NO contiene el email ni el ID del estudiante autor (el admin consulta la autoría solo desde el panel bajo auditoría).
  2. **(b) Material aprobado**: Al pasar de `pending` a `approved`, se envía un aviso agrupado al estudiante confirmando los materiales publicados y accesibles para toda la comunidad.
  3. **(c) Material rechazado**: Al pasar a `rejected`, se envía un correo con el motivo ingresado por el moderador (debidamente sanitizado y escapado) para que el estudiante pueda corregirlo y volver a subirlo.
  - **Exclusiones**: No se envía email si el autor es anónimo (`uploader_user_id IS NULL`), si el usuario está suspendido (`status === 'suspended'`), o si desactivó su preferencia `notify_library_email`.
- **Topes de tasa y control de spam**:
  - `NOTIFY_ADMIN_MAX_PER_HOUR = 10`: Si se supera este límite en una hora, los avisos sucesivos se consolidan en un único resumen horario indicando la cantidad de archivos pendientes para no saturar al equipo.
  - `NOTIFY_USERS_MAX_PER_DAY = 150`: Límite diario global para preservar la cuota del proveedor de correo (Resend / Brevo) compartida con los códigos de verificación.
  - **Reenvío manual**: Desde la cola de moderación del Panel de Admin (`POST /api/admin/library/files/:id/resend-admin-notification`), los administradores pueden disparar un reenvío manual de la notificación ante contingencias.

---

## 🚀 Despliegue en Producción

- **Render (Backend `server/`)**: Root Directory `server`, Build Command `npm install && npm run build && npm run db:migrate`, Start Command `npm run start`, Health Check `/api/health`.
- **Vercel (Frontend)**: `vercel.json` reescribe `/api/:path*` hacia el backend en Render permitiendo cookies `HttpOnly` first-party en el mismo dominio.

---

Hecho por [Scroll Studio](https://thiagopgnqn.github.io/ScrollStudio/).

