# 🎓 Mi Carrera — Seguimiento Plan 2023 ISI (UTN)

Una aplicación web moderna, interactiva y fluida para el seguimiento de la carrera **Ingeniería en Sistemas de Información (Plan 2023, Universidad Tecnológica Nacional)**. Diseñada como un árbol de habilidades con estética constellation/glassmorphism, animaciones fluidas, simulador hipotético "¿Y si...?", cálculo de camino crítico, armador de horarios con reseñas docentes y panel de analítica.

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
   - Botón para **"Guardar en mi carrera"** o **"Reiniciar cambios"**.

6. **📋 Vista por Niveles & Tablero Kanban**:
   - Columnas por estado (*Pendiente/Disponible*, *Cursando*, *Regularizada*, *Aprobada/Promocionada*) con **arrastrar y soltar (Drag & Drop)**.
   - Modo de vista alternativo agrupado por nivel (1° a 5° año) con barras de porcentaje.

7. **📅 "Armá tu Cuatrimestre" (Planificador Semestral)**:
   - Filtros por cuatrimestre (1C, 2C, Anual) y materias 100% disponibles.
   - Canasta interactiva para planear el cuatrimestre, sumando horas semanales en vivo y evaluando la intensidad de la carga académica.
   - Botón directo para pasar a armar los horarios de cursada con las materias elegidas en la canasta.
   - Botón para pasar la selección en bloque a estado *"Cursando"*.

8. **🕒 Armador de Horarios de Cuatrimestre & Detección de Choques**:
   - **Grilla semanal interactiva**: columnas de Lunes a Sábado con franjas horarias configurables y dinámicas. Bloques coloreados por materia con código, aula y docentes.
   - **Valoraciones docentes integradas en tiempo real**: cada docente en las tarjetas de comisión muestra su insignia (`★ 4,6 · 23`, `Pocas reseñas` o `Sin reseñas`), promedio combinado cuando hay múltiples docentes, popover con histograma y últimas opiniones, filtro de **valoración mínima** y orden **"Mejor valoradas primero"**.
   - **Detección visual de superposiciones**: patrón rayado animado en rojo sobre los bloques en conflicto, contador global de choques y lista clickeable que enfoca y resalta cada conflicto.
   - **Previsualización al pasar el mouse (Ghost / Fantasma)**: al posar el cursor sobre una comisión candidata en el panel lateral, se dibuja semitransparente en la grilla indicando si caería sin choques o en rojo si superpone.
   - **Sugeridor inteligente de combinaciones**: algoritmo automático que calcula combinaciones 100% sin choques, ordenables por *menos días de cursada*, *menos huecos libres* o *preferencia de turno*, más criterio opcional **"Preferir mejores profesores"** como desempate.
   - **Valoración docente promedio de tu semana**: el panel de Resumen Semanal calcula el promedio docente de tu propuesta actual.
   - **Gestión de borradores**: guarda hasta 5 propuestas independientes con nombre (ej. "Plan A", "Plan B"), con opción de duplicar, renombrar y comparar.
   - **Importador y validador JSON** y exportación a **PDF / texto / iCalendar (`.ics`)**.

9. **⭐ Reseñas de Profesores (100% Anónimas & Moderadas)**:
   - **Directorio completo de docentes**: búsqueda por apellido, nombre o materia, filtros por materia, valoración mínima y docentes con reseñas, y ordenamiento por ranking bayesiano (`Mejor valorados`), `Más reseñas` o `Nombre (A-Z)`.
   - **Fila de 5 estrellas siempre visible**: cada tarjeta del directorio muestra una fila de 5 estrellas consistente en los 3 estados:
     - `≥ 3` reseñas (`confiable`): estrellas doradas rellenas en tono pleno, promedio numérico y total de reseñas.
     - `1–2` reseñas (`pocas_resenas`): estrellas en tono atenuado/translúcido, promedio provisorio, etiqueta distintiva `"Provisorio"` y total de reseñas.
     - `0` reseñas (`sin_resenas`): 5 estrellas en contorno sutil y etiqueta `"Sin reseñas"`.
   - **Ficha detallada por profesor**: promedio general y estrellas (habilitado a partir de **3 reseñas** para evitar sesgos), histograma animado de 5 a 1 estrellas, barras de claridad, trato, disponibilidad y exigencia, `% que lo recomienda`, desglose y filtro por materia, votos de utilidad y paginación.
   - **Insignia "Cursó con este docente" (`attended_declared`)**: indica con una etiqueta discreta cuando el autor registró haber cursado la materia con ese docente en sus cursadas. Se recalcula automáticamente en tiempo real al crear, editar o eliminar cursadas, y al fusionar docentes.
   - **Elegibilidad verificada en backend**: solo se puede reseñar un par `(profesor, materia)` si `(a)` el profesor dicta o dictó la materia en **cualquier período cargado** (o mediante vínculo histórico manual) y `(b)` el estudiante tiene esa materia en estado `regularizada`, `aprobada` o `promocionada`. Máximo 1 reseña por `(usuario, profesor, materia)`, editable o eliminable desde **"Mis reseñas"**.
   - **Anonimato estricto**: la API pública jamás expone `userId`, correo ni fecha/hora exactas; solo publica *"Estudiante de [Materia]"* con **mes y año**, y oculta el período de cursada (`academicYear` / `term`) mientras el profesor tenga **menos de 5 reseñas**.
   - **Convivencia y moderación**: guía rápida antes de la primera reseña, filtro automático contra insultos y datos personales (teléfonos, emails, URLs), tope de 10 reseñas nuevas por usuario/día, botón **"Reportar"** con ocultamiento preventivo automático al llegar a **3 reportes abiertos**, y panel mínimo de moderación exclusivo para administradores (`Ocultar`, `Restaurar`, `Descartar reporte`).

10. **📝 "Mi Cursada" (Registro de Comisión y Docentes) & Recomendaciones Inteligentes**:
    - **Registro de cursada al cambiar de estado**: al marcar una materia como *Cursando*, *Regularizada*, *Aprobada* o *Promocionada* (desde el grafo, menú contextual, panel lateral *Drawer*, o tablero Kanban), se puede indicar la comisión cursada o cargar el ciclo/año y docentes a mano.
    - **Autocompletado desde horarios**: al elegir una comisión cargada en la oferta académica, el sistema autocompleta automáticamente a los profesores correspondientes, permitiendo editarlos o sumar otros.
    - **Sincronización con el Armador de Horarios**: al presionar *"Aplicar al cursado"* en el armador de horarios, además de pasar las materias a cursando, se registran automáticamente sus comisiones y docentes asociados.
    - **Soporte de recursadas**: permite registrar múltiples cursadas por materia (diferentes años o cuatrimestres).
    - **Aviso discreto al regularizar**: si una materia en curso pasa a *Regularizada*, *Aprobada* o *Promocionada*, aparece un toast sutil invitando a reseñar a los docentes con quienes se cursó.
    - **Banners y recomendaciones en el Directorio**: sección *"Contanos con quién cursaste"* para materias sin comisiones registradas y lista de *"Profesores que podés reseñar"* según tus comisiones, con opción *"Ahora no"* (descarte persistente).
    - **Punto indicador en Navbar**: un punto ámbar discreto sobre *"Profesores"* avisa cuando hay nuevas recomendaciones de reseñas generadas por tus cursadas hasta que se visita la sección.

11. **📊 Dashboard de Estadísticas & Camino Crítico**:
    - **Selector de Modo de Cálculo de Avance**: *Solo obligatorias* o *Con electivas*.
    - Anillos de progreso de carrera (% por materias y % por horas semanales).
    - Panel de **Requisitos para el Título de Ingeniero/a**, promedio general ponderado, distribución de notas y **Camino Crítico Algorítmico**.

12. **🌟 Tutorial Interactivo de Bienvenida (Visita Guiada con Spotlight)**:
    - **16 pasos guiados** (incluyendo el registro de comisiones y docentes de "Mi Cursada", el directorio de Reseñas de Profesores y su integración con el Armador de Horarios) con entorno Sandbox seguro y navegación completa por teclado.

---

## 🛠️ Stack Tecnológico

- **Frontend**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/) + [Tailwind CSS v4](https://tailwindcss.com/) + [@xyflow/react](https://reactflow.dev/) + [Framer Motion](https://www.framer.com/motion/)
- **Backend**: Node.js + TypeScript + Express 5 + Drizzle ORM + Zod (`server/`)
- **Base de Datos**: PostgreSQL serverless en **Neon**

---

## 🧪 Pruebas Automatizadas

### Frontend (Raíz)
```bash
npm test
```
Ejecuta las suites de correlativas, importador de horarios, estados de insignias docentes, promedios combinados de comisión/propuesta, filtros/desempate en el Armador de Horarios y navegación accesible por teclado del selector de estrellas.

### Backend (`server/`)
```bash
npm --prefix server test
```
Ejecuta la suite de integración HTTP en memoria (sin tocar Neon) verificando:
- Elegibilidad por estado académico y vínculo real docente-materia (incluyendo períodos históricos).
- Unicidad por `(usuario, profesor, materia)`, edición y borrado solo por el autor.
- Anonimato estricto en JSON público (ausencia total de `userId`/`email`/timestamps exactos y ocultamiento de cursada con `< 5` reseñas).
- Tope diario de 10 reseñas nuevas, filtro de insultos/datos personales y sanitización HTML.
- Ocultamiento preventivo automático al recibir 3 reportes abiertos y recálculo de agregados.
- Promedio bayesiano y umbral de 3 reseñas (`Sin reseñas` / `Pocas reseñas` / promedio confiable).
- Normalización insensible al orden (`"Botta, Oscar Ernesto"` vs `"Oscar, Botta"`), separación segura de apellidos homónimos con nombres distintos y fusión administrativa de docentes.

---

## 🔐 Reglas Configurables, Migración de Profesores y Endpoints Admin

Todas las constantes de negocio están documentadas en `server/src/config/reviews.config.ts`:
- `MIN_REVIEWS_FOR_RELIABLE_AVERAGE = 3` (umbral para mostrar promedio numérico).
- `MIN_REVIEWS_TO_SHOW_ATTENDED_PERIOD = 5` (umbral de privacidad para mostrar año/cuatrimestre cursado).
- `BAYESIAN_PRIOR_GLOBAL_MEAN = 3.5` y `BAYESIAN_PRIOR_WEIGHT = 5` (prior bayesiano para ordenar rankings).
- `MAX_NEW_REVIEWS_PER_USER_PER_DAY = 10` (tope diario por cuenta).
- `AUTO_HIDE_OPEN_REPORTS_THRESHOLD = 3` (reportes abiertos para ocultar preventivamente).
- `ALLOWED_REVIEW_SUBJECT_STATUSES = ['regularizada', 'aprobada', 'promocionada']`.

### Migración de entidades de Profesores (`migrate:professors`)
1. **Modo simulación segura (`--dry-run`, por defecto — no toca Neon)**:
   Analiza los nombres docentes de los JSON locales y planillas `data-source/*.xlsx`, reportando profesores únicos, propuestas de duplicados y anomalías de formato:
   ```bash
   npm --prefix server run migrate:professors -- --dry-run
   ```
2. **Aplicar en base de datos Neon (cuando decidas desplegarlo)**:
   Primero aplicá la migración SQL incremental `server/drizzle/0001_professor_reviews.sql` y luego ejecutá el poblado de entidades y vínculos:
   ```bash
   npm --prefix server run db:migrate
   npm --prefix server run migrate:professors -- --apply
   ```

### Fusión y renombre por lote (`merge-professors`)
Permite fusionar pares `{ "keep", "remove" }` y aplicar renombres `{ "from", "to" }` desde un archivo JSON sin usar `curl`:
1. **Previsualización segura (`--dry-run` por defecto, sin tocar Neon)**:
   Muestra materias, comisiones y cantidad de reseñas de cada docente involucrado:
   ```bash
   npm --prefix server run merge-professors -- --file merges.json
   ```
   *(Una vez migrada la base, podés sumar `--from-db` al dry-run para consultar el conteo real de reseñas en PostgreSQL sin escribir cambios).*
2. **Ejecución transaccional (`--apply`)**:
   Ejecuta todas las fusiones, alias, renombres y recálculo de estadísticas dentro de una única transacción PostgreSQL:
   ```bash
   npm --prefix server run merge-professors -- --file merges.json --apply
   ```

### Endpoints del Módulo de Autenticación, Verificación y Cursadas
- **Autenticación y Cuentas**:
  - `POST /api/auth/register` — Registro con email y contraseña (genera código criptográfico de 6 dígitos con hash HMAC y lo envía por mail).
  - `POST /api/auth/login` — Inicio de sesión con credenciales.
  - `POST /api/auth/google` — Inicio de sesión / registro con ID token de Google Identity Services verificado en backend (`google-auth-library`).
  - `POST /api/auth/verify-email` — Verificación con código de 6 dígitos (consumo único, tiempo constante y reemisión de tokens de sesión con claim `emailVerified: true`).
  - `POST /api/auth/resend-code` — Reenvío de código (espera de 60s y tope de 5 envíos por hora).
  - `POST /api/auth/cancel-registration` — Cancela y elimina la cuenta no verificada si el usuario necesita cambiar de email.
  - `POST /api/auth/refresh` y `POST /api/auth/logout` — Rotación con ventana de gracia y cierre seguro.
  - `GET /api/me` — Datos del usuario, estado `emailVerified: boolean` y proveedores (`authProviders`).
- **Públicos (requieren sesión iniciada y email verificado)**:
  - `GET /api/professors` — Directorio con búsqueda, filtros (`subjectId`, `minRating`, `withReviews`) y orden (`rating`, `reviews`, `name`).
  - `GET /api/professors/ratings` — Lote liviano cacheable (`byId` + `byNormalizedName` + `recentReviews`) para el Armador de Horarios.
  - `GET /api/professors/:id` y `GET /api/professors/:id/reviews` — Ficha completa, desglose por materia y reseñas paginadas.
  - `GET /api/me/reviewable` — Pares `(profesor, materia)` habilitados, bloqueados (con motivo), recomendaciones activas y reseñas propias.
  - `POST /api/me/reviewable/dismiss` — Descartar recomendación ("Ahora no") para un par profesor/materia.
  - `POST /api/me/reviewable/seen` — Marcar recomendaciones como vistas para apagar el indicador ámbar del navbar.
  - `POST /api/reviews`, `PUT /api/reviews/:id`, `DELETE /api/reviews/:id` — Crear, editar o borrar reseña propia.
  - `POST /api/reviews/:id/helpful` — Votar utilidad (toggle).
  - `POST /api/reviews/:id/report` — Reportar reseña (`ofensiva`, `datos personales`, `falsa o spam`, `otra`).
  - `GET /api/enrollments` — Listado de cursadas registradas del usuario.
  - `GET /api/enrollments/options/:subjectId` — Opciones de comisiones del período y docentes históricos/cargados para registrar cursada.
  - `PUT /api/enrollments/:subjectId` — Crear o actualizar cursada (comisión, año, cuatrimestre, lista de docentes).
  - `DELETE /api/enrollments/:id` — Eliminar registro de cursada.
- **Administración (requieren `role = 'admin'`)**:
  - `GET /api/admin/professors` — Listado de entidades y candidatos a duplicados detectados.
  - `POST /api/admin/professors` — Crear profesor histórico (y vincularlo opcionalmente a una materia).
  - `POST /api/admin/professors/:id/subjects` — Vincular manualmente un profesor histórico a una materia.
  - `POST /api/admin/professors/merge` — Fusionar dos profesores (reasigna comisiones, cursadas, recomendaciones descartadas, ofertas electivas, vínculos, reseñas, guarda alias y recalcula estadísticas y `attended_declared`).
  - `PATCH /api/admin/professors/:id` — Corregir `display_name`.
  - `GET /api/admin/reviews/reports` — Cola de moderación (reportes abiertos y reseñas ocultas).
  - `PATCH /api/admin/reviews/:id/status` — Cambiar estado (`published`, `hidden`, `removed`).
  - `PATCH /api/admin/reviews/reports/:reportId` — Resolver o descartar reporte (`dismissed`, `actioned`).
  - `GET /api/admin/reviews/stats` — Resumen estadístico general de reseñas y moderación.

### Migraciones Drizzle en PostgreSQL / Neon
1. `0000_massive_thunderball.sql`: Tablas base de usuarios, sesiones OAuth/credenciales, estados de carrera, horarios y comisiones.
2. `0001_professor_reviews.sql`: Entidades `professors`, `professor_aliases`, `professor_subjects`, `commission_professors`, `professor_reviews`, `review_reports` y `review_helpful_votes`.
3. `0002_enrollments_and_declared_reviews.sql`: Tablas de cursadas `subject_enrollments` y `enrollment_professors`, descartes de recomendaciones `review_recommendation_dismissals` y columna `attended_declared` en `professor_reviews`.
4. `0003_premium_dakota_north.sql`: Tablas `user_identities` (proveedor Google con `provider_user_id` / `sub`), `email_verification_codes` (código HMAC, expiración y límite de intentos), columna `email_verified_at` y `canonical_email` en `users` con índice único condicional, y `password_hash` nullable. *(Se aplica con el deploy normal)*.

---

## 🔑 Configuración de Google Login y Proveedor de Email

### 1. Configuración de Google Identity Services (Google Cloud Console)
1. Ingresá a [Google Cloud Console](https://console.cloud.google.com/) y seleccioná o creá un proyecto para **Mi Carrera**.
2. En **APIs y servicios > Pantalla de consentimiento de OAuth**:
   - Seleccioná tipo de usuario **Externo**.
   - Completá el nombre de la app (*Mi Carrera*), correo de soporte y datos de desarrollador.
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
     EMAIL_FROM=Mi Carrera <noreply@tudominio.com>
     EMAIL_FROM_NAME=Mi Carrera
     ```
- **Opción B — Brevo (Sendinblue)**:
  1. Registrate en [Brevo](https://brevo.com), ingresá a **SMTP & API** y generá una API Key v3.
  2. Verificá el remitente (Senders & IP) con el correo que usarás en `EMAIL_FROM`.
  3. En Render configurá:
     ```env
     EMAIL_PROVIDER=brevo
     BREVO_API_KEY=xkeysib-...
     EMAIL_FROM=noreply@tudominio.com
     EMAIL_FROM_NAME=Mi Carrera
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
  - *Nota*: Esto mitiga significativamente pero no elimina al 100% las multicuentas si se utilizan proveedores con dominios personalizados o servicios VPN.

### 4. Herramientas CLI y Mantenimiento
- **Verificar manualmente una cuenta (Fallback de emergencia)**:
  Si un usuario experimenta problemas con el proveedor de emails o necesita acceso inmediato:
  ```bash
  npm --prefix server run verify-user -- --email estudiante@ejemplo.com
  ```
- **Limpieza de cuentas huérfanas**:
  El servidor ejecuta automáticamente cada 12 horas una rutina liviana que elimina cuentas creadas hace más de 7 días que nunca verificaron su correo. También puede ejecutarse a demanda:
  ```bash
  npm --prefix server run cleanup-unverified -- --days 7
  ```
- **Comando SQL para eliminar cuenta de prueba `prueba@ejemplo.com`**:
  *(Solo para ejecutar cuando lo consideres necesario en la consola SQL de Neon)*:
  ```sql
  DELETE FROM users WHERE email = 'prueba@ejemplo.com' OR canonical_email = 'prueba@ejemplo.com';
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

## 🚀 Despliegue en Producción

- **Render (Backend `server/`)**: Root Directory `server`, Build Command `npm install && npm run build && npm run db:migrate`, Start Command `npm run start`, Health Check `/api/health`.
- **Vercel (Frontend)**: `vercel.json` reescribe `/api/:path*` hacia el backend en Render permitiendo cookies `HttpOnly` first-party en el mismo dominio.
