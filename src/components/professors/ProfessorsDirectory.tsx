import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Edit2,
  Filter,
  MessageSquarePlus,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { CORE_SUBJECTS } from '../../data/plan2023';
import { ELECTIVES } from '../../data/electives';
import { professorsApi } from '../../api/professors.api';
import { useProfessorRatings } from '../../hooks/useProfessorRatings';
import type { OwnReviewItem, ProfessorListItem } from '../../types/professor';
import { ProfessorCard } from './ProfessorCard';
import { ProfessorDetailModal } from './ProfessorDetailModal';
import { ReviewFormModal } from './ReviewFormModal';
import { AdminModerationModal } from './AdminModerationModal';
import { StarRating } from './StarRating';

export const ProfessorsDirectory: React.FC = () => {
  const { user } = useAuth();
  const { reloadRatings } = useProfessorRatings(true);
  const shouldReduceMotion = useReducedMotion();

  const isAdmin = user?.role === 'admin';

  // Filtros de búsqueda
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState<string>('');
  const [minRatingFilter, setMinRatingFilter] = useState<number>(0);
  const [withReviewsOnly, setWithReviewsOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'rating' | 'reviews' | 'name'>('rating');

  // Datos del directorio
  const [professors, setProfessors] = useState<ProfessorListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Mis reseñas & elegibilidad
  const [myReviews, setMyReviews] = useState<OwnReviewItem[]>([]);
  const [eligibleCount, setEligibleCount] = useState<number>(0);
  const [showMyReviews, setShowMyReviews] = useState<boolean>(false);
  const [deletingReviewId, setDeletingReviewId] = useState<string | null>(null);

  // Modales
  const [selectedProfessorId, setSelectedProfessorId] = useState<string | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState<boolean>(false);
  const [preselectedProfForReview, setPreselectedProfForReview] = useState<string | null>(null);
  const [editingReview, setEditingReview] = useState<OwnReviewItem | null>(null);
  const [moderationModalOpen, setModerationModalOpen] = useState<boolean>(false);
  const [openReportsBadge, setOpenReportsBadge] = useState<number>(0);

  // Debounce búsqueda de texto
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 220);
    return () => clearTimeout(t);
  }, [searchInput]);

  const allPlanSubjects = useMemo(() => {
    return [...CORE_SUBJECTS, ...ELECTIVES].sort(
      (a, b) => a.level - b.level || a.name.localeCompare(b.name, 'es')
    );
  }, []);

  const loadDirectory = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await professorsApi.listProfessors({
        search: debouncedSearch || undefined,
        subjectId: subjectFilter || undefined,
        minRating: minRatingFilter > 0 ? minRatingFilter : undefined,
        withReviewsOnly,
        sort: sortBy,
      });
      if (res.success && res.data) {
        setProfessors(res.data.professors);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo cargar el directorio de profesores.');
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, subjectFilter, minRatingFilter, withReviewsOnly, sortBy]);

  const loadMyReviewsSummary = useCallback(async () => {
    try {
      const res = await professorsApi.getReviewable();
      if (res.success && res.data) {
        setMyReviews(res.data.myReviews);
        setEligibleCount(res.data.eligible.filter((p) => !p.alreadyReviewed).length);
      }
    } catch {
      // Silencioso en caso de carga inicial offline
    }
  }, []);

  const loadAdminBadge = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await professorsApi.adminGetModerationQueue();
      if (res.success && res.data) {
        setOpenReportsBadge(res.data.openReports.length);
      }
    } catch {
      // Ignorar
    }
  }, [isAdmin]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  useEffect(() => {
    loadMyReviewsSummary();
    loadAdminBadge();
  }, [loadMyReviewsSummary, loadAdminBadge]);

  const refreshEverything = useCallback(async () => {
    await Promise.all([
      loadDirectory(),
      loadMyReviewsSummary(),
      reloadRatings(),
      loadAdminBadge(),
    ]);
  }, [loadDirectory, loadMyReviewsSummary, reloadRatings, loadAdminBadge]);

  const handleOpenWriteReview = (profId?: string | null) => {
    setEditingReview(null);
    setPreselectedProfForReview(profId || null);
    setReviewModalOpen(true);
  };

  const handleOpenEditReview = (rev: OwnReviewItem) => {
    setPreselectedProfForReview(null);
    setEditingReview(rev);
    setReviewModalOpen(true);
  };

  const handleDeleteOwnReview = async (reviewId: string) => {
    if (!window.confirm('¿Querés eliminar tu reseña? Esta acción actualizará el promedio del docente.')) {
      return;
    }
    setDeletingReviewId(reviewId);
    try {
      await professorsApi.deleteReview(reviewId);
      await refreshEverything();
    } catch (err: any) {
      alert(err?.message || 'No se pudo eliminar la reseña.');
    } finally {
      setDeletingReviewId(null);
    }
  };

  const hasActiveFilters =
    Boolean(searchInput.trim()) ||
    Boolean(subjectFilter) ||
    minRatingFilter > 0 ||
    withReviewsOnly;

  const clearFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setSubjectFilter('');
    setMinRatingFilter(0);
    setWithReviewsOnly(false);
    setSortBy('rating');
  };

  return (
    <div
      data-tour="professors-directory"
      className="w-full max-w-[1600px] mx-auto px-3 sm:px-6 py-4 sm:py-6 flex-1 flex flex-col gap-4 sm:gap-5"
    >
      {/* Hero Banner */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 sm:p-5 backdrop-blur-md shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 via-indigo-500 to-cyan-400 p-0.5 shadow-lg shadow-indigo-500/20 flex items-center justify-center shrink-0">
            <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center text-amber-400">
              <Star className="w-5 h-5 fill-amber-400/20" />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
                Reseñas de Profesores
              </h2>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>100% Anónimas</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
              Consultá opiniones de estudiantes antes de inscribirte o compartí tu experiencia en
              materias que ya regularizaste o aprobaste. Las valoraciones también aparecen en el{' '}
              <strong className="text-slate-200">Armador de Horarios</strong>.
            </p>
          </div>
        </div>

        {/* Acciones principales */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setModerationModalOpen(true)}
              className="px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>Moderación</span>
              {openReportsBadge > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white font-mono text-[10px] font-black">
                  {openReportsBadge}
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowMyReviews(!showMyReviews)}
            className={`px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              showMyReviews
                ? 'bg-indigo-600/25 border-indigo-400 text-white'
                : 'bg-slate-950/80 hover:bg-slate-800 border-slate-800 text-slate-300'
            }`}
          >
            <UserCheck className="w-4 h-4 text-indigo-400" />
            <span>Mis reseñas ({myReviews.length})</span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenWriteReview(null)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-extrabold shadow-lg shadow-indigo-600/30 flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <MessageSquarePlus className="w-4 h-4" />
            <span>Dejar una reseña</span>
            {eligibleCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-white font-mono text-[10px]">
                {eligibleCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Panel desplegable: Mis reseñas */}
      <AnimatePresence>
        {showMyReviews && (
          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="bg-slate-900/80 border border-indigo-500/30 rounded-2xl p-4 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-wider text-indigo-300">
                  Mis reseñas publicadas ({myReviews.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setShowMyReviews(false)}
                  className="text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Ocultar
                </button>
              </div>

              {myReviews.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">
                  Todavía no publicaste ninguna reseña. Hacé click en{' '}
                  <strong className="text-white">&ldquo;Dejar una reseña&rdquo;</strong> para puntuar
                  a docentes de materias que ya regularizaste o aprobaste.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {myReviews.map((rev) => (
                    <div
                      key={rev.id}
                      className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between gap-2.5"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <button
                              type="button"
                              onClick={() => setSelectedProfessorId(rev.professorId)}
                              className="text-xs font-extrabold text-white hover:text-indigo-300 text-left cursor-pointer"
                            >
                              {rev.professorName}
                            </button>
                            <div className="text-[11px] text-slate-400">
                              {rev.subjectName} · {rev.publishedLabel}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <StarRating value={rev.overall} readOnly size="xs" />
                            {rev.status === 'hidden' && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                En revisión
                              </span>
                            )}
                          </div>
                        </div>

                        {rev.comment && (
                          <p className="text-xs text-slate-300 line-clamp-2">{rev.comment}</p>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/70 text-[11px]">
                        <button
                          type="button"
                          onClick={() => handleOpenEditReview(rev)}
                          className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Edit2 className="w-3 h-3 text-indigo-400" />
                          <span>Editar</span>
                        </button>
                        <button
                          type="button"
                          disabled={deletingReviewId === rev.id}
                          onClick={() => handleDeleteOwnReview(rev.id)}
                          className="px-2.5 py-1 rounded-lg bg-rose-950/30 hover:bg-rose-950/60 border border-rose-500/30 text-rose-300 font-semibold flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Eliminar</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Barra de búsqueda, filtros y ordenamiento */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 sm:p-4 backdrop-blur-md flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Buscador */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar docente por apellido, nombre o materia..."
            className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Controles de filtro y orden */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Materia */}
          <select
            aria-label="Filtrar por materia"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="max-w-[220px] rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Todas las materias</option>
            {allPlanSubjects.map((sub) => (
              <option key={sub.id} value={String(sub.code)}>
                {sub.level}° · {sub.name}
              </option>
            ))}
          </select>

          {/* Puntaje mínimo */}
          <select
            aria-label="Valoración mínima"
            value={minRatingFilter}
            onChange={(e) => setMinRatingFilter(Number(e.target.value))}
            className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value={0}>Cualquier puntaje</option>
            <option value={3.5}>★ 3,5 o más</option>
            <option value={4}>★ 4,0 o más</option>
            <option value={4.5}>★ 4,5 o más</option>
          </select>

          {/* Solo con reseñas */}
          <button
            type="button"
            onClick={() => setWithReviewsOnly(!withReviewsOnly)}
            className={`px-3 py-2 rounded-xl border font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              withReviewsOnly
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Con reseñas</span>
          </button>

          {/* Ordenamiento */}
          <select
            aria-label="Ordenar profesores"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'rating' | 'reviews' | 'name')}
            className="rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="rating">Orden: Mejor valorados</option>
            <option value="reviews">Orden: Más reseñas</option>
            <option value="name">Orden: Nombre (A-Z)</option>
          </select>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
              title="Restablecer filtros"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpiar</span>
            </button>
          )}
        </div>
      </div>

      {/* Contador de resultados */}
      {!isLoading && !errorMsg && (
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span>
            Mostrando <strong className="text-white">{professors.length}</strong>{' '}
            {professors.length === 1 ? 'docente' : 'docentes'}
          </span>
          <span className="hidden sm:inline text-[11px] text-slate-500">
            Ranking ponderado con promedio bayesiano (umbral visible desde 3 reseñas)
          </span>
        </div>
      )}

      {/* Grilla de tarjetas / Skeletons / Estado vacío */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="h-48 rounded-2xl bg-slate-900/50 border border-slate-800/80 p-4 animate-pulse flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-800" />
                  <div className="space-y-2 flex-1">
                    <div className="h-3.5 bg-slate-800 rounded w-3/4" />
                    <div className="h-2.5 bg-slate-800/70 rounded w-1/2" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="h-5 bg-slate-800/80 rounded-lg w-20" />
                  <div className="h-5 bg-slate-800/80 rounded-lg w-24" />
                </div>
                <div className="h-5 bg-slate-800/60 rounded-lg w-2/3" />
              </div>
              <div className="h-3 bg-slate-800/60 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : errorMsg ? (
        <div className="p-8 rounded-2xl bg-rose-950/30 border border-rose-500/30 text-center space-y-3">
          <p className="text-xs text-rose-200">{errorMsg}</p>
          <button
            type="button"
            onClick={loadDirectory}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      ) : professors.length === 0 ? (
        <div className="p-12 rounded-2xl bg-slate-900/50 border border-slate-800 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto">
            <Filter className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-extrabold text-white">
              No encontramos profesores con esos filtros
            </h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Probá quitando el filtro de valoración mínima o buscando por una parte del apellido o
              de la materia.
            </p>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              Mostrar todos los docentes
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {professors.map((prof, idx) => (
            <ProfessorCard
              key={prof.id}
              professor={prof}
              index={idx}
              onSelect={(id) => setSelectedProfessorId(id)}
            />
          ))}
        </div>
      )}

      {/* Modal de ficha completa del profesor */}
      <ProfessorDetailModal
        professorId={selectedProfessorId}
        onClose={() => setSelectedProfessorId(null)}
        onWriteReview={(profId) => {
          setSelectedProfessorId(null);
          handleOpenWriteReview(profId);
        }}
        onRatingsChanged={refreshEverything}
      />

      {/* Modal para escribir o editar reseña */}
      <ReviewFormModal
        isOpen={reviewModalOpen}
        onClose={() => {
          setReviewModalOpen(false);
          setEditingReview(null);
          setPreselectedProfForReview(null);
        }}
        initialProfessorId={preselectedProfForReview}
        editingReview={editingReview}
        onSaved={refreshEverything}
      />

      {/* Modal de moderación (exclusivo rol admin) */}
      <AdminModerationModal
        isOpen={moderationModalOpen}
        onClose={() => setModerationModalOpen(false)}
        onModerated={refreshEverything}
      />
    </div>
  );
};

