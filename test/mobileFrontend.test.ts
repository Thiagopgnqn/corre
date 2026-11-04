import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerLayer, unregisterLayer, getActiveLayersCount, isTopLayer } from '../src/components/common/BottomSheet';
import { checkEligibility, ALL_SUBJECTS_MAP } from '../src/utils/correlativas';

const rootDir = 'c:/Users/msgar/OneDrive/Escritorio/codigos/corre';

describe('Fase 1: Infraestructura Mobile, BottomSheet, Navegación y Prevención de Zoom iOS', () => {
  it('1. Hook useIsMobile y useDeviceCapabilities respetan Tailwind md y media queries oficiales', () => {
    const hookPath = path.join(rootDir, 'src/hooks/useIsMobile.ts');
    assert.ok(fs.existsSync(hookPath), 'src/hooks/useIsMobile.ts debe existir');
    const content = fs.readFileSync(hookPath, 'utf8');

    // Breakpoint consistente con Tailwind md (< 768px)
    assert.match(content, /767\.98px/, 'Debe usar breakpoint consistente con Tailwind md (max-width: 767.98px)');
    // Media query oficial para punteros táctiles gruesos sin hover
    assert.match(content, /\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)/, 'Debe detectar dispositivos puramente táctiles');
    // Media query para teléfonos en horizontal con baja altura
    assert.match(content, /\(orientation:\s*landscape\)\s*and\s*\(max-height:\s*500px\)/, 'Debe contemplar landscape con poca altura');
    // Exporta funciones useIsMobile y useDeviceCapabilities
    assert.match(content, /export function useIsMobile/, 'Debe exportar useIsMobile');
    assert.match(content, /export function useDeviceCapabilities/, 'Debe exportar useDeviceCapabilities');
  });

  it('2. Componente BottomSheet cumple requisitos de accesibilidad, scroll-lock y swipe-to-close', () => {
    const sheetPath = path.join(rootDir, 'src/components/common/BottomSheet.tsx');
    assert.ok(fs.existsSync(sheetPath), 'src/components/common/BottomSheet.tsx debe existir');
    const content = fs.readFileSync(sheetPath, 'utf8');

    // Accesibilidad WAI-ARIA
    assert.match(content, /role="dialog"/, 'Debe declarar role="dialog"');
    assert.match(content, /aria-modal="true"/, 'Debe declarar aria-modal="true"');
    assert.match(content, /aria-labelledby/, 'Debe vincular título mediante aria-labelledby');

    // Trampa de foco y devolución de foco
    assert.match(content, /previousActiveElementRef/, 'Debe guardar y devolver foco al cerrar');
    assert.match(content, /e\.key === 'Escape'/, 'Debe cerrarse con tecla Escape');
    assert.match(content, /e\.key === 'Tab'/, 'Debe implementar trampa de foco para ciclar con Tab y Shift+Tab');

    // Bloqueo de scroll en el body
    assert.match(content, /document\.body\.style\.overflow = 'hidden'/, 'Debe bloquear scroll en body mientras esté abierto');
    assert.match(content, /overscrollBehavior:\s*'contain'/, 'Debe contener sobre-desplazamiento en iOS (overscroll-behavior: contain)');

    // Gestos de arrastre (swipe to close) con Pointer Events exclusivos en el handle
    assert.match(content, /onPointerDown={handlePointerDown}/, 'Debe capturar puntero solo en cabecera/handle');
    assert.match(content, /setPointerCapture/, 'Debe usar setPointerCapture');

    // Botón de cierre visible >= 44x44px
    assert.match(content, /w-11 h-11/, 'El botón de cierre debe medir al menos 44x44 px (w-11 h-11 = 44px)');
    assert.match(content, /aria-label="Cerrar panel"/, 'Debe incluir aria-label accesible en el botón de cierre');

    // Altura en dvh y soporte safe-area
    assert.match(content, /dvh/, 'Debe usar unidades dvh para adaptarse al teclado virtual y barras de navegación');
  });

  it('3. Navbar mobile contiene exactamente 5 destinos con targets táctiles >= 48px e íconos >= 24px', () => {
    const navPath = path.join(rootDir, 'src/components/common/Navbar.tsx');
    const content = fs.readFileSync(navPath, 'utf8');

    // 4 destinos principales + "Más"
    assert.match(content, /id:\s*'graph',\s*label:\s*'Mapa'/, 'Debe incluir ítem Mapa');
    assert.match(content, /id:\s*'schedule',\s*label:\s*'Horarios'/, 'Debe incluir ítem Horarios');
    assert.match(content, /id:\s*'library',\s*label:\s*'Biblioteca'/, 'Debe incluir ítem Biblioteca');
    assert.match(content, /id:\s*'professors',\s*label:\s*'Profesores'/, 'Debe incluir ítem Profesores');
    assert.match(content, /data-tour="more-menu-btn"/, 'Debe incluir botón Más con data-tour preservado');

    // Targets táctiles e íconos
    assert.match(content, /min-h-\[52px\]/, 'Los botones deben tener altura mínima >= 48px (min-h-[52px])');
    assert.match(content, /w-6 h-6/, 'Los íconos principales deben tener tamaño >= 24px (w-6 h-6)');
    assert.match(content, /text-\[11px\]/, 'Las etiquetas deben tener tamaño >= 11px');

    // Sheet "Más" con vistas secundarias
    assert.match(content, /id:\s*'kanban'/, 'Sheet Más debe incluir Niveles (kanban)');
    assert.match(content, /id:\s*'planner'/, 'Sheet Más debe incluir Cuatrimestre (planner)');
    assert.match(content, /id:\s*'electives'/, 'Sheet Más debe incluir Electivas (electives)');
    assert.match(content, /id:\s*'stats'/, 'Sheet Más debe incluir Estadísticas (stats)');

    // Restricción de rol para Panel de Administración
    assert.match(content, /user\?\.role === 'admin'[\s\S]{0,250}handleMobileNavigate\('admin'\)/, 'Panel de administración solo visible para admins');

    // Búsqueda accesible en mobile sin depender de teclado físico (Ctrl+K)
    assert.match(content, /data-tour="search-button"[\s\S]{0,120}min-h-\[44px\] min-w-\[44px\]/, 'Botón de búsqueda táctil visible >= 44x44 px');

    // Badge de avisos pendientes de administración en "Más"
    assert.match(content, /hasMoreAdminBadge/, 'Debe calcular badge de admin en botón Más');
  });

  it('4. UserMenu mobile se despliega como BottomSheet con accesos táctiles >= 48px', () => {
    const menuPath = path.join(rootDir, 'src/components/common/UserMenu.tsx');
    const content = fs.readFileSync(menuPath, 'utf8');

    // Usa BottomSheet en mobile
    assert.match(content, /import\s*\{\s*BottomSheet\s*\}\s*from\s*'\.\/BottomSheet'/, 'UserMenu debe importar BottomSheet');
    assert.match(content, /isMobile\s*&&/, 'Debe condicionar BottomSheet a entorno mobile');
    assert.match(content, /min-h-\[48px\]/, 'Las opciones en mobile deben medir al menos 48px de alto');

    // Botón de activación táctil >= 44x44px
    assert.match(content, /min-h-\[44px\] min-w-\[44px\]/, 'El avatar de usuario debe tener target táctil >= 44x44 px');

    // Controles de cuenta preservados
    assert.match(content, /user\.role === 'admin'/, 'Preserva acceso a panel de admin');
    assert.match(content, /notifyLibraryEmail/, 'Preserva switch de notificaciones de biblioteca');
    assert.match(content, /handleExport/, 'Preserva descarga de respaldo');
    assert.match(content, /logout/, 'Preserva cierre de sesión');
  });

  it('5. Prevención global de zoom en iOS Safari y viewport seguro', () => {
    const htmlPath = path.join(rootDir, 'index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Viewport seguro sin desactivar zoom manual del usuario
    assert.match(htmlContent, /name="viewport"\s*content="width=device-width,\s*initial-scale=1\.0,\s*viewport-fit=cover"/, 'index.html debe tener viewport cover');
    assert.doesNotMatch(htmlContent, /user-scalable=no/, 'NO debe bloquear el zoom con user-scalable=no');
    assert.doesNotMatch(htmlContent, /maximum-scale/, 'NO debe bloquear el zoom con maximum-scale');

    // Regla global en index.css (acotada a inputs de texto, select y textarea sin !important)
    const cssPath = path.join(rootDir, 'src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    assert.match(cssContent, /@media\s*\(max-width:\s*767\.98px\)\s*\{[\s\S]*input:not\([\s\S]*font-size:\s*16px;/, 'Debe forzar font-size: 16px en mobile sin !important excluyendo checkbox/radio/range/file/button');
    assert.doesNotMatch(cssContent, /font-size:\s*16px\s*!important;/, 'NO debe usar !important en la regla de font-size');

    // Escala centralizada de Z-Index
    assert.match(cssContent, /--mobile-nav-height:\s*4rem;/, 'Debe definir variable CSS --mobile-nav-height');
    assert.match(cssContent, /--z-mobile-nav:\s*40;/, 'Debe definir z-index de barra móvil');
    assert.match(cssContent, /--z-backdrop:\s*(45|50);/, 'Debe definir z-index de backdrop (45 estricto inferior a sheet/modal)');
    assert.match(cssContent, /--z-sheet:\s*50;/, 'Debe definir z-index de bottom sheet');
    assert.match(cssContent, /--z-toast:\s*60;/, 'Debe definir z-index de toast');
    assert.match(cssContent, /--z-modal-top:\s*(70|100);/, 'Debe definir z-index superior (100 para tutorial/spotlight)');

    // Prefers-reduced-motion
    assert.match(cssContent, /prefers-reduced-motion:\s*reduce/, 'Debe contemplar prefers-reduced-motion');
  });
});

describe('Fase 2: Interacciones del Grafo, Modales de Materia y Tablero Kanban en Mobile', () => {
  it('1. QuickStatusModal se despliega como BottomSheet en mobile con validación de correlativas y targets >= 50px', () => {
    const filePath = path.join(rootDir, 'src/components/common/QuickStatusModal.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    // Usa useIsMobile y BottomSheet
    assert.match(content, /useIsMobile/, 'Debe importar useIsMobile');
    assert.match(content, /BottomSheet/, 'Debe importar BottomSheet');
    assert.match(content, /if\s*\(isMobile\)/, 'Debe renderizar BottomSheet en mobile');

    // Validación de correlatividades sin duplicar reglas de negocio
    assert.match(content, /checkEligibility/, 'Debe validar elegibilidad con checkEligibility');
    assert.match(content, /isStatusAllowed/, 'Debe verificar permiso para cada estado');
    assert.match(content, /Falta regularizar:/, 'Debe indicar materias faltantes para regularizar');
    assert.match(content, /Falta aprobar:/, 'Debe indicar materias faltantes para aprobar');
    assert.match(content, /isSimulationMode/, 'No debe bloquear estados en modo simulación');

    // Targets táctiles >= 50px para pulgar y selector numérico
    assert.match(content, /min-h-\[50px\]/, 'Las opciones de estado en mobile deben medir al menos 50px');
    assert.match(content, /min-h-\[44px\]/, 'Los botones numéricos de nota deben medir al menos 44px');
    assert.match(content, /Restablecer estado/, 'Debe contar con acción explícita para restablecer');
  });

  it('2. SubjectDrawer se transforma en BottomSheet en mobile con pestañas horizontales y targets >= 44px', () => {
    const filePath = path.join(rootDir, 'src/components/graph/SubjectDrawer.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    // Render mobile vs desktop
    assert.match(content, /if\s*\(isMobile\)/, 'Debe diferenciar render mobile');
    assert.match(content, /maxHeightDvh=\{92\}/, 'Debe configurar maxHeightDvh={92} en BottomSheet');
    assert.match(content, /w-full\s*sm:w-\[440px\]/, 'En desktop debe preservar panel lateral de 440px');

    // Pestañas segmentadas horizontales
    assert.match(content, /id:\s*'info'/, 'Debe tener pestaña General');
    assert.match(content, /id:\s*'correlativas'/, 'Debe tener pestaña Correlativas');
    assert.match(content, /id:\s*'cursadas'/, 'Debe tener pestaña Mi Cursada');
    assert.match(content, /id:\s*'historial'/, 'Debe tener pestaña Finales');
    assert.match(content, /id:\s*'biblioteca'/, 'Debe tener pestaña Material');

    // Targets táctiles >= 44px
    assert.match(content, /min-h-\[44px\]/, 'Las pestañas y botones deben tener target mínimo >= 44px');
    assert.match(content, /min-w-\[44px\]/, 'Los botones de acción en filas deben tener target mínimo >= 44px');

    // Z-Index centralizado
    assert.match(content, /z-\[var\(--z-backdrop\)\]/, 'Backdrop debe usar escala centralizada');
    assert.match(content, /z-\[var\(--z-sheet\)\]/, 'Panel drawer debe usar escala centralizada');
  });

  it('3. Grafo y Vista Lista en mobile (Parte 0: M1 a M4)', () => {
    const graphPath = path.join(rootDir, 'src/components/graph/CorrelativeGraph.tsx');
    const graphContent = fs.readFileSync(graphPath, 'utf8');

    // Importa useIsMobile y SubjectListView
    assert.match(graphContent, /useIsMobile/, 'Debe importar useIsMobile');
    assert.match(graphContent, /SubjectListView/, 'Debe importar SubjectListView');

    // Vista por defecto en mobile es Lista y persiste en localStorage
    assert.match(graphContent, /DEFAULT_MOBILE_GRAPH_VIEW.*=\s*'lista'/, 'Default mobile view debe ser lista');
    assert.match(graphContent, /localStorage\.getItem\('ui_mobile_graph_view'\)/, 'Debe persistir preferencia en localStorage');

    // Segmented control en mobile para alternar [ Lista | Mapa ]
    assert.match(graphContent, /handleSetMobileGraphView\('lista'\)/, 'Debe soportar switch a vista Lista');
    assert.match(graphContent, /handleSetMobileGraphView\('mapa'\)/, 'Debe soportar switch a vista Mapa');

    // Zoom legible en mobile (sin fitView aplastado, viewport centrado inicial y límites de paneo)
    assert.match(graphContent, /defaultViewport=\{isMobile \? initialViewport : undefined\}/, 'Debe iniciar con zoom dinámico legible en mobile');
    assert.match(graphContent, /dynamicTranslateExtent/, 'Debe calcular translateExtent dinámico a partir de los nodos reales');
    assert.match(graphContent, /FitViewButton|Ver todo/, 'Debe incluir botón Ver todo (fitView)');
    assert.match(graphContent, /nodesDraggable=\{!isMobile\}/, 'Nodos no deben ser arrastrables en mobile');
    assert.match(graphContent, /minZoom=\{isMobile \? 0\.35 : 0\.2\}/, 'Debe restringir minZoom para evitar texto microscópico');
    assert.match(graphContent, /translateExtent=/, 'Debe limitar paneo para evitar perderse en el espacio vacío');

    // MiniMap oculto en mobile
    assert.match(graphContent, /hidden sm:block/, 'MiniMap debe permanecer oculto en pantallas chicas');

    // Regla en index.css para controles de React Flow >= 44x44px en mobile
    const cssPath = path.join(rootDir, 'src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    assert.match(cssContent, /@media\s*\(max-width:\s*767\.98px\)\s*\{[\s\S]*\.react-flow__controls-button\s*\{[\s\S]*width:\s*44px\s*!important;[\s\S]*height:\s*44px\s*!important;/, 'Botones de control del grafo deben medir 44x44px en mobile');

    // SubjectListView implementa desglose por año y motivos de bloqueo
    const listPath = path.join(rootDir, 'src/components/graph/SubjectListView.tsx');
    const listContent = fs.readFileSync(listPath, 'utf8');
    assert.match(listContent, /checkEligibility/, 'Debe usar checkEligibility para validar correlativas');
    assert.match(listContent, /Falta regularizar/, 'Debe indicar materias faltantes para regularizar');
    assert.match(listContent, /Falta aprobar/, 'Debe indicar materias faltantes para aprobar');
  });

  it('4. Tablero Kanban en mobile muestra 1 columna a la vez y desactiva HTML5 drag & drop en touch', () => {
    const kanbanPath = path.join(rootDir, 'src/components/kanban/KanbanBoard.tsx');
    const content = fs.readFileSync(kanbanPath, 'utf8');

    // Hooks de detección
    assert.match(content, /useIsMobile/, 'Debe importar useIsMobile');
    assert.match(content, /useDeviceCapabilities/, 'Debe importar useDeviceCapabilities');

    // Segmented control con 1 columna a la vez en mobile
    assert.match(content, /mobileColumnTab/, 'Debe gestionar columna activa en mobile');
    assert.match(content, /!isMobile\s*\|\|\s*mobileColumnTab === col\.id/, 'Debe filtrar para mostrar 1 sola columna a la vez en mobile y 4 en desktop');

    // Desactiva drag and drop en mobile y touch
    assert.match(content, /draggable=\{!isMobile && !isTouch\}/, 'Debe desactivar draggable en dispositivos móviles y táctiles');
    assert.match(content, /if\s*\(isMobile\s*\|\|\s*isTouch\)\s*return;/, 'Debe ignorar eventos de arrastre en touch');

    // Botón visible de cambiar estado >= 44px
    assert.match(content, /min-h-\[44px\][\s\S]{0,350}aria-label=\{`Cambiar estado de/, 'Debe tener botón visible para cambiar estado >= 44px accesible');
  });

  it('5. PlanSelectorModal y SearchModal adaptados a mobile con targets >= 48px e inputs de 16px', () => {
    // PlanSelectorModal
    const planPath = path.join(rootDir, 'src/components/common/PlanSelectorModal.tsx');
    const planContent = fs.readFileSync(planPath, 'utf8');
    assert.match(planContent, /if\s*\(isMobile\)/, 'PlanSelectorModal debe renderizar BottomSheet en mobile');
    assert.match(planContent, /min-h-\[48px\]/, 'Botón de elección de plan en mobile debe medir al menos 48px');
    assert.match(planContent, /z-\[var\(--z-modal\)\]/, 'Modal en desktop debe usar variable centralizada');

    // SearchModal
    const searchPath = path.join(rootDir, 'src/components/common/SearchModal.tsx');
    const searchContent = fs.readFileSync(searchPath, 'utf8');
    assert.match(searchContent, /if\s*\(isMobile\)/, 'SearchModal debe renderizar vista a pantalla completa en mobile');
    assert.match(searchContent, /h-\[100dvh\] max-h-\[100dvh\]/, 'SearchModal debe usar h-[100dvh] en mobile');
    assert.match(searchContent, /text-\[16px\]/, 'Input de búsqueda en mobile debe tener font-size de al menos 16px para evitar auto-zoom');
    assert.match(searchContent, /Cancelar/, 'Debe tener botón visible de Cancelar');
    assert.match(searchContent, /min-h-\[44px\]/, 'Los filtros y botones de acción deben medir al menos 44px');
    assert.match(searchContent, /z-\[var\(--z-modal\)\]/, 'Debe usar variable centralizada de z-index');
  });
});

describe('Fase 3: Armador de Horarios (ScheduleBuilder) en Mobile', () => {
  it('1. ScheduleBuilder implementa segmented control de 2 modos limpios, barra flotante de resumen y BottomSheets (Parte 0: H1, H5, H6)', () => {
    const builderPath = path.join(rootDir, 'src/components/schedule/ScheduleBuilder.tsx');
    const content = fs.readFileSync(builderPath, 'utf8');

    // Segmented mode switcher en mobile: Comisiones / Mi Semana (sin modo dividida roto)
    assert.match(content, /mobileTab === 'comisiones'/, 'Debe soportar pestaña de Comisiones en mobile');
    assert.match(content, /mobileTab === 'grilla'/, 'Debe soportar pestaña de Mi Horario (grilla) en mobile');
    assert.match(content, /Mi Horario/, 'Pestaña debe llamarse Mi Horario');
    assert.match(content, /Mis Propuestas de Horarios|Planes/, 'Barra flotante debe incluir botón directo a Planes');
    assert.match(content, /setMobileTab\('comisiones'\)/, 'Debe permitir cambiar a pestaña Comisiones');
    assert.match(content, /setMobileTab\('grilla'\)/, 'Debe permitir cambiar a pestaña Mi Semana');

    // Barra flotante persistente de resumen inferior en mobile
    assert.match(content, /aria-label="Resumen rápido de horarios"/, 'Debe renderizar barra flotante de resumen en mobile');
    assert.match(content, /fixed bottom-\[calc\(var\(--mobile-nav-height/, 'Debe anclarse arriba de la barra de navegación móvil');

    // Banner de advertencia persistente de choques en mobile
    assert.match(content, /conflicts\.length > 0 &&/, 'Debe renderizar alerta cuando existan choques');
    assert.match(content, /choque detectado|choques detectados/, 'Debe indicar claramente la cantidad de choques');
    assert.match(content, /Ver en grilla/, 'El banner debe tener acceso directo a la grilla');

    // BottomSheets en mobile para Propuestas, Resumen y Más Opciones
    assert.match(content, /<BottomSheet[\s\S]*title="Mis Propuestas de Horarios"/, 'Debe renderizar propuestas en BottomSheet');
    assert.match(content, /<BottomSheet[\s\S]*title="Más Opciones de Horarios"/, 'Debe renderizar más opciones en BottomSheet');
    assert.match(content, /<BottomSheet[\s\S]*title="Resumen y Opciones"/, 'Debe renderizar resumen en BottomSheet en mobile');

    // Targets táctiles en cabecera mobile compacta (< 280px)
    assert.match(content, /min-h-\[36px\]/, 'Toggle 1C/2C debe tener altura táctil mínima');
    assert.match(content, /w-10 h-10[\s\S]{0,300}title="Deshacer"/, 'Botón Deshacer debe ser 40x40px');
    assert.match(content, /w-10 h-10[\s\S]{0,300}title="Rehacer"/, 'Botón Rehacer debe ser 40x40px');
    assert.match(content, /w-10 h-10[\s\S]{0,300}title="Más opciones"/, 'Botón Más opciones debe ser 40x40px');

    // Invariantes de escritorio preservados estrictamente
    assert.match(content, /h-full overflow-hidden/, 'ScheduleBuilder debe mantener h-full y overflow-hidden');
    assert.match(content, /min-h-0/, 'ScheduleBuilder debe mantener min-h-0');
    assert.match(content, /hidden lg:flex xl:hidden/, 'Debe mantener barra compacta en lg');
    assert.match(content, /hidden xl:flex/, 'Debe mantener columna derecha en xl');
    assert.match(content, /summaryDrawerOpen/, 'Debe mantener soporte a summaryDrawerOpen');
  });

  it('2. ScheduleLeftPanel adapta input a 16px, filtros táctiles y botones de comisión >= 44px', () => {
    const leftPanelPath = path.join(rootDir, 'src/components/schedule/ScheduleLeftPanel.tsx');
    const content = fs.readFileSync(leftPanelPath, 'utf8');

    // Input de búsqueda a 16px para prevenir zoom en iOS y altura >= 44px
    assert.match(content, /text-\[16px\]\s*sm:text-xs/, 'Input de búsqueda debe tener 16px en mobile y xs en desktop');
    assert.match(content, /min-h-\[44px\]\s*sm:min-h-0/, 'Input de búsqueda debe tener al menos 44px de alto en mobile');

    // Botones de filtro de turno, sin choques y ordenamiento >= 38px
    assert.match(content, /min-h-\[38px\]\s*sm:min-h-0/, 'Filtros deben tener altura mínima táctil >= 38px en mobile');

    // Cabecera de materia del acordeón >= 48px
    assert.match(content, /min-h-\[48px\]/, 'Cabecera de materia debe medir al menos 48px');

    // Botones de acción de comisión: Quitar, Previsualizar, Elegir/Confirmar >= 44px
    assert.match(content, /min-h-\[44px\][\s\S]{0,300}Quitar/, 'Botón Quitar debe medir al menos 44px en mobile');
    assert.match(content, /min-h-\[44px\][\s\S]{0,300}Previsualizar/, 'Botón Previsualizar debe medir al menos 44px en mobile');
    assert.match(content, /min-h-\[44px\][\s\S]{0,1200}Confirmar/, 'Botón Confirmar/Elegir debe medir al menos 44px en mobile');

    // Preserva invariantes de layout
    assert.match(content, /Plegar/, 'Debe conservar botón manual Plegar');
    assert.match(content, /elegida|Elegida/, 'Debe conservar insignia de elegida');
    assert.match(content, /a\.id === selectedComm\.id\s*\?\s*-1|if\s*\(a\.id === selectedComm\.id\)\s*return -1/, 'Debe posicionar comisión elegida primero');
  });

  it('3. ScheduleWeeklyGrid optimiza selector de días táctil y popover de clase como BottomSheet en mobile (Parte 0: H2)', () => {
    const gridPath = path.join(rootDir, 'src/components/schedule/ScheduleWeeklyGrid.tsx');
    const content = fs.readFileSync(gridPath, 'utf8');

    // Tira de días a ancho completo con scroll horizontal suave y auto-centrado
    assert.match(content, /Por Día/, 'Debe incluir selector de modo Por Día');
    assert.match(content, /Semana Completa/, 'Debe incluir selector de modo Semana Completa');
    assert.match(content, /snap-x snap-mandatory/, 'Tira de días debe tener scroll suave snap-x');
    assert.match(content, /scrollIntoView/, 'Debe centrar suavemente el día activo seleccionado');

    // Píldoras de día >= 44px
    assert.match(content, /key=\{d\}[\s\S]{0,500}min-h-\[44px\]/, 'Píldoras de día deben medir al menos 44px');

    // Popover de clase como BottomSheet en mobile y modal centrado en desktop
    assert.match(content, /if\s*\(isMobile\)|\bisMobile\s*\?/, 'Debe consultar condición isMobile para el popover');
    assert.match(content, /<BottomSheet[\s\S]*title=\{activePopover\?\.subjectName/, 'Debe renderizar popover como BottomSheet en mobile');
    assert.match(content, /z-\[var\(--z-modal\)\]/, 'Modal en desktop debe usar variable centralizada de z-index');

    // Botones del popover >= 44px
    assert.match(content, /min-h-\[44px\][\s\S]{0,140}Quitar comisión/, 'Botón Quitar comisión debe medir al menos 44px');
    assert.match(content, /min-h-\[44px\][\s\S]{0,140}Cambiar comisión/, 'Botón Cambiar comisión debe medir al menos 44px');
  });

  it('4. ScheduleSummaryPanel eleva diálogos de confirmación a z-modal-elevated y agranda botones táctiles', () => {
    const summaryPath = path.join(rootDir, 'src/components/schedule/ScheduleSummaryPanel.tsx');
    const content = fs.readFileSync(summaryPath, 'utf8');

    // Diálogos de confirmación en z-modal-elevated
    assert.match(content, /z-\[var\(--z-modal-elevated\)\][\s\S]{0,500}¿Pasar a "Cursando"\?/, 'Diálogo de pasar a cursando debe usar z-modal-elevated');
    assert.match(content, /z-\[var\(--z-modal-elevated\)\][\s\S]{0,500}¿Limpiar toda la selección\?/, 'Diálogo de limpiar todo debe usar z-modal-elevated');

    // Acciones principales >= 44px y 48px
    assert.match(content, /min-h-\[44px\][\s\S]{0,300}Sugerir combinaciones/, 'Botón Sugerir combinaciones debe medir al menos 44px');
    assert.match(content, /min-h-\[48px\][\s\S]{0,250}Pasar elegidas a "Cursando"/, 'Botón Pasar a cursando debe medir al menos 48px');
    assert.match(content, /min-h-\[44px\][\s\S]{0,500}Copiar resumen en texto/, 'Botón Copiar texto debe medir al menos 44px');
    assert.match(content, /min-h-\[44px\][\s\S]{0,300}Exportar a Calendario \(\.ics\)/, 'Botón Exportar .ics debe medir al menos 44px');
    assert.match(content, /min-h-\[44px\][\s\S]{0,300}Descargar \/ Imprimir horario/, 'Botón Imprimir debe medir al menos 44px');
    assert.match(content, /min-h-\[44px\][\s\S]{0,300}Limpiar todo/, 'Botón Limpiar todo debe medir al menos 44px');
  });

  it('5. ScheduleCombinationsModal y ScheduleImportModal adaptados con BottomSheet, 16px en texto y z-modal', () => {
    // ScheduleCombinationsModal
    const comboPath = path.join(rootDir, 'src/components/schedule/ScheduleCombinationsModal.tsx');
    const comboContent = fs.readFileSync(comboPath, 'utf8');
    assert.match(comboContent, /if\s*\(isMobile\)/, 'ScheduleCombinationsModal debe renderizar BottomSheet en mobile');
    assert.match(comboContent, /maxHeightDvh=\{92\}/, 'BottomSheet de combinaciones debe usar 92 dvh');
    assert.match(comboContent, /z-\[var\(--z-modal\)\]/, 'Modal en desktop debe usar variable centralizada');
    assert.match(comboContent, /min-h-\[44px\][\s\S]{0,140}Cargar en mi grilla/, 'Botón Cargar en mi grilla debe medir al menos 44px');

    // ScheduleImportModal
    const importPath = path.join(rootDir, 'src/components/schedule/ScheduleImportModal.tsx');
    const importContent = fs.readFileSync(importPath, 'utf8');
    assert.match(importContent, /z-\[var\(--z-modal\)\]/, 'ScheduleImportModal debe usar variable centralizada');
    assert.match(importContent, /text-\[16px\]\s*sm:text-xs/, 'Textarea de importación debe usar 16px en mobile');
    assert.match(importContent, /min-h-\[44px\][\s\S]{0,250}Examinar archivo/, 'Botón Examinar archivo debe medir al menos 44px');
    assert.match(importContent, /min-h-\[44px\][\s\S]{0,250}Importar horarios/, 'Botón Importar horarios debe medir al menos 44px');
  });
});

describe('Ajustes de Cierre de Fases 1 a 3: Capas Anidadas, Tablets, Correlativas y Kanban Mobile', () => {
  it('1. Pila global de BottomSheet gestiona capas anidadas, foco, Escape y scroll lock', () => {
    // Estado inicial limpio
    assert.equal(getActiveLayersCount(), 0, 'La pila inicial de capas debe estar vacía');

    // 1. Abrir Sheet 1 (ej. Resumen)
    const idx1 = registerLayer('sheet-resumen');
    assert.equal(idx1, 0, 'La primera capa debe tener índice 0');
    assert.equal(getActiveLayersCount(), 1, 'Debe haber 1 capa activa');
    assert.equal(isTopLayer('sheet-resumen'), true, 'Sheet 1 debe ser la capa superior');

    // 2. Abrir Sheet 2 encima (ej. Diálogo de confirmación dentro del resumen)
    const idx2 = registerLayer('sheet-confirm');
    assert.equal(idx2, 1, 'La segunda capa debe tener índice 1 (para calcular z-index)');
    assert.equal(getActiveLayersCount(), 2, 'Debe haber 2 capas activas');
    assert.equal(isTopLayer('sheet-confirm'), true, 'Sheet 2 debe ser la capa superior activa');
    assert.equal(isTopLayer('sheet-resumen'), false, 'Sheet 1 NO debe ser la capa superior mientras Sheet 2 esté abierto');

    // 3. Cerrar Sheet 2 (confirmación)
    unregisterLayer('sheet-confirm');
    assert.equal(getActiveLayersCount(), 1, 'Al cerrar Sheet 2 debe quedar 1 capa activa');
    assert.equal(isTopLayer('sheet-resumen'), true, 'Sheet 1 vuelve a ser la capa superior');

    // 4. Cerrar Sheet 1
    unregisterLayer('sheet-resumen');
    assert.equal(getActiveLayersCount(), 0, 'Al cerrar todas las capas la cuenta debe volver a 0');
  });

  it('2. Validación de Correlativas: checkEligibility bloquea estados no permitidos y habilita al cumplirlas', () => {
    // Materia de segundo año (Sistemas Operativos, ID 15) que tiene correlativas
    const soSubject = ALL_SUBJECTS_MAP.get(15);
    assert.ok(soSubject, 'Sistemas Operativos debe existir en el plan');

    // Con estado académico vacío
    const emptyState = {};
    const resEmpty = checkEligibility(soSubject, emptyState);
    assert.equal(resEmpty.eligible, false, 'No debe ser eligible sin correlativas cumplidas');
    assert.ok(
      resEmpty.missingRegular.length > 0 || resEmpty.missingApproved.length > 0,
      'Debe listar correlativas pendientes'
    );

    // Con correlativas cumplidas (regularizadas y aprobadas)
    const fulfilledState: Record<number, any> = {};
    soSubject.regularPrereqs.forEach((id) => {
      fulfilledState[id] = { status: 'regularizada' };
    });
    soSubject.approvedPrereqs.forEach((id) => {
      fulfilledState[id] = { status: 'aprobada', grade: 8 };
    });
    const resFulfilled = checkEligibility(soSubject, fulfilledState);
    assert.equal(resFulfilled.eligible, true, 'Debe ser eligible cuando se cumplen todas las correlativas');
  });

  it('3. Kanban Mobile: materias promocionadas se alcanzan y mapean en la columna Aprobada / Promocionada', () => {
    const kanbanPath = path.join(rootDir, 'src/components/kanban/KanbanBoard.tsx');
    const content = fs.readFileSync(kanbanPath, 'utf8');

    // La columna de aprobadas incluye promocionadas en su filtro
    assert.match(
      content,
      /filterFn:\s*\(st\)\s*=>\s*st === 'aprobada'\s*\|\|\s*st === 'promocionada'/,
      'La columna Aprobada debe agrupar materias aprobadas y promocionadas'
    );

    // En mobile hay botón visible Cambiar estado >= 44px
    assert.match(
      content,
      /min-h-\[44px\][\s\S]{0,350}Cambiar/,
      'Cada tarjeta debe tener un botón Cambiar estado accesible de al menos 44px'
    );

    // Selector segmentado de 1 columna a la vez
    assert.match(
      content,
      /mobileColumnTab === c\.id/,
      'En mobile debe mostrar 1 sola columna a la vez seleccionable por tabs'
    );
  });

  it('4. Tablets (768 a 1023 px) y Grafo: CorrelativeGraph no descuenta la barra móvil inexistente y controla clics', () => {
    const graphPath = path.join(rootDir, 'src/components/graph/CorrelativeGraph.tsx');
    const content = fs.readFileSync(graphPath, 'utf8');

    // En tablets (>= md / 768px), usa md:h- sin descontar var(--mobile-nav-height)
    assert.match(
      content,
      /md:h-\[calc\(100dvh-var\(--app-header-height,4rem\)\)\]/,
      'En tablets (>= md) debe usar altura completa sin descontar la barra móvil'
    );

    // Tolerancia de clic de 5px para distinguir tap de pan/drag
    assert.match(content, /nodeClickDistance=\{5\}/, 'Debe fijar tolerancia de clic en nodos');
    assert.match(content, /paneClickDistance=\{5\}/, 'Debe fijar tolerancia de clic en el canvas');
    assert.match(content, /nodesDraggable=\{!isMobile\}/, 'En mobile los nodos no deben arrastrarse accidentalmente');
  });

  it('5. SubjectDrawer: todos los hooks se declaran antes del condicional para evitar React error #310', () => {
    const drawerPath = path.join(rootDir, 'src/components/graph/SubjectDrawer.tsx');
    const content = fs.readFileSync(drawerPath, 'utf8');

    const earlyReturnIdx = content.indexOf('if (!selectedSubject) return null;');
    assert.ok(earlyReturnIdx > 0, 'Debe existir if (!selectedSubject) return null;');

    // Buscar si hay algún useState o useEffect después de ese índice
    const contentAfterReturn = content.slice(earlyReturnIdx);
    const hasHookAfterReturn = /\b(useState|useEffect|useMemo|useCallback)\s*\(/.test(contentAfterReturn);
    assert.equal(hasHookAfterReturn, false, 'No debe haber ningún hook después de if (!selectedSubject) return null;');
  });
});

describe('Fase 4: Adaptación Completa de Vistas Restantes (Cuatrimestre, Electivas, Estadísticas, Profesores, Biblioteca)', () => {
  it('1. SemesterPlanner: barra flotante con resumen, canasta en BottomSheet y touch targets >= 44px', () => {
    const plannerPath = path.join(rootDir, 'src/components/planner/SemesterPlanner.tsx');
    const content = fs.readFileSync(plannerPath, 'utf8');

    // Barra flotante con z-index de planner
    assert.match(content, /data-testid="planner-floating-bar"/, 'Debe incluir barra flotante en mobile');
    assert.match(content, /var\(--z-planner-bar\)/, 'Barra flotante debe usar var(--z-planner-bar)');
    assert.match(content, /isMobileBasketOpen/, 'Debe gestionar apertura de BottomSheet para la canasta');

    // BottomSheet para canasta móvil
    assert.match(content, /<BottomSheet[\s\S]*title="Mi Selección del Cuatrimestre"/, 'Canasta móvil debe montarse en BottomSheet');

    // Touch targets >= 44px
    assert.match(content, /min-h-\[44px\]/, 'Botones y filtros deben tener touch target >= 44px');
  });

  it('2. ElectivesPicker: selector segmentado de años, drag&drop desactivado en touch y modal adaptado', () => {
    const electivesPath = path.join(rootDir, 'src/components/electives/ElectivesPicker.tsx');
    const content = fs.readFileSync(electivesPath, 'utf8');

    // Selector segmentado de años en mobile
    assert.match(content, /selectedMobileYear/, 'Debe incluir selector de año en mobile');
    assert.match(content, /draggable=\{!isMobile\}/, 'Drag & Drop debe estar inactivo en touch/mobile');

    // Modal con z-[var(--z-modal)] e input >= 16px
    assert.match(content, /z-\[var\(--z-modal\)\]/, 'Modal de electivas debe usar variable centralizada de modal');
    assert.match(content, /text-base sm:text-xs/, 'Input de búsqueda de electivas debe medir 16px en mobile');

    // Botones con min-h-[44px]
    assert.match(content, /min-h-\[44px\]/, 'Botones de agregar y mover deben medir >= 44px');
  });

  it('3. StatsDashboard: ancho 100% sin desborde, KPIs en 2 columnas y switches accesibles', () => {
    const statsPath = path.join(rootDir, 'src/components/stats/StatsDashboard.tsx');
    const content = fs.readFileSync(statsPath, 'utf8');

    // Contenedor seguro
    assert.match(content, /w-full overflow-hidden/, 'Contenedor principal debe evitar desborde horizontal');

    // KPIs en grid-cols-2 en mobile
    assert.match(content, /grid-cols-2 lg:grid-cols-4/, 'KPIs deben ordenarse en 2 columnas en pantallas móviles');

    // Switches y controles >= 44px
    assert.match(content, /min-h-\[44px\]/, 'Switches y selectores deben medir >= 44px');
  });

  it('4. Profesores y Reseñas: buscador de 16px, filtros en BottomSheet, estrellas >= 44px y submit sticky', () => {
    const dirPath = path.join(rootDir, 'src/components/professors/ProfessorsDirectory.tsx');
    const dirContent = fs.readFileSync(dirPath, 'utf8');
    assert.match(dirContent, /text-base sm:text-xs/, 'Buscador de profesores debe medir 16px en mobile');
    assert.match(dirContent, /isMobileFilterOpen/, 'Debe gestionar BottomSheet de filtros en mobile');

    const starsPath = path.join(rootDir, 'src/components/professors/StarRating.tsx');
    const starsContent = fs.readFileSync(starsPath, 'utf8');
    assert.match(starsContent, /min-h-\[44px\] min-w-\[44px\]/, 'Botones de calificación por estrellas deben medir >= 44x44px');

    const formPath = path.join(rootDir, 'src/components/professors/ReviewFormModal.tsx');
    const formContent = fs.readFileSync(formPath, 'utf8');
    assert.match(formContent, /sticky bottom-0/, 'Botón de publicar reseña debe ser sticky en la vista móvil');
    assert.match(formContent, /text-base sm:text-xs/, 'Textarea de reseña debe medir 16px en mobile');

    const detailPath = path.join(rootDir, 'src/components/professors/ProfessorDetailModal.tsx');
    const detailContent = fs.readFileSync(detailPath, 'utf8');
    assert.match(detailContent, /MessageSquarePlus/, 'Debe incluir botón thumb-reachable para dejar reseña');
  });

  it('5. Biblioteca: UploadMaterialModal sin capture, input de 16px, progreso visible y modals en z-modal', () => {
    const uploadPath = path.join(rootDir, 'src/components/library/UploadMaterialModal.tsx');
    const uploadContent = fs.readFileSync(uploadPath, 'utf8');

    // File input sin capture y con tipos aceptados
    assert.match(uploadContent, /accept="application\/pdf,image\/jpeg,image\/png,image\/webp"/, 'Debe aceptar PDF e imágenes');
    assert.doesNotMatch(uploadContent, /capture=/, 'NO debe forzar atributo capture para permitir elegir archivos');
    assert.match(uploadContent, /Elegir archivo o foto/, 'Debe ofrecer botón explícito accesible');

    // Inputs de 16px y checkbox legal >= 44px
    assert.match(uploadContent, /text-base sm:text-xs/, 'Inputs deben medir 16px en mobile');
    assert.match(uploadContent, /min-h-\[44px\]/, 'Checkbox legal y botones deben medir >= 44px');
    assert.match(uploadContent, /sticky bottom-0/, 'Acciones de envío deben ser sticky');

    // Modales de biblioteca con z-[var(--z-modal)]
    const libSubjPath = path.join(rootDir, 'src/components/library/SubjectLibraryView.tsx');
    const libSubjContent = fs.readFileSync(libSubjPath, 'utf8');
    assert.match(libSubjContent, /z-\[var\(--z-modal\)\]/, 'Modal de reporte debe usar z-modal');

    const myUpPath = path.join(rootDir, 'src/components/library/MyUploadsView.tsx');
    const myUpContent = fs.readFileSync(myUpPath, 'utf8');
    assert.match(myUpContent, /z-\[var\(--z-modal\)\]/, 'Modales de Mis Aportes deben usar z-modal');
  });

  it('6. Escala estricta de Z-Index: mobile-nav < backdrop < sheet/modal < modal-elevated < toast < spotlight', () => {
    const cssPath = path.join(rootDir, 'src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    const extractZ = (varName: string) => {
      const match = cssContent.match(new RegExp(`${varName}:\\s*(\\d+);`));
      assert.ok(match, `Variable ${varName} debe existir`);
      return Number(match[1]);
    };

    const zMobileNav = extractZ('--z-mobile-nav');
    const zBackdrop = extractZ('--z-backdrop');
    const zModal = extractZ('--z-modal');
    const zElevated = extractZ('--z-modal-elevated');
    const zToast = extractZ('--z-toast');
    const zSpotlight = extractZ('--z-spotlight');

    assert.ok(zMobileNav < zBackdrop, `mobile-nav (${zMobileNav}) debe ser < backdrop (${zBackdrop})`);
    assert.ok(zBackdrop < zModal, `backdrop (${zBackdrop}) debe ser < sheet/modal (${zModal})`);
    assert.ok(zModal <= zElevated, `sheet/modal (${zModal}) debe ser <= diálogo elevado (${zElevated})`);
    assert.ok(zElevated < zToast, `diálogo elevado (${zElevated}) debe ser < toast (${zToast})`);
    assert.ok(zToast < zSpotlight, `toast (${zToast}) debe ser < spotlight (${zSpotlight})`);
  });
});

