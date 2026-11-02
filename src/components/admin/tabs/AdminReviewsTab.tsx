import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  EyeOff,
  RotateCcw,
  CheckCircle2,
  UserX,
  Users,
  Plus,
  Loader2,
  X,
  User,
  Mail,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { professorsApi } from '../../../api/professors.api';
import { adminApi } from '../../../api/admin.api';
import type { AdminModerationQueueData, AdminReviewCatalogItem } from '../../../types/professor';
import { StarRating } from '../../professors/StarRating';
import { AdminReauthModal } from '../AdminReauthModal';
import { CORE_SUBJECTS } from '../../../data/plan2023';

export const AdminReviewsTab: React.FC = () => {
  const subjects = CORE_SUBJECTS;

  // Tab: 'queue' (moderación) vs 'catalog' (todas con autor) vs 'professors' (docentes y fusiones)
  const [subTab, setSubTab] = useState<'queue' | 'catalog' | 'professors'>('queue');

  // Moderation Queue State
  const [queue, setQueue] = useState<AdminModerationQueueData>({
    openReports: [],
    hiddenReviews: [],
  });
  const [queueTab, setQueueTab] = useState<'reports' | 'hidden'>('reports');
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);

  // All Reviews Catalog State (Admins see author identity)
  const [allReviews, setAllReviews] = useState<AdminReviewCatalogItem[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [reviewsTotalPages, setReviewsTotalPages] = useState(1);
  const [reviewsSearch, setReviewsSearch] = useState('');
  const [reviewsStatus, setReviewsStatus] = useState<string>('all');
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);

  // Professor Management State
  const [duplicateCandidates, setDuplicateCandidates] = useState<any[]>([]);
  const [isLoadingDuplicates, setIsLoadingDuplicates] = useState(false);

  // Modals & Forms
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');

  const [historicalModalOpen, setHistoricalModalOpen] = useState(false);
  const [historicalName, setHistoricalName] = useState('');
  const [historicalSubjectId, setHistoricalSubjectId] = useState('');

  // Reauth Modal
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [reauthTitle, setReauthTitle] = useState('');
  const [reauthDesc, setReauthDesc] = useState('');

  // Notifications
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setIsLoadingQueue(true);
    try {
      const res = await professorsApi.adminGetModerationQueue();
      if (res.success && res.data) {
        setQueue(res.data);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al cargar la cola de moderación.');
    } finally {
      setIsLoadingQueue(false);
    }
  }, []);

  const loadAllReviews = useCallback(
    async (page = 1, search = reviewsSearch, status = reviewsStatus) => {
      setIsLoadingReviews(true);
      try {
        const res = await adminApi.listReviews({
          page,
          pageSize: 15,
          search: search.trim() || undefined,
          status: status !== 'all' ? status : undefined,
        });
        if (res.success && res.data) {
          const data: any = res.data;
          const list = Array.isArray(data.items)
            ? data.items
            : Array.isArray(data.reviews)
            ? data.reviews
            : Array.isArray(data)
            ? data
            : [];
          setAllReviews(list);
          setReviewsTotal(res.data.total ?? 0);
          setReviewsPage(res.data.page ?? 1);
          setReviewsTotalPages(res.data.totalPages ?? 1);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || 'Error al cargar las reseñas.');
      } finally {
        setIsLoadingReviews(false);
      }
    },
    [reviewsSearch, reviewsStatus]
  );

  const loadDuplicates = useCallback(async () => {
    setIsLoadingDuplicates(true);
    try {
      const res = await adminApi.listDuplicateCandidates();
      if (res.success && res.data) {
        setDuplicateCandidates(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al analizar duplicados.');
    } finally {
      setIsLoadingDuplicates(false);
    }
  }, []);

  useEffect(() => {
    if (subTab === 'queue') {
      loadQueue();
    } else if (subTab === 'catalog') {
      loadAllReviews(1);
    } else {
      loadDuplicates();
    }
  }, [subTab, loadQueue, loadDuplicates, loadAllReviews]);

  const executeWithReauth = (title: string, desc: string, action: () => Promise<void>) => {
    setReauthTitle(title);
    setReauthDesc(desc);
    setPendingAction(() => action);
    setReauthOpen(true);
  };

  const handleReauthSuccess = async () => {
    if (pendingAction) {
      try {
        await pendingAction();
      } catch (err: any) {
        setErrorMsg(err?.message || 'Error al ejecutar la acción.');
      } finally {
        setPendingAction(null);
      }
    }
  };

  // ── Moderation Actions ──
  const handleHideReview = async (reviewId: string) => {
    try {
      await professorsApi.adminSetReviewStatus(reviewId, 'hidden');
      setSuccessMsg('Reseña ocultada del perfil del docente.');
      loadQueue();
      if (subTab === 'catalog') loadAllReviews(reviewsPage);
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo ocultar la reseña.');
    }
  };

  const handleRestoreReview = async (reviewId: string) => {
    try {
      await professorsApi.adminSetReviewStatus(reviewId, 'published');
      setSuccessMsg('Reseña restaurada y promedios recalculados.');
      loadQueue();
      if (subTab === 'catalog') loadAllReviews(reviewsPage);
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo restaurar la reseña.');
    }
  };

  const handleDismissReport = async (reportId: string) => {
    try {
      await professorsApi.adminResolveReport(reportId, {
        status: 'dismissed',
        reviewStatus: 'published',
      });
      setSuccessMsg('Reporte descartado.');
      loadQueue();
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo descartar el reporte.');
    }
  };

  const handleSuspendAuthor = (reviewId: string, authorEmail?: string | null) => {
    const desc = authorEmail
      ? `Esta acción ocultará la reseña y suspenderá inmediatamente la cuenta del autor (${authorEmail}).`
      : 'Esta acción ocultará la reseña y suspenderá inmediatamente la cuenta del autor.';
    executeWithReauth(
      'Suspender autor de la reseña',
      desc,
      async () => {
        const res = await adminApi.suspendReviewAuthor(reviewId);
        setSuccessMsg(res.message);
        loadQueue();
        if (subTab === 'catalog') loadAllReviews(reviewsPage);
      }
    );
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setReviewsPage(1);
    loadAllReviews(1, reviewsSearch, reviewsStatus);
  };

  // ── Professor Directory & Merge Actions ──
  const handleMergeSubmit = () => {
    if (!mergeSourceId || !mergeTargetId) {
      setErrorMsg('Seleccioná el docente a absorber y el docente principal.');
      return;
    }
    if (mergeSourceId === mergeTargetId) {
      setErrorMsg('No podés fusionar un docente consigo mismo.');
      return;
    }

    setMergeModalOpen(false);
    executeWithReauth(
      'Fusión de docentes',
      'Esta acción moverá todas las reseñas, cursadas y comisiones al docente principal, creando un alias para búsquedas futuras.',
      async () => {
        const res = await adminApi.mergeProfessors(mergeSourceId, mergeTargetId);
        setSuccessMsg(res.message);
        setMergeSourceId('');
        setMergeTargetId('');
        loadDuplicates();
      }
    );
  };

  const handleCreateHistoricalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!historicalName.trim()) return;
    try {
      const res = await adminApi.createHistoricalProfessor({
        displayName: historicalName.trim(),
        subjectId: historicalSubjectId || undefined,
      });
      setSuccessMsg(`Docente histórico "${res.data.professor?.displayName || historicalName}" registrado.`);
      setHistoricalModalOpen(false);
      setHistoricalName('');
      setHistoricalSubjectId('');
      loadDuplicates();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al crear docente histórico.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {errorMsg && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-between text-xs text-red-300">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-between text-xs text-emerald-300">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Subtabs Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setSubTab('queue')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              subTab === 'queue'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Cola de Moderación (
            {queue.openReports.length + queue.hiddenReviews.length} pendientes)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('catalog')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              subTab === 'catalog'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Todas las Reseñas (Ver Autores)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('professors')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              subTab === 'professors'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Gestión de Docentes y Fusiones
          </button>
        </div>

        {subTab === 'professors' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHistoricalModalOpen(true)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Docente Histórico</span>
            </button>
            <button
              type="button"
              onClick={() => setMergeModalOpen(true)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Fusionar Docentes</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Subtab 1: Moderation Queue ── */}
      {subTab === 'queue' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setQueueTab('reports')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer ${
                queueTab === 'reports'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Reportes Abiertos ({queue.openReports.length})
            </button>
            <button
              type="button"
              onClick={() => setQueueTab('hidden')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer ${
                queueTab === 'hidden'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Reseñas Ocultas ({queue.hiddenReviews.length})
            </button>
          </div>

          {isLoadingQueue ? (
            <div className="py-16 text-center text-slate-500 text-xs">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-500 mb-2" />
              Cargando reseñas...
            </div>
          ) : queueTab === 'reports' ? (
            queue.openReports.length === 0 ? (
              <div className="p-8 bg-slate-900/60 border border-slate-800 rounded-2xl text-center text-slate-400 text-xs">
                No hay reportes abiertos pendientes de revisión.
              </div>
            ) : (
              <div className="space-y-3">
                {queue.openReports.map((item) => (
                  <div
                    key={item.reportId}
                    className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs"
                  >
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px] uppercase">
                          Motivo: {item.reason}
                        </span>
                        <span className="text-slate-400 font-medium">
                          {item.review?.professorName || 'Docente'} • {item.review?.subjectName || 'Materia'}
                        </span>
                        {(item.authorEmail || item.review?.authorEmail) && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold text-[11px] border border-blue-500/30">
                            <User className="w-3 h-3 text-blue-400" />
                            <span>Autor: {item.authorEmail || item.review?.authorEmail}</span>
                          </span>
                        )}
                        {item.reporterEmail && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[11px] border border-slate-700">
                            <Mail className="w-3 h-3 text-slate-400" />
                            <span>Reportó: {item.reporterEmail}</span>
                          </span>
                        )}
                      </div>

                      {item.note && (
                        <p className="text-slate-300 bg-slate-950 p-2.5 rounded-xl border border-slate-800 italic">
                          "{item.note}"
                        </p>
                      )}

                      <div className="p-3 bg-slate-950/70 border border-slate-850 rounded-xl space-y-1">
                        <div className="flex items-center gap-2">
                          <StarRating value={item.review?.overall || 0} size="sm" readOnly />
                          <span className="text-slate-500 text-[10px]">
                            {item.review?.publishedMonthYear || ''}
                          </span>
                        </div>
                        {item.review?.comment && (
                          <p className="text-slate-200 font-sans">
                            {item.review.comment}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap md:flex-col gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleHideReview(item.review.id)}
                        className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>Ocultar Reseña</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSuspendAuthor(item.review.id, item.authorEmail || item.review?.authorEmail)}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        title="Suspende la cuenta del autor"
                      >
                        <UserX className="w-3.5 h-3.5" />
                        <span>Suspender al Autor</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDismissReport(item.reportId)}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium cursor-pointer"
                      >
                        Descartar Reporte
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : queue.hiddenReviews.length === 0 ? (
            <div className="p-8 bg-slate-900/60 border border-slate-800 rounded-2xl text-center text-slate-400 text-xs">
              No hay reseñas ocultadas actualmente.
            </div>
          ) : (
            <div className="space-y-3">
              {queue.hiddenReviews.map((item) => (
                <div
                  key={item.id}
                  className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold text-[10px] uppercase">
                        Oculta
                      </span>
                      <span className="text-slate-400 font-medium">
                        {item.professorName} • {item.subjectName}
                      </span>
                      {item.authorEmail && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold text-[11px] border border-blue-500/30">
                          <User className="w-3 h-3 text-blue-400" />
                          <span>Autor: {item.authorEmail}</span>
                        </span>
                      )}
                    </div>

                    <div className="p-3 bg-slate-950/70 border border-slate-850 rounded-xl space-y-1">
                      <div className="flex items-center gap-2">
                        <StarRating value={item.overall} size="sm" readOnly />
                        <span className="text-slate-500 text-[10px]">
                          {item.publishedMonthYear}
                        </span>
                      </div>
                      {item.comment && (
                        <p className="text-slate-200">{item.comment}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap md:flex-col gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRestoreReview(item.id)}
                      className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restaurar Reseña</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSuspendAuthor(item.id, item.authorEmail)}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      title="Suspende la cuenta del autor"
                    >
                      <UserX className="w-3.5 h-3.5" />
                      <span>Suspender al Autor</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Subtab 2: Reviews Catalog (With Authors) ── */}
      {subTab === 'catalog' && (
        <div className="space-y-4">
          {/* Search & Filters */}
          <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl space-y-3">
            <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={reviewsSearch}
                  onChange={(e) => setReviewsSearch(e.target.value)}
                  placeholder="Buscar por autor (email), docente, materia o texto de la reseña..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={reviewsStatus}
                  onChange={(e) => {
                    setReviewsStatus(e.target.value);
                    setReviewsPage(1);
                    loadAllReviews(1, reviewsSearch, e.target.value);
                  }}
                  className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="all">Todos los estados</option>
                  <option value="published">Solo publicadas</option>
                  <option value="hidden">Solo ocultas</option>
                  <option value="removed">Solo eliminadas</option>
                </select>

                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shrink-0 cursor-pointer transition-colors"
                >
                  Buscar
                </button>
              </div>
            </form>

            <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-slate-800/60">
              <span>{reviewsTotal} reseñas encontradas en el sistema</span>
              <span>Página {reviewsPage} de {Math.max(1, reviewsTotalPages)}</span>
            </div>
          </div>

          {/* Reviews List */}
          {isLoadingReviews ? (
            <div className="py-16 text-center text-slate-500 text-xs">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-500 mb-2" />
              Cargando reseñas con autores...
            </div>
          ) : allReviews.length === 0 ? (
            <div className="p-8 bg-slate-900/60 border border-slate-800 rounded-2xl text-center text-slate-400 text-xs">
              No se encontraron reseñas con los filtros seleccionados.
            </div>
          ) : (
            <div className="space-y-3">
              {allReviews.map((rev) => (
                <div
                  key={rev.id}
                  className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 text-xs"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded font-bold text-[10px] uppercase ${
                        rev.status === 'published'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : rev.status === 'hidden'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'bg-red-500/20 text-red-300 border border-red-500/30'
                      }`}>
                        {rev.status === 'published' ? 'Publicada' : rev.status === 'hidden' ? 'Oculta' : 'Eliminada'}
                      </span>
                      <span className="text-white font-bold">
                        {rev.professorName}
                      </span>
                      <span className="text-slate-400">
                        • #{rev.subjectCode} {rev.subjectName}
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold text-[11px] border border-blue-500/30">
                        <User className="w-3 h-3 text-blue-400" />
                        <span>Autor: {rev.authorEmail}</span>
                      </span>
                    </div>

                    <div className="p-3 bg-slate-950/70 border border-slate-850 rounded-xl space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StarRating value={rev.overall} size="sm" readOnly />
                        <span className="text-slate-400 font-medium">({rev.overall}/5)</span>
                        {rev.wouldRecommend === true && (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold">
                            Recomienda
                          </span>
                        )}
                        {rev.wouldRecommend === false && (
                          <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 text-[10px] font-semibold">
                            No recomienda
                          </span>
                        )}
                        {rev.attendedDeclared && (
                          <span className="px-2 py-0.5 rounded bg-teal-500/15 text-teal-300 text-[10px] font-semibold">
                            Cursada verificada
                          </span>
                        )}
                        {rev.academicYear && (
                          <span className="text-slate-500 text-[10px]">
                            Ciclo {rev.academicYear} {rev.term || ''}
                          </span>
                        )}
                        <span className="text-slate-500 text-[10px] ml-auto">
                          {new Date(rev.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      {(rev.clarity !== null || rev.treatment !== null || rev.availability !== null || rev.difficulty !== null) && (
                        <div className="flex items-center gap-3 text-[11px] text-slate-400 pt-1 border-t border-slate-900 flex-wrap">
                          {rev.clarity !== null && <span>Claridad: <b className="text-slate-200">{rev.clarity}/5</b></span>}
                          {rev.treatment !== null && <span>Trato: <b className="text-slate-200">{rev.treatment}/5</b></span>}
                          {rev.availability !== null && <span>Disponibilidad: <b className="text-slate-200">{rev.availability}/5</b></span>}
                          {rev.difficulty !== null && <span>Dificultad: <b className="text-slate-200">{rev.difficulty}/5</b></span>}
                        </div>
                      )}

                      {rev.comment ? (
                        <p className="text-slate-200 font-sans text-xs pt-0.5">
                          "{rev.comment}"
                        </p>
                      ) : (
                        <p className="text-slate-500 italic text-[11px]">
                          (Sin comentario escrito)
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap lg:flex-col gap-2 shrink-0">
                    {rev.status === 'published' && (
                      <button
                        type="button"
                        onClick={() => handleHideReview(rev.id)}
                        className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>Ocultar Reseña</span>
                      </button>
                    )}

                    {rev.status === 'hidden' && (
                      <button
                        type="button"
                        onClick={() => handleRestoreReview(rev.id)}
                        className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restaurar Reseña</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleSuspendAuthor(rev.id, rev.authorEmail)}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      title={`Suspender la cuenta de ${rev.authorEmail}`}
                    >
                      <UserX className="w-3.5 h-3.5" />
                      <span>Suspender Autor</span>
                    </button>
                  </div>
                </div>
              ))}

              {/* Pagination */}
              {reviewsTotalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-4">
                  <button
                    type="button"
                    disabled={reviewsPage <= 1}
                    onClick={() => {
                      const next = Math.max(1, reviewsPage - 1);
                      setReviewsPage(next);
                      loadAllReviews(next);
                    }}
                    className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-slate-400">
                    Página {reviewsPage} de {reviewsTotalPages}
                  </span>
                  <button
                    type="button"
                    disabled={reviewsPage >= reviewsTotalPages}
                    onClick={() => {
                      const next = Math.min(reviewsTotalPages, reviewsPage + 1);
                      setReviewsPage(next);
                      loadAllReviews(next);
                    }}
                    className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Subtab 3: Professors Directory & Duplicates ── */}
      {subTab === 'professors' && (
        <div className="space-y-4">
          <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              Detección Automática de Duplicados
            </h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              El algoritmo de normalización analiza similitudes por fonética, permutación de apellido/nombre y diferencias de tildes para sugerir unificaciones.
            </p>

            {isLoadingDuplicates ? (
              <div className="py-12 text-center text-slate-500 text-xs">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-indigo-400 mb-2" />
                Analizando catálogo docente...
              </div>
            ) : duplicateCandidates.length === 0 ? (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>No se detectaron duplicados activos en este momento.</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {duplicateCandidates.map((cand, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <span className="font-bold text-white">{cand.name1}</span>
                      <span className="text-slate-500 mx-2">vs</span>
                      <span className="font-bold text-amber-300">{cand.name2}</span>
                      <span className="ml-3 text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                        Confianza: {cand.confidence || 'Alta'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setMergeSourceId(cand.id2);
                        setMergeTargetId(cand.id1);
                        setMergeModalOpen(true);
                      }}
                      className="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-200 border border-indigo-500/30 rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Fusionar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: Merge Professors ── */}
      {mergeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl text-slate-100">
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <Users className="w-5 h-5 text-indigo-400" />
              Fusionar Dos Registros Docentes
            </h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              El docente a absorber será eliminado del catálogo activo y registrado como alias del docente principal.
            </p>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Docente a Absorber (se eliminará)</label>
                <input
                  type="text"
                  placeholder="ID de docente (UUID)"
                  value={mergeSourceId}
                  onChange={(e) => setMergeSourceId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-[11px] focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Docente Principal (permanece)</label>
                <input
                  type="text"
                  placeholder="ID de docente (UUID)"
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-[11px] focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMergeModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleMergeSubmit}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl"
                >
                  Confirmar Fusión
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Create Historical Professor ── */}
      {historicalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl text-slate-100">
            <h3 className="text-base font-bold text-white mb-2">Registrar Docente Histórico</h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Permite habilitar a docentes de ciclos lectivos anteriores que no figuran en las comisiones vigentes para que alumnos con cursadas históricas puedan reseñarlos.
            </p>

            <form onSubmit={handleCreateHistoricalSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nombre Completo</label>
                <input
                  type="text"
                  required
                  value={historicalName}
                  onChange={(e) => setHistoricalName(e.target.value)}
                  placeholder="Apellido, Nombre"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Materia Asociada</label>
                <select
                  value={historicalSubjectId}
                  onChange={(e) => setHistoricalSubjectId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Seleccionar materia...</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      #{s.code} {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setHistoricalModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl"
                >
                  Crear Docente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reauth Modal */}
      <AdminReauthModal
        isOpen={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={handleReauthSuccess}
        actionTitle={reauthTitle}
        description={reauthDesc}
      />
    </div>
  );
};