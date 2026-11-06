import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GraduationCap,
  Compass,
  Palette,
  MousePointerClick,
  Sparkles,
  GitBranch,
  FlaskConical,
  Award,
  Layers,
  BarChart3,
  Download,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  X,
  HelpCircle,
  Clock,
  Star,
  UserCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { getAvailableTutorialSteps } from '../../data/tutorialSteps';
import { useScheduleAvailability } from '../../hooks/useScheduleAvailability';
import {
  computeTutorialLayout,
  adaptTutorialText,
  isTargetVisiblyInViewport,
  type RectLike,
  type ViewportLike,
  type SafeInsetsLike,
} from '../../utils/tutorialLayout';
import type { AppView } from '../common/Navbar';

interface TutorialSpotlightProps {
  currentView: AppView;
  onNavigateView: (view: AppView) => void;
}

interface SpotlightRect extends RectLike {}

const STEP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  GraduationCap,
  Compass,
  Palette,
  MousePointerClick,
  Sparkles,
  GitBranch,
  FlaskConical,
  Award,
  Layers,
  BarChart3,
  Download,
  CheckCircle2,
  HelpCircle,
  Clock,
  Star,
  UserCheck,
};

function getVisualViewport(): ViewportLike {
  if (typeof window === 'undefined') {
    return { width: 1200, height: 800, offsetTop: 0, offsetLeft: 0 };
  }
  const innerW = window.innerWidth;
  const innerH = window.innerHeight;
  if (window.visualViewport) {
    const vvW = Math.round(window.visualViewport.width);
    const vvH = Math.round(window.visualViewport.height);
    // Solo usar visualViewport si se encuentra dentro del layout viewport (ej. barra de direcciones móvil o teclado virtual)
    if (vvW > 0 && vvW <= innerW + 2 && vvH > 0 && vvH <= innerH + 2 && Math.abs(vvW - innerW) < 40) {
      return {
        width: vvW,
        height: vvH,
        offsetTop: Math.round(window.visualViewport.offsetTop),
        offsetLeft: Math.round(window.visualViewport.offsetLeft),
      };
    }
  }
  return {
    width: innerW,
    height: innerH,
    offsetTop: 0,
    offsetLeft: 0,
  };
}

/**
 * Busca el elemento visible en el DOM que coincida con el selector dado,
 * ignorando elementos con display: none o dimensiones nulas.
 */
function findVisibleElement(selector: string): HTMLElement | null {
  if (!selector || typeof document === 'undefined') return null;
  const elements = Array.from(document.querySelectorAll(selector));
  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    const style = window.getComputedStyle(el);
    if (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      parseFloat(style.opacity || '1') > 0
    ) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return el;
      }
    }
  }
  return null;
}

/**
 * Encuentra el contenedor con scroll más cercano a un elemento.
 */
function findScrollContainer(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  let parent = element.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

export const TutorialSpotlight: React.FC<TutorialSpotlightProps> = ({
  currentView,
  onNavigateView,
}) => {
  const {
    isTutorialOpen,
    currentTutorialStep,
    closeTutorial,
    nextTutorialStep,
    prevTutorialStep,
    selectedSubjectId,
    setSelectedSubjectId,
    setIsMoreMenuOpen,
  } = useCareer();

  const { isAvailable: isScheduleAvailable } = useScheduleAvailability();
  const availableSteps = React.useMemo(
    () => getAvailableTutorialSteps(isScheduleAvailable),
    [isScheduleAvailable]
  );
  const step = availableSteps[currentTutorialStep] || availableSteps[availableSteps.length - 1];

  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const [viewport, setViewport] = useState<ViewportLike>(getVisualViewport);
  const [isTextExpanded, setIsTextExpanded] = useState<boolean>(false);
  const [measuredCardHeight, setMeasuredCardHeight] = useState<number>(270);
  const cardRef = useRef<HTMLDivElement>(null);

  // Medir dinámicamente la altura real de la tarjeta en el DOM (incluyendo tras transiciones de AnimatePresence)
  useEffect(() => {
    if (!isTutorialOpen) return;
    let rafId: number | null = null;
    const syncHeight = () => {
      if (cardRef.current) {
        const h = cardRef.current.offsetHeight;
        if (h > 0 && Math.abs(h - measuredCardHeight) >= 1) {
          setMeasuredCardHeight(h);
        }
      }
    };
    syncHeight();
    const timer1 = setTimeout(syncHeight, 60);
    const timer2 = setTimeout(syncHeight, 200);
    const timer3 = setTimeout(syncHeight, 380);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && cardRef.current) {
      ro = new ResizeObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(syncHeight);
      });
      ro.observe(cardRef.current);
    }
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      if (rafId) cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
    };
  }, [isTutorialOpen, step?.id, isTextExpanded, rect, viewport.height, measuredCardHeight]);

  const isMobile = viewport.width < 768;

  // Actualizar dimensiones de viewport ante resize, scroll o cambio en barra de navegación de Android
  const updateViewport = useCallback(() => {
    setViewport(getVisualViewport());
  }, []);

  useEffect(() => {
    if (!isTutorialOpen) return;
    updateViewport();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', updateViewport);
      vv.addEventListener('scroll', updateViewport);
    }
    window.addEventListener('resize', updateViewport);
    window.addEventListener('scroll', updateViewport, true);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', updateViewport);
        vv.removeEventListener('scroll', updateViewport);
      }
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('scroll', updateViewport, true);
    };
  }, [isTutorialOpen, updateViewport]);

  // Cambiar de vista si el paso lo requiere
  useEffect(() => {
    if (isTutorialOpen && step?.targetView && step.targetView !== currentView) {
      onNavigateView(step.targetView);
    }
  }, [isTutorialOpen, step?.targetView, currentView, onNavigateView]);

  // Gestión de contenedores dependientes de cada paso (Drawer, Sheet "Más", etc.)
  useEffect(() => {
    if (!isTutorialOpen || !step) return;

    // Resetear expansión de texto en cada paso nuevo
    setIsTextExpanded(false);

    // Paso 5 (interactive-status): abrir SubjectDrawer seleccionando la materia visible (sample-subject) o materia 1
    if (step.id === 'interactive-status' && !selectedSubjectId) {
      const sampleEl = findVisibleElement('[data-tour="sample-subject"]');
      const sampleIdAttr = sampleEl?.getAttribute('data-subject-id');
      const sampleId = sampleIdAttr ? Number(sampleIdAttr) : 1;
      setSelectedSubjectId(Number.isFinite(sampleId) && sampleId > 0 ? sampleId : 1);
    }

    // Paso 6 (edge-types): cerrar el drawer para ver el lienzo de correlativas despejado
    if (step.id === 'edge-types' && selectedSubjectId) {
      setSelectedSubjectId(null);
    }

    // Paso 9 (analista-switch) o Paso 16 (finish): abrir Sheet "Más" en mobile o menú "Más" en desktop (< 1900px)
    const needsMoreMenuForAnalista =
      viewport.width < 1900 &&
      (step.id === 'analista-switch' ||
        (step.targetSelector && step.targetSelector.includes('analista-button')));
    const needsMoreMenuForFinish =
      step.id === 'finish' ||
      (step.targetSelector && step.targetSelector.includes('onboarding-menu-item'));

    if (needsMoreMenuForAnalista || needsMoreMenuForFinish) {
      setIsMoreMenuOpen(true);
    } else {
      // Cerrar Sheet/Menú Más en pasos que no lo requieran
      setIsMoreMenuOpen(false);
    }
  }, [isTutorialOpen, step?.id, step?.targetSelector, viewport.width, selectedSubjectId, setSelectedSubjectId, setIsMoreMenuOpen]);

  // Selector efectivo según viewport
  const effectiveTargetSelector = React.useMemo(() => {
    if (!step?.targetSelector) return null;
    // Paso 2: vista panorámica del mapa completo -> tarjeta informativa general
    if (step.id === 'graph-overview' || step.targetSelector === '[data-tour="graph-canvas"]') {
      return null;
    }
    const isShortViewport = viewport.height < 480;
    const isTallTargetInCompactScreen = viewport.height < 680;
    // En viewports bajos (ej. 640x360 landscape o 630px con fuente al 130%), apuntar al título/cabecera del banner para dejar aire vertical
    if (
      (isShortViewport || isTallTargetInCompactScreen) &&
      step.targetSelector === '[data-tour="electives-banner"]'
    ) {
      return '[data-tour="electives-banner"] > div:first-child';
    }
    if (
      (isShortViewport || isTallTargetInCompactScreen) &&
      step.targetSelector === '[data-tour="library-header"]'
    ) {
      return '[data-tour="library-header"] h1';
    }
    // Paso de estadísticas: apuntar al primer anillo ("Avance por materias")
    if (step.id === 'stats-tour' || step.targetSelector === '[data-tour="stats-rings"]') {
      return '[data-tour="stats-rings"] > div:first-child';
    }
    // Paso 10 en mobile destaca el botón Más en el bottom nav
    if (isMobile && step.id === 'app-views') {
      return '[data-tour="more-menu-btn"]';
    }
    return step.targetSelector;
  }, [step?.targetSelector, step?.id, isMobile, viewport.height]);

  // Medición reactiva y estabilización mediante requestAnimationFrame
  useEffect(() => {
    if (!isTutorialOpen || !step) return;

    // Limpiar el rect anterior inmediatamente al cambiar de paso para no reutilizar una caja vieja
    setRect(null);

    if (!effectiveTargetSelector || step.placement === 'center') {
      return;
    }

    let isMounted = true;
    let consecutiveMatches = 0;
    const STABLE_FRAMES_REQUIRED = 3;
    let lastTop = -9999;
    let lastLeft = -9999;
    let lastWidth = -9999;
    let lastHeight = -9999;
    let frameCount = 0;
    const maxFrames = 75; // ~1200ms de tope para animaciones de entrada (ej. AnimatePresence mode="wait")

    const ensureScrolledIntoView = (el: HTMLElement) => {
      const scrollParent = findScrollContainer(el);
      if (scrollParent) {
        const parentRect = scrollParent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        if (elRect.top < parentRect.top + 8 || elRect.bottom > parentRect.bottom - 8) {
          el.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' });
        }
      } else {
        const elStyle = window.getComputedStyle(el);
        const vp = getVisualViewport();
        if (elStyle.position !== 'fixed' && document.documentElement.scrollHeight > vp.height + 10) {
          const rawRect = el.getBoundingClientRect();
          const desiredTop = vp.height < 480 ? 58 : 68;
          if (rawRect.top > desiredTop + 16 || rawRect.top < 52 || rawRect.bottom > vp.height - 56) {
            const targetScrollY = Math.max(0, window.scrollY + rawRect.top - desiredTop);
            if (Math.abs(window.scrollY - targetScrollY) > 2) {
              window.scrollTo({ top: targetScrollY, behavior: 'instant' as ScrollBehavior });
            }
          }
        }
      }
      const afterRect = el.getBoundingClientRect();
      if (!isTargetVisiblyInViewport(afterRect, getVisualViewport())) {
        try {
          el.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center', inline: 'center' });
        } catch {
          // ignore if unsupported in environment
        }
      }
    };

    const buildValidatedRect = (el: HTMLElement): SpotlightRect | null => {
      const b = el.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) return null;
      if (!isTargetVisiblyInViewport(b, getVisualViewport())) {
        return null;
      }
      const pad = 8;
      const top = Math.round(b.top - pad);
      const left = Math.round(b.left - pad);
      const width = Math.round(b.width + pad * 2);
      const height = Math.round(b.height + pad * 2);
      return {
        top,
        left,
        width,
        height,
        bottom: top + height,
        right: left + width,
      };
    };

    const checkFrame = () => {
      if (!isMounted) return;
      frameCount++;

      const el = findVisibleElement(effectiveTargetSelector);
      if (el) {
        ensureScrolledIntoView(el);
        const b = el.getBoundingClientRect();
        const currentRect = buildValidatedRect(el);

        setRect(currentRect);

        const isWithinScreen = currentRect !== null;
        const isStable =
          isWithinScreen &&
          Math.abs(b.top - lastTop) < 1.0 &&
          Math.abs(b.left - lastLeft) < 1.0 &&
          Math.abs(b.width - lastWidth) < 1.0 &&
          Math.abs(b.height - lastHeight) < 1.0;

        if (isStable) {
          consecutiveMatches++;
        } else {
          consecutiveMatches = 0;
          lastTop = b.top;
          lastLeft = b.left;
          lastWidth = b.width;
          lastHeight = b.height;
        }

        // Exigir al menos 10 frames (~160ms) para dar tiempo a que comience la transición antes de congelar
        if ((consecutiveMatches >= STABLE_FRAMES_REQUIRED && frameCount >= 10) || frameCount >= maxFrames) {
          if (!currentRect) {
            console.warn(
              `[TutorialSpotlight] Objetivo fuera del viewport visual (< 90% visible) para paso: ${step.id} (selector: ${effectiveTargetSelector})`
            );
            setRect(null);
          }
          return;
        }
      }

      if (frameCount < maxFrames) {
        requestAnimationFrame(checkFrame);
      } else {
        const finalEl = findVisibleElement(effectiveTargetSelector);
        const finalRect = finalEl ? buildValidatedRect(finalEl) : null;
        if (!finalRect) {
          console.warn(
            `[TutorialSpotlight] Objetivo no visible en viewport para paso: ${step.id} (selector: ${effectiveTargetSelector})`
          );
          setRect(null);
        }
      }
    };

    // Pequeño retardo inicial para permitir que el DOM monte el nodo
    const initialTimer = setTimeout(() => {
      requestAnimationFrame(checkFrame);
    }, 40);

    // Mantener el rect sincronizado ante cargas asíncronas de datos (ej. Profesores, Biblioteca) o scroll/resize
    const syncTargetRectNow = () => {
      if (!isMounted) return;
      if (cardRef.current) {
        const h = cardRef.current.offsetHeight;
        if (h > 0) setMeasuredCardHeight((prev) => (Math.abs(h - prev) >= 1 ? h : prev));
      }
      const el = findVisibleElement(effectiveTargetSelector);
      if (!el) {
        setRect(null);
        return;
      }
      ensureScrolledIntoView(el);
      const validRect = buildValidatedRect(el);
      setRect(validRect);
    };

    const lateTimer1 = setTimeout(syncTargetRectNow, 260);
    const lateTimer2 = setTimeout(syncTargetRectNow, 480);
    const lateTimer3 = setTimeout(syncTargetRectNow, 680);
    window.addEventListener('scroll', syncTargetRectNow, true);
    window.addEventListener('resize', syncTargetRectNow);

    return () => {
      isMounted = false;
      clearTimeout(initialTimer);
      clearTimeout(lateTimer1);
      clearTimeout(lateTimer2);
      clearTimeout(lateTimer3);
      window.removeEventListener('scroll', syncTargetRectNow, true);
      window.removeEventListener('resize', syncTargetRectNow);
    };
  }, [isTutorialOpen, step?.id, effectiveTargetSelector, currentView]);

  // Teclado accesible
  useEffect(() => {
    if (!isTutorialOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        nextTutorialStep();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevTutorialStep();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeTutorial();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTutorialOpen, nextTutorialStep, prevTutorialStep, closeTutorial]);

  if (!isTutorialOpen || !step) return null;

  const IconComponent = STEP_ICONS[step.iconName] || Sparkles;
  const isFirstStep = currentTutorialStep === 0;
  const isLastStep = currentTutorialStep >= availableSteps.length - 1;
  const progressPercent = Math.round(((currentTutorialStep + 1) / availableSteps.length) * 100);

  // Adaptación de textos contextuales (táctil vs mouse)
  const adaptedText = adaptTutorialText(step, isMobile);

  const cardWidth = Math.min(420, viewport.width - 24);
  const cardHeightToUse =
    cardRef.current?.offsetHeight && cardRef.current.offsetHeight > 0
      ? cardRef.current.offsetHeight
      : measuredCardHeight > 0
      ? measuredCardHeight
      : isTextExpanded
      ? 320
      : 240;

  const isShortViewport = viewport.height < 480;
  const isReducedVisualViewport =
    typeof window !== 'undefined' && viewport.height < window.innerHeight - 20;

  const safeInsets: SafeInsetsLike = {
    top: isShortViewport ? 8 : 12,
    bottom: isMobile
      ? isReducedVisualViewport
        ? 12
        : isShortViewport
        ? 52
        : 76
      : 16,
    left: 12,
    right: 12,
  };

  // Heurística mobile: si el objetivo está en la mitad inferior de la pantalla (rect && rect.top > windowSize.height / 2)
  const windowSize = { width: viewport.width, height: viewport.height };
  const isBottomHalf = rect && rect.top > windowSize.height / 2;
  void isBottomHalf;

  const layout = computeTutorialLayout(rect, { width: cardWidth, height: cardHeightToUse }, viewport, safeInsets);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal-top)] overflow-hidden pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-step-title"
    >
      {/* SVG del Spotlight con recorte dinámico (coordenadas 1:1 en píxeles CSS) */}
      <svg className="fixed inset-0 w-full h-full pointer-events-none z-[var(--z-modal-top)]">
        <defs>
          <mask id="tutorial-spotlight-mask">
            {/* Fondo blanco revela el overlay oscuro */}
            <rect x="0" y="0" width={viewport.width} height={viewport.height} fill="white" />
            {/* Rectángulo negro perfora la ventana del spotlight */}
            {rect && (
              <rect
                x={rect.left}
                y={rect.top}
                width={rect.width}
                height={rect.height}
                rx="14"
                ry="14"
                fill="black"
              />
            )}
          </mask>
        </defs>

        {/* Fondo oscurecido. Si no hay objetivo visible, es transparente para NO tapar la pantalla */}
        <rect
          x="0"
          y="0"
          width={viewport.width}
          height={viewport.height}
          fill={rect ? 'rgba(2, 6, 23, 0.78)' : 'transparent'}
          mask={rect ? 'url(#tutorial-spotlight-mask)' : undefined}
        />
      </svg>

      {/* Anillo dorado pulsante alrededor del objetivo */}
      {rect && (
        <div
          data-tour="tutorial-spotlight-ring"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
          className="fixed rounded-2xl border-2 border-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.4)] pointer-events-none z-[var(--z-modal-top)] animate-pulse"
        />
      )}

      {/* Tarjeta flotante interactiva */}
      <div
        style={{
          top: layout.cardCoords.top,
          left: layout.cardCoords.left,
          width: layout.cardMaxWidth ?? cardWidth,
          maxHeight: layout.cardMaxHeight,
        }}
        className="fixed z-[var(--z-modal-top)] pointer-events-auto"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            ref={cardRef}
            data-tour="tutorial-card"
            style={{ maxHeight: layout.cardMaxHeight }}
            className="w-full bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-3 sm:p-5 shadow-2xl flex flex-col gap-2 sm:gap-3 text-slate-100 overflow-y-auto"
          >
            {/* Cabecera de la tarjeta: Badge, Conteo y Botón Cerrar */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <IconComponent className="w-4 h-4" />
                </span>
                {step.badge && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 uppercase tracking-wider">
                    {step.badge}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-slate-400">
                  {currentTutorialStep + 1} / {availableSteps.length}
                </span>
                <button
                  type="button"
                  onClick={() => closeTutorial()}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                  title="Cerrar tutorial (Esc)"
                  aria-label="Cerrar tutorial"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Contenido textual con soporte de compactación ("Ver más") */}
            <div className="space-y-1.5">
              <h3
                id="tutorial-step-title"
                className="text-base sm:text-lg font-black text-white leading-tight"
              >
                {adaptedText.title}
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {layout.shouldCollapseText && !isTextExpanded
                  ? `${adaptedText.description.slice(0, 110)}...`
                  : adaptedText.description}
              </p>

              {layout.shouldCollapseText && (
                <button
                  type="button"
                  onClick={() => setIsTextExpanded(!isTextExpanded)}
                  className="text-xs font-bold text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 cursor-pointer py-1"
                >
                  <span>{isTextExpanded ? 'Ver menos' : 'Ver más'}</span>
                  {isTextExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              )}

              {/* Indicación interactiva */}
              {adaptedText.interactiveHint && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center gap-2 mt-2">
                  <span>{adaptedText.interactiveHint}</span>
                </div>
              )}
            </div>

            {/* Barra de progreso */}
            <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800">
              <motion.div
                className="h-full bg-gradient-to-r from-indigo-500 via-amber-500 to-emerald-400 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            {/* Acciones de pie de tarjeta con targets táctiles >= 44px */}
            <div className="flex items-center justify-between pt-1 gap-2">
              {!isLastStep ? (
                <button
                  type="button"
                  onClick={() => closeTutorial()}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors py-2 px-1 min-h-[44px] flex items-center cursor-pointer"
                >
                  Saltar
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                {!isFirstStep && (
                  <button
                    type="button"
                    onClick={prevTutorialStep}
                    className="px-3 py-2 min-h-[44px] rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-all flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Atrás</span>
                  </button>
                )}

                {isLastStep ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => closeTutorial()}
                      className="px-3 py-2 min-h-[44px] rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-all cursor-pointer"
                    >
                      Empezar solo
                    </button>
                    <button
                      type="button"
                      onClick={() => closeTutorial({ openOnboarding: true })}
                      className="px-3.5 py-2 min-h-[44px] rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Cargar mis materias</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={nextTutorialStep}
                    className="px-4 py-2 min-h-[44px] rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Siguiente</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
