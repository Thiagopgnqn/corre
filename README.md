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

## 🚀 Despliegue en Producción

- **Render (Backend `server/`)**: Root Directory `server`, Build Command `npm install && npm run build && npm run db:migrate`, Start Command `npm run start`, Health Check `/api/health`.
- **Vercel (Frontend)**: `vercel.json` reescribe `/api/:path*` hacia el backend en Render permitiendo cookies `HttpOnly` first-party en el mismo dominio.
