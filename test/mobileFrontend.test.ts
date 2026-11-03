import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
    assert.match(cssContent, /--z-backdrop:\s*50;/, 'Debe definir z-index de backdrop');
    assert.match(cssContent, /--z-sheet:\s*50;/, 'Debe definir z-index de bottom sheet');
    assert.match(cssContent, /--z-toast:\s*60;/, 'Debe definir z-index de toast');
    assert.match(cssContent, /--z-modal-top:\s*70;/, 'Debe definir z-index superior');

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

  it('3. Controles del grafo y botón flotante de re-centrar (fitView) en mobile', () => {
    const graphPath = path.join(rootDir, 'src/components/graph/CorrelativeGraph.tsx');
    const graphContent = fs.readFileSync(graphPath, 'utf8');

    // Importa useReactFlow y useIsMobile
    assert.match(graphContent, /useReactFlow/, 'Debe importar useReactFlow de @xyflow/react');
    assert.match(graphContent, /useIsMobile/, 'Debe importar useIsMobile');

    // Botón flotante para re-centrar mapa
    assert.match(graphContent, /MobileFitViewButton/, 'Debe definir componente MobileFitViewButton');
    assert.match(graphContent, /fitView\(\{\s*padding:\s*0\.2,\s*duration:\s*400\s*\}\)/, 'Debe re-centrar mapa con fitView animado');
    assert.match(graphContent, /aria-label="Re-centrar mapa"/, 'Debe incluir aria-label en botón de re-centrar');
    assert.match(graphContent, /min-h-\[44px\] min-w-\[44px\]/, 'Botón de re-centrar debe medir al menos 44x44px');

    // MiniMap oculto en mobile
    assert.match(graphContent, /hidden sm:block/, 'MiniMap debe permanecer oculto en pantallas chicas');

    // Regla en index.css para controles de React Flow >= 44x44px en mobile
    const cssPath = path.join(rootDir, 'src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    assert.match(cssContent, /@media\s*\(max-width:\s*767\.98px\)\s*\{[\s\S]*\.react-flow__controls-button\s*\{[\s\S]*width:\s*44px\s*!important;[\s\S]*height:\s*44px\s*!important;/, 'Botones de control del grafo deben medir 44x44px en mobile');
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
