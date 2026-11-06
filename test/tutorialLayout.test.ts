import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTutorialLayout,
  adaptTutorialText,
  getTargetVisibilityRatio,
  isTargetVisiblyInViewport,
  MIN_AIR_GAP_PX,
} from '../src/utils/tutorialLayout';

describe('A2. computeTutorialLayout (Función Pura de Layout del Tutorial)', () => {
  const defaultCardSize = { width: 380, height: 260 };

  it('1. Sin objetivo o placement center: centra la tarjeta perfectamente en el viewport', () => {
    const viewport = { width: 411, height: 740, offsetTop: 0, offsetLeft: 0 };
    const res = computeTutorialLayout(null, defaultCardSize, viewport);

    assert.equal(res.placement, 'center');
    assert.equal(res.overlapDetected, false);
    // Centrado vertical: (740 - 260) / 2 = 240
    assert.equal(res.cardCoords.top, 240);
    // Centrado horizontal: (411 - 380) / 2 = 15.5 -> 16
    assert.equal(res.cardCoords.left, 16);
  });

  it('2. Objetivo arriba: coloca la tarjeta abajo con al menos 12px de separación', () => {
    const viewport = { width: 411, height: 740, offsetTop: 0, offsetLeft: 0 };
    // Objetivo en la cabecera (top 60, height 50 -> bottom 110)
    const targetRect = { top: 60, left: 20, width: 200, height: 50, bottom: 110 };
    const res = computeTutorialLayout(targetRect, defaultCardSize, viewport);

    assert.equal(res.placement, 'bottom');
    assert.ok(res.cardCoords.top >= targetRect.bottom + MIN_AIR_GAP_PX, 'Debe haber al menos 12px de aire debajo del objetivo');
    assert.equal(res.overlapDetected, false);
  });

  it('3. Objetivo abajo (o en la barra inferior): coloca la tarjeta SIEMPRE arriba sin taparlo', () => {
    const viewport = { width: 411, height: 740, offsetTop: 0, offsetLeft: 0 };
    // Barra de navegación inferior móvil: top 676, height 64 -> bottom 740
    const targetNav = { top: 676, left: 0, width: 411, height: 64, bottom: 740 };
    const res = computeTutorialLayout(targetNav, defaultCardSize, viewport);

    assert.equal(res.placement, 'top', 'Si el objetivo está en la barra inferior, la tarjeta debe colocarse arriba');
    // La tarjeta debe terminar antes de targetNav.top - MIN_AIR_GAP_PX
    const cardBottom = res.cardCoords.top + defaultCardSize.height;
    assert.ok(cardBottom <= targetNav.top - MIN_AIR_GAP_PX || res.cardCoords.top <= targetNav.top - MIN_AIR_GAP_PX);
    assert.equal(res.overlapDetected, false, 'No debe existir superposición con la barra inferior');
  });

  it('4. Objetivo en el centro: elige el lado con más espacio libre disponible', () => {
    const viewport = { width: 411, height: 740, offsetTop: 0, offsetLeft: 0 };
    // Objetivo ubicado a top 250, bottom 350.
    // Espacio arriba: 250 - 12 - 12 = 226px. Espacio abajo: 740 - 12 - 350 - 12 = 366px.
    // Como abajo hay 366px (> 260px de la tarjeta y > 226px de arriba), elige abajo.
    const targetRect = { top: 250, left: 10, width: 390, height: 100, bottom: 350 };
    const res = computeTutorialLayout(targetRect, defaultCardSize, viewport);

    assert.equal(res.placement, 'bottom');
    assert.ok(res.cardCoords.top >= targetRect.bottom + MIN_AIR_GAP_PX);
    assert.equal(res.overlapDetected, false);
  });

  it('5. Viewport chico o con barra de direcciones simulada (411x630 visualViewport): no se desborda y compacta si es necesario', () => {
    const viewport = { width: 411, height: 630, offsetTop: 0, offsetLeft: 0 };
    // Objetivo grande en el centro (top 150, height 300 -> bottom 450)
    const targetRect = { top: 150, left: 20, width: 370, height: 300, bottom: 450 };
    const res = computeTutorialLayout(targetRect, defaultCardSize, viewport);

    assert.equal(res.overlapDetected, false, 'Incluso en viewport chico la tarjeta no se superpone');
    assert.ok(res.cardMaxHeight > 0, 'Debe calcular altura máxima de contención');
  });

  it('6. Objetivo dentro de un sheet con safe-area insets', () => {
    const viewport = { width: 360, height: 640, offsetTop: 0, offsetLeft: 0 };
    const safeInsets = { top: 24, bottom: 34, left: 12, right: 12 };
    const targetInsideSheet = { top: 380, left: 16, width: 328, height: 48, bottom: 428 };
    const res = computeTutorialLayout(targetInsideSheet, defaultCardSize, viewport, safeInsets);

    assert.equal(res.overlapDetected, false);
    // Espacio arriba: 380 - 24 - 12 = 344px. Abajo: 640 - 34 - 428 - 12 = 166px.
    // Arriba tiene mucho más espacio que abajo.
    assert.equal(res.placement, 'top');
    assert.ok(res.cardCoords.top >= safeInsets.top);
  });
});

describe('A2. adaptTutorialText (Adaptación de Textos por Dispositivo)', () => {
  it('Reemplaza "Ctrl + K" por "la lupa de la barra superior" en mobile', () => {
    const step10 = {
      id: 'app-views',
      title: 'Vistas, Planificador y Buscador',
      description: 'Accedé al Tablero Kanban por estados o niveles, armá tu cuatrimestre sumando horas semanales en la canasta, o buscá cualquier materia al instante con Ctrl + K.',
    };

    const desktopText = adaptTutorialText(step10, false);
    assert.match(desktopText.description, /Ctrl \+ K/);

    const mobileText = adaptTutorialText(step10, true);
    assert.doesNotMatch(mobileText.description, /Ctrl \+ K/);
    assert.match(mobileText.description, /lupa de la barra superior/);
  });

  it('Reemplaza "rueda del mouse" por "dos dedos" en mobile', () => {
    const step2 = {
      id: 'graph-overview',
      title: 'El Mapa de Correlativas',
      description: 'Cada nodo es una materia del plan oficial y las 5 columnas representan los años de la carrera. Podés arrastrar el lienzo y hacer zoom con la rueda del mouse.',
    };

    const mobileText = adaptTutorialText(step2, true);
    assert.doesNotMatch(mobileText.description, /rueda del mouse/);
    assert.match(mobileText.description, /dos dedos/);
  });

  it('Reemplaza "Hacé click" por "Tocá" en mobile', () => {
    const step4 = {
      id: 'interactive-click',
      title: 'Detalle de Requisitos',
      description: 'Hacé click en cualquier materia del mapa para abrir su panel lateral.',
      interactiveHint: '👉 Hacé click en cualquier materia',
    };

    const mobileText = adaptTutorialText(step4, true);
    assert.match(mobileText.description, /Tocá cualquier materia/);
    assert.match(mobileText.interactiveHint!, /👉 Tocá cualquier materia/);
  });

  it('Adapta el paso de Reseñas de Profesores en mobile omitiendo el Armador de Horarios', () => {
    const stepProf = {
      id: 'professors-reviews-tour',
      title: 'Reseñas de Profesores en Horarios',
      description: 'Consultá puntuaciones y opiniones 100% anónimas por docente y materia, filtrá comisiones mejor valoradas directamente en el Armador de Horarios y puntuá a tus profesores en materias regularizadas o aprobadas.',
    };

    const mobileText = adaptTutorialText(stepProf, true);
    assert.equal(mobileText.title, 'Reseñas de Profesores');
    assert.doesNotMatch(mobileText.description, /Armador de Horarios/);
    assert.match(mobileText.description, /pestaña Profesores/);
  });

  it('Adapta Mi Cursada en mobile omitiendo referencias a horarios', () => {
    const stepCursada = {
      id: 'enrollments-and-recommendations-tour',
      title: 'Mi Cursada & Recomendaciones',
      description: 'Indicá con qué comisión y docentes cursaste cada materia desde su ficha o al pasar tu horario a cursando. El sistema te sugerirá automáticamente a quiénes reseñar.',
    };

    const mobileText = adaptTutorialText(stepCursada, true);
    assert.doesNotMatch(mobileText.description, /o al pasar tu horario a cursando/);
    assert.match(mobileText.description, /desde su ficha/);
  });
});

describe('A2. getTargetVisibilityRatio & isTargetVisiblyInViewport (Visibilidad >= 90%)', () => {
  it('Rechaza objetivos fuera del viewport (ej. left: -428..-249) y aprueba objetivos >= 90% visibles', () => {
    const vp = { width: 411, height: 630, offsetTop: 0, offsetLeft: 0 };
    const offscreenNode = { top: 202, left: -428, width: 179, height: 87, right: -249, bottom: 290 };
    assert.equal(getTargetVisibilityRatio(offscreenNode, vp), 0);
    assert.equal(isTargetVisiblyInViewport(offscreenNode, vp), false);

    const visibleNode = { top: 140, left: 116, width: 179, height: 87, right: 295, bottom: 227 };
    assert.equal(getTargetVisibilityRatio(visibleNode, vp), 1);
    assert.equal(isTargetVisiblyInViewport(visibleNode, vp), true);
  });
});

