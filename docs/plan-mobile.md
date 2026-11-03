# Plan de Adaptación Mobile y Táctil — Stack

> **Rama activa:** `mobile`  
> **Objetivo:** Adaptar el 100% de la aplicación Stack para que sea una experiencia mobile-first cómoda, ergonómica para el pulgar, con targets táctiles $\ge 44 \times 44\text{ px}$, cero auto-zoom en iOS Safari, navegación intuitiva y sin scroll horizontal involuntario, **preservando el 100% de la experiencia y tests de escritorio intactos**.

---

## Estado Actual de las Fases

| Fase | Alcance | Estado | Notas / Cierre |
| :--- | :--- | :--- | :--- |
| **Fase 1** | **Infraestructura Base, BottomSheet, Navbar y UserMenu Mobile, Prevención Zoom iOS** | **COMPLETADA** | Hook `useIsMobile`, componente accesible `BottomSheet`, Bottom Nav de 5 ítems con "Más", `UserMenu` adaptado a sheet, escala Z-Index y regla de font-size de 16px en mobile. Build y 9 suites de tests en verde. |
| **Fase 2** | Materias, Estados y Tableros (`SubjectDrawer`, `QuickStatusModal`, `KanbanBoard`) | Pendiente | Esperando aprobación para iniciar. |
| **Fase 3** | Armador de Horarios (`ScheduleBuilder`, grilla día/semana, comisiones táctiles) | Pendiente | Mantener layout y test de desktop intactos. |
| **Fase 4** | Planificador de Cuatrimestre, Biblioteca, Reseñas y Electivas | Pendiente | Barra flotante sobre bottom nav, formulario de material con galería/cámara. |
| **Fase 5** | Panel de Administración Completo (6 pestañas) y Métricas | Pendiente | Transformación de tablas HTML anchas a tarjetas táctiles responsivas. |
| **Fase 6** | Verificación visual final, pulido en viewports reales y documentación | Pendiente | 360x640, 390x844, 414x896 y landscape. |

---

## 1. Fase 1: Decisiones Tomadas y Cambios Implementados

1. **Breakpoint Consistente con Tailwind `md`**:
   - `src/hooks/useIsMobile.ts` evalúa `(max-width: 767.98px)`.
   - Se utiliza solo para decisiones de comportamiento interactivo (ej. abrir un BottomSheet en vez de un dropdown absoluto). Todo el layout visual se maneja preferentemente con clases utilitarias responsivas de Tailwind (`md:`, `lg:`).
   - Capacidades táctiles mediante `(hover: none) and (pointer: coarse)`.
   - Detección de pantallas horizontales con baja altura mediante `(orientation: landscape) and (max-height: 500px)`.
2. **Componente Reutilizable y Accesible `BottomSheet` (`src/components/common/BottomSheet.tsx`)**:
   - Cumple WAI-ARIA para diálogos modales: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`.
   - Gestión de foco: al abrir enfoca el primer elemento interactivo; al cerrar devuelve el foco al elemento disparador previo.
   - Trampa de foco (Focus Trap): cicla mediante `Tab` y `Shift+Tab` dentro del sheet impidiendo escapar al fondo.
   - Mecanismos de cierre: tecla `Escape`, tap sobre el backdrop semi-transparente, y botón `X` visible de $44 \times 44\text{ px}$ (`w-11 h-11`).
   - Scroll-lock en el `body` no destructivo (`overflow: hidden` mientras está abierto, restaurando el valor anterior).
   - Prevención de rebote en iOS Safari con `overscroll-behavior: contain`.
   - Soporte de gestos: arrastre hacia abajo (swipe-to-close) capturado con **Pointer Events exclusivamente en la cabecera / handle** para no interferir nunca con el scroll interno del contenido.
   - Teclado virtual: los botones de acción (footer) van `sticky` dentro del propio sheet, no en un `position: fixed` flotante desvinculado.
   - Respeto de `prefers-reduced-motion` para usuarios con sensibilidad visual.
3. **Escala Centralizada de Capas (Z-Index) y Alturas**:
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
4. **Prevención Global de Zoom en iOS Safari**:
   - Regla CSS en `src/index.css`:
     ```css
     @media (max-width: 767.98px) {
       input, select, textarea {
         font-size: 16px !important;
       }
     }
     ```
   - `index.html` verificado: `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />` sin `user-scalable=no` ni `maximum-scale`.
5. **No `overflow-x-hidden` simultáneo en HTML y Body**:
   - Solo `body` posee `overflow-x: hidden`; `html` no se toca para no quebrar `position: sticky` ni el scroll en iOS.

---

## 2. Tabla de Correspondencia: Navbar Desktop vs Mobile

| Elemento actual en Navbar Desktop | Ubicación en Mobile (< 768px) | Detalle de accesibilidad / interacción |
| :--- | :--- | :--- |
| **BrandLogo (Stack)** | Barra superior (Top bar) | Visible a la izquierda, adaptado en tamaño. |
| **Selector de Plan (Píldora Plan 2023 / 2008)** | Barra superior & Sheet "Más" & Sheet "Usuario" | Botón táctil en top bar; accesible también desde las hojas de opciones. |
| **Pestaña Mapa (Correlativas)** | Barra inferior (Bottom Nav) — Ítem 1 | Botón táctil con altura $\ge 48\text{ px}$ (`min-h-[52px]`), ícono de $24\text{ px}$ (`w-6 h-6`), texto $\ge 11\text{ px}$. |
| **Pestaña Horarios (Armador)** | Barra inferior (Bottom Nav) — Ítem 2 | Botón táctil con altura $\ge 48\text{ px}$, ícono de $24\text{ px}$, texto $\ge 11\text{ px}$. |
| **Pestaña Biblioteca (Material)** | Barra inferior (Bottom Nav) — Ítem 3 | Botón táctil con altura $\ge 48\text{ px}$, ícono de $24\text{ px}$, texto $\ge 11\text{ px}$, badge de novedades activo. |
| **Pestaña Profesores (Reseñas)** | Barra inferior (Bottom Nav) — Ítem 4 | Botón táctil con altura $\ge 48\text{ px}$, ícono de $24\text{ px}$, texto $\ge 11\text{ px}$, badge de recomendaciones activo. |
| **Botón "Más"** | Barra inferior (Bottom Nav) — Ítem 5 | Botón táctil con altura $\ge 48\text{ px}$, ícono de $24\text{ px}$, texto "Más". Abre `BottomSheet` de Más Secciones. |
| **Pestaña Niveles (Kanban)** | Sheet "Más" | Ítem táctil $\ge 48\text{ px}$ con ícono `Kanban` y subtítulo explicativo. |
| **Pestaña Cuatrimestre (Planificador)** | Sheet "Más" | Ítem táctil $\ge 48\text{ px}$ con ícono `CalendarDays` y subtítulo explicativo. |
| **Pestaña Electivas (Catálogo)** | Sheet "Más" | Ítem táctil $\ge 48\text{ px}$ con ícono `Sparkles` y subtítulo explicativo. |
| **Pestaña Estadísticas (Camino Crítico)**| Sheet "Más" | Ítem táctil $\ge 48\text{ px}$ con ícono `BarChart3` y subtítulo explicativo. |
| **Panel de Administración (/#admin)** | Sheet "Más" & Sheet "Usuario" (Solo Admins) | Botón destacado con ícono `Shield`, visible **únicamente** si `user?.role === 'admin'`. Muestra badge de pendientes. |
| **Buscador rápido (Ctrl+K)** | Barra superior (Top bar) | **Botón táctil visible $\ge 44 \times 44\text{ px}$** con ícono de lupa (`Search`) para abrir con un solo toque (Ctrl+K no existe en móvil). |
| **Simulador "¿Y si...?"** | Barra superior & Sheet "Más" | Botón táctil en top bar y switch interactivo ON/OFF dentro del sheet "Más". |
| **Switch Analista (Seminario 99)** | Sheet "Más" | Switch táctil accesible ON/OFF (conserva selector `data-tour="analista-button"`). |
| **Efectos de sonido** | Sheet "Más" | Switch táctil accesible ON/OFF con íconos de volumen. |
| **Carga rápida por nivel** | Sheet "Más" | Botón táctil $\ge 44\text{ px}$ con ícono `Layers` (conserva `data-tour="onboarding-menu-item"`). |
| **Cargar muestra demo (3er año)** | Sheet "Más" | Botón táctil $\ge 44\text{ px}$ con ícono `Sparkles`. |
| **Ver tutorial interactivo** | Sheet "Más" | Botón táctil $\ge 44\text{ px}$ con ícono `HelpCircle`. |
| **Exportar carrera (JSON)** | Sheet "Más" & Sheet "Usuario" | Botón táctil $\ge 44\text{ px}$ con descarga inmediata. |
| **Importar carrera (JSON)** | Sheet "Más" | Botón táctil $\ge 44\text{ px}$ que abre el selector de archivo nativo. |
| **Reiniciar carrera...** | Sheet "Más" | Botón táctil de advertencia con diálogo de confirmación. |
| **Badge de Sync / Offline** | Barra superior (Top bar) | Indicador visual de estado de sincronización. |
| **Menú de Usuario / Perfil** | Barra superior (Top bar) | Botón táctil $\ge 44 \times 44\text{ px}$ con avatar que en mobile despliega `UserMenu` como `BottomSheet`. |
| **Aviso de mails de Biblioteca** | Sheet "Usuario" | Switch táctil con área de toque amplia ($\ge 44\text{ px}$). |
| **Cerrar Sesión** | Sheet "Usuario" & Sheet "Más" | Botón táctil $\ge 48\text{ px}$ de fácil acceso. |
| **Eliminar cuenta...** | Sheet "Usuario" | Botón táctil de acción peligrosa con modal de confirmación. |

---

## 3. Comportamiento en Orientación Horizontal (Landscape, ej. 844x390)

En teléfonos colocados en horizontal con poca altura ($< 500\text{ px}$):
- **Barra Superior**: Mantiene su altura compacta (máx 44px) para preservar el área de trabajo.
- **Barra Inferior**: Reduce el padding vertical manteniendo los targets táctiles accesibles.
- **Bottom Sheets**: Ajustan su altura máxima a `max-h-[92dvh]`, con cabecera compacta y scroll interno fluido, garantizando que el usuario siempre pueda ver los contenidos y los botones de acción sin que queden ocultos.
- **Armador de Horarios / Grafo**: Se apoya en el scroll vertical del canvas y vista de día único sin solapar controles.

---

## 4. Inventario Completo y Asignación por Fases

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

## 5. Notas y Directivas para Fases Futuras

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

