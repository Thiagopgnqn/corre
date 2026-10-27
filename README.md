# 🎓 Mi Carrera — Seguimiento Plan 2023 ISI (UTN)

Una aplicación web moderna, interactiva y fluida para el seguimiento de la carrera **Ingeniería en Sistemas de Información (Plan 2023, Universidad Tecnológica Nacional)**. Diseñada como un árbol de habilidades con estética constellation/glassmorphism, animaciones fluidas, simulador hipotético "¿Y si...?", cálculo de camino crítico y panel de analítica.

---

## 🚀 Características Principales

1. **🗺️ Mapa de Correlativas Interactivo (Skill Tree / Constelación)**:
   - Visualización con `@xyflow/react` en columnas por nivel (1° a 5° año).
   - Aristas diferenciadas:
     - **Línea punteada ámbar**: requiere estar **Regularizada** (o superior).
     - **Línea sólida esmeralda**: requiere estar **Aprobada** (final o promoción).
   - **Enfoque dinámico**: al posar el mouse o seleccionar una materia, se iluminan sus correlativas previas y lo que desbloquea a futuro, atenuando el resto.
   - Panel lateral desplegable (*Drawer*) con detalle de horas, requisitos faltantes y qué desbloquea al aprobar o regularizar.
   - Toggle para incluir las **Materias Electivas** en el grafo con diseño dorado punteado.

2. **🧪 Modo Simulador "¿Y si...?"**:
   - Probá aprobar o regularizar materias hipotéticamente sin tocar tu historial guardado.
   - Observá en tiempo real cómo se iluminan y desbloquean las materias siguientes.
   - Botón para **"Guardar en mi carrera"** o **"Reiniciar cambios"**.

3. **📋 Vista por Niveles & Tablero Kanban**:
   - Columnas por estado (*Pendiente/Disponible*, *Cursando*, *Regularizada*, *Aprobada/Promocionada*) con **arrastrar y soltar (Drag & Drop)**.
   - Modo de vista alternativo agrupado por nivel (1° a 5° año) con barras de porcentaje.

4. **📅 "Armá tu Cuatrimestre" (Planificador Semestral)**:
   - Filtros por cuatrimestre (1C, 2C, Anual) y materias 100% disponibles.
   - Canasta interactiva para planear el cuatrimestre, sumando horas semanales en vivo y evaluando la intensidad de la carga académica.
   - Botón para pasar la selección en bloque a estado *"Cursando"*.

5. **✨ Selector de Electivas con Slot Picker**:
   - Visualización de créditos por nivel:
     - Nivel 3: 4 créditos (Habilita el título intermedio de Analista).
     - Nivel 4: 6 créditos.
     - Nivel 5: 10 créditos.
     - Total para Ingeniero/a: 20 créditos.
   - Validación de correlatividades de electivas con mapeo automático de siglas (`AED`, `SSL`, `PPR`, `SPN`, `ASI`, `DDS`, `BDA`, `RDA`, `ADM`, `IOP`, `ICS`).

6. **📊 Dashboard de Estadísticas & Camino Crítico**:
   - Anillos de progreso de carrera (% por cantidad de materias y % por carga horaria).
   - Promedio general ponderado con selector para incluir o excluir materias promocionadas y umbral de nota mínima de aprobación (4 o 6).
   - Distribución de notas (1 a 10), mejor y peor calificación, y promedio por nivel.
   - **Camino Crítico Algorítmico**: cálculo del camino más largo de dependencias hacia el Proyecto Final y estimación de cuatrimestres restantes.
   - **Hitos & Título Intermedio**: medallas desbloqueables (25%, 50%, 75%, 100%, Analista Universitario, Habilitación PPS).

7. **⚡ UX & Accesibilidad**:
   - Buscador global rápido con el atajo de teclado **Ctrl + K** (o Cmd + K).
   - **Carga rápida inicial**: marcación en lote de niveles enteros con notas por defecto o carga de perfil demo (estudiante de 3er año).
   - **Efectos de sonido procedurales** con Web Audio API (cero dependencias de archivos externos de audio) y botón para silenciar.
   - **Confetti** animado al aprobar, promocionar o desbloquear hitos.
   - Persistencia automática en **`localStorage`**, exportación e importación completa en formato **JSON**, y reinicio con diálogo de confirmación.

---

## 🛠️ Stack Tecnológico

- **Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Bundler**: [Vite](https://vite.dev/)
- **Estilos**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Grafo interactivo**: [@xyflow/react](https://reactflow.dev/)
- **Animaciones**: [Framer Motion](https://www.framer.com/motion/)
- **Iconos**: [Lucide React](https://lucide.dev/)
- **Celebraciones**: [canvas-confetti](https://www.npmjs.com/package/canvas-confetti)
- **Audio**: Web Audio API Synthesizer

---

## 💻 Cómo Correrlo Localmente

### Requisitos previos
- Tener instalado [Node.js](https://nodejs.org/) (versión 18 o superior).

### Pasos

1. Abrir una terminal en la carpeta del proyecto:
   ```bash
   cd c:\Users\PC\Desktop\correlativas
   ```

2. Instalar dependencias (si aún no se instalaron):
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

*O vía Vercel CLI directamente desde la terminal:*
```bash
npm i -g vercel
vercel
```

---

### Opción 2: Despliegue en Netlify

1. Entrá en [Netlify](https://www.netlify.com/) e iniciá sesión.
2. Hacé click en **"Add new site" -> "Import an existing project"** y vinculá tu repositorio de GitHub.
3. Configurá los ajustes de compilación:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
4. Hacé click en **"Deploy site"**.

*O vía Netlify CLI:*
```bash
npm i -g netlify-cli
netlify deploy --prod --dir=dist
```

---

### Opción 3: Build estático manual
Si querés subir los archivos a cualquier servidor web tradicional (Apache, Nginx, GitHub Pages, Firebase Hosting):
```bash
npm run build
```
La carpeta generada `dist/` contiene los archivos estáticos optimizados y minificados listos para servir.
