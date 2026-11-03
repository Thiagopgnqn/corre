# Plan de Adaptación Mobile y Táctil — Stack

> **Rama activa:** `mobile`  
> **Objetivo:** Adaptar el 100% de la aplicación Stack para que sea una experiencia mobile-first cómoda, ergonómica para el pulgar, con targets táctiles $\ge 44 \times 44\text{ px}$, cero auto-zoom en iOS Safari, navegación intuitiva y sin scroll horizontal involuntario, **preservando el 100% de la experiencia y tests de escritorio intactos**.

---

## Estado Actual de las Fases

| Fase | Alcance | Estado | Notas / Cierre |
| :--- | :--- | :--- | :--- |
| **Fase 1** | **Infraestructura Base, BottomSheet, Navbar y UserMenu Mobile, Prevención Zoom iOS** | **COMPLETADA (con Ajustes de Cierre)** | Hook `useIsMobile`, componente accesible `BottomSheet`, Bottom Nav de 5 ítems con "Más", `UserMenu` adaptado a sheet, escala Z-Index migrada, safe-areas de notch y landscape, badge de avisos en "Más", sincronización del tutorial en mobile, y regla de font-size de 16px en mobile sin `!important`. Build y 9 suites de tests (100%) en verde. |
| **Fase 2** | Materias, Estados y Tableros (`SubjectDrawer`, `QuickStatusModal`, `KanbanBoard`) | Pendiente | Esperando aprobación para iniciar. |
| **Fase 3** | Armador de Horarios (`ScheduleBuilder`, grilla día/semana, comisiones táctiles) | Pendiente | Mantener layout y test de desktop intactos. |
| **Fase 4** | Planificador de Cuatrimestre, Biblioteca, Reseñas y Electivas | Pendiente | Barra flotante sobre bottom nav, formulario de material con galería/cámara. |
| **Fase 5** | Panel de Administración Completo (6 pestañas) y Métricas | Pendiente | Transformación de tablas HTML anchas a tarjetas táctiles responsivas. |
| **Fase 6** | Verificación visual final, pulido en viewports reales y documentación | Pendiente | 360x640, 390x844, 414x896 y landscape. |

---

## 1. Fase 1: Decisiones Tomadas y Ajustes de Cierre Implementados

1. **Rutas Reales de Componentes**:
   - `Navbar.tsx` reside en `src/components/common/Navbar.tsx` (corregida la referencia previa de `src/components/layout/Navbar.tsx`).
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
| **Menú contextual del Grafo (`CorrelativeGraph.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Menú emergente de clic derecho. |
| **Desplegable Más opciones desktop (`Navbar.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Menú flotante de escritorio. |
| **Desplegable de Usuario desktop (`UserMenu.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Menú flotante de usuario en escritorio. |
| **Contenedor BottomSheet (`BottomSheet.tsx`)** | `z-50` | `z-[var(--z-sheet)]` (50) | Panel modal inferior sobre fondo oscuro. |
| **Diálogos de Confirmación (`Navbar.tsx` / `UserMenu.tsx`)** | `z-50` | `z-[var(--z-modal)]` (50) | Modales de confirmación de reinicio y eliminación de cuenta. |
| **Aviso de Reseña Cursada (`ReviewRecommendationToast.tsx`)** | `z-[55]` | `z-[var(--z-toast)]` (60) | Notificación emergente flotante (ubicada con holgura por encima de la barra móvil). |
| **Spotlight de Tutorial Guiado (`TutorialSpotlight.tsx`)** | `z-50` | `z-[var(--z-modal-top)]` (70) | Capa superior que resalta cualquier elemento interactivo. |

6. **Despeje de Contenido y Prevención de Doble Scroll**:
   - `App.tsx` `<main>`:
     `pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom,0px))] md:pb-0`.
     Garantiza que ninguna vista de contenido regular quede tapada por la barra inferior fija en pantallas móviles.
   - `CorrelativeGraph.tsx`:
     Calcula su altura exacta restando la cabecera dinámica y la barra inferior móvil:
     `h-[calc(100dvh-var(--app-header-height,3.5rem)-var(--mobile-nav-height)-env(safe-area-inset-bottom,0px))] lg:h-[calc(100dvh-var(--app-header-height,4rem))]`.
     Elimina scroll vertical secundario y ajusta el zoom al área realmente visible.
   - `ScheduleBuilder.tsx`:
     Mantiene su altura fija `100dvh` con scroll interno en cada panel (`min-h-0`), con su test `scheduleLayout.test.ts` en verde sin modificaciones.

7. **Prevención de Zoom en iOS Safari (Sin `!important` y Acotada)**:
   - Regla en `src/index.css`:
     ```css
     @media (max-width: 767.98px) {
       input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="color"]),
       select,
       textarea {
         font-size: 16px;
       }
     }
     ```
   - No utiliza `!important`.
   - Excluye explícitamente checkboxes, radios, ranges, botones nativos y selectores de color.
   - `SixDigitInput` (código de 6 dígitos) utiliza `text-xl sm:text-2xl` (20px / 24px), por lo que no se ve alterado negativamente en su diseño.
   - `index.html` validado con `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />` sin bloquear el zoom manual del usuario.

8. **Tutorial Interactivo en Mobile**:
   - Se verificaron los 16 pasos del tutorial (`TUTORIAL_STEPS`):
     - **Paso 9 (`analista-switch`)**: en desktop está en la cabecera; en mobile vive dentro del sheet "Más". `TutorialSpotlight` ahora detecta si está en viewport móvil y activa automáticamente `setIsMoreMenuOpen(true)` para desplegar el BottomSheet y resaltar el switch.
     - **Paso 10 y 11 (`app-views` y `schedule-builder-tour`)**: apuntan a `[data-tour="nav-tabs"]`. La barra de navegación inferior móvil ahora porta `data-tour="nav-tabs"`, permitiendo que el spotlight la identifique y resalte de inmediato.
     - **Paso 14 (`persistence-tour`)**: apunta a `[data-tour="more-menu-btn"]`. En mobile este data-attribute está asignado al 5to botón de la barra ("Más"), guiando al usuario con exactitud.
     - **Paso 16 (`finish`)**: apunta a `[data-tour="onboarding-menu-item"]` (Carga rápida). La apertura automática del menú ya está soportada.
     - Ningún paso del tour queda con objetivo nulo o inaccesible en mobile.

9. **Badge de Avisos en "Más"**:
   - Si un usuario administrador tiene archivos pendientes de moderación en la biblioteca (`adminPendingCount > 0`), el botón "Más" de la barra inferior exhibe un punto ámbar pulsante (`hasMoreAdminBadge`).
   - Dentro del sheet "Más", el botón "Panel de Administración" indica la cantidad exacta de archivos pendientes (`{adminPendingCount} pend.`).

10. **Comportamiento en Landscape Corto (844x390) y Muescas (Notch)**:
    - Se aplicaron clases seguras con `env(safe-area-inset-left, 0px)` y `env(safe-area-inset-right, 0px)` en el contenedor raíz de `App.tsx`, en la cabecera `Navbar.tsx`, en la barra inferior móvil y en el `BottomSheet.tsx`.
    - En teléfonos rotados con notch lateral o esquinas redondeadas, los botones y contenidos respetan los márgenes seguros para evitar recortes.
    - Los BottomSheets ajustan su contenido con scroll interno fluido en `dvh`.

---

## 2. Tabla de Correspondencia: Navbar Desktop vs Mobile

| Elemento actual en Navbar Desktop | Ubicación en Mobile (< 768px) | Detalle de accesibilidad / interacción |
| :--- | :--- | :--- |
| **BrandLogo (Stack)** | Barra superior (Top bar) | Visible a la izquierda, adaptado en tamaño. |
| **Selector de Plan (Píldora Plan 2023 / 2008)** | Barra superior, Sheet "Más" y Sheet "Usuario" | Botón táctil en top bar; accesible también desde las hojas de opciones. |
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
| **Buscador rápido (Ctrl+K)** | Barra superior (Top bar) | **Botón táctil visible $\ge 44 \times 44\text{ px}$** con ícono de lupa (`Search`) para abrir con un solo toque (Ctrl+K no existe en móvil). |
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

## 3. Inventario Completo y Asignación por Fases

| Componente / Pantalla | Archivo | ¿Existe en el Repo? | Fase de Adaptación |
| :--- | :--- | :--- | :--- |
| **Electivas Libres por Año** | `src/components/electives/ElectivesPicker.tsx` | Sí | **Fase 4** (tarjetas de materias, filtros por año, selector de créditos). |
| **Niveles & Tablero Kanban** | `src/components/kanban/KanbanBoard.tsx` | Sí | **Fase 2** (desactivar drag HTML5 en touch, chips táctiles de cambio de estado). |
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

## 4. Notas y Directivas para Fases Futuras

1. **Biblioteca (Fase 4)**:
   - El input nativo de archivos debe llevar:
     `accept="application/pdf,image/jpeg,image/png,image/webp"` y **SIN el atributo `capture`**, permitiendo al estudiante elegir con libertad si subir desde la fototeca/galería, selector de archivos del dispositivo o cámara en vivo.
   - *Aclaración sobre "permisos"*: Se refiere exclusivamente al consentimiento explícito de Términos y Condiciones mediante el checkbox de aceptación legal y al acceso nativo del navegador a archivos/cámara. **No altera roles, cuotas ni reglas del backend Express**.
2. **Armador de Horarios (Fase 3)**:
   - Al separar "Grilla" y "Comisiones" en pestañas para mobile, la selección de cualquier comisión debe reflejar de inmediato en pantalla si presenta superposiciones mediante una alerta visual persistente o mini-preview.
   - Los choques horarios se mostrarán siempre mediante la combinación de **color + ícono de advertencia + texto explicativo** (no solo color, para accesibilidad).
   - El layout de escritorio y el archivo `test/scheduleLayout.test.ts` deben mantenerse intactos y en verde.
3. **Planificador de Cuatrimestre (Fase 4)**:
   - La barra flotante inferior que resume las materias elegidas y el botón de acción debe posicionarse por encima de la barra de navegación móvil:
     `bottom: calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 0px) + 0.75rem); z-index: var(--z-planner-bar);`.
4. **Kanban (Fase 2)**:
   - En desktop se preserva el drag & drop HTML5 nativo al 100%.
   - En dispositivos táctiles (`(hover: none) and (pointer: coarse)` o `isTouch`), cada tarjeta ofrecerá un selector rápido o tap directo para abrir el `QuickStatusModal` en formato BottomSheet.
5. **Mapa de Correlativas (Fase 2)**:
   - El `MiniMap` se oculta en pantallas móviles para no tapar los nodos.
   - Se aplicará `fitView` con padding generoso y un botón flotante accesible para re-centrar el lienzo en el año cursado actual.
