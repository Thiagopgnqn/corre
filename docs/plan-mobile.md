# Plan de Adaptación Mobile y Táctil — Stack

> **Rama activa:** `mobile`  
> **Objetivo:** Adaptar el 100% de la aplicación Stack para que sea una experiencia mobile-first cómoda, ergonómica para el pulgar, con targets táctiles $\ge 44 \times 44\text{ px}$, cero auto-zoom en iOS Safari, navegación intuitiva y sin scroll horizontal involuntario, **preservando el 100% de la experiencia y tests de escritorio intactos**.

---

## Estado Actual de las Fases

| Fase | Alcance | Estado | Notas / Cierre |
| :--- | :--- | :--- | :--- |
| **Fase 1** | **Infraestructura Base, BottomSheet, Navbar y UserMenu Mobile, Prevención Zoom iOS** | **COMPLETADA** | Hook `useIsMobile`, componente accesible `BottomSheet`, Bottom Nav de 5 ítems con "Más", `UserMenu` adaptado a sheet, escala Z-Index migrada, safe-areas de notch y landscape, badge de avisos en "Más", sincronización del tutorial en mobile, y regla de font-size de 16px en mobile sin `!important`. Build y tests (100%) en verde. |
| **Fase 2** | **Materias, Estados y Tableros (`SubjectDrawer`, `QuickStatusModal`, `KanbanBoard`, `PlanSelectorModal`, `SearchModal`, Grafo)** | **COMPLETADA** | `QuickStatusModal` en `BottomSheet` con validación de correlativas y nota táctil; `SubjectDrawer` en `BottomSheet` con 5 pestañas segmentadas; `CorrelativeGraph` con botones $\ge 44\text{ px}$ y botón flotante de re-centrado; `KanbanBoard` con 1 columna a la vez en mobile y drag & drop desactivado en touch; `PlanSelectorModal` en sheet; y `SearchModal` en pantalla completa con font-size $\ge 16\text{ px}$. |
| **Fase 3** | **Armador de Horarios (`ScheduleBuilder`, grilla día/semana, comisiones táctiles)** | **COMPLETADA** | Segmented control de 3 modos (Comisiones, Mi Semana, Dividida), banner persistente de choques con salto a grilla, popover de clases en `BottomSheet`, botones táctiles $\ge 44\text{ px}$, modales de combinaciones e importación adaptados, diálogos de confirmación elevados a `z-[var(--z-modal-elevated)]`. Layout desktop y tests preexistentes al 100% en verde. |
| **Fase 4** | Planificador de Cuatrimestre, Biblioteca, Reseñas y Electivas | Pendiente | Barra flotante sobre bottom nav, formulario de material con galería/cámara. |
| **Fase 5** | Panel de Administración Completo (6 pestañas) y Métricas | Pendiente | Transformación de tablas HTML anchas a tarjetas táctiles responsivas. |
| **Fase 6** | Verificación visual final, pulido en viewports reales y documentación | Pendiente | 360x640, 390x844, 414x896 y landscape. |

---

## 1. Fase 1: Decisiones Tomadas y Ajustes de Cierre Implementados

1. **Rutas Reales de Componentes**:
   - `Navbar.tsx` reside en `src/components/common/Navbar.tsx`.
   - `UserMenu.tsx` reside en `src/components/common/UserMenu.tsx`.

2. **Breakpoint Consistente con Tailwind `md`**:
   - `src/hooks/useIsMobile.ts` evalúa `(max-width: 767.98px)`.
   - Se utiliza solo para decisiones de comportamiento interactivo (ej. abrir un BottomSheet en vez de un dropdown absoluto). Todo el layout visual se maneja preferentemente con clases utilitarias responsivas de Tailwind (`md:`, `lg:`).
   - Capacidades táctiles mediante `(hover: none) and (pointer: coarse)`.
   - Detección de pantallas horizontales con baja altura mediante `(orientation: landscape) and (max-height: 500px)`.

3. **Componente Reutilizable y Accesible `BottomSheet` (`src/components/common/BottomSheet.tsx`)**:
   - Cumple WAI-ARIA para diálogos modales: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`.
   - Gestión de foco: al abrir enfoca el primer elemento interactivo; al cerrar devuelve el foco al elemento disparador previo.
   - Trampa de foco (Focus Trap): cicla mediante `Tab` y `Shift+Tab` dentro del sheet impidiendo escapar al fondo.
   - Mecanismos de cierre: tecla `Escape`, tap sobre el backdrop semi-transparente, y botón `X` visible de $44 \times 44\text{ px}$ (`w-11 h-11`).
   - Scroll-lock en el `body` no destructivo (`overflow: hidden` mientras está abierto, restaurando el valor anterior).
   - Prevención de rebote en iOS Safari con `overscroll-behavior: contain`.
   - Soporte de gestos: arrastre hacia abajo (swipe-to-close) capturado con **Pointer Events exclusivamente en la cabecera / handle** para no interferir nunca con el scroll interno del contenido.
   - Teclado virtual: los botones de acción (footer) van `sticky` dentro del propio sheet, no en un `position: fixed` flotante desvinculado.
   - Soporte para notch y landscape: `pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]`.
   - Respeto de `prefers-reduced-motion` para usuarios con sensibilidad visual.

4. **Escala Centralizada de Capas (Z-Index) y Alturas**:
   - Declarada en `src/index.css` en `:root`:
     - `--mobile-nav-height: 4rem;` (64px)
     - `--z-graph-controls: 30;`
     - `--z-planner-bar: 35;` (barra de canasta de Fase 4)
     - `--z-mobile-nav: 40;`
     - `--z-simulation-banner: 40;`
     - `--z-header: 40;`
     - `--z-backdrop: 50;`
     - `--z-sheet: 50;`
     - `--z-modal: 50;`
     - `--z-toast: 60;`
     - `--z-modal-elevated: 65;`
     - `--z-modal-top: 70;`

5. **Auditoría y Migración de Z-Index**:

| Componente | Z-Index Anterior | Variable Centralizada Nueva | Justificación |
| :--- | :--- | :--- | :--- |
| **Cabecera / Header (`App.tsx` / `Navbar.tsx`)** | `z-40` | `z-[var(--z-header)]` (40) | Capa fija del encabezado de la app. |
| **Cabecera de Admin (`AdminDashboard.tsx`)** | `z-30` | `z-[var(--z-header)]` (40) | Encabezado fijo del panel de administración. |
| **Barra Inferior Móvil (`Navbar.tsx`)** | `z-40` | `z-[var(--z-mobile-nav)]` (40) | Capa fija inferior; siempre visible sobre el contenido pero bajo modales. |
| **Controles y Leyenda del Grafo (`CorrelativeGraph.tsx`)** | `z-20` / default | `z-[var(--z-graph-controls)]` (30) | Flotantes dentro del canvas, debajo de la barra móvil y de la cabecera. |
| **Botón flotante Re-centrar mapa (`CorrelativeGraph.tsx`)** | Nuevo | `z-[var(--z-graph-controls)]` (30) | Botón flotante accesible en mobile dentro del canvas. |
| **Menú contextual del Grafo (`CorrelativeGraph.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Menú emergente de clic derecho. |
| **Desplegable Más opciones desktop (`Navbar.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Menú flotante de escritorio. |
| **Desplegable de Usuario desktop (`UserMenu.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Menú flotante de usuario en escritorio. |
| **Contenedor BottomSheet (`BottomSheet.tsx`)** | `z-50` | `z-[calc(var(--z-sheet)+layer*10)]` (50+) | Capa modal inferior dinámica para hojas apiladas. |
| **Detalle de Materia Desktop (`SubjectDrawer.tsx`)** | `z-50` | `z-[var(--z-sheet)]` (50) | Panel lateral de escritorio y backdrop `z-[var(--z-backdrop)]`. |
| **Modal Selector de Estado (`QuickStatusModal.tsx`)** | `z-50` | `z-[var(--z-sheet)]` (mobile) / `z-[var(--z-modal)]` (desktop) | Diálogo de cambio rápido de estado académico. |
| **Modal Selector de Planes (`PlanSelectorModal.tsx`)** | `z-50` | `z-[var(--z-sheet)]` (mobile) / `z-[var(--z-modal)]` (desktop) | Catálogo universitario y planes de estudio. |
| **Buscador Rápido (`SearchModal.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Pantalla completa en mobile y modal centrado en desktop. |
| **Modal de Cursada y Docente (`EnrollmentModal.tsx`)** | `z-[65]` / `z-50` | `z-[var(--z-modal-elevated)]` (65) | Modal para registrar cursada y docente asignado. |
| **Modal de Bienvenida (`OnboardingModal.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Modal inicial explicativo de bienvenida. |
| **Modal de Migración Local (`LocalStorageMigrationModal.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Modal para unificar datos de almacenamiento local a la nube. |
| **Detalle de Docente (`ProfessorDetailModal.tsx`)** | `z-[60]` | `z-[var(--z-modal)]` (50) | Modal con listado de reseñas de docente. |
| **Formulario de Reseña (`ReviewFormModal.tsx`)** | `z-[65]` | `z-[var(--z-modal-elevated)]` (65) | Diálogo para calificar profesor o materia. |
| **Reportar Reseña (`ReportReviewModal.tsx`)** | `z-[70]` | `z-[var(--z-modal-top)]` (70) | Diálogo crítico de denuncia de contenido. |
| **Moderación Docente Admin (`AdminModerationModal.tsx`)** | `z-[70]` | `z-[var(--z-modal-top)]` (70) | Diálogo de aprobación y rechazo de reseñas en panel. |
| **Reautenticación Admin (`AdminReauthModal.tsx`)** | `z-50` | `z-[var(--z-modal-top)]` (70) | Modal crítico de confirmación con PIN de seguridad. |
| **Combinaciones de Horarios (`ScheduleCombinationsModal.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Sugeridor automático de comisiones sin choques. |
| **Importar Horarios (`ScheduleImportModal.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Diálogo para importar oferta académica desde JSON. |
| **Confirmaciones en Horarios (`ScheduleSummaryPanel.tsx`)** | `z-50` | `z-[var(--z-modal-elevated)]` (65) | Diálogos de pasar a cursando y limpiar grilla. |
| **Aviso de Reseña Cursada (`ReviewRecommendationToast.tsx`)** | `z-[55]` | `z-[var(--z-toast)]` (60) | Notificación emergente flotante sobre la barra móvil. |
| **Spotlight de Tutorial Guiado (`TutorialSpotlight.tsx`)** | `z-50` | `z-[var(--z-modal-top)]` (70) | Capa superior que resalta cualquier elemento interactivo. |

6. **Despeje de Contenido, Tablets (768 a 1023 px) y Prevención de Doble Scroll**:
   - `App.tsx` `<main>`: `pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px))] md:pb-0`.
   - **Tablets (768 a 1023 px)**: En tablets, la barra inferior móvil no existe (`md:hidden`), por lo que `md:pb-0` desactiva cualquier descuento inferior. `CorrelativeGraph.tsx` utiliza `md:h-[calc(100dvh-var(--app-header-height,4rem))]` evitando descontar la barra móvil inexistente en tabletas, y `ScheduleBuilder` llena el contenedor disponible (`flex-1 min-h-0`) ajustándose a la barra superior sin dejar espacios muertos.
   - `ScheduleBuilder.tsx`: mantiene `100dvh` con scroll interno en cada panel (`min-h-0`).

7. **Comportamiento en Landscape Corto y Muescas (Notch)**:
   - Detección: `(orientation: landscape) and (max-height: 500px)` en `useDeviceCapabilities`.
   - **Barra inferior móvil**: Se mantiene compacta con padding seguro para el notch mediante `pl-[env(safe-area-inset-left,0px)]` y `pr-[env(safe-area-inset-right,0px)]`.
   - **Armador de Horarios (`ScheduleBuilder`)**: Al estar en landscape corto, el selector de 3 modos (Comisiones, Mi Semana, Dividida) permite alternar a pantalla completa sin apretar la vista. En vista Dividida, la grilla se ajusta dinámicamente para no tapar los controles.
   - **Mapa de Correlativas (`CorrelativeGraph`)**: Ocupa el 100% de la altura disponible entre la cabecera y el fondo, con `nodeClickDistance={5}` para que el paneo con dos dedos o arrastre no confunda el gesto con un toque sobre una materia.

8. **Gestión de Sheets y Diálogos Anidados (`BottomSheet.tsx`)**:
   - **Pila global de capas (`activeSheetStack: string[]`)**: Cada instancia de `BottomSheet` o diálogo hijo se registra al montarse/abrirse.
   - **Bloqueo de scroll inteligente**: El `document.body.style.overflow = 'hidden'` se aplica solo con la primera capa (`count === 1`), y se restaura a su valor original **únicamente** cuando se cierra la última capa (`count === 0`).
   - **Trampa de foco y tecla Escape**: Solo la capa superior activa (`isTopLayer(id)`) captura la tecla Escape y atrapa el tabulador. Al cerrar un diálogo superior (ej. confirmación dentro de "Resumen"), la capa inferior permanece bloqueada y recupera el foco inmediatamente.
   - **Z-Index dinámico por profundidad**: Cada capa calcula `zIndex: calc(var(--z-sheet) + layerIndex * 10)` asegurando que las hojas o modales hijos queden siempre visibles por encima de sus hojas madres.

9. **Prevención de Zoom en iOS Safari (Sin `!important` y Acotada)**:
   - Regla en `src/index.css` a $16\text{ px}$ en `< 768px` para inputs de texto, select y textarea.
   - Excluye checkboxes, radios, ranges, submit/buttons y selectores de color.

10. **Tutorial y Badges**:
   - Pasos adaptados para abrir automáticamente el sheet "Más" al resaltar opciones secundarias.
   - Badge ámbar en el botón "Más" para moderación de archivos de administración.

---

## 2. Fase 2: Decisiones Técnicas e Implementación Detallada

### 2.1 Selector Rápido de Estado Académico (`QuickStatusModal.tsx`)
- **Diseño Mobile**: Se renderiza como un `BottomSheet` accesible con altura máxima de $90\text{ dvh}$.
- **Consistencia de Reglas de Negocio**:
  - Utiliza la función pura del motor de correlatividades `checkEligibility(subject, activeState)`.
  - Cuando una materia no cumple requisitos, las opciones inválidas (`cursando`, `regularizada`, `aprobada`, `promocionada`) aparecen visualmente deshabilitadas indicando el motivo exacto (ej. *"Falta regularizar: Análisis Matemático I"* o *"Falta aprobar: Algoritmos y Estructuras de Datos"*).
  - En modo simulación (`isSimulationMode`), todas las opciones permanecen habilitadas para permitir la proyección de escenarios hipotéticos.
  - El estado `disponible` y `libre` siempre son aplicables.
- **Interacción para el Pulgar**:
  - Las opciones de estado tienen altura mínima $\ge 50\text{ px}$ (`min-h-[50px]`).
  - Al tocar un estado que no requiere calificación (como `cursando`, `regularizada`, `disponible`, `libre`), se aplica inmediatamente y se cierra el panel.
  - Para `aprobada` o `promocionada`, se despliega un teclado numérico táctil (calificaciones de 1 a 10 con targets $\ge 44\text{ px}$) donde tocar una nota guarda y aplica al instante.
  - Se incluye un botón explícito de *"Restablecer estado"* para revertir a pendiente.
- **Compatibilidad de Escritorio**: En pantallas $\ge 768\text{ px}$, se renderiza el modal centrado original sin alteraciones.

### 2.2 Panel de Detalle de Materia (`SubjectDrawer.tsx`)
- **Diseño Mobile**: En pantallas móviles se transforma en un `BottomSheet` (`maxHeightDvh={92}`) en lugar de ocupar toda la pantalla lateralmente.
- **Arquitectura de Pestañas Segmentadas**:
  Para evitar un scroll vertical kilométrico en teléfonos pequeños, el contenido se organizó en 5 pestañas horizontales deslizables (`overflow-x-auto no-scrollbar`) con targets táctiles $\ge 44\text{ px}$:
  1. **General (`info`)**: Tarjeta de estado actual con botón grande para cambiar estado, estadísticas de carga semanal y modalidad, botón de cuatrimestre planeado ($\ge 48\text{ px}$), acceso a biblioteca y regla especial de aprobación (ej. Proyecto Final).
  2. **Correlativas (`correlativas`)**: Requisitos para cursar (regularizadas y aprobadas) con indicadores visuales claros y sección de *"Qué desbloquea"*.
  3. **Mi Cursada (`cursadas`)**: Historial de comisiones cursadas, docentes asignados, botón $\ge 44\text{ px}$ para registrar nueva cursada y botones de edición/eliminación táctiles de $44 \times 44\text{ px}$.
  4. **Finales (`historial`)**: Registro de exámenes finales y aplazos con fecha, nota y observaciones, junto al listado de intentos y botón de borrado táctil.
  5. **Material (`biblioteca`)**: Acceso directo al catálogo colaborativo con conteo dinámico de archivos.
- **Compatibilidad de Escritorio**: En escritorio mantiene intacto el panel deslizable derecho (`w-[440px]`) con flujo continuo de información.

### 2.3 Controles y Navegación del Grafo (`CorrelativeGraph.tsx`)
- **Targets Táctiles de React Flow**:
  Se incorporó una regla en `src/index.css` acotada a móviles (`@media (max-width: 767.98px)`) que fuerza a los botones nativos de `.react-flow__controls-button` a medir exactamente $44 \times 44\text{ px}$ con íconos escalados a $18\text{ px}$.
- **Botón Flotante de Re-centrado (`MobileFitViewButton`)**:
  Se implementó un botón táctil flotante con `min-h-[44px] min-w-[44px]` en la esquina superior derecha (`z-[var(--z-graph-controls)]`) que invoca `fitView({ padding: 0.2, duration: 400 })`, permitiendo recuperar el encuadre del mapa en cualquier momento con un solo toque del pulgar.
- **MiniMap**: Oculto en pantallas chicas (`hidden sm:block`) para evitar tapar nodos.
- **Alternativa Documentada (Vista de Lista Jerárquica)**:
  Para pantallas ultra-compactas (< 360px) o usuarios con dificultades para interactuar con gestos de zoom/pan en lienzos 2D, se propone como futura alternativa una vista en acordeón colapsable por nivel (1° a 5° año) y cuatrimestre, donde cada materia se presenta como tarjeta con chips de correlativas directas y selector de estado.

### 2.4 Tablero Kanban (`KanbanBoard.tsx`)
- **1 Columna a la Vez en Mobile**:
  En pantallas pequeñas, apilar 4 columnas generaba un scroll interminable y difícil de manipular. Se diseñó un control segmentado horizontal con 4 pestañas:
  - *"Pendientes (X)"*
  - *"Cursando (Y)"*
  - *"Regularizadas (Z)"*
  - *"Aprobadas (W)"*
  Cada pestaña es un botón táctil de $\ge 44\text{ px}$ con ícono y contador de materias. En mobile se visualiza únicamente la columna seleccionada.
- **Desactivación de Drag & Drop en Touch**:
  Se configuró `draggable={!isMobile && !isTouch}` y se ignoran los eventos nativos de drag si el dispositivo es táctil. Esto evita que el gesto de arrastre compita con el scroll vertical natural de la pantalla.
- **Cambio de Estado Accesible**:
  Cada tarjeta incluye un botón visible *"Cambiar"* ($\ge 44\text{ px}$) que abre de inmediato el `QuickStatusModal` en formato `BottomSheet`.
  Tocar el cuerpo de la tarjeta abre el `SubjectDrawer`.
- **Compatibilidad de Escritorio**: En escritorio se mantiene la grilla de 4 columnas (`grid-cols-4`) con drag & drop HTML5 nativo y soporte para cambio de vista por niveles.

### 2.5 Catálogo Universitario (`PlanSelectorModal.tsx`)
- En mobile se renderiza como `BottomSheet` con altura de $90\text{ dvh}$.
- Cada plan de estudios se organiza en una tarjeta vertical donde el botón *"Elegir plan"* mide al menos $48\text{ px}$ de altura (`min-h-[48px]`).
- En escritorio se conserva el diálogo modal centrado con `z-[var(--z-modal)]`.

### 2.6 Buscador Rápido (`SearchModal.tsx`)
- En mobile se transforma en una pantalla completa inmersiva (`h-[100dvh] max-h-[100dvh]`) con `z-[var(--z-modal)]`.
- El campo de búsqueda tiene tamaño de fuente de $16\text{ px}$ (`text-[16px]`), eliminando el zoom automático de iOS Safari.
- Cuenta con botón visible *"Cancelar"* de $\ge 44\text{ px}$ para cerrar rápidamente.
- Filtros segmentados táctiles de $\ge 44\text{ px}$ por nivel y estado.
- Las filas de resultados tienen altura táctil $\ge 48\text{ px}$ con acceso directo al detalle de materia y botón para cambiar estado.
- En escritorio se mantiene el modal centrado emergente (`Ctrl + K`).

---

## 3. Tabla de Correspondencia: Navbar Desktop vs Mobile

| Elemento actual en Navbar Desktop | Ubicación en Mobile (< 768px) | Detalle de accesibilidad / interacción |
| :--- | :--- | :--- |
| **BrandLogo (Stack)** | Barra superior (Top bar) | Visible a la izquierda, adaptado en tamaño. |
| **Selector de Plan (Píldora Plan 2023 / 2008)** | Barra superior, Sheet "Más" y Sheet "Usuario" | Botón táctil en top bar; abre `PlanSelectorModal` en `BottomSheet`. |
| **Pestaña Mapa (Correlativas)** | Barra inferior (Bottom Nav) — Ítem 1 | Botón táctil con altura $\ge 48\text{ px}$ (`min-h-[52px]`), ícono de $24\text{ px}$ (`w-6 h-6`), texto $\ge 11\text{ px}$. |
| **Pestaña Horarios (Armador)** | Barra inferior (Bottom Nav) — Ítem 2 | Botón táctil con altura $\ge 48\text{ px}$, ícono de $24\text{ px}$, texto $\ge 11\text{ px}$. |
| **Pestaña Biblioteca (Material)** | Barra inferior (Bottom Nav) — Ítem 3 | Botón táctil con altura $\ge 48\text{ px}$, ícono de $24\text{ px}$, texto $\ge 11\text{ px}$, badge de novedades activo. |
| **Pestaña Profesores (Reseñas)** | Barra inferior (Bottom Nav) — Ítem 4 | Botón táctil con altura $\ge 48\text{ px}$, ícono de $24\text{ px}$, texto $\ge 11\text{ px}$, badge de recomendaciones activo. |
| **Botón "Más"** | Barra inferior (Bottom Nav) — Ítem 5 | Botón táctil con altura $\ge 48\text{ px}$, ícono de $24\text{ px}$, texto "Más". Badge de moderación para administradores. Abre `BottomSheet` "Más Secciones". |
| **Pestaña Niveles (Kanban)** | Sheet "Más" | Fila táctil $\ge 48\text{ px}$ con ícono `Kanban` y subtítulo explicativo. |
| **Pestaña Cuatrimestre (Planificador)** | Sheet "Más" | Fila táctil $\ge 48\text{ px}$ con ícono `CalendarDays` y subtítulo explicativo. |
| **Pestaña Electivas (Catálogo)** | Sheet "Más" | Fila táctil $\ge 48\text{ px}$ con ícono `Sparkles` y subtítulo explicativo. |
| **Pestaña Estadísticas (Camino Crítico)**| Sheet "Más" | Fila táctil $\ge 48\text{ px}$ con ícono `BarChart3` y subtítulo explicativo. |
| **Panel de Administración (/#admin)** | Sheet "Más" y Sheet "Usuario" (Solo Admins) | Fila destacada con ícono `Shield`, visible **únicamente** si `user?.role === 'admin'`. Muestra badge de pendientes. |
| **Buscador rápido (Ctrl+K)** | Barra superior (Top bar) | **Botón táctil visible $\ge 44 \times 44\text{ px}$** con ícono de lupa (`Search`) que abre `SearchModal` en pantalla completa. |
| **Simulador "¿Y si...?"** | Barra superior y Sheet "Más" | Botón táctil en top bar y switch interactivo ON/OFF dentro del sheet "Más". |
| **Switch Analista (Seminario 99)** | Sheet "Más" | Switch táctil accesible ON/OFF (conserva selector `data-tour="analista-button"` y se auto-abre en tutorial). |
| **Efectos de sonido** | Sheet "Más" | Switch táctil accesible ON/OFF con íconos de volumen. |
| **Carga rápida por nivel** | Sheet "Más" | Fila táctil $\ge 44\text{ px}$ con ícono `Layers` (conserva `data-tour="onboarding-menu-item"`). |
| **Cargar muestra demo (3er año)** | Sheet "Más" | Fila táctil $\ge 44\text{ px}$ con ícono `Sparkles`. |
| **Ver tutorial interactivo** | Sheet "Más" | Fila táctil $\ge 44\text{ px}$ con ícono `HelpCircle`. |
| **Exportar carrera (JSON)** | Sheet "Más" y Sheet "Usuario" | Fila táctil $\ge 44\text{ px}$ con descarga inmediata. |
| **Importar carrera (JSON)** | Sheet "Más" | Fila táctil $\ge 44\text{ px}$ que abre el selector de archivo nativo. |
| **Reiniciar carrera...** | Sheet "Más" | Botón de advertencia con diálogo de confirmación. |
| **Badge de Sync / Offline** | Barra superior (Top bar) | Indicador visual de estado de sincronización. |
| **Menú de Usuario / Perfil** | Barra superior (Top bar) | Botón táctil $\ge 44 \times 44\text{ px}$ con avatar que en mobile despliega `UserMenu` como `BottomSheet`. |
| **Aviso de mails de Biblioteca** | Sheet "Usuario" | Switch táctil con área de toque amplia ($\ge 44\text{ px}$). |
| **Cerrar Sesión** | Sheet "Usuario" y Sheet "Más" | Fila táctil $\ge 48\text{ px}$ de fácil acceso. |
| **Eliminar cuenta...** | Sheet "Usuario" | Botón de acción peligrosa con diálogo de confirmación modal. |

---

## 4. Inventario Completo y Asignación por Fases

| Componente / Pantalla | Archivo | ¿Existe en el Repo? | Fase de Adaptación |
| :--- | :--- | :--- | :--- |
| **Electivas Libres por Año** | `src/components/electives/ElectivesPicker.tsx` | Sí | **Fase 4** (tarjetas de materias, filtros por año, selector de créditos). |
| **Niveles & Tablero Kanban** | `src/components/kanban/KanbanBoard.tsx` | Sí | **Fase 2** (COMPLETADA: 1 columna a la vez en mobile, drag & drop desactivado en touch, botón de cambiar estado $\ge 44\text{ px}$). |
| **Selector Rápido de Estado** | `src/components/common/QuickStatusModal.tsx` | Sí | **Fase 2** (COMPLETADA: BottomSheet táctil, validación de correlativas, teclado de notas 1-10). |
| **Detalle de Materia** | `src/components/graph/SubjectDrawer.tsx` | Sí | **Fase 2** (COMPLETADA: BottomSheet con 5 pestañas horizontales segmentadas y targets $\ge 44\text{ px}$). |
| **Controles de Grafo** | `src/components/graph/CorrelativeGraph.tsx` | Sí | **Fase 2** (COMPLETADA: controles $\ge 44\text{ px}$ y botón flotante de re-centrado). |
| **Selector de Plan** | `src/components/common/PlanSelectorModal.tsx` | Sí | **Fase 2** (COMPLETADA: BottomSheet con botones $\ge 48\text{ px}$). |
| **Buscador Rápido** | `src/components/common/SearchModal.tsx` | Sí | **Fase 2** (COMPLETADA: pantalla completa, input de 16px, cancelar visible). |
| **Configuración de Usuario & Preferencias** | `src/components/common/UserMenu.tsx` | Sí | **Fase 1** (implementada en BottomSheet) y ajustes en **Fase 4**. |
| **Historial de Cursadas y Docentes cursados** | `EnrollmentModal.tsx` & `SubjectDrawer.tsx` | Sí | **Fase 2** (pestaña cursadas en drawer) y **Fase 4** (modal de cursada). |
| **Reseñas de Comisiones y Docentes** | `ReviewFormModal.tsx` & `ScheduleLeftPanel.tsx` | Sí | **Fase 3** (insignias en comisiones) y **Fase 4** (formulario de reseña táctil). |
| **Propuestas Guardadas del Armador** | `ScheduleSummaryPanel.tsx` & `ScheduleCombinationsModal.tsx` | Sí | **Fase 3** (drawer de propuestas guardadas 1, 2, 3 en mobile). |
| **Modal de Reautenticación de Admin** | `src/components/admin/AdminReauthModal.tsx` | Sí | **Fase 5** (modal adaptable en mobile con teclado numérico). |
| **Términos de Uso de Biblioteca (#library/terms)** | `src/components/library/LibraryTermsPage.tsx` | Sí | **Fase 4** (lectura en mobile con tipografía legible y márgenes cómodos). |
| **Migración de Datos Locales** | `LocalStorageMigrationModal.tsx` | Sí | **Fase 1** (JSON export/import) y **Fase 2** (modal de bienvenida). |
| **Pantallas de Vacío, Error y Offline** | `AdminErrorBoundary.tsx`, `EmptyLibraryState.tsx`, `SyncStatusBadge.tsx` | Sí | **Fase 4** y **Fase 5** (estados vacíos con CTA táctil grande). |
| **Admin Overview (Métricas y gráficos)** | `src/components/admin/tabs/AdminOverviewTab.tsx` | Sí | **Fase 5** (gráficos responsivos en 1 columna). |
| **Admin Usuarios (Tabla de estudiantes)** | `src/components/admin/tabs/AdminUsersTab.tsx` | Sí | **Fase 5** (conversión de `table` a lista de tarjetas táctiles). |
| **Admin Reseñas (Moderación)** | `src/components/admin/tabs/AdminReviewsTab.tsx` | Sí | **Fase 5** (tarjetas de reseñas con botones Aprobar/Rechazar $\ge 44\text{ px}$). |
| **Admin Horarios (Comisiones del plan)** | `src/components/admin/tabs/AdminScheduleTab.tsx` | Sí | **Fase 5** (tarjetas de comisiones con edición táctil). |
| **Admin Biblioteca (Archivos y Storage)** | `src/components/admin/tabs/AdminLibraryTab.tsx` | Sí | **Fase 5** (moderación de archivos y test storage en tarjetas). |
| **Admin Auditoría (Logs de seguridad)** | `src/components/admin/tabs/AdminAuditTab.tsx` | Sí | **Fase 5** (feed vertical de eventos de auditoría). |

---

## 5. Notas y Directivas para Fases Futuras

1. **Armador de Horarios (Fase 3)**:
   - Al separar "Grilla" y "Comisiones" en pestañas para mobile, la selección de cualquier comisión debe reflejar de inmediato en pantalla si presenta superposiciones mediante una alerta visual persistente o mini-preview.
   - Los choques horarios se mostrarán siempre mediante la combinación de **color + ícono de advertencia + texto explicativo** (no solo color, para accesibilidad).
   - El layout de escritorio y el archivo `test/scheduleLayout.test.ts` deben mantenerse intactos y en verde.
2. **Planificador de Cuatrimestre (Fase 4)**:
   - La barra flotante inferior que resume las materias elegidas y el botón de acción debe posicionarse por encima de la barra de navegación móvil:
     `bottom: calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 0px) + 0.75rem); z-index: var(--z-planner-bar);`.
3. **Biblioteca (Fase 4)**:
   - El input nativo de archivos debe llevar:
     `accept="application/pdf,image/jpeg,image/png,image/webp"` y **SIN el atributo `capture`**, permitiendo al estudiante elegir con libertad si subir desde la fototeca/galería, selector de archivos del dispositivo o cámara en vivo.
   - El consentimiento de Términos y Condiciones se realiza mediante el checkbox legal del formulario, sin modificar roles ni APIs del backend.


---

## 6. Fase 3.5: Correcciones tras prueba en celular real (Parte 0)

Se realizaron ajustes críticos tras pruebas en dispositivo Android real (Chrome, ~411 dp) en las vistas de **Mapa** y **Horarios**, resolviendo problemas de usabilidad, desbordes y colisiones de interfaz.

### A. Mapa de Correlativas
1. **M1 & M3 (Paneles superiores y controles de zoom)**:
   - Se eliminó el botón flotante `MobileFitViewButton` que colisionaba en la esquina superior derecha (`top-3 right-3`) provocando el texto cortado "entrar".
   - Se unificó la barra superior flotante en un único contenedor responsive flex que alberga el selector segmentado `[ 📋 Lista | 🗺️ Mapa ]`, la leyenda compacta y el interruptor de Electivas.
   - Los controles de zoom de React Flow se reposicionaron en la esquina inferior derecha (`!right-3 md:!left-4`) con `showInteractive={false}`, eliminando el candado innecesario y asegurando botones de control $\ge 44 \times 44\text{ px}$.
2. **M2 (Grafo legible en mobile)**:
   - Al visualizar el grafo en pantallas móviles se desactiva el `fitView` global en el montaje (`fitView={!isMobile}`), aplicando un `defaultViewport={{ x: 50, y: 120, zoom: 0.78 }}` que garantiza un tamaño de texto legible (~11-12px efectivos).
   - Se restringió `minZoom={isMobile ? 0.35 : 0.2}` y se delimitó el paneo mediante `translateExtent` para evitar que el usuario se pierda en el lienzo vacío.
3. **M4 (Vista en Lista)**:
   - Se creó el componente `SubjectListView.tsx`, establecido como vista por defecto en mobile (`DEFAULT_MOBILE_GRAPH_VIEW = 'lista'`), persistiendo la preferencia en `localStorage.getItem('ui_mobile_graph_view')`.
   - Agrupa las materias por año académico (1° a 5° año) con porcentaje de avance por nivel.
   - Cada tarjeta muestra código, nombre, modalidad, horas semanales y estado (`StatusBadge`).
   - Para materias bloqueadas, evalúa correlativas mediante `checkEligibility` e indica explícitamente los motivos de bloqueo (`🔒 Falta regularizar: X`, `🔒 Falta aprobar: Y`).
   - Respeta estrictamente la orientación de Analista Universitario, el modo simulación y las electivas.

### B. Armador de Horarios
1. **H1 (Fila de herramientas compacta)**:
   - Se rediseñó la cabecera móvil a un ancho total inferior a 280 px: título "Horarios" + toggle `[ 1C | 2C ]` a la izquierda, y 3 botones táctiles de $40 \times 40\text{ px}$ a la derecha: Deshacer (`Undo2`), Rehacer (`Redo2`) y Más Opciones (`MoreHorizontal`).
   - "Planes" y "Resumen" se movieron al sheet de Más Opciones y a la barra flotante inferior, eliminando el corte del botón "..." en pantallas angostas.
2. **H2 (Tira de días en la grilla)**:
   - Se removieron los chevrons inline y el switch Día/Semana que apretaban los días en mobile.
   - La tira de días ocupa el ancho completo con scroll horizontal suave (`snap-x snap-mandatory`), 6 píldoras táctiles (LUN a SÁB) $\ge 44\text{ px}$ y auto-centrado del día seleccionado (`scrollIntoView({ inline: 'center' })`).
3. **H3 & H4 (Buscador y Sheet de Filtros)**:
   - En la lista de comisiones, el racimo de filtros inline se reemplazó en mobile por una barra sticky con input de búsqueda (16px, min-h 44px) y botón "Filtros" con badge de filtros activos.
   - Los filtros completos (turno, choques, sólo disponibles, ordenamiento y valoración docente sin truncar) se gestionan en un `BottomSheet`.
   - Cuando hay filtros activos, se muestra una tira horizontal compacta de chips descartables (`✕`).
4. **H5 (Dos modos limpios en mobile)**:
   - Se eliminó el modo "Dividida" roto en mobile, dejando un selector segmentado limpio de 2 pestañas: `[ 📚 Comisiones ]` y `[ 📅 Mi Semana ]`.
   - Ambas vistas aprovechan el 100% de la altura útil de la pantalla con scroll vertical único.
5. **H6 (Barra flotante inferior de resumen)**:
   - Se incorporó una barra fija flotante situada por encima de la barra de navegación:
     `bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px)+0.5rem)]`.
   - Muestra en todo momento: `📚 X mat. • ⏱️ Y hs • [⚠️ Z choques | ✓ Sin choques]`.
   - Al tocarla abre el drawer de Resumen o cambia a la vista de Grilla.

### C. Verificaciones Realizadas
- **Tests unitarios y de integración**: 9 suites completas en verde (20/20 en `mobileFrontend.test.ts`, `scheduleLayout.test.ts` intacto).
- **Build de producción**: `npm run build` exitoso (0 errores de TypeScript y bundling).
- **Desborde horizontal**: Verificado mediante CDP en viewports de 360, 390, 411 y 414 px (`document.documentElement.scrollWidth === window.innerWidth`, 0 desborde).
- **Capturas de pantalla reales**:
  - `screenshot_map_lista.png`: Vista Lista con tarjetas, estados y porcentajes.
  - `screenshot_map_graph.png`: Vista Grafo con zoom legible (0.78), sin superposición superior y controles accesibles.
  - `screenshot_schedule_comisiones.png`: Vista Comisiones con cabecera < 280 px, buscador + botón Filtros y barra flotante de resumen.
  - `screenshot_schedule_filtros.png`: BottomSheet de filtros con opciones completas y targets táctiles $\ge 44\text{ px}$.
  - `screenshot_schedule_semana.png`: Vista Mi Semana con tira de 6 días completa, auto-centrado y grilla de pantalla completa.

### D. Qué NO se pudo verificar en este entorno
- **Sensación táctil física (haptics)** en un teléfono real físico con los dedos del usuario (se verificó con emulación móvil de Edge CDP a 411x823, pero no en el hardware físico de un celular Android o iOS particular).
- **Notch / Dynamic Island real de iOS** (el emulador aplica safe-area CSS estándar `env(safe-area-inset-*)`, pero la curvatura física del cristal depende del dispositivo del usuario).


---

## 7. Cierre de la Parte 0 y Pendientes (Parte 0.5)

Esta subfase consolida todas las correcciones necesarias detectadas en pruebas reales y resuelve los puntos pendientes de fases anteriores antes de continuar con la Fase 4.

### 1. Viewport y Extensión Dinámica del Grafo en Mobile
- **Centrado inteligente**: En lugar de coordenadas fijas, el viewport inicial calcula el centro de interés real del estudiante:
  - Prioridad 1: Centroide de las materias en estado `cursando`.
  - Prioridad 2 (fallback): Centroide del primer año académico que contenga materias no aprobadas.
  - Nivel de zoom inicial fijado en `0.78` (asegura texto de etiquetas >= 11.7 px efectivo).
- **Límites dinámicos (`dynamicTranslateExtent`)**: Se calcula en tiempo de ejecución a partir de la bounding box real de los nodos montados (`[minX - 300, minY - 250], [maxX + 240 + 300, maxY + 120 + 250]`). Funciona idénticamente con Plan 2023, Plan 2008, orientación Analista (nodo 99) activada o desactivada, visualización de electivas encendida o apagada, y modo simulación.
- **Botón "Ver todo" (`FitViewButton`)**: El ajuste global `fitView` se reserva exclusivamente para este botón flotante en la barra superior con animación suave (`duration: 600ms`).
- **Interacción táctil sin aperturas accidentales**:
  - `nodesDraggable={!isMobile}`: En mobile los nodos no se pueden arrastrar individualmente.
  - `nodeClickDistance={5}`: Todo gesto de arrastre (drag > 5 px) panea el lienzo sin disparar el drawer; solo un tap limpio abre los detalles de la materia.

### 2. Armador de Horarios: "Mi Horario" (Semana Completa vs Por Día)
- **Renombrado semántico**: La pestaña móvil se renombró de "Mi Semana" a **"Mi Horario"** para reflejar con fidelidad lo que muestra.
- **Selector de modo en mobile**: Se incorporó un switch segmentado `[ Por Día | Semana Completa ]`:
  - **Por Día**: Grilla de un solo día en pantalla completa con tira horizontal de 6 días (LUN a SÁB), navegación táctil con swipe y auto-centrado del día activo.
  - **Semana Completa**: Grilla tradicional de 6 columnas simultáneas con scroll horizontal fluido (`overflow-x-auto min-w-[640px]`), cabeceras de horas fijadas a la izquierda y visualización global de huecos y choques, sin desbordar el contenedor de la página.

### 3. Descubribilidad de "Planes" y Padding Inferior en Horarios
- **Acceso directo a Planes**: Se añadió un botón visible `[ 📋 Planes (${scheduleDrafts.length}) ]` directamente en la barra flotante inferior persistente y dentro del menú "...", permitiendo acceder de inmediato a las propuestas guardadas.
- **Padding inferior garantizado**: Se ajustó el contenedor raíz a:
  `pb-[calc(var(--mobile-nav-height,56px)+84px+env(safe-area-inset-bottom,0px))]`.
  La barra flotante nunca tapa la última tarjeta de comisión ni el último slot de hora.

### 4. Causa Raíz y Solución del Error en `useProfessorRatings.ts`
- **Diagnóstico**: Al cargar la app sin reseñas registradas o con respuesta vacía, el endpoint `/api/professors/ratings` retornaba `{ success: true, data: [] }`. La expresión `res.data ? res.data : null` evaluaba `[]` como truthy, asignando un array a la variable `data`.
- **Efecto**: TypeScript tipaba `data` como objeto `RatingsBatchData`, pero en runtime `[].byNormalizedName` era `undefined`. Al consultar `data.byNormalizedName[norm]`, el navegador lanzaba `TypeError: Cannot read properties of undefined (reading 'esther irene romoli')`.
- **Alcance**: No era un bug móvil; ocurría tanto en desktop como en mobile en producción. No fallaba en los tests porque los mocks unitarios proveían un objeto con claves válidas `{ byId: {}, byNormalizedName: {} }`.
- **Corrección**: Normalización defensiva en la resolución de la promesa del hook: si la respuesta no contiene `byId` o `byNormalizedName`, se asigna de inmediato `{ byId: {}, byNormalizedName: {}, thresholds: DEFAULT_THRESHOLDS }`. Además se blindó `getRatingForProfessor` con chequeo nulo anticipado.

### 5. Tablets (768 a 1023 px) y Landscape Corto
- **Ajuste para Tablets**: En tablets la barra inferior de navegación no existe (`md:hidden`, oculta a >= 768 px). Se configuró en `src/index.css`:
  ```css
  @media (min-width: 768px) {
    :root {
      --mobile-nav-height: 0px;
    }
  }
  ```
  Esto garantiza que ninguna vista descuente espacio fantasma ni deje huecos vacíos en tablets.
- **Landscape Corto (<= 500 px)**:
  ```css
  @media (max-width: 767.98px) and (orientation: landscape) and (max-height: 500px) {
    :root {
      --mobile-nav-height: 2.75rem; /* 44px compactos */
    }
  }
  ```
  Permite maximizar el área vertical útil cuando el teléfono se rota horizontalmente.

### 6. Pila de Capas y Sheets Anidados
- En `src/components/common/BottomSheet.tsx` se formalizó el registro y desregistro en una pila de capas (`registerLayer(id)`, `unregisterLayer(id)`).
- Al abrir un sheet secundario o un diálogo modal sobre un sheet primario (por ejemplo, diálogo de confirmación sobre el sheet de Planes o Resumen), el bloqueo de scroll del `body` permanece activo mientras `openLayerCount > 0`.
- El scroll del documento se libera única y exclusivamente cuando se cierra la última capa.
- La pulsación de la tecla Escape o el tap en el fondo oscuro despacha el evento solo a la capa superior activa.

### 7. Materias Promocionadas en el Tablero Kanban Mobile
- **Mapeo**: En mobile, la 4ta columna agrupa tanto materias aprobadas por final como materias promocionadas (`filterFn: (st) => st === 'aprobada' || st === 'promocionada'`).
- **Identificación**: Cada tarjeta exhibe su correspondiente `StatusBadge` distinguiendo el estado ("Aprobada" o "Promocionada") y la calificación obtenida.
- **Acción táctil >= 44 px**: Cada tarjeta incluye el botón "Cambiar", el cual abre `QuickStatusModal` desplegado como `BottomSheet`. Desde allí el estudiante puede conmutar y asignar cualquiera de los estados válidos (Cursando, Regularizada, Aprobada, Promocionada con nota), respetando las correlativas del Plan 2023 o 2008, el interruptor Analista y el modo simulación.

### 8. Tabla Centralizada de Migración de Z-Index

| Componente / Elemento | Z-Index Anterior | Variable Centralizada Nueva | Valor Efectivo |
| :--- | :--- | :--- | :--- |
| Barra flotante de resumen (Schedule) | `z-30` / hardcoded | `var(--z-planner-bar)` | `35` |
| Barra de navegación inferior móvil | `z-40` / hardcoded | `var(--z-mobile-nav)` | `40` |
| Fondo oscuro de modales / sheets (Backdrop) | `z-40` / `z-50` | `var(--z-modal-backdrop)` | `45` |
| Contenedor BottomSheet / Modales estándar | `z-50` / `z-[60]` | `var(--z-modal)` | `50` |
| Modales anidados / Diálogos de confirmación | `z-50` / `z-[70]` | `var(--z-modal-elevated)` | `55` |
| Menú de usuario desplegable (UserMenu Sheet) | `z-50` / hardcoded | `var(--z-dropdown)` | `50` |
| Notificaciones flotantes (Toasts / Alertas) | `z-50` / hardcoded | `var(--z-toast)` | `60` |
| Spotlight de Tutorial Interactivo | `z-[100]` / hardcoded | `var(--z-spotlight)` | `100` |

### 9. Conteo Exacto de Tests

Ejecución de las 9 suites mediante `npm test`:

| Archivo de Test | Casos / Escenarios | Aserciones | Estado |
| :--- | :---: | :---: | :---: |
| `test/correlativas.test.ts` | 17 | 106 | ✅ PASS |
| `test/scheduleImport.test.ts` | 14 | 84 | ✅ PASS |
| `test/reviewsFrontend.test.ts` | 10 | 64 | ✅ PASS |
| `test/authFrontend.test.ts` | 4 | 19 | ✅ PASS |
| `test/brand.test.ts` | 26 | 19 | ✅ PASS |
| `test/scheduleLayout.test.ts` | 6 | 20 | ✅ PASS |
| `test/adminFrontend.test.ts` | 6 | 24 | ✅ PASS |
| `test/libraryFrontend.test.ts` | 14 | 45 | ✅ PASS |
| `test/mobileFrontend.test.ts` | 20 | 194 | ✅ PASS |
| **TOTAL** | **117** | **575** | **100% PASS** |

### 10. Matriz de Verificación Visual y Medición de Desborde (CDP)

Pruebas automatizadas mediante Microsoft Edge en modo headless vía Chrome DevTools Protocol (CDP) conectando a `http://127.0.0.1:8080/`:

| Pantalla / Vista | Viewport | scrollWidth | innerWidth | Desborde Horizontal | Captura Generada |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Mapa (Desktop)** | 1280x800 | 1272 px | 1280 px | **0 px (PASS ✅)** | `screenshot_desktop_map_1280.png` |
| **Horarios (Desktop 3 col)** | 1280x800 | 1272 px | 1280 px | **0 px (PASS ✅)** | `screenshot_desktop_schedule_1280.png` |
| **Mapa (Tablet)** | 900x800 | 892 px | 900 px | **0 px (PASS ✅)** | `screenshot_tablet_map_900.png` |
| **Horarios (Tablet compacto)** | 900x800 | 900 px | 900 px | **0 px (PASS ✅)** | `screenshot_tablet_schedule_900.png` |
| **Mapa Lista** | 412x740 | 412 px | 412 px | **0 px (PASS ✅)** | `screenshot_map_lista_412.png` |
| **Mapa Grafo (Plan 2023)** | 412x740 | 412 px | 412 px | **0 px (PASS ✅)** | `screenshot_map_graph_2023_412.png` |
| **Horarios Comisiones** | 412x740 | 412 px | 412 px | **0 px (PASS ✅)** | `screenshot_schedule_comisiones_412.png` |
| **Horarios Sheet Filtros** | 412x740 | 412 px | 412 px | **0 px (PASS ✅)** | `screenshot_schedule_filtros_412.png` |
| **Horarios Mi Horario (Día)** | 412x740 | 412 px | 412 px | **0 px (PASS ✅)** | `screenshot_schedule_horario_dia_412.png` |
| **Horarios Mi Horario (Semana)** | 412x740 | 412 px | 412 px | **0 px (PASS ✅)** | `screenshot_schedule_horario_semana_412.png` |
| **Tablero Kanban** | 412x740 | 412 px | 412 px | **0 px (PASS ✅)** | `screenshot_kanban_412.png` |
| **Mapa Lista** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_map_lista_360.png` |
| **Mapa Grafo (Plan 2023)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_map_graph_2023_360.png` |
| **Horarios Comisiones** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_schedule_comisiones_360.png` |
| **Horarios Mi Horario (Día)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_schedule_horario_dia_360.png` |
| **Horarios Mi Horario (Semana)** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_schedule_horario_semana_360.png` |
| **Tablero Kanban** | 360x640 | 360 px | 360 px | **0 px (PASS ✅)** | `screenshot_kanban_360.png` |

#### Estado de Verificación
- **Verificado**:
  - 100% de las pantallas renderizadas sin desborde horizontal (`scrollWidth <= innerWidth`).
  - Viewports móviles (360x640 y 412x740), tablet (900x800) y desktop (1280x800).
  - Comportamiento de zoom inicial y dinámica de `translateExtent` en el grafo.
  - Apertura y cierre de BottomSheets con scroll-lock y safe-area insets.
  - Modos "Por Día" y "Semana Completa" con scroll horizontal encapsulado en Horarios.
  - Botón "Planes" visible y descubierto en la barra flotante.
  - Compilación limpia con Vite y TypeScript (`npm run build`).
  - 117 tests / 575 aserciones en verde en `npm test`.
- **NO verificado**:
  - **Sensación táctil física (haptics)** y fricción en dedos sobre la pantalla de cristal de un modelo físico específico de smartphone Android o iPhone.
  - **Curvatura física de esquinas de hardware y Dynamic Island real**: se validó la compatibilidad con las variables CSS oficiales `env(safe-area-inset-*)`, pero la apariencia de los radios de curvatura físicos varía por fabricante.


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
- **Canasta móvil en BottomSheet**: Reemplaza la columna derecha en mobile (la cual se oculta con `hidden lg:block`), permitiendo vaciar la selección, ver la evaluación de carga horaria, quitar materias individuales con botones $\ge 44	ext{ px}$ y ejecutar "Armar horarios" o "Marcar todas como Cursando".
- **Padding inferior**: Se aplicó `pb-[calc(var(--mobile-nav-height,4rem)+5rem+env(safe-area-inset-bottom,0px))]` en el contenedor para evitar que la barra flotante tape materias.

### Electivas Libres (`ElectivesPicker.tsx`)
- **Selector segmentado de años**: Barra desplazable con chips táctiles `[ Todos los años | 1° | 2° | 3° | 4° | 5° ]` con altura mínima de 44 px. Al seleccionar un año, la vista filtra y muestra únicamente ese año para facilitar la lectura.
- **Drag & Drop**: Inactivo en dispositivos táctiles (`draggable={!isMobile}`) para evitar que el arrastre interfiera con el scroll.
- **Modal de Agregar Electiva**: Se adaptó con estilo bottom-sheet en mobile (`items-end sm:items-center`, `rounded-t-3xl`), z-index estricto `z-[var(--z-modal)]`, input de búsqueda con `text-base sm:text-xs` ($\ge 16	ext{ px}$) para evitar zoom en iOS Safari, y botones de acción con altura mínima de 44 px.

### Estadísticas (`StatsDashboard.tsx`)
- **Contenedor 100% seguro**: Clases `w-full overflow-hidden` en el envoltorio para evitar desbordes por diagramas circulares o barras.
- **KPIs en 2 columnas en mobile**: Las tarjetas de resumen y métricas de notas se adaptaron de `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` a `grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4`, con tipografía y SVGs circulares responsivos para encajar sin desbordar en 360 px.
- **Controles táctiles**: Selectores de nota mínima, switches de promedio y tabs horizontales con altura mínima de 44 px.
- **Camino Crítico**: Tarjetas verticales apiladas con wrapping en nombres largos y badges sin overflow.

### Profesores y Reseñas (`ProfessorsDirectory.tsx`, `ProfessorCard.tsx`, `ProfessorDetailModal.tsx`)
- **Buscador y Filtros en BottomSheet**: El input de búsqueda mide $\ge 16	ext{ px}$ (`text-base sm:text-xs`). En mobile se añade un botón "Filtros" con indicador de filtros activos que abre un `BottomSheet` completo con selector de materia, puntaje mínimo, ordenamiento y switch de reseñas.
- **Ficha de Profesor (`ProfessorDetailModal`)**: Modal responsivo con disposición de bottom sheet en mobile (`rounded-t-3xl`), z-index `var(--z-modal)` y pie sticky accesible con el pulgar para el botón "Dejar reseña".
- **Calificación por Estrellas (`StarRating.tsx`)**: En modo interactivo, cada estrella tiene un botón táctil de al menos $44 	imes 44	ext{ px}$ (`min-h-[44px] min-w-[44px]`) con separación adecuada para facilitar el tap preciso.
- **Formulario de Reseña (`ReviewFormModal.tsx`)**: Se configuró como hoja inferior en mobile (`max-h-[92dvh]`), con inputs y textarea de $\ge 16	ext{ px}$ para prevenir auto-zoom, contador de caracteres visible y pie con botón de envío sticky al fondo de la pantalla.

### Cursadas (`EnrollmentModal.tsx`)
- Modal responsivo con disposición inferior en mobile (`rounded-t-3xl`, `max-h-[90dvh]`), inputs con fuente de 16 px, botones de estado ("Cursando", "Regularizada", "Promocionada", "Quedé libre") y opciones de comisión con altura mínima de 44 px.

### Biblioteca Completa
- **UploadMaterialModal**:
  - Modal adaptado a bottom-sheet en mobile (`max-h-[92dvh]`, `rounded-t-3xl`), z-index `z-[var(--z-modal)]`.
  - Botón explícito accesible "Elegir archivo o foto" con altura de 44 px.
  - Etiqueta `<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp">` **sin atributo `capture`**, permitiendo al usuario elegir archivos existentes o usar la cámara según su preferencia.
  - Textos descriptivos claros de límites: PDF hasta 25 MB, imágenes hasta 10 MB.
  - Barra de progreso durante la subida, checkbox de términos legales con contenedor $\ge 44	ext{ px}$, inputs de $\ge 16	ext{ px}$ y botón de envío sticky al pie.
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
  - Botones y zonas interactivas cumplen con touch target $\ge 44	ext{ px}$.
  - Formularios e inputs con tamaño de fuente $\ge 16	ext{ px}$ en mobile para prevenir zoom no deseado en iOS Safari.
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
