import React, { useEffect, useState, useRef } from 'react';
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
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { TUTORIAL_STEPS } from '../../data/tutorialSteps';
import type { AppView } from '../common/Navbar';

interface TutorialSpotlightProps {
  currentView: AppView;
  onNavigateView: (view: AppView) => void;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// Icon mapping dictionary
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

function getElementRect(selector?: string): SpotlightRect | null {
  if (!selector || typeof window === 'undefined') return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const b = el.getBoundingClientRect();

  // If element is not rendered, hidden in closed menu, or has zero dimensions, fallback gracefully to center
  if (
    b.width <= 0 ||
    b.height <= 0 ||
    (b.top === 0 && b.left === 0 && b.width <= 16 && b.height <= 16)
  ) {
    return null;
  }

  const computedStyle = window.getComputedStyle(el);
  if (
    computedStyle.display === 'none' ||
    computedStyle.visibility === 'hidden' ||
    computedStyle.opacity === '0'
  ) {
    return null;
  }

  const pad = 8;
  return {
    top: Math.max(0, b.top - pad),
    left: Math.max(0, b.left - pad),
    width: Math.min(window.innerWidth, b.width + pad * 2),
    height: Math.min(window.innerHeight, b.height + pad * 2),
  };
}

function calculateCardCoords(
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center',
  rect: SpotlightRect | null,
  windowSize: { width: number; height: number },
  cardWidth = 420,
  cardHeight = 280
): { top: number; left: number } {
  const margin = 16;
  const isMobile = windowSize.width < 640;

  if (isMobile) {
    if (!rect || placement === 'center') {
      return {
        top: Math.max(margin, Math.round((windowSize.height - cardHeight) / 2)),
        left: margin,
      };
    }
    return {
      top: Math.max(margin, windowSize.height - cardHeight - 74),
      left: margin,
    };
  }

  if (!rect || placement === 'center') {
    return {
      top: Math.max(margin, Math.round((windowSize.height - cardHeight) / 2)),
      left: Math.max(margin, Math.round((windowSize.width - cardWidth) / 2)),
    };
  }

  let top = 0;
  let left = 0;

  switch (placement) {
    case 'bottom':
      top = rect.top + rect.height + margin;
      left = rect.left + rect.width / 2 - cardWidth / 2;
      // If overflows bottom, flip to top
      if (top + cardHeight > windowSize.height - margin && rect.top - cardHeight - margin >= margin) {
        top = rect.top - cardHeight - margin;
      }
      break;
    case 'top':
      top = rect.top - cardHeight - margin;
      left = rect.left + rect.width / 2 - cardWidth / 2;
      // If overflows top, flip to bottom
      if (top < margin && rect.top + rect.height + cardHeight + margin <= windowSize.height) {
        top = rect.top + rect.height + margin;
      }
      break;
    case 'left':
      top = rect.top + rect.height / 2 - cardHeight / 2;
      left = rect.left - cardWidth - margin;
      // If overflows left, flip to right
      if (left < margin && rect.left + rect.width + cardWidth + margin <= windowSize.width) {
        left = rect.left + rect.width + margin;
      }
      break;
    case 'right':
    default:
      top = rect.top + rect.height / 2 - cardHeight / 2;
      left = rect.left + rect.width + margin;
      // If overflows right, flip to left
      if (left + cardWidth > windowSize.width - margin && rect.left - cardWidth - margin >= margin) {
        left = rect.left - cardWidth - margin;
      }
      break;
  }

  // Safe clamping within viewport
  top = Math.max(margin, Math.min(windowSize.height - cardHeight - margin, top));
  left = Math.max(margin, Math.min(windowSize.width - cardWidth - margin, left));

  return { top, left };
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
  } = useCareer();

  const step = TUTORIAL_STEPS[currentTutorialStep];

  const [rect, setRect] = useState<SpotlightRect | null>(() => {
    const s = TUTORIAL_STEPS[currentTutorialStep];
    return s?.targetSelector ? getElementRect(s.targetSelector) : null;
  });

  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  // Navigate to target view if step requires a different tab
  useEffect(() => {
    if (isTutorialOpen && step?.targetView && step.targetView !== currentView) {
      onNavigateView(step.targetView);
    }
  }, [isTutorialOpen, step?.targetView, currentView, onNavigateView]);

  // Synchronous and short-polling rect resolution on step or view change
  useEffect(() => {
    if (!isTutorialOpen || !step) return;

    if (!step.targetSelector || step.placement === 'center') {
      setRect(null);
      return;
    }

    let isMounted = true;
    let timerId: number | null = null;
    let attempts = 0;
    const maxAttempts = 25; // 25 * 20ms = 500ms max

    const findRect = () => {
      if (!isMounted) return;
      const r = getElementRect(step.targetSelector);
      if (r) {
        setRect(r);
      } else if (attempts < maxAttempts) {
        attempts++;
        timerId = window.setTimeout(findRect, 20);
      } else {
        setRect(null);
      }
    };

    // Attempt resolution immediately
    findRect();

    const handleResizeOrScroll = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
      const r = getElementRect(step.targetSelector);
      if (r) setRect(r);
    };

    window.addEventListener('resize', handleResizeOrScroll);
    window.addEventListener('scroll', handleResizeOrScroll, true);

    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
      window.removeEventListener('resize', handleResizeOrScroll);
      window.removeEventListener('scroll', handleResizeOrScroll, true);
    };
  }, [isTutorialOpen, step, currentView]);

  // Step 5: ensure subject 1 is selected so the drawer and status button exist
  useEffect(() => {
    if (isTutorialOpen && step?.id === 'interactive-status' && !selectedSubjectId) {
      setSelectedSubjectId(1);
    }
  }, [isTutorialOpen, step?.id, selectedSubjectId, setSelectedSubjectId]);

  // Step 6: close drawer so the graph lines and edge legend are unobstructed
  useEffect(() => {
    if (isTutorialOpen && step?.id === 'edge-types' && selectedSubjectId) {
      setSelectedSubjectId(null);
    }
  }, [isTutorialOpen, step?.id, selectedSubjectId, setSelectedSubjectId]);

  // Avoid skipping Step 4 if a subject was already selected before entering Step 4
  const lastStepIdRef = useRef<string | null>(null);
  const prevSelectedIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isTutorialOpen || !step) return;
    if (lastStepIdRef.current !== step.id) {
      lastStepIdRef.current = step.id;
      prevSelectedIdRef.current = selectedSubjectId;
    }
  }, [isTutorialOpen, step, selectedSubjectId]);

  // Interactive step advance: if step requires clicking a subject and user clicked a new one
  useEffect(() => {
    if (isTutorialOpen && step?.interactiveAction === 'click-subject') {
      if (selectedSubjectId && selectedSubjectId !== prevSelectedIdRef.current) {
        prevSelectedIdRef.current = selectedSubjectId;
        const autoTimer = setTimeout(() => {
          nextTutorialStep();
        }, 500);
        return () => clearTimeout(autoTimer);
      }
    }
  }, [isTutorialOpen, step, selectedSubjectId, nextTutorialStep]);

  // Keyboard navigation
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
  const isLastStep = currentTutorialStep === TUTORIAL_STEPS.length - 1;
  const progressPercent = Math.round(((currentTutorialStep + 1) / TUTORIAL_STEPS.length) * 100);

  const isMobile = windowSize.width < 640;
  const cardWidth = Math.min(420, windowSize.width - 32);
  const coords = calculateCardCoords(
    step.placement || 'center',
    rect,
    windowSize,
    cardWidth,
    280
  );

  return (
    <div className="fixed inset-0 z-50 overflow-hidden pointer-events-none" role="dialog" aria-modal="true">
      {/* Dark Spotlight SVG Mask with smoothly animated cutout */}
      <svg className="fixed inset-0 w-full h-full pointer-events-none z-50">
        <defs>
          <mask id="tutorial-spotlight-mask">
            {/* White background reveals the overlay */}
            <rect x="0" y="0" width={windowSize.width} height={windowSize.height} fill="white" />
            {/* Black rectangle punches the spotlight hole, animating position and dimensions */}
            {rect && (
              <motion.rect
                animate={{
                  x: rect.left,
                  y: rect.top,
                  width: rect.width,
                  height: rect.height,
                }}
                transition={{
                  type: 'spring',
                  damping: 30,
                  stiffness: 300,
                  mass: 0.8,
                }}
                rx="14"
                ry="14"
                fill="black"
              />
            )}
          </mask>
        </defs>

        {/* Backdrop rect with mask applied */}
        <rect
          x="0"
          y="0"
          width={windowSize.width}
          height={windowSize.height}
          fill="rgba(2, 6, 23, 0.78)"
          mask="url(#tutorial-spotlight-mask)"
        />
      </svg>

      {/* Pulsing Glowing Ring smoothly gliding around highlighted element */}
      {rect && (
        <motion.div
          animate={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            opacity: 1,
          }}
          transition={{
            type: 'spring',
            damping: 30,
            stiffness: 300,
            mass: 0.8,
          }}
          className="fixed rounded-2xl border-2 border-amber-400 shadow-[0_0_30px_rgba(251,191,36,0.5)] pointer-events-none z-50 animate-pulse"
        />
      )}

      {/* Floating Tour Card (Smoothly gliding container via spring) */}
      <motion.div
        animate={
          isMobile
            ? { bottom: 16, left: 16, right: 16 }
            : { top: coords.top, left: coords.left }
        }
        transition={{
          type: 'spring',
          damping: 28,
          stiffness: 280,
          mass: 0.8,
        }}
        style={{
          position: 'fixed',
          zIndex: 60,
          width: isMobile ? undefined : `${cardWidth}px`,
        }}
        className="pointer-events-auto"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="w-full bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-5 shadow-2xl flex flex-col gap-4 text-slate-100"
          >
            {/* Top Bar: Badge, Progress & Close Button */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
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

              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-bold text-slate-400">
                  {currentTutorialStep + 1} / {TUTORIAL_STEPS.length}
                </span>
                <button
                  onClick={() => closeTutorial()}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  title="Cerrar tutorial (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Card Content */}
            <div className="space-y-2">
              <h3 className="text-base sm:text-lg font-black text-white leading-tight">
                {step.title}
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {step.description}
              </p>

              {/* Interactive hint banner if present */}
              {step.interactiveHint && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center gap-2 mt-2">
                  <span>{step.interactiveHint}</span>
                </div>
              )}
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800">
              <motion.div
                className="h-full bg-gradient-to-r from-indigo-500 via-amber-500 to-emerald-400 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            {/* Card Footer Actions */}
            <div className="flex items-center justify-between pt-1 gap-2">
              {!isLastStep ? (
                <button
                  onClick={() => closeTutorial()}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Saltar tutorial
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                {!isFirstStep && (
                  <button
                    onClick={prevTutorialStep}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-all flex items-center gap-1"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Anterior</span>
                  </button>
                )}

                {isLastStep ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => closeTutorial()}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-all"
                    >
                      Empezar solo
                    </button>
                    <button
                      onClick={() => closeTutorial({ openOnboarding: true })}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-1.5"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Cargar mis materias</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={nextTutorialStep}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5"
                  >
                    <span>Siguiente</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
