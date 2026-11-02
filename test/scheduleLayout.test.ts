import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = 'c:/Users/msgar/OneDrive/Escritorio/codigos/corre';

describe('Layout y Scroll del Armador de Horarios (ScheduleBuilder)', () => {
  it('App.tsx aplica overflow-hidden y h-[100dvh] exclusivamente en la vista de horarios', () => {
    const appPath = path.join(rootDir, 'src/App.tsx');
    const content = fs.readFileSync(appPath, 'utf8');

    // Debe condicionar según la vista activa de horarios
    assert.match(content, /currentView === 'schedule'/, 'Debe condicionar a currentView === "schedule"');
    // Debe aplicar altura fija 100dvh y overflow hidden en mobile para schedule
    assert.match(content, /isScheduleView\s*\?\s*'h-\[100dvh\] max-h-\[100dvh\] overflow-hidden/, 'Debe aplicar h-[100dvh] y overflow-hidden en mobile');
    // Para main y el contenedor animado debe aplicar min-h-0 overflow-hidden en mobile
    assert.match(content, /isScheduleView\s*\?\s*'min-h-0 overflow-hidden/, 'Debe propagar min-h-0 y overflow-hidden al main en mobile');
    assert.match(content, /isScheduleView\s*\?\s*'min-h-0 h-full overflow-hidden/, 'Debe propagar min-h-0 h-full overflow-hidden al motion.div en mobile');
    // Debe incluir medición dinámica con ResizeObserver de la cabecera completa (navbar + simulation bar + banners)
    assert.match(content, /ResizeObserver/, 'Debe usar ResizeObserver para medir la cabecera');
    assert.match(content, /--app-header-height/, 'Debe setear la variable CSS --app-header-height');
  });

  it('ScheduleBuilder.tsx respeta el contenedor sin generar scroll en la ventana global', () => {
    const builderPath = path.join(rootDir, 'src/components/schedule/ScheduleBuilder.tsx');
    const content = fs.readFileSync(builderPath, 'utf8');

    // El contenedor principal debe tener overflow-hidden, h-full y min-h-0
    assert.match(content, /h-full overflow-hidden/, 'ScheduleBuilder debe tener h-full y overflow-hidden');
    // Debe usar min-h-0 para flex items anidados
    assert.match(content, /min-h-0/, 'Debe usar min-h-0 para que flexbox permita scroll interno');
  });

  it('Ajuste 1: Al elegir una comisión no se colapsa la materia, se fija al tope y tiene botón Plegar', () => {
    const panelPath = path.join(rootDir, 'src/components/schedule/ScheduleLeftPanel.tsx');
    const content = fs.readFileSync(panelPath, 'utf8');

    // Comprobamos que al seleccionar no hay cierre automático del acordeón
    assert.doesNotMatch(content, /onSelectCommission[\s\S]{0,100}setExpandedSubjectIds\(new Set\(\)\)/, 'No debe cerrar el acordeón al seleccionar');

    // Debe ordenar comisiones colocando la seleccionada al principio (pinning)
    assert.match(content, /a\.id === selectedComm\.id\s*\?\s*-1|if\s*\(a\.id === selectedComm\.id\)\s*return -1/, 'Debe posicionar la comisión elegida primero en el grupo');

    // Debe mostrar botón manual de plegar
    assert.match(content, /Plegar/, 'Debe incluir botón explícito para plegar');

    // Debe tener indicación de elegida
    assert.match(content, /elegida|Elegida/, 'Debe resaltar la comisión elegida');
  });

  it('Ajuste 2: Entre 1024px y 1279px (lg) muestra tira compacta y grilla holgada para 6 días; desde 1280px (xl) tres columnas', () => {
    const builderPath = path.join(rootDir, 'src/components/schedule/ScheduleBuilder.tsx');
    const content = fs.readFileSync(builderPath, 'utf8');

    // Debe tener barra resumen compacta en lg y oculta en xl
    assert.match(content, /hidden lg:flex xl:hidden/, 'Debe mostrar tira compacta en lg y ocultarla en xl');
    // En xl debe mostrar la columna derecha completa de 3 columnas
    assert.match(content, /hidden xl:flex/, 'Debe mostrar panel derecho completo en xl');
    // El drawer de resumen debe estar disponible mediante botón "Ver resumen"
    assert.match(content, /summaryDrawerOpen/, 'Debe soportar drawer de resumen');
  });

  it('Ajuste 3: Previsualización táctil activa según capacidades del dispositivo ((hover: none) y (pointer: coarse))', () => {
    const hookPath = path.join(rootDir, 'src/hooks/useTouchDevice.ts');
    assert.ok(fs.existsSync(hookPath), 'src/hooks/useTouchDevice.ts debe existir');
    const hookContent = fs.readFileSync(hookPath, 'utf8');

    // Debe consultar la media query oficial
    assert.match(hookContent, /\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)/, 'Debe evaluar (hover: none) and (pointer: coarse)');

    // En ScheduleLeftPanel se debe contemplar la previsualización en dos toques
    const panelPath = path.join(rootDir, 'src/components/schedule/ScheduleLeftPanel.tsx');
    const panelContent = fs.readFileSync(panelPath, 'utf8');
    assert.match(panelContent, /previewingCommissionId/, 'Debe almacenar comisión previsualizada');
    assert.match(panelContent, /Previsualizando|Confirmar/i, 'Debe indicar estado de previsualización táctil');
  });

  it('Ajuste 6: En mobile utiliza dvh en el contenedor raíz para adaptarse al teclado virtual', () => {
    const appPath = path.join(rootDir, 'src/App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf8');
    // Debe usar dvh en vez de vh fijo
    assert.match(appContent, /100dvh/, 'Debe usar 100dvh para adaptarse a teclados y barras de navegación dinámicas');
  });
});
