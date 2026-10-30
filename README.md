# 🎓 Mi Carrera — Seguimiento Plan 2023 ISI (UTN)

Una aplicación web moderna, interactiva y fluida para el seguimiento de la carrera **Ingeniería en Sistemas de Información (Plan 2023, Universidad Tecnológica Nacional)**. Diseñada como un árbol de habilidades con estética constellation/glassmorphism, animaciones fluidas, simulador hipotético "¿Y si...?", cálculo de camino crítico y panel de analítica.

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
   - Selector visible en la barra de navegación y en el menú de ajustes (por defecto **DESACTIVADO** y guardado en `localStorage`).
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
   - **Detección visual de superposiciones**: patrón rayado animado en rojo sobre los bloques en conflicto, contador global de choques y lista clickeable que enfoca y resalta cada conflicto.
   - **Previsualización al pasar el mouse (Ghost / Fantasma)**: al posar el cursor sobre una comisión candidata en el panel lateral, se dibuja semitransparente en la grilla indicando si caería sin choques o en rojo si superpone.
   - **Sugeridor inteligente de combinaciones**: algoritmo automático que calcula combinaciones 100% sin choques, ordenables por *menos días de cursada*, *menos huecos libres* o *preferencia de turno* (mañana, tarde, noche); en caso de conflicto generalizado, sugiere la opción con menor cantidad de choques.
   - **Gestión de borradores**: guarda hasta 5 propuestas independientes con nombre (ej. "Plan A", "Plan B"), con opción de duplicar, renombrar y comparar.
   - **Importador y validador JSON**: permite cargar ofertas horarias reales mediante arrastrar y soltar o pegado de texto con validación estricta de formato y detección preventiva de errores.
   - **Exportación**: impresión y guardado en PDF nativo, y copia rápida de resumen en texto al portapapeles.
   - **Pasar a "Cursando"**: confirmación para inscribir las materias elegidas en el avance general de la carrera.

9. **📊 Dashboard de Estadísticas & Camino Crítico**:
   - **Selector de Modo de Cálculo de Avance**:
     - *Solo obligatorias*: porcentaje basado únicamente en las materias troncales activas (36, o 37 con Analista).
     - *Con electivas (por defecto)*: suma las electivas como un bloque proporcional de 7 materias equivalentes (`ELECTIVE_SLOTS_EQUIVALENT = 7`, correspondiente a 20 créditos).
     - Los porcentajes de *aprobadas*, *regularizadas*, *cursando* y *pendientes* suman estrictamente el **100%** en ambos modos.
   - Anillos de progreso de carrera (% por materias y % por horas semanales, con nota explícita de que las electivas no computan horas de plan).
   - Panel de **Requisitos para el Título de Ingeniero/a**: desglose explícito de materias obligatorias faltantes y créditos de electivas (X / 20).
   - Promedio general ponderado con selector para incluir o excluir materias promocionadas y umbral de nota mínima (4 o 6).
   - Distribución de notas (1 a 10), mejor y peor calificación, y promedio por nivel.
   - **Camino Crítico Algorítmico**: cálculo del camino más largo de dependencias hacia el Proyecto Final y estimación de cuatrimestres restantes.
   - **Hitos & Medallas**: 25%, 50%, 75%, Graduación (100% materias + 20 cr electivas), Habilitación PPS y Analista Universitario (cuando está activo).

10. **⚡ UX & Accesibilidad**:
    - Buscador global rápido con el atajo de teclado **Ctrl + K** (o Cmd + K).
    - **Carga rápida inicial**: marcación en lote de niveles enteros con notas por defecto o carga de perfil demo (estudiante de 3er año).
    - **Efectos de sonido procedurales** con Web Audio API y botón para silenciar.
    - **Confetti** animado al aprobar, promocionar o desbloquear hitos.
    - Persistencia automática en **`localStorage`**, exportación e importación completa en formato **JSON** (incluyendo propuestas y comisiones guardadas), y reinicio con confirmación.

11. **🌟 Tutorial Interactivo de Bienvenida (Visita Guiada con Spotlight)**:
    - **Spotlight animado nativo**: recorte SVG con halo dorado pulsante y transiciones fluidas con Framer Motion (sin librerías pesadas externas).
    - **14 pasos guiados**: bienvenida, mapa de correlativas, estados y colores, drawer interactivo, cambio de estado y festejo, tipos de aristas, simulador "¿Y si...?", electivas libres (20 cr), título de analista (99), vistas de la app, armador de horarios de cuatrimestre, dashboard de estadísticas, privacidad/respaldo JSON y finalización.
    - **Entorno Sandbox Seguro**: cualquier acción interactiva durante el tour opera sobre una copia temporal y restaura el estado real del usuario al finalizar o salir.
    - **Convivencia con Carga Rápida**: el tour se ejecuta primero en nuevos ingresos y, en el paso final, ofrece la opción *"Cargar mis materias"* o *"Empezar solo"*.
    - **Detección inteligente de usuarios existentes**: si ya contás con materias registradas, el tutorial no interrumpe tu navegación y queda disponible a demanda desde el botón **"?" (Ver tutorial)** en la barra de navegación (desktop y móvil).
    - **Navegación completa por teclado**: flechas `←` y `→`, `Enter` para avanzar y `Esc` para salir en cualquier momento; soporte adaptativo responsive con formato bottom sheet en dispositivos móviles.

---

## 🛠️ Stack Tecnológico

- **Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Bundler**: [Vite](https://vite.dev/)
- **Estilos**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Grafo interactivo**: [@xyflow/react](https://reactflow.dev/)
- **Animaciones**: [Framer Motion](https://www.framer.com/motion/)
- **Iconos**: [Lucide React](https://lucide.dev/)
- **Celebraciones**: [canvas-confetti](https://www.npmjs.com/package/canvas-confetti)
- **Audio**: Web Audio API Synthesizer (sin archivos externos)

---

## 🧪 Pruebas Automatizadas

El proyecto incluye tests unitarios de lógica pura ejecutables en Node.js:
```bash
npm test
```
Los tests verifican:
- Mapeo de siglas oficial (`DDS = 20`, `AED = 6`, `SSL = 13`, `PPR = 14`, etc.).
- Correlatividades de materias troncales y electivas.
- Regla especial de Seminario Integrador (99) y Proyecto Final (36).
- Proyecto Final con Analista **activado** (requiere 99) vs **desactivado** (no requiere 99).
- Validación contra electivas duplicadas en múltiples años (`sanitizeAssignedElectives`).
- Migración desde esquemas anteriores (`migrateLegacyElectives`).
- Requisitos del título intermedio de Analista (4 créditos de electivas de cualquier nivel).
- Desglose y cálculo estricto al 100% del avance de carrera con y sin electivas.
- Configuración de los 13 pasos del Tutorial Interactivo de Bienvenida.
- Detección automática y migración silenciosa para usuarios existentes sin interrupción.

---

## 💻 Cómo Correrlo Localmente

### Requisitos previos
- Tener instalado [Node.js](https://nodejs.org/) (versión 18 o superior).

### Pasos

1. Abrir una terminal en la carpeta del proyecto:
   ```bash
   cd c:\Users\PC\Desktop\correlativas
   ```

2. Instalar dependencias:
   ```bash
   npm install
   ```

3. Iniciar el servidor de desarrollo:
   ```bash
   npm run dev
   ```

4. Abrir en el navegador la URL que muestra la consola (usualmente `http://localhost:5173`).

---

## 🌐 Arquitectura Full Stack & Base de Datos (Neon PostgreSQL)

La aplicación cuenta con una arquitectura Full Stack completa:
- **Frontend**: React 19 + Vite + Tailwind CSS desplegado en **Vercel**.
- **Backend**: Node.js + TypeScript + Express desplegado en **Render** (Root directory: `server/`).
- **Base de Datos**: PostgreSQL serverless en **Neon** con pooler de conexiones y SSL (`node-postgres` con soporte transaccional ACID).
- **Autenticación Segura**: Cookies HttpOnly con rotación de refresh tokens (ventana de gracia de 20s y detección de reutilización), Argon2id para contraseñas, validación con Zod y protección CSRF (`X-Requested-With` + `Origin`).
- **Login Obligatorio**: Sin sesión iniciada solo se muestran las pantallas de autenticación (Login y Registro). Una vez autenticado, si el usuario posee datos en `localStorage`, se ofrece una migración guiada en un click hacia la base de datos.
- **Sincronización Optimista**: La UI responde instantáneamente (60 FPS) y sincroniza los cambios en segundo plano con un debounce de 400ms y un indicador de estado (*Guardado* / *Guardando...* / *Sin conexión*).

---

## 💻 Ejecución Local y Comandos del Servidor

### 1. Backend (`server/`)

Entrá en la carpeta del backend:
```bash
cd server
npm install
```

Configurá tu archivo `.env` basado en `.env.example`:
```env
PORT=3000
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:5173
DATABASE_URL=postgres://usuario:password@ep-xyz-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
DIRECT_URL=postgres://usuario:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require
JWT_SECRET=tu_jwt_secret_super_seguro
REFRESH_SECRET=tu_refresh_secret_super_seguro
```

#### Comandos de Base de Datos y CLI:
- **Correr migraciones**:
  ```bash
  npm run db:migrate
  ```
- **Cargar catálogo de materias (Seed inicial)**:
  Lee de forma autónoma desde `server/seed-data/plan2023-catalog.json`:
  ```bash
  npm run seed
  ```
- **Importar oferta horaria a Neon**:
  Carga grupos de curso, comisiones, slots, franjas reservadas y electivas con docentes:
  ```bash
  npm run import:schedule -- --faculty FRC --plan "Plan 2023" --year 2026 --term 1C
  ```
- **Promover usuario a Administrador**:
  ```bash
  npm run make-admin -- --email tu-correo@ejemplo.com
  ```
- **Compilar e iniciar servidor**:
  ```bash
  npm run build
  npm run start
  ```

---

### 2. Frontend (Raíz)

En la raíz del proyecto:
```bash
npm install
npm run dev
```

---

## 🚀 Despliegue en Producción

### 1. Render (Backend `server/`)
- Tipo: **Web Service**.
- **Root Directory**: `server`
- **Build Command**: `npm install && npm run build && npm run db:migrate`
- **Start Command**: `npm run start`
- **Health Check Path**: `/api/health`
- **Variables de Entorno**: `DATABASE_URL` (pooled), `DIRECT_URL` (directa para migraciones), `JWT_SECRET`, `REFRESH_SECRET`, `CLIENT_ORIGIN` (URL de Vercel), `NODE_ENV=production`.

### 2. Vercel (Frontend)
- El archivo `vercel.json` ya incluye el rewrite que envía `/api/*` a Render:
  ```json
  {
    "rewrites": [
      {
        "source": "/api/:path*",
        "destination": "https://TU-BACKEND-EN-RENDER.onrender.com/api/:path*"
      },
      {
        "source": "/(.*)",
        "destination": "/index.html"
      }
    ]
  }
  ```
- Gracias a este rewrite, el navegador envía y recibe las cookies HttpOnly en el mismo dominio, eliminando problemas de cross-origin cookies entre Vercel y Render.
