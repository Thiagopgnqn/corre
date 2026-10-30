import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Flag,
  History,
  Loader2,
  MessageSquarePlus,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import { professorsApi } from '../../api/professors.api';
import type {
  PaginatedReviewsResponse,
  ProfessorDetail,
  PublicProfessorReview,
  ReviewsThresholdsMeta,
} from '../../types/professor';
import { formatRatingDecimal } from '../../utils/professorRatingsLogic';
import { StarRating } from './StarRating';
import { ReportReviewModal } from './ReportReviewModal';

interface ProfessorDetailModalProps {
  professorId: string | null;
  onClose: () => void;
  onWriteReview?: (professorId: string) => void;
  onRatingsChanged?: () => void;
}

export const ProfessorDetailModal: React.FC<ProfessorDetailModalProps> = ({
  professorId,
  onClose,
  onWriteReview,
  onRatingsChanged,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [professor, setProfessor] = useState<ProfessorDetail | null>(null);
  const [thresholds, setThresholds] = useState<ReviewsThresholdsMeta | null>(null);
  const [reviewsPage, setReviewsPage] = useState<PaginatedReviewsResponse | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [sortBy, setSortBy] = useState<'recent' | 'helpful'>('recent');
  const [page, setPage] = useState<number>(1);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isLoadingReviews, setIsLoadingReviews] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reportingReview, setReportingReview] = useState<PublicProfessorReview | null>(null);
  const [votingReviewId, setVotingReviewId] = useState<string | null>(null);

  const loadFullDetail = useCallback(async (id: string) => {
    setIsLoadingDetail(true);
    setErrorMsg(null);
    try {
      const res = await professorsApi.getProfessorDetail(id);
      if (res.success && res.data) {
        setProfessor(res.data.professor);
        setReviewsPage(res.data.reviewsPage);
        setThresholds(res.data.thresholds);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo cargar la ficha del profesor.');
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  const loadFilteredReviews = useCallback(
    async (id: string, subId: string, sort: 'recent' | 'helpful', nextPage: number) => {
      setIsLoadingReviews(true);
      try {
        const res = await professorsApi.getProfessorReviews(id, {
          subjectId: subId || undefined,
          sort,
          page: nextPage,
          pageSize: 8,
        });
        if (res.success && res.data) {
          setReviewsPage(res.data);
        }
      } catch {
        // Conservar página actual si falla recarga puntual
      } finally {
        setIsLoadingReviews(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!professorId) {
      setProfessor(null);
      setReviewsPage(null);
      setSelectedSubjectId('');
      setSortBy('recent');
      setPage(1);
      return;
    }
    setSelectedSubjectId('');
    setSortBy('recent');
    setPage(1);
    loadFullDetail(professorId);
  }, [professorId, loadFullDetail]);

  const handleChangeSubjectFilter = (subId: string) => {
    if (!professorId) return;
    setSelectedSubjectId(subId);
    setPage(1);
    loadFilteredReviews(professorId, subId, sortBy, 1);
  };

  const handleChangeSort = (nextSort: 'recent' | 'helpful') => {
    if (!professorId || nextSort === sortBy) return;
    setSortBy(nextSort);
    setPage(1);
    loadFilteredReviews(professorId, selectedSubjectId, nextSort, 1);
  };

  const handleChangePage = (nextPage: number) => {
    if (!professorId || !reviewsPage) return;
    if (nextPage < 1 || nextPage > reviewsPage.totalPages) return;
    setPage(nextPage);
    loadFilteredReviews(professorId, selectedSubjectId, sortBy, nextPage);
  };

  const handleToggleHelpful = async (review: PublicProfessorReview) => {
    if (votingReviewId) return;
    setVotingReviewId(review.id);
    try {
      const res = await professorsApi.toggleHelpful(review.id);
      if (res.success && reviewsPage) {
        setReviewsPage({
          ...reviewsPage,
          items: reviewsPage.items.map((item) =>
            item.id === review.id
              ? {
                  ...item,
                  helpfulCount: res.data.helpfulCount,
                  viewerHasVotedHelpful: res.data.voted,
                }
              : item
          ),
        });
      }
    } catch {
      // Ignorar si hubo error de red transitorio
    } finally {
      setVotingReviewId(null);
    }
  };

  useEffect(() => {
    if (!professorId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !reportingReview) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [professorId, reportingReview, onClose]);

  if (!professorId) return null;

  const minReliable = thresholds?.minReviewsForReliableAverage ?? 3;

  const metricBars: Array<{ key: string; label: string; value: number | null; hint?: string }> =
    professor
      ? [
          { key: 'clarity', label: 'Claridad al explicar', value: professor.averageClarity },
          { key: 'treatment', label: 'Trato estudiantil', value: professor.averageTreatment },
          {
            key: 'availability',
            label: 'Disponibilidad / consultas',
            value: professor.averageAvailability,
          },
          {
            key: 'difficulty',
            label: 'Exigencia',
            value: professor.averageDifficulty,
            hint: '1 baja · 5 muy alta',
          },
        ]
      : [];

  return (
    <>
      <AnimatePresence>
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="professor-detail-title"
        >
          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-4xl max-h-[92vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/70 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2
                    id="professor-detail-title"
                    className="text-base sm:text-xl font-black text-white tracking-tight"
                  >
                    {professor ? professor.displayName : 'Cargando docente...'}
                  </h2>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
                    <ShieldCheck className="w-3 h-3 text-indigo-400" />
                    <span>Reseñas anónimas</span>
                  </span>
                </div>
                {professor && professor.subjects.length > 0 && (
                  <p className="text-xs text-slate-400 mt-1">
                    Dicta o dictó {professor.subjects.length}{' '}
                    {professor.subjects.length === 1 ? 'materia' : 'materias'} en el plan
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {professor && onWriteReview && (
                  <button
                    type="button"
                    onClick={() => onWriteReview(professor.id)}
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                    <span>Dejar reseña</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Cerrar ficha del profesor"
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
              {isLoadingDetail ? (
                <div className="py-16 flex flex-col items-center justify-center text-slate-400 gap-3">
                  <Loader2 className="w-7 h-7 animate-spin text-indigo-400" />
                  <span className="text-xs font-medium">Cargando estadísticas y reseñas...</span>
                </div>
              ) : errorMsg || !professor ? (
                <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                  <span>{errorMsg || 'Profesor no encontrado.'}</span>
                </div>
              ) : (
                <>
                  {/* Panel superior: Puntaje + Histograma + Submétricas */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
                    {/* Columna 1: Promedio general */}
                    <div className="lg:col-span-4 flex flex-col justify-center items-center text-center p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-2">
                      {professor.hasReliableAverage && professor.averageOverall !== null ? (
                        <>
                          <div className="text-4xl font-black text-amber-300 tracking-tight leading-none">
                            {formatRatingDecimal(professor.averageOverall, 1)}
                          </div>
                          <StarRating value={professor.averageOverall} readOnly size="md" />
                          <p className="text-xs text-slate-300 font-semibold">
                            Basado en {professor.reviewCount} reseñas
                          </p>
                          {professor.recommendPercent !== null && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                              <ThumbsUp className="w-3.5 h-3.5 text-emerald-400" />
                              <span>{Math.round(professor.recommendPercent)}% lo recomienda</span>
                            </span>
                          )}
                        </>
                      ) : professor.reviewCount > 0 ? (
                        <>
                          <span className="px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-extrabold">
                            Pocas reseñas ({professor.reviewCount})
                          </span>
                          <p className="text-[11px] text-slate-400 leading-relaxed max-w-[230px]">
                            El promedio numérico se habilita al alcanzar al menos{' '}
                            <strong className="text-slate-200">{minReliable} reseñas</strong> para
                            evitar sesgos.
                          </p>
                        </>
                      ) : (
                        <>
                          <span className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold">
                            Sin reseñas todavía
                          </span>
                          <p className="text-[11px] text-slate-400 leading-relaxed max-w-[230px]">
                            Si ya regularizaste o aprobaste una materia con este docente, ¡sé la
                            primera persona en opinar!
                          </p>
                        </>
                      )}
                    </div>

                    {/* Columna 2: Distribución 5 a 1 estrellas */}
                    <div className="lg:col-span-4 flex flex-col justify-center space-y-1.5 px-1">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                        Distribución de estrellas
                      </span>
                      {([5, 4, 3, 2, 1] as const).map((star) => {
                        const count = professor.distribution[star] || 0;
                        const pct =
                          professor.reviewCount > 0
                            ? Math.round((count / professor.reviewCount) * 100)
                            : 0;
                        return (
                          <div key={star} className="flex items-center gap-2 text-xs">
                            <span className="w-8 font-mono font-bold text-slate-300 text-right shrink-0">
                              {star} ★
                            </span>
                            <div className="flex-1 h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                              <motion.div
                                initial={shouldReduceMotion ? false : { width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.35, ease: 'easeOut' }}
                                className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full"
                              />
                            </div>
                            <span className="w-7 font-mono text-[11px] text-slate-400 text-right shrink-0">
                              {count}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Columna 3: Barras de métricas opcionales */}
                    <div className="lg:col-span-4 flex flex-col justify-center space-y-2 px-1">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Aspectos evaluados
                      </span>
                      {professor.hasReliableAverage ? (
                        metricBars.map((m) => (
                          <div key={m.key} className="space-y-0.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-300 font-medium">{m.label}</span>
                              <span className="font-mono font-bold text-white">
                                {m.value !== null ? `${formatRatingDecimal(m.value, 1)} / 5` : '—'}
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                              <motion.div
                                initial={shouldReduceMotion ? false : { width: 0 }}
                                animate={{
                                  width: m.value !== null ? `${Math.round((m.value / 5) * 100)}%` : '0%',
                                }}
                                transition={{ duration: 0.35, ease: 'easeOut' }}
                                className={`h-full rounded-full ${
                                  m.key === 'difficulty'
                                    ? 'bg-gradient-to-r from-cyan-500 to-purple-400'
                                    : 'bg-gradient-to-r from-indigo-500 to-emerald-400'
                                }`}
                              />
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Los promedios de claridad, trato, disponibilidad y exigencia se mostrarán
                          cuando el docente reúna al menos {minReliable} reseñas publicadas.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Desglose y filtro por materia */}
                  {professor.subjects.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                        <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Desglose y filtro por materia</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleChangeSubjectFilter('')}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                            selectedSubjectId === ''
                              ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                              : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          Todas ({professor.reviewCount})
                        </button>
                        {professor.subjects.map((sub) => {
                          const active = selectedSubjectId === sub.subjectId;
                          return (
                            <button
                              key={sub.subjectId}
                              type="button"
                              onClick={() => handleChangeSubjectFilter(sub.subjectId)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                                active
                                  ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                                  : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                              }`}
                            >
                              {sub.isHistoricalLink && !sub.isCurrentTerm && (
                                <History className="w-3 h-3 text-amber-400 shrink-0" />
                              )}
                              <span>{sub.name}</span>
                              {sub.hasReliableAverage && sub.averageOverall !== null ? (
                                <span
                                  className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${
                                    active
                                      ? 'bg-white/20 text-white'
                                      : 'bg-amber-500/15 text-amber-300'
                                  }`}
                                >
                                  ★ {formatRatingDecimal(sub.averageOverall, 1)} ({sub.reviewCount})
                                </span>
                              ) : (
                                <span
                                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                                    active
                                      ? 'bg-white/20 text-white'
                                      : 'bg-slate-800 text-slate-400'
                                  }`}
                                >
                                  {sub.reviewCount}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Barra de orden de reseñas */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
                      Opiniones de estudiantes ({reviewsPage?.total ?? 0})
                    </h3>

                    <div className="inline-flex rounded-xl bg-slate-950 p-0.5 border border-slate-800 text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => handleChangeSort('recent')}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          sortBy === 'recent'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Más recientes
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChangeSort('helpful')}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          sortBy === 'helpful'
                            ? 'bg-indigo-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Más útiles
                      </button>
                    </div>
                  </div>

                  {/* Lista paginada de reseñas */}
                  {isLoadingReviews ? (
                    <div className="py-10 flex items-center justify-center text-slate-400 gap-2 text-xs">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                      <span>Actualizando opiniones...</span>
                    </div>
                  ) : !reviewsPage || reviewsPage.items.length === 0 ? (
                    <div className="p-8 rounded-2xl bg-slate-950/50 border border-slate-800/80 text-center space-y-2">
                      <p className="text-xs text-slate-400">
                        No hay reseñas publicadas para esta selección todavía.
                      </p>
                      {onWriteReview && (
                        <button
                          type="button"
                          onClick={() => onWriteReview(professor.id)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-xs font-bold transition-colors cursor-pointer"
                        >
                          <MessageSquarePlus className="w-3.5 h-3.5" />
                          <span>Publicar una reseña</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {reviewsPage.items.map((rev) => (
                        <div
                          key={rev.id}
                          className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/90 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-white">
                                  {rev.studentLabel}
                                </span>
                                {rev.attendedPeriod && (
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                    Cursada {rev.attendedPeriod}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                <span>Publicado en {rev.publishedLabel}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <StarRating value={rev.overall} readOnly size="sm" />
                              {rev.wouldRecommend === true && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  <ThumbsUp className="w-2.5 h-2.5" />
                                  <span>Recomienda</span>
                                </span>
                              )}
                              {rev.wouldRecommend === false && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">
                                  <ThumbsDown className="w-2.5 h-2.5" />
                                  <span>No recomienda</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Submétricas individuales si el estudiante las completó */}
                          {(rev.clarity !== null ||
                            rev.treatment !== null ||
                            rev.availability !== null ||
                            rev.difficulty !== null) && (
                            <div className="flex flex-wrap gap-1.5 text-[10px]">
                              {rev.clarity !== null && (
                                <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
                                  Claridad: <strong>{rev.clarity}/5</strong>
                                </span>
                              )}
                              {rev.treatment !== null && (
                                <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
                                  Trato: <strong>{rev.treatment}/5</strong>
                                </span>
                              )}
                              {rev.availability !== null && (
                                <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
                                  Disponibilidad: <strong>{rev.availability}/5</strong>
                                </span>
                              )}
                              {rev.difficulty !== null && (
                                <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-slate-300">
                                  Exigencia: <strong>{rev.difficulty}/5</strong>
                                </span>
                              )}
                            </div>
                          )}

                          {rev.comment ? (
                            <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-line">
                              {rev.comment}
                            </p>
                          ) : (
                            <p className="text-[11px] italic text-slate-500">
                              Calificación con estrellas sin comentario escrito.
                            </p>
                          )}

                          {/* Acciones: Útil y Reportar */}
                          <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
                            <button
                              type="button"
                              disabled={votingReviewId === rev.id}
                              onClick={() => handleToggleHelpful(rev)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-semibold transition-all cursor-pointer ${
                                rev.viewerHasVotedHelpful
                                  ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              <ThumbsUp className="w-3 h-3" />
                              <span>Útil ({rev.helpfulCount})</span>
                            </button>

                            <button
                              type="button"
                              disabled={rev.viewerHasReported}
                              onClick={() => setReportingReview(rev)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-slate-500 hover:text-rose-400 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors cursor-pointer"
                            >
                              <Flag className="w-3 h-3" />
                              <span>{rev.viewerHasReported ? 'Reportada' : 'Reportar'}</span>
                            </button>
                          </div>
                        </div>
                      ))}

                      {/* Controles de paginación */}
                      {reviewsPage.totalPages > 1 && (
                        <div className="flex items-center justify-between pt-2 text-xs">
                          <button
                            type="button"
                            disabled={page <= 1}
                            onClick={() => handleChangePage(page - 1)}
                            className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            <span>Anterior</span>
                          </button>

                          <span className="font-mono text-slate-400">
                            Página {page} de {reviewsPage.totalPages}
                          </span>

                          <button
                            type="button"
                            disabled={page >= reviewsPage.totalPages}
                            onClick={() => handleChangePage(page + 1)}
                            className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                          >
                            <span>Siguiente</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </div>
      </AnimatePresence>

      {/* Modal secundario para reportar una reseña */}
      <ReportReviewModal
        reviewId={reportingReview?.id || null}
        professorName={professor?.displayName}
        onClose={() => setReportingReview(null)}
        onReported={({ autoHidden, reviewId }) => {
          if (reviewsPage) {
            if (autoHidden) {
              // Si se ocultó automáticamente al llegar a 3 reportes, refrescar ficha completa
              if (professorId) loadFullDetail(professorId);
              onRatingsChanged?.();
            } else {
              setReviewsPage({
                ...reviewsPage,
                items: reviewsPage.items.map((it) =>
                  it.id === reviewId ? { ...it, viewerHasReported: true } : it
                ),
              });
            }
          }
        }}
      />
    </>
  );
};

