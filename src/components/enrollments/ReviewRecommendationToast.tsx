import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { MessageSquarePlus, Star, X } from 'lucide-react';
import { useCareer } from '../../context/CareerContext';

export const ReviewRecommendationToast: React.FC = () => {
  const shouldReduceMotion = useReducedMotion();
  const {
    pendingReviewPrompts,
    dismissPendingReviewPrompt,
    openGlobalReviewModal,
  } = useCareer();

  const currentPrompt = pendingReviewPrompts[0] ?? null;

  return (
    <AnimatePresence>
      {currentPrompt && (
        <motion.div
          key={`${currentPrompt.professorId}::${currentPrompt.subjectId}`}
          initial={shouldReduceMotion ? false : { opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, y: 14, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          role="status"
          aria-live="polite"
          className="fixed bottom-20 md:bottom-5 right-3 sm:right-5 z-[55] w-[calc(100vw-1.5rem)] max-w-md bg-slate-900/95 backdrop-blur-xl border border-indigo-500/40 rounded-2xl p-4 shadow-2xl shadow-indigo-950/60"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
              <Star className="w-4 h-4 fill-amber-400/25" />
            </div>

            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-slate-200 leading-relaxed">
                  Cursaste <strong className="text-white">{currentPrompt.subjectName}</strong>{' '}
                  con <strong className="text-indigo-300">{currentPrompt.professorName}</strong>:
                  ¿querés dejar una reseña anónima?
                </p>
                <button
                  type="button"
                  onClick={() => dismissPendingReviewPrompt(currentPrompt, false)}
                  aria-label="Cerrar aviso"
                  className="p-1 rounded-lg text-slate-500 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => dismissPendingReviewPrompt(currentPrompt, true)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Ahora no
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openGlobalReviewModal({
                      professorId: currentPrompt.professorId,
                      subjectId: currentPrompt.subjectId,
                      academicYear: currentPrompt.academicYear,
                      term: currentPrompt.term,
                    });
                    dismissPendingReviewPrompt(currentPrompt, false);
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold shadow-md shadow-indigo-600/30 flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  <span>Reseñar</span>
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

