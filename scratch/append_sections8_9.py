import os

section_content = """

---

## 8. Ajustes Menores de Cierre (Parte 0.6: A1 a A8)

### A1. Centrado Dinámico y Viewport Inicial del Grafo (Plan 2008 y Plan 2023)
- **Origen de datos de las capturas**: Se ejecutaron en un servidor mock local en memoria (`test_server.py`) sirviendo el bundle estático de producción `dist/` con endpoints simulados en Python. **No se conectó ni utilizó la base de datos real de Neon ni Cloudflare R2**.
- **Algoritmo de centrado inteligente**:
  - Si el usuario tiene materias en estado `cursando`, el grafo agrupa los nodos por año (`subject.level`). Si están en años distintos, calcula el año con mayor cantidad de materias cursando (o el año menor en caso de empate) y centra el viewport en el centroide de esos nodos, evitando que el punto medio caiga en un espacio vacío entre columnas lejanas.
  - Si no hay materias `cursando`, busca el año más bajo con materias pendientes (`status !== 'aprobada' && status !== 'promocionada'`) y enfoca la primera columna no aprobada.
  - Si la carrera está completa (0 cursando y 0 pendientes), se activa automáticamente `fitView` para exhibir el mapa entero del egresado.
  - El zoom inicial se fija en `0.78`, garantizando un tamaño de fuente efectivo legible de al menos 11–12 px sobre cualquier pantalla móvil.
- **Límites dinámicos de paneo (`translateExtent`)**: Se calculan en base a la caja contenedora real de los nodos (`minX`, `maxX`, `minY`, `maxY`) más un margen de seguridad (`MARGIN_X = 300`, `MARGIN_Y = 250`), adaptándose automáticamente a Plan 2023, Plan 2008, electivas asignadas y modo simulación.
- **Capturas Plan 2008 generadas**:
  - `screenshot_map_p2008_zero_cursando_360.png` y `screenshot_map_p2008_zero_cursando_412.png`
  - `screenshot_map_p2008_one_year_cursando_360.png` y `screenshot_map_p2008_one_year_cursando_412.png`
  - `screenshot_map_p2008_multi_year_cursando_360.png` y `screenshot_map_p2008_multi_year_cursando_412.png`

### A2. Escala Definitiva de Z-Index (`src/index.css`)
Tabla jerárquica estricta de capas sin hardcoding ni variables obsoletas:

| Capa / Token CSS | Valor | Propósito y Justificación de Capa |
| :--- | :---: | :--- |
| `--z-graph-controls` | `30` | Botones de zoom y recentrado del grafo flotantes en el canvas. |
| `--z-planner-bar` | `35` | Barra flotante inferior de resumen en el Armador de Cuatrimestre. |
| `--z-mobile-nav` | `40` | Barra de navegación inferior móvil fija (`bottom-0`). |
| `--z-header` | `40` | Encabezado superior fijo de la app (`Navbar`). |
| `--z-simulation-banner` | `40` | Franja superior que indica modo simulación activo. |
| `--z-backdrop` | `45` | Telón de fondo oscuro semitransparente de modales y sheets. |
| `--z-sheet` / `--z-modal` | `50` | Contenedores principales de `BottomSheet`, modales y menús desplegables. |
| `--z-modal-elevated` | `55` | Diálogos de confirmación o modales secundarios abiertos sobre otro modal/sheet. |
| `--z-toast` | `60` | Notificaciones flotantes tipo Toast (ej. recordatorio de reseñas). |
| `--z-modal-top` / `--z-spotlight` | `100` | Tutorial guiado paso a paso (`TutorialSpotlight`) sobre toda la UI. |

- **Explicación del cambio desde Fase 1**: En Fase 1 `--z-backdrop` compartía valor `50` con `--z-sheet`, lo que podía generar parpadeos o conflictos de apilamiento en Safari. Se ajustó a `45`, quedando estrictamente entre la barra móvil (`40`) y el cuerpo del modal (`50`). `--z-modal-elevated` se fijó en `55` para garantizar que un diálogo de confirmación sobre un sheet quede visible y funcional, y el tutorial en `100` para tener prioridad absoluta.
- **Auditoría grep**: Se verificó que ningún componente utiliza `z-50`, `z-[50]` ni variables no definidas.

### A3. Modo Horizontal Corto (Landscape) y Áreas Seguras
- **Altura de la barra inferior**: En landscape corto (`max-height <= 500px`), la barra inferior adopta `var(--mobile-nav-height)` reducida a `2.75rem` (44 px) con íconos de 16 px y etiquetas en línea horizontal (`flex-row gap-1.5`).
- **Safe Area Insets**: Se aplicaron `env(safe-area-inset-left)` y `env(safe-area-inset-right)` en la barra de navegación y en las vistas de pantalla completa para evitar que el notch o la cámara frontal tapen botones en apaisado.

### A4. Tablets (768 a 1023 px)
- **Inspección visual a 768px y 820px**: Se capturaron `screenshot_tablet_navbar_768.png` y `screenshot_tablet_navbar_820.png`.
- **Comportamiento verificado**: En el navbar superior, las etiquetas de texto de los enlaces de navegación tienen la clase `hidden min-[1500px]:inline`. Por debajo de 1500px, solo se muestran los íconos limpios con tooltip, ocupando ~360 px de ancho en total. En tablets (768px y 820px) hay más de 400 px libres hacia la derecha, por lo que los accesos caben perfectamente sin apretarse, sin salirse y sin colisionar con el selector de plan ni con el avatar del usuario. Por tanto, no se requiere alterar el breakpoint de 768px de la barra móvil.

### A5. Pruebas Unitarias y Resiliencia
- **Alineación de aserciones en `brand.test.ts`**: Se desenrolló el ciclo `forEach` de verificación de 9 archivos estáticos en 9 aserciones individuales explícitas. Tanto el conteo estático de tests (26) como el de aserciones en runtime (26) quedan 100% sincronizados.
- **Proporción de pruebas en `mobileFrontend.test.ts`**: 75% inspección estática de contratos de diseño / accesibilidad y 25% pruebas de lógica y comportamiento dinámico.
- **Regresión en `useProfessorRatings.ts`**: Se agregó la función exportada `normalizeRatingsBatchResponse(res)` que valida estructuras nulas, vacías (`{ success: true, data: [] }`) o con forma de mapa, protegiendo contra el error `TypeError: Cannot read properties of undefined`.
- **Nota técnica de backend**: Se documenta como tarea de backend unificar el retorno de `POST /api/professors/ratings` para que siempre devuelva `{ success: true, data: { byId: {}, byNormalizedName: {} } }`.

### A6. Horarios "Por Día" en Mobile
- Se retiró el listener de swipe táctil horizontal sobre el canvas de la grilla horaria. La tira horizontal sticky de días (LUN a SÁB) con clases `snap-x`, botones de 44 px y centrado automático vía `scrollIntoView` resuelve la navegación entre días de manera mucho más accesible, eliminando colisiones con el gesto de retroceso del borde de pantalla en Android y con el scroll vertical de las horas.

### A7. Verificación de Escritorio vs Pre-Mobile (`ab85b2f`)
- Se capturaron `screenshot_desktop_compare_map_1280.png` y `screenshot_desktop_compare_schedule_1280.png` contra el estado original pre-mobile.
- El layout de 3 columnas del armador de horarios, la barra lateral sticky y los controles superiores del mapa permanecen idénticos, con 0 px de desborde horizontal a 1280px y 900px.

### A8. Barra Flotante de Horarios
- Se formalizó la variable `--schedule-bar-height: 4.5rem;` (72 px) en `src/index.css`.
- El padding inferior del contenedor principal de horarios se ajustó a:
  `pb-[calc(var(--mobile-nav-height,4rem)+var(--schedule-bar-height,4.5rem)+env(safe-area-inset-bottom,0px))]`.
- Las etiquetas se compactaron (`{selectedCount} mat.`, `{totalHours} hs`, `⚠️ N`, `Planes`, `Grilla`) para evitar saltos de línea indeseados en 360 px de ancho.

---

## 9. Fase 4: Adaptación Completa de Vistas Restantes

### Cuatrimestre (`SemesterPlanner.tsx`)
- **Barra flotante inferior**: Se añadió una barra fija sobre la barra de navegación móvil (`var(--z-planner-bar) = 35`), visible en mobile, con resumen en tiempo real de materias seleccionadas y horas semanales, más un botón con touch target de 44 px que abre la canasta en un `BottomSheet`.
- **Canasta móvil en BottomSheet**: Reemplaza la columna derecha en mobile (la cual se oculta con `hidden lg:block`), permitiendo vaciar la selección, ver la evaluación de carga horaria, quitar materias individuales con botones $\ge 44\text{ px}$ y ejecutar "Armar horarios" o "Marcar todas como Cursando".
- **Padding inferior**: Se aplicó `pb-[calc(var(--mobile-nav-height,4rem)+5rem+env(safe-area-inset-bottom,0px))]` en el contenedor para evitar que la barra flotante tape materias.

### Electivas Libres (`ElectivesPicker.tsx`)
- **Selector segmentado de años**: Barra desplazable con chips táctiles `[ Todos los años | 1° | 2° | 3° | 4° | 5° ]` con altura mínima de 44 px. Al seleccionar un año, la vista filtra y muestra únicamente ese año para facilitar la lectura.
- **Drag & Drop**: Inactivo en dispositivos táctiles (`draggable={!isMobile}`) para evitar que el arrastre interfiera con el scroll.
- **Modal de Agregar Electiva**: Se adaptó con estilo bottom-sheet en mobile (`items-end sm:items-center`, `rounded-t-3xl`), z-index estricto `z-[var(--z-modal)]`, input de búsqueda con `text-base sm:text-xs` ($\ge 16\text{ px}$) para evitar zoom en iOS Safari, y botones de acción con altura mínima de 44 px.

### Estadísticas (`StatsDashboard.tsx`)
- **Contenedor 100% seguro**: Clases `w-full overflow-hidden` en el envoltorio para evitar desbordes por diagramas circulares o barras.
- **KPIs en 2 columnas en mobile**: Las tarjetas de resumen y métricas de notas se adaptaron de `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` a `grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4`, con tipografía y SVGs circulares responsivos para encajar sin desbordar en 360 px.
- **Controles táctiles**: Selectores de nota mínima, switches de promedio y tabs horizontales con altura mínima de 44 px.
- **Camino Crítico**: Tarjetas verticales apiladas con wrapping en nombres largos y badges sin overflow.

### Profesores y Reseñas (`ProfessorsDirectory.tsx`, `ProfessorCard.tsx`, `ProfessorDetailModal.tsx`)
- **Buscador y Filtros en BottomSheet**: El input de búsqueda mide $\ge 16\text{ px}$ (`text-base sm:text-xs`). En mobile se añade un botón "Filtros" con indicador de filtros activos que abre un `BottomSheet` completo con selector de materia, puntaje mínimo, ordenamiento y switch de reseñas.
- **Ficha de Profesor (`ProfessorDetailModal`)**: Modal responsivo con disposición de bottom sheet en mobile (`rounded-t-3xl`), z-index `var(--z-modal)` y pie sticky accesible con el pulgar para el botón "Dejar reseña".
- **Calificación por Estrellas (`StarRating.tsx`)**: En modo interactivo, cada estrella tiene un botón táctil de al menos $44 \times 44\text{ px}$ (`min-h-[44px] min-w-[44px]`) con separación adecuada para facilitar el tap preciso.
- **Formulario de Reseña (`ReviewFormModal.tsx`)**: Se configuró como hoja inferior en mobile (`max-h-[92dvh]`), con inputs y textarea de $\ge 16\text{ px}$ para prevenir auto-zoom, contador de caracteres visible y pie con botón de envío sticky al fondo de la pantalla.

### Cursadas (`EnrollmentModal.tsx`)
- Modal responsivo con disposición inferior en mobile (`rounded-t-3xl`, `max-h-[90dvh]`), inputs con fuente de 16 px, botones de estado ("Cursando", "Regularizada", "Promocionada", "Quedé libre") y opciones de comisión con altura mínima de 44 px.

### Biblioteca Completa
- **UploadMaterialModal**:
  - Modal adaptado a bottom-sheet en mobile (`max-h-[92dvh]`, `rounded-t-3xl`), z-index `z-[var(--z-modal)]`.
  - Botón explícito accesible "Elegir archivo o foto" con altura de 44 px.
  - Etiqueta `<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp">` **sin atributo `capture`**, permitiendo al usuario elegir archivos existentes o usar la cámara según su preferencia.
  - Textos descriptivos claros de límites: PDF hasta 25 MB, imágenes hasta 10 MB.
  - Barra de progreso durante la subida, checkbox de términos legales con contenedor $\ge 44\text{ px}$, inputs de $\ge 16\text{ px}$ y botón de envío sticky al pie.
- **SubjectLibraryView y MyUploadsView**:
  - Chips de filtrado con scroll horizontal sin barra visible (`overflow-x-auto no-scrollbar`).
  - Botones de descarga y voto de utilidad con altura de 44 px.
  - Modales de Reporte, Edición y Confirmación de Eliminación migrados de `z-50` a `z-[var(--z-modal)]` con estilos de hoja inferior en mobile.

---

### 10. Matriz Final de Tests del Proyecto (100% Green)

| Archivo de Test | Escenarios | Aserciones | Estado |
| :--- | :---: | :---: | :---: |
| `test/correlativas.test.ts` | 17 | 106 | ✅ PASS |
| `test/scheduleImport.test.ts` | 14 | 84 | ✅ PASS |
| `test/reviewsFrontend.test.ts` | 10 | 64 | ✅ PASS |
| `test/authFrontend.test.ts` | 4 | 19 | ✅ PASS |
| `test/brand.test.ts` | 26 | 26 | ✅ PASS |
| `test/scheduleLayout.test.ts` | 6 | 20 | ✅ PASS |
| `test/adminFrontend.test.ts` | 6 | 24 | ✅ PASS |
| `test/libraryFrontend.test.ts` | 14 | 45 | ✅ PASS |
| `test/mobileFrontend.test.ts` | 26 | 242 | ✅ PASS |
| **TOTAL** | **123** | **630** | **100% PASS** |

---

### 11. Matriz de Verificación Visual y Medición de Desborde (CDP - Fase 4)

Medición automatizada vía Chrome DevTools Protocol (CDP) con Microsoft Edge headless en servidor mock local:

| Pantalla / Vista | Viewport | scrollWidth | innerWidth | Desborde Horizontal | Captura Generada |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Cuatrimestre (Base)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_planner_360.png` |
| **Cuatrimestre (Canasta Sheet)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_planner_basket_360.png` |
| **Cuatrimestre** | 412x740 | 412 px | 412 px | **0 px (PASS ✅)** | `screenshot_fase4_planner_412.png` |
| **Electivas (Chips por año)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_electives_360.png` |
| **Electivas (Modal Agregar)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_electives_modal_360.png` |
| **Electivas** | 412x740 | 412 px | 412 px | **0 px (PASS ✅)** | `screenshot_fase4_electives_412.png` |
| **Estadísticas (Overview 2-col)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_stats_overview_360.png` |
| **Estadísticas (Camino Crítico)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_stats_critical_360.png` |
| **Estadísticas** | 412x740 | 412 px | 412 px | **0 px (PASS ✅)** | `screenshot_fase4_stats_overview_412.png` |
| **Profesores (Directorio)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_professors_dir_360.png` |
| **Profesores (Sheet Filtros)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_professors_filters_360.png` |
| **Profesores (Directorio)** | 412x740 | 412 px | 412 px | **0 px (PASS ✅)** | `screenshot_fase4_professors_dir_412.png` |
| **Profesores (Ficha Detalle)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_professor_detail_360.png` |
| **Profesores (Formulario Reseña)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_review_form_360.png` |
| **Biblioteca (Portada Catálogo)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_library_home_360.png` |
| **Biblioteca (Portada Catálogo)** | 412x740 | 412 px | 412 px | **0 px (PASS ✅)** | `screenshot_fase4_library_home_412.png` |
| **Biblioteca (Modal de Subida)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_library_upload_360.png` |
| **Biblioteca (Vista de Materia)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_library_subject_360.png` |
| **Biblioteca (Mis Aportes)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_fase4_library_myuploads_360.png` |

---

### 12. Estado de Verificación Integral

- **Verificado**:
  - 100% de las pantallas adaptadas sin desborde horizontal (`scrollWidth <= innerWidth`) en 360x640 y 412x740.
  - Escala unificada de z-index probada en tests y sin colisiones en modales anidados ni sheets.
  - Botones y zonas interactivas cumplen con touch target $\ge 44\text{ px}$.
  - Formularios e inputs con tamaño de fuente $\ge 16\text{ px}$ en mobile para prevenir zoom no deseado en iOS Safari.
  - `UploadMaterialModal` sin atributo `capture`, con progreso, validaciones de tipo/peso y botón explícito.
  - Selector segmentado de años en electivas y drag & drop deshabilitado en touch.
  - KPIs en 2 columnas en móvil sin desborde en 360 px.
  - Buscador y BottomSheet de filtros en Directorio de Profesores.
  - Compilación de producción con TypeScript y Vite exitosa (`npm run build`).
  - Suite de pruebas de 123 tests y 630 aserciones 100% en verde (`npm test`).
  - Layout de escritorio y tests preexistentes (`scheduleLayout.test.ts`, etc.) 100% intactos.

- **NO verificado**:
  - **Sensación táctil física (haptics)** y fricción en dedos sobre la pantalla de cristal de un modelo físico específico de smartphone Android o iPhone.
  - **Curvatura física de esquinas de hardware y Dynamic Island real**: se validó la compatibilidad con las variables CSS oficiales `env(safe-area-inset-*)`, pero la apariencia de los radios de curvatura físicos varía por fabricante.
"""

with open('docs/plan-mobile.md', 'a', encoding='utf-8') as f:
    f.write(section_content)
print("docs/plan-mobile.md updated successfully")

