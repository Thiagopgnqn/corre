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
   - Botón para pasar la selección en bloque a estado *"Cursando"*.

8. **📊 Dashboard de Estadísticas & Camino Crítico**:
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

9. **⚡ UX & Accesibilidad**:
   - Buscador global rápido con el atajo de teclado **Ctrl + K** (o Cmd + K).
   - **Carga rápida inicial**: marcación en lote de niveles enteros con notas por defecto o carga de perfil demo (estudiante de 3er año).
   - **Efectos de sonido procedurales** con Web Audio API y botón para silenciar.
   - **Confetti** animado al aprobar, promocionar o desbloquear hitos.
   - Persistencia automática en **`localStorage`**, exportación e importación completa en formato **JSON** (incluyendo electivas asignadas por año), y reinicio con confirmación.

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

## 🌐 Cómo Desplegarlo en la Web

### Opción 1: Despliegue en Vercel (Recomendado)

1. Subí tu proyecto a un repositorio en **GitHub** o **GitLab**.
2. Entrá en [Vercel](https://vercel.com/) e iniciá sesión.
3. Hacé click en **"Add New Project"** y seleccioná el repositorio de `correlativas`.
4. Vercel detectará automáticamente que es un proyecto **Vite**:
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Hacé click en **"Deploy"**. En menos de 1 minuto tendrás tu enlace público HTTPS listo.

---

### Opción 2: Build estático manual
Si querés subir los archivos a cualquier servidor web tradicional (Apache, Nginx, GitHub Pages, Firebase Hosting):
```bash
npm run build
```
La carpeta generada `dist/` contiene los archivos estáticos optimizados y minificados listos para servir.
