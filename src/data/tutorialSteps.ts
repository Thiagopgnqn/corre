import type { AppView } from '../components/common/Navbar';

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  badge?: string;
  targetSelector?: string;
  targetView?: AppView;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  interactiveAction?: 'click-subject' | 'change-status' | 'none';
  interactiveHint?: string;
  iconName: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  // 1. Bienvenida
  {
    id: 'welcome',
    title: '¡Bienvenido a Mi Carrera!',
    description:
      'Tu constelación académica interactiva para Ingeniería en Sistemas de Información (Plan 2023, UTN). Planificá, simulá correlativas y visualizá tu avance en tiempo real.',
    badge: 'Inicio del Tour',
    placement: 'center',
    targetView: 'graph',
    iconName: 'GraduationCap',
  },

  // 2. Mapa de Correlativas
  {
    id: 'graph-overview',
    title: 'El Mapa de Correlativas',
    description:
      'Cada nodo es una materia del plan oficial y las 5 columnas representan los años de la carrera (1° a 5° año). Podés arrastrar el lienzo y hacer zoom con la rueda del mouse.',
    badge: 'Grafo Visual',
    targetSelector: '[data-tour="graph-canvas"]',
    targetView: 'graph',
    placement: 'bottom',
    iconName: 'Compass',
  },

  // 3. Estados y Colores
  {
    id: 'status-legend',
    title: 'Estados de una Materia',
    description:
      'Cada estado tiene su color y brillo propio: bloqueada (gris), disponible (verde pulsante), cursando (cian), regularizada (ámbar) y aprobada o promocionada (verde y púrpura).',
    badge: 'Identidad Visual',
    targetSelector: '[data-tour="graph-controls"]',
    targetView: 'graph',
    placement: 'bottom',
    iconName: 'Palette',
  },

  // 4. Interactivo: Click en una materia
  {
    id: 'interactive-click',
    title: 'Detalle de Requisitos y Desbloqueos',
    description:
      'Hacé click en cualquier materia del mapa para abrir su panel lateral (o avanzá con "Siguiente"). Verás sus horas semanales, correlativas requeridas y las materias futuras que habilita.',
    badge: 'Interactivo',
    targetSelector: '[data-tour="sample-subject"]',
    targetView: 'graph',
    placement: 'right',
    interactiveAction: 'click-subject',
    interactiveHint: '👉 Hacé click en cualquier materia para abrir su panel lateral',
    iconName: 'MousePointerClick',
  },

  // 5. Interactivo: Cambiar estado y nota
  {
    id: 'interactive-status',
    title: 'Cambiar Estado y Celebración',
    description:
      'Probá marcar una materia como Aprobada o Promocionada con su nota. Se activará el festejo con confetti y las materias dependientes se desbloquearán automáticamente.',
    badge: 'Festejo & Unlock',
    targetSelector: '[data-tour="drawer-status-btn"]',
    targetView: 'graph',
    placement: 'left',
    interactiveAction: 'change-status',
    interactiveHint: '👉 Probá cambiar el estado de la materia abierta',
    iconName: 'Sparkles',
  },

  // 6. Tipos de Líneas
  {
    id: 'edge-types',
    title: 'Correlativas: Regular vs Aprobada',
    description:
      'Las líneas punteadas ámbar indican que necesitás tener la materia previa Regularizada para cursar. Las líneas sólidas esmeralda exigen tenerla Aprobada con final o promoción.',
    badge: 'Reglas del Plan',
    targetSelector: '[data-tour="edge-legend"]',
    targetView: 'graph',
    placement: 'bottom',
    iconName: 'GitBranch',
  },

  // 7. Modo Simulador "¿Y si...?"
  {
    id: 'simulation-mode',
    title: 'Simulador Hipotético "¿Y si...?"',
    description:
      'Activá este modo para proyectar escenarios futuros sin alterar tu historia real. Jugá a aprobar finales y observá qué materias se te abren antes de decidir tu cursada.',
    badge: 'Proyección Futura',
    targetSelector: '[data-tour="simulation-button"]',
    targetView: 'graph',
    placement: 'bottom',
    iconName: 'FlaskConical',
  },

  // 8. Electivas Libres por Año
  {
    id: 'electives-tour',
    title: 'Electivas Libres por Año (Total 20 cr)',
    description:
      'Sin cupos rígidos por nivel: podés agregar cualquier electiva en cualquier año donde cumplas sus correlativas. Para el título de Ingeniero/a se requieren 20 créditos en total.',
    badge: 'Oferta Académica',
    targetSelector: '[data-tour="electives-banner"]',
    targetView: 'electives',
    placement: 'bottom',
    iconName: 'Sparkles',
  },

  // 9. Interruptor de Título de Analista
  {
    id: 'analista-switch',
    title: 'Título Intermedio de Analista',
    description:
      'Si querés tramitar el título intermedio, activá este interruptor. Hará visible el Seminario Integrador (99) y habilitará el seguimiento con sus 4 créditos de electivas requeridos.',
    badge: 'Título Intermedio',
    targetSelector: '[data-tour="analista-button"]',
    targetView: 'graph',
    placement: 'bottom',
    iconName: 'Award',
  },

  // 10. Vistas de la App
  {
    id: 'app-views',
    title: 'Vistas, Planificador y Buscador',
    description:
      'Accedé al Tablero Kanban por estados o niveles, armá tu cuatrimestre sumando horas semanales en la canasta, o buscá cualquier materia al instante con Ctrl + K.',
    badge: 'Herramientas',
    targetSelector: '[data-tour="nav-tabs"]',
    targetView: 'graph',
    placement: 'bottom',
    iconName: 'Layers',
  },

  // 11. Armador de Horarios de Cuatrimestre
  {
    id: 'schedule-builder-tour',
    title: 'Armador de Horarios & Choques',
    description:
      'Planificá tu semana eligiendo comisiones, detectá superposiciones con alertas visuales rayadas, previsualizá bloques al posar el mouse y generá combinaciones automáticas sin choques.',
    badge: 'Grilla Semanal',
    targetSelector: '[data-tour="nav-tabs"]',
    targetView: 'schedule',
    placement: 'bottom',
    iconName: 'Clock',
  },

  // 12. Reseñas de Profesores
  {
    id: 'professors-reviews-tour',
    title: 'Reseñas de Profesores en Horarios',
    description:
      'Consultá puntuaciones y opiniones 100% anónimas por docente y materia, filtrá comisiones mejor valoradas directamente en el Armador de Horarios y puntuá a tus profesores en materias regularizadas o aprobadas.',
    badge: 'Comunidad & Elección',
    targetSelector: '[data-tour="professors-directory"]',
    targetView: 'professors',
    placement: 'bottom',
    iconName: 'Star',
  },

  // 13. Dashboard de Estadísticas
  {
    id: 'stats-tour',
    title: 'Estadísticas & Camino Crítico',
    description:
      'Monitoreá tu porcentaje de carrera por materias y horas, elegí si incluir electivas en el cálculo, revisá tu promedio general ponderado y descubrí la cadena crítica hacia la graduación.',
    badge: 'Analítica',
    targetSelector: '[data-tour="stats-rings"]',
    targetView: 'stats',
    placement: 'bottom',
    iconName: 'BarChart3',
  },

  // 14. Guardado y Respaldo
  {
    id: 'persistence-tour',
    title: 'Tus Datos 100% Tuyos',
    description:
      'Todo tu progreso se sincroniza con tu cuenta y podés exportar un respaldo JSON descargable desde el menú para llevarlo a otra computadora o celular.',
    badge: 'Privacidad & Respaldo',
    targetSelector: '[data-tour="more-menu-btn"]',
    targetView: 'graph',
    placement: 'bottom',
    iconName: 'Download',
  },

  // 15. Finalización
  {
    id: 'finish',
    title: '¡Todo Listo para Arrancar!',
    description:
      '¿Querés configurar rápidamente las materias que ya tenés aprobadas de años anteriores con la Carga Rápida, o preferís explorar libremente por tu cuenta?',
    badge: 'Fin del Tour',
    placement: 'center',
    targetView: 'graph',
    iconName: 'CheckCircle2',
  },
];
