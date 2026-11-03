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
