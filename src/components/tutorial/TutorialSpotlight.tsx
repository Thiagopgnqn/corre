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
};

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
  } = useCareer();

  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  const cardRef = useRef<HTMLDivElement>(null);
  const step = TUTORIAL_STEPS[currentTutorialStep];

  // Navigate to target view if step requires a different tab
  useEffect(() => {
    if (isTutorialOpen && step && step.targetView && step.targetView !== currentView) {
      onNavigateView(step.targetView);
    }
  }, [isTutorialOpen, step, currentView, onNavigateView]);

  // Compute bounding rect of target element
  const updateRect = useCallback(() => {
    if (typeof window === 'undefined') return;

    setWindowSize({
      width: window.innerWidth,
      height: window.innerHeight,
    });

    if (!step || !step.targetSelector || step.placement === 'center') {
      setRect(null);
      return;
    }

    const el = document.querySelector(step.targetSelector);
    if (!el) {
      setRect(null);
      return;
    }

    const b = el.getBoundingClientRect();
    const pad = 8;
    setRect({
      top: Math.max(0, b.top - pad),
      left: Math.max(0, b.left - pad),
      width: Math.min(window.innerWidth, b.width + pad * 2),
      height: Math.min(window.innerHeight, b.height + pad * 2),
    });
  }, [step]);

  // Update rect on step change, resize and scroll
  useEffect(() => {
    if (!isTutorialOpen) return;

    // Small delay to allow any view transitions to finish
    const timer = setTimeout(updateRect, 120);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [isTutorialOpen, step, updateRect]);

  // Interactive step advance: if step requires clicking a subject and user clicked one
  const prevSelectedIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (isTutorialOpen && step?.interactiveAction === 'click-subject') {
      if (selectedSubjectId && selectedSubjectId !== prevSelectedIdRef.current) {
        prevSelectedIdRef.current = selectedSubjectId;
        const autoTimer = setTimeout(() => {
          nextTutorialStep();
        }, 600);
        return () => clearTimeout(autoTimer);
      }
    }
    prevSelectedIdRef.current = selectedSubjectId;
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

  // Position calculation for card on desktop
  const isMobile = windowSize.width < 640;
  let cardPositionStyles: React.CSSProperties = {};

  if (isMobile) {
    // Dock as bottom sheet on mobile
    cardPositionStyles = {
      position: 'fixed',
      bottom: '16px',
      left: '16px',
      right: '16px',
      zIndex: 60,
    };
  } else if (!rect || step.placement === 'center') {
    // Centered modal
    cardPositionStyles = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 60,
    };
  } else {
    // Floating around target
    const cardWidth = 420;
    const margin = 16;
    let top = 0;
    let left = 0;

    switch (step.placement) {
      case 'bottom':
        top = Math.min(windowSize.height - 350, rect.top + rect.height + margin);
        left = Math.max(margin, Math.min(windowSize.width - cardWidth - margin, rect.left + rect.width / 2 - cardWidth / 2));
        break;
      case 'top':
        top = Math.max(margin, rect.top - 320);
        left = Math.max(margin, Math.min(windowSize.width - cardWidth - margin, rect.left + rect.width / 2 - cardWidth / 2));
        break;
      case 'left':
        top = Math.max(margin, Math.min(windowSize.height - 350, rect.top));
        left = Math.max(margin, rect.left - cardWidth - margin);
        break;
      case 'right':
      default:
        top = Math.max(margin, Math.min(windowSize.height - 350, rect.top));
        left = Math.min(windowSize.width - cardWidth - margin, rect.left + rect.width + margin);
        break;
    }

    cardPositionStyles = {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${cardWidth}px`,
      zIndex: 60,
    };
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true">
      {/* Dark Spotlight SVG Mask */}
      <svg className="fixed inset-0 w-full h-full pointer-events-none z-50">
        <defs>
          <mask id="tutorial-spotlight-mask">
            {/* White background reveals the overlay */}
            <rect x="0" y="0" width={windowSize.width} height={windowSize.height} fill="white" />
            {/* Black rectangle punches the spotlight hole */}
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

      {/* Pulsing Glowing Ring around highlighted element */}
      {rect && (
        <motion.div
          key={`highlight-${step.id}`}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          style={{
            position: 'fixed',
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }}
          className="rounded-2xl border-2 border-amber-400 shadow-[0_0_30px_rgba(251,191,36,0.5)] pointer-events-none z-50 animate-pulse"
        />
      )}

      {/* Floating Tour Card */}
      <div style={cardPositionStyles} ref={cardRef}>
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
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
      </div>
    </div>
  );
};
