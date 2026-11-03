# Plan de Adaptación Mobile y Táctil — Stack

> **Rama activa:** `mobile`  
> **Objetivo:** Adaptar el 100% de la aplicación Stack para que sea una experiencia mobile-first cómoda, ergonómica para el pulgar, con targets táctiles $\ge 44 \times 44\text{ px}$, cero auto-zoom en iOS Safari, navegación intuitiva y sin scroll horizontal involuntario, **preservando el 100% de la experiencia y tests de escritorio intactos**.

---

## Estado Actual de las Fases

| Fase | Alcance | Estado | Notas / Cierre |
| :--- | :--- | :--- | :--- |
| **Fase 1** | **Infraestructura Base, BottomSheet, Navbar y UserMenu Mobile, Prevención Zoom iOS** | **COMPLETADA (con Ajustes de Cierre)** | Hook `useIsMobile`, componente accesible `BottomSheet`, Bottom Nav de 5 ítems con "Más", `UserMenu` adaptado a sheet, escala Z-Index migrada, safe-areas de notch y landscape, badge de avisos en "Más", sincronización del tutorial en mobile, y regla de font-size de 16px en mobile sin `!important`. Build y tests (100%) en verde. |
| **Fase 2** | **Materias, Estados y Tableros (`SubjectDrawer`, `QuickStatusModal`, `KanbanBoard`, `PlanSelectorModal`, `SearchModal`, Grafo)** | **COMPLETADA** | `QuickStatusModal` en `BottomSheet` con validación de correlativas y nota táctil; `SubjectDrawer` en `BottomSheet` con 5 pestañas segmentadas; `CorrelativeGraph` con botones $\ge 44\text{ px}$ y botón flotante de re-centrado; `KanbanBoard` con 1 columna a la vez en mobile y drag & drop desactivado en touch; `PlanSelectorModal` en sheet; y `SearchModal` en pantalla completa con font-size $\ge 16\text{ px}$. 10 tests de mobile y 9 suites del proyecto (100%) en verde. |
| **Fase 3** | Armador de Horarios (`ScheduleBuilder`, grilla día/semana, comisiones táctiles) | Pendiente | Mantener layout y test de desktop intactos. |
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
| **Barra Inferior Móvil (`Navbar.tsx`)** | `z-40` | `z-[var(--z-mobile-nav)]` (40) | Capa fija inferior; siempre visible sobre el contenido pero bajo modales. |
| **Controles y Leyenda del Grafo (`CorrelativeGraph.tsx`)** | `z-20` / default | `z-[var(--z-graph-controls)]` (30) | Flotantes dentro del canvas, debajo de la barra móvil y de la cabecera. |
| **Botón flotante Re-centrar mapa (`CorrelativeGraph.tsx`)** | Nuevo | `z-[var(--z-graph-controls)]` (30) | Botón flotante accesible en mobile dentro del canvas. |
| **Menú contextual del Grafo (`CorrelativeGraph.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Menú emergente de clic derecho. |
| **Desplegable Más opciones desktop (`Navbar.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Menú flotante de escritorio. |
| **Desplegable de Usuario desktop (`UserMenu.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Menú flotante de usuario en escritorio. |
| **Contenedor BottomSheet (`BottomSheet.tsx`)** | `z-50` | `z-[var(--z-sheet)]` (50) | Panel modal inferior sobre fondo oscuro. |
| **Detalle de Materia Desktop (`SubjectDrawer.tsx`)** | `z-50` | `z-[var(--z-sheet)]` (50) | Panel lateral de escritorio y backdrop `z-[var(--z-backdrop)]`. |
| **Modal Selector de Estado (`QuickStatusModal.tsx`)** | `z-50` | `z-[var(--z-sheet)]` (mobile) / `z-[var(--z-modal)]` (desktop) | Diálogo de cambio rápido de estado académico. |
| **Modal Selector de Planes (`PlanSelectorModal.tsx`)** | `z-50` | `z-[var(--z-sheet)]` (mobile) / `z-[var(--z-modal)]` (desktop) | Catálogo universitario y planes de estudio. |
| **Buscador Rápido (`SearchModal.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Pantalla completa en mobile y modal centrado en desktop. |
| **Diálogos de Confirmación (`Navbar.tsx` / `UserMenu.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Modales de confirmación de reinicio y eliminación de cuenta. |
| **Aviso de Reseña Cursada (`ReviewRecommendationToast.tsx`)** | `z-[55]` | `z-[var(--z-toast)]` (60) | Notificación emergente flotante sobre la barra móvil. |
| **Spotlight de Tutorial Guiado (`TutorialSpotlight.tsx`)** | `z-50` | `z-[var(--z-modal-top)]` (70) | Capa superior que resalta cualquier elemento interactivo. |

6. **Despeje de Contenido y Prevención de Doble Scroll**:
   - `App.tsx` `<main>`: `pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px))] md:pb-0`.
   - `CorrelativeGraph.tsx`: altura `calc(100dvh - var(--app-header-height) - var(--mobile-nav-height) - safe-area)`.
   - `ScheduleBuilder.tsx`: mantiene `100dvh` con scroll interno en cada panel (`min-h-0`).

7. **Prevención de Zoom en iOS Safari (Sin `!important` y Acotada)**:
   - Regla en `src/index.css` a $16\text{ px}$ en `< 768px` para inputs de texto, select y textarea.
   - Excluye checkboxes, radios, ranges, submit/buttons y selectores de color.

8. **Tutorial y Badges**:
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
