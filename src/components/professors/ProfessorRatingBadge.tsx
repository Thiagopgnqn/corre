import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowRight, MessageSquare, ThumbsUp, User } from 'lucide-react';
import type { ProfessorBatchRating } from '../../types/professor';
import {
  formatProfessorBadgeState,
  formatRatingDecimal,
} from '../../utils/professorRatingsLogic';
import { StarRating } from './StarRating';

interface ProfessorRatingBadgeProps {
  professorName: string;
  professorId?: string | null;
  rating: ProfessorBatchRating | null;
  onOpenDetail?: (professorId: string) => void;
}

export const ProfessorRatingBadge: React.FC<ProfessorRatingBadgeProps> = ({
  professorName,
  professorId,
  rating,
  onOpenDetail,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const badge = formatProfessorBadgeState(rating);
  const effectiveProfId = rating?.professorId || professorId || null;

  const updateCoords = () => {
    if (!triggerRef.current || typeof window === 'undefined') return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popWidth = 296;
    const popEstHeight = 290;
    const margin = 12;

    let left = rect.right + 8;
    if (left + popWidth > window.innerWidth - margin) {
      left = Math.max(margin, rect.left - popWidth - 8);
    }
    if (left < margin) {
      left = Math.max(margin, Math.min(window.innerWidth - popWidth - margin, rect.left));
    }

    let top = rect.top - 16;
    if (top + popEstHeight > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - popEstHeight - margin);
    }
    top = Math.max(margin, top);

    setCoords({ top, left });
  };

  const cancelCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    cancelCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, 170);
  };

  const handleOpen = () => {
    cancelCloseTimer();
    updateCoords();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleScrollOrResize = () => {
      updateCoords();
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open]);

  useEffect(() => {
    return () => cancelCloseTimer();
  }, []);

  const badgeColorClasses =
    badge.status === 'confiable'
      ? 'bg-amber-500/15 border-amber-500/35 text-amber-300 hover:bg-amber-500/25'
      : badge.status === 'pocas_resenas'
      ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25'
      : 'bg-slate-800/80 border-slate-700/70 text-slate-400 hover:text-slate-200 hover:border-slate-600';

  return (
    <>
      <div className="flex items-center justify-between gap-1.5 text-[11px] py-0.5">
        <span className="flex items-center gap-1 text-slate-300 min-w-0">
          <User className="w-3 h-3 text-slate-500 shrink-0" />
          <span className="truncate" title={professorName}>
            {professorName}
          </span>
        </span>

        <button
          ref={triggerRef}
          type="button"
          onMouseEnter={handleOpen}
          onMouseLeave={scheduleClose}
          onClick={(e) => {
            e.stopPropagation();
            if (open && effectiveProfId && onOpenDetail) {
              setOpen(false);
              onOpenDetail(effectiveProfId);
            } else {
              handleOpen();
            }
          }}
          aria-label={`${professorName}: ${badge.label}`}
          className={`shrink-0 px-1.5 py-0.5 rounded-md border text-[10px] font-bold transition-colors cursor-pointer ${badgeColorClasses}`}
        >
          {badge.label}
        </button>
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={popoverRef}
                onMouseEnter={cancelCloseTimer}
                onMouseLeave={scheduleClose}
                initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.14 }}
                style={{
                  position: 'fixed',
                  top: `${coords.top}px`,
                  left: `${coords.left}px`,
                  width: '296px',
                  zIndex: 80,
                }}
                className="rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-slate-700/90 shadow-2xl p-3.5 text-xs text-slate-100 space-y-2.5"
              >
                {/* Header del popover */}
                <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-800">
                  <div className="min-w-0">
                    <span className="font-extrabold text-white block truncate">
                      {rating?.displayName || professorName}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {rating?.reviewCount || 0}{' '}
                      {(rating?.reviewCount || 0) === 1 ? 'reseña publicada' : 'reseñas publicadas'}
                    </span>
                  </div>

                  {rating?.hasReliableAverage && rating.averageOverall !== null ? (
                    <div className="text-right shrink-0">
                      <div className="text-sm font-black text-amber-300 leading-none">
                        ★ {formatRatingDecimal(rating.averageOverall, 1)}
                      </div>
                      {rating.recommendPercent !== null && (
                        <span className="text-[10px] text-emerald-300 font-semibold flex items-center gap-0.5 mt-0.5">
                          <ThumbsUp className="w-2.5 h-2.5" />
                          <span>{Math.round(rating.recommendPercent)}%</span>
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 shrink-0">
                      {badge.shortLabel}
                    </span>
                  )}
                </div>

                {/* Mini distribución si hay reseñas */}
                {rating && rating.reviewCount > 0 ? (
                  <>
                    <div className="space-y-1">
                      {([5, 4, 3, 2, 1] as const).map((st) => {
                        const c = rating.distribution[st] || 0;
                        const pct = Math.round((c / rating.reviewCount) * 100);
                        return (
                          <div key={st} className="flex items-center gap-1.5 text-[10px]">
                            <span className="w-6 font-mono text-slate-400 text-right">{st}★</span>
                            <div className="flex-1 h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                              <div
                                className="h-full bg-amber-400 rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-5 font-mono text-slate-500 text-right">{c}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Últimas 2 reseñas */}
                    {rating.recentReviews.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                          <MessageSquare className="w-2.5 h-2.5 text-indigo-400" />
                          <span>Últimas opiniones</span>
                        </span>
                        {rating.recentReviews.slice(0, 2).map((rev) => (
                          <div
                            key={rev.id}
                            className="p-2 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] font-semibold text-slate-300 truncate">
                                {rev.subjectName} · {rev.publishedLabel}
                              </span>
                              <StarRating value={rev.overall} readOnly size="xs" />
                            </div>
                            {rev.comment && (
                              <p className="text-[11px] text-slate-300 line-clamp-2 leading-snug">
                                {rev.comment}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Todavía no hay reseñas cargadas para este docente.
                  </p>
                )}

                {effectiveProfId && onOpenDetail && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      onOpenDetail(effectiveProfId);
                    }}
                    className="w-full py-1.5 px-2.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-300 hover:text-white text-[11px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>Ver perfil completo</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
};

