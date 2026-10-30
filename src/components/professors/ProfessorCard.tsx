import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, BookOpen, MessageSquare, ThumbsUp, History } from 'lucide-react';
import type { ProfessorListItem } from '../../types/professor';
import { formatRatingDecimal } from '../../utils/professorRatingsLogic';
import { StarRating } from './StarRating';

interface ProfessorCardProps {
  professor: ProfessorListItem;
  onSelect: (professorId: string) => void;
  index?: number;
}

function getInitials(displayName: string): string {
  const parts = displayName
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'PR';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export const ProfessorCard: React.FC<ProfessorCardProps> = ({
  professor,
  onSelect,
  index = 0,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const visibleSubjects = professor.subjects.slice(0, 3);
  const extraSubjectsCount = Math.max(0, professor.subjects.length - visibleSubjects.length);

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(professor.id)}
      initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.22,
        delay: shouldReduceMotion ? 0 : Math.min(index * 0.025, 0.25),
        ease: 'easeOut',
      }}
      whileHover={shouldReduceMotion ? undefined : { y: -3 }}
      className="group w-full text-left bg-slate-900/70 hover:bg-slate-900/95 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-4 shadow-lg hover:shadow-indigo-950/40 backdrop-blur-md transition-colors flex flex-col justify-between gap-3.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      <div className="space-y-3 w-full">
        {/* Cabecera: Iniciales + Nombre + Puntaje */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600/25 via-indigo-500/15 to-cyan-500/15 border border-indigo-500/30 text-indigo-300 font-black text-xs flex items-center justify-center shrink-0">
              {getInitials(professor.displayName)}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-extrabold text-white group-hover:text-indigo-200 transition-colors leading-snug line-clamp-2">
                {professor.displayName}
              </h3>
              <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                <BookOpen className="w-3 h-3 text-slate-500 shrink-0" />
                <span>
                  {professor.subjects.length}{' '}
                  {professor.subjects.length === 1 ? 'materia' : 'materias'}
                </span>
              </p>
            </div>
          </div>

          {/* Insignia de estado de calificación */}
          {professor.ratingStatus === 'confiable' && professor.averageOverall !== null ? (
            <div className="shrink-0 text-right bg-amber-500/10 border border-amber-500/30 rounded-xl px-2.5 py-1.5">
              <div className="text-base font-black text-amber-300 leading-none">
                {formatRatingDecimal(professor.averageOverall, 1)}
              </div>
              <div className="mt-1">
                <StarRating value={professor.averageOverall} readOnly size="xs" />
              </div>
            </div>
          ) : professor.ratingStatus === 'pocas_resenas' ? (
            <span className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-xl bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              Pocas reseñas
            </span>
          ) : (
            <span className="shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded-xl bg-slate-800/80 text-slate-400 border border-slate-700/60">
              Sin reseñas
            </span>
          )}
        </div>

        {/* Métricas secundarias: cantidad de reseñas y % recomienda */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-950/70 border border-slate-800 text-slate-300 font-medium">
            <MessageSquare className="w-3 h-3 text-indigo-400" />
            <span>
              {professor.reviewCount}{' '}
              {professor.reviewCount === 1 ? 'reseña' : 'reseñas'}
            </span>
          </span>

          {professor.hasReliableAverage && professor.recommendPercent !== null && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 font-semibold">
              <ThumbsUp className="w-3 h-3 text-emerald-400" />
              <span>{Math.round(professor.recommendPercent)}% recomienda</span>
            </span>
          )}

          {professor.hasReliableAverage && professor.averageClarity !== null && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-950/70 border border-slate-800 text-slate-400">
              <span>Claridad {formatRatingDecimal(professor.averageClarity, 1)}</span>
            </span>
          )}
        </div>

        {/* Materias que dicta */}
        {visibleSubjects.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {visibleSubjects.map((sub) => (
              <span
                key={sub.subjectId}
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-slate-950/90 border border-slate-800 text-slate-300 max-w-full truncate"
                title={sub.name}
              >
                {sub.isHistoricalLink && !sub.isCurrentTerm && (
                  <History className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                )}
                <span className="truncate">{sub.name}</span>
              </span>
            ))}
            {extraSubjectsCount > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
                +{extraSubjectsCount} más
              </span>
            )}
          </div>
        )}
      </div>

      {/* Pie de tarjeta */}
      <div className="pt-2.5 border-t border-slate-800/70 flex items-center justify-between text-[11px] font-bold text-indigo-400 group-hover:text-indigo-300">
        <span>Ver ficha y opiniones</span>
        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </motion.button>
  );
};

