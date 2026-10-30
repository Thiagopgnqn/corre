import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  Loader2,
  RotateCcw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { professorsApi } from '../../api/professors.api';
import type { AdminModerationQueueData } from '../../types/professor';
import { StarRating } from './StarRating';

interface AdminModerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModerated: () => void;
}

export const AdminModerationModal: React.FC<AdminModerationModalProps> = ({
  isOpen,
  onClose,
  onModerated,
}) => {
  const { user } = useAuth();
  const shouldReduceMotion = useReducedMotion();
  const [queue, setQueue] = useState<AdminModerationQueueData>({
    openReports: [],
    hiddenReviews: [],
  });
  const [activeTab, setActiveTab] = useState<'reports' | 'hidden'>('reports');
  const [isLoading, setIsLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  const loadQueue = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await professorsApi.adminGetModerationQueue();
      if (res.success && res.data) {
        setQueue(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al cargar la cola de moderación.');
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isOpen && isAdmin) {
      loadQueue();
    }
  }, [isOpen, isAdmin, loadQueue]);

  // Estricto control de rol: jamás renderizar para usuarios comunes
  if (!isAdmin || !isOpen) return null;

  const handleHideFromReport = async (reportId: string) => {
    setBusyId(reportId);
    setErrorMsg(null);
    try {
      await professorsApi.adminResolveReport(reportId, {
        status: 'actioned',
        reviewStatus: 'hidden',
      });
      await loadQueue();
      onModerated();
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo ocultar la reseña.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRestoreFromReport = async (reportId: string) => {
    setBusyId(reportId);
    setErrorMsg(null);
    try {
      await professorsApi.adminResolveReport(reportId, {
        status: 'dismissed',
        reviewStatus: 'published',
      });
      await loadQueue();
      onModerated();
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo restaurar la reseña.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDismissReportOnly = async (reportId: string) => {
    setBusyId(reportId);
    setErrorMsg(null);
    try {
      await professorsApi.adminResolveReport(reportId, {
        status: 'dismissed',
      });
      await loadQueue();
      onModerated();
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo descartar el reporte.');
    } finally {
      setBusyId(null);
    }
  };

  const handleChangeReviewStatus = async (reviewId: string, status: 'published' | 'hidden') => {
    setBusyId(reviewId);
    setErrorMsg(null);
    try {
      await professorsApi.adminSetReviewStatus(reviewId, status);
      await loadQueue();
      onModerated();
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo actualizar el estado de la reseña.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-moderation-title"
      >
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-3xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="p-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <ShieldAlert className="w-4 h-4" />
              </span>
              <div>
                <h2 id="admin-moderation-title" className="text-sm sm:text-base font-black text-white">
                  Moderación de Reseñas (Solo Admin)
                </h2>
                <p className="text-[11px] text-slate-400">
                  Revisá reportes abiertos y reseñas ocultas respetando el anonimato estudiantil.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar panel de moderación"
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Sub-tabs */}
          <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-950/40 flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('reports')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                activeTab === 'reports'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Reportes abiertos ({queue.openReports.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('hidden')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                activeTab === 'hidden'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              Reseñas ocultas ({queue.hiddenReviews.length})
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {isLoading ? (
              <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                <span>Cargando cola de moderación...</span>
              </div>
            ) : activeTab === 'reports' ? (
              queue.openReports.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                  <p className="text-xs font-semibold text-slate-300">
                    No hay reportes abiertos pendientes de revisión.
                  </p>
                </div>
              ) : (
                queue.openReports.map((rep) => {
                  const isBusy = busyId === rep.reportId;
                  return (
                    <div
                      key={rep.reportId}
                      className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-extrabold text-white">
                              {rep.review.professorName}
                            </span>
                            <span className="text-xs text-slate-400">
                              · {rep.review.subjectName}
                            </span>
                            <StarRating value={rep.review.overall} readOnly size="xs" />
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap text-[10px]">
                            <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 font-bold uppercase">
                              Motivo: {rep.reason}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold">
                              Estado reseña:{' '}
                              {rep.review.status === 'hidden' ? 'Oculta' : 'Publicada'}
                            </span>
                            <span className="text-slate-500">
                              Reportes abiertos en esta reseña: {rep.openReportsOnReview}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500">
                          {rep.reportedMonthYear}
                        </span>
                      </div>

                      {rep.note && (
                        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200">
                          <strong>Nota del reporte:</strong> {rep.note}
                        </div>
                      )}

                      <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 whitespace-pre-line">
                        {rep.review.comment || '(Reseña sin texto escrito, solo puntuación)'}
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleHideFromReport(rep.reportId)}
                          className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
                        >
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>Ocultar</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleRestoreFromReport(rep.reportId)}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Restaurar</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDismissReportOnly(rep.reportId)}
                          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors disabled:opacity-40 cursor-pointer"
                        >
                          Descartar reporte
                        </button>
                      </div>
                    </div>
                  );
                })
              )
            ) : queue.hiddenReviews.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400">
                No hay reseñas ocultas actualmente.
              </div>
            ) : (
              queue.hiddenReviews.map((rev) => {
                const isBusy = busyId === rev.id;
                return (
                  <div
                    key={rev.id}
                    className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-extrabold text-white">
                          {rev.professorName}
                        </span>
                        <span className="text-xs text-slate-400">· {rev.subjectName}</span>
                        <StarRating value={rev.overall} readOnly size="xs" />
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">
                        {rev.publishedMonthYear} · {rev.openReportsCount} rep. abiertos
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 whitespace-pre-line">
                      {rev.comment || '(Reseña sin comentario escrito)'}
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleChangeReviewStatus(rev.id, 'published')}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restaurar</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

