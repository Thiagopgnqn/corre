import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  ChevronDown,
  AlertTriangle,
  Check,
  Clock,
  Sparkles,
  MapPin,
  User,
  Filter,
  Eye,
  EyeOff,
  Info,
  ChevronsUp,
  ChevronsDown,
  Star,
  X,
} from 'lucide-react';
import type { Commission, SubjectSchedule, Shift } from '../../types/schedule';
import type { Subject } from '../../types/career';
import { getCommissionConflictsWithSelection } from '../../utils/scheduleLogic';
import {
  computeCommissionCombinedRating,
  filterAndSortCommissionsByRating,
  formatRatingDecimal,
  type ProfessorRatingResolver,
} from '../../utils/professorRatingsLogic';
import { ProfessorRatingBadge } from '../professors/ProfessorRatingBadge';
import { useIsTouchDevice } from '../../hooks/useTouchDevice';
import { BottomSheet } from '../common/BottomSheet';

interface ScheduleLeftPanelProps {
  term: '1C' | '2C';
  availableSubjects: Subject[];
  allSubjects: Subject[];
  schedulesMap: Map<number, SubjectSchedule>;
  selections: Record<number, Commission>;
  onSelectCommission: (subjectId: number, commissionId: string) => void;
  onRemoveCommission?: (subjectId: number) => void;
  onHoverCommission: (data: { commission: Commission; subjectId: number; subjectName: string; hasConflict: boolean } | null) => void;
  subjectNamesMap: Map<number, string>;
  focusedSubjectId?: number | null;
  onViewInGrid?: (subjectId?: number) => void;
  resolveProfessorRating?: ProfessorRatingResolver;
  onOpenProfessorDetail?: (professorId: string) => void;
  isMobileView?: boolean;
}

export const ScheduleLeftPanel: React.FC<ScheduleLeftPanelProps> = ({
  term,
  availableSubjects,
  allSubjects,
  schedulesMap,
  selections,
  onSelectCommission,
  onRemoveCommission,
  onHoverCommission,
  subjectNamesMap,
  focusedSubjectId,
  onViewInGrid,
  resolveProfessorRating,
  onOpenProfessorDetail,
  isMobileView: _isMobileView,
}) => {
  const isTouchDevice = useIsTouchDevice();
  const [searchQuery, setSearchQuery] = useState('');
  const [shiftFilter, setShiftFilter] = useState<'all' | Shift>('all');
  const [onlyConflictFree, setOnlyConflictFree] = useState(false);
  const [showAllSubjects, setShowAllSubjects] = useState(false);
  const [minRatingFilter, setMinRatingFilter] = useState<number>(0);
  const [sortByBestRated, setSortByBestRated] = useState<boolean>(false);
  const [expandedSubjectIds, setExpandedSubjectIds] = useState<Set<number>>(new Set());
  const [previewingCommissionId, setPreviewingCommissionId] = useState<string | null>(null);
  const [isFiltersSheetOpen, setIsFiltersSheetOpen] = useState(false);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (shiftFilter !== 'all') count++;
    if (onlyConflictFree) count++;
    if (showAllSubjects) count++;
    if (minRatingFilter > 0) count++;
    if (sortByBestRated) count++;
    return count;
  }, [shiftFilter, onlyConflictFree, showAllSubjects, minRatingFilter, sortByBestRated]);

  const handleClearAllFilters = () => {
    setShiftFilter('all');
    setOnlyConflictFree(false);
    setShowAllSubjects(false);
    setMinRatingFilter(0);
    setSortByBestRated(false);
  };

  // Expand focused subject when requested by popover
  React.useEffect(() => {
    if (focusedSubjectId) {
      setExpandedSubjectIds((prev) => new Set(prev).add(focusedSubjectId));
    }
  }, [focusedSubjectId]);

  // Determine subjects pool based on showAllSubjects and term
  const subjectsPool = useMemo(() => {
    const pool = showAllSubjects ? allSubjects : availableSubjects;

    return pool.filter((s) => {
      // Modality filter: 1C -> 1C or A; 2C -> 2C or A
      const matchesTerm =
        s.modality === 'A' ||
        (term === '1C' && s.modality.includes('1C')) ||
        (term === '2C' && s.modality.includes('2C'));

      if (!matchesTerm) return false;

      // Text query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = s.name.toLowerCase().includes(q);
        const matchesCode = String(s.code).includes(q);
        const sched = schedulesMap.get(s.id);
        const matchesProf = sched?.commissions.some((c) =>
          c.professors.some((p) => p.toLowerCase().includes(q))
        );
        if (!matchesName && !matchesCode && !matchesProf) return false;
      }

      return true;
    });
  }, [showAllSubjects, allSubjects, availableSubjects, term, searchQuery, schedulesMap]);

  const toggleSubjectExpanded = (subjectId: number) => {
    setExpandedSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) {
        next.delete(subjectId);
      } else {
        next.add(subjectId);
      }
      return next;
    });
  };

  const allExpanded = useMemo(() => {
    if (subjectsPool.length === 0) return false;
    return subjectsPool.every((s) => expandedSubjectIds.has(s.id));
  }, [subjectsPool, expandedSubjectIds]);

  const handleToggleAll = () => {
    if (allExpanded) {
      setExpandedSubjectIds(new Set());
    } else {
      setExpandedSubjectIds(new Set(subjectsPool.map((s) => s.id)));
    }
  };

  // Al elegir comisión: NO colapsar la materia (ajuste 1) para mantener el scroll intacto
  const handleSelectCommission = (subjectId: number, commissionId: string) => {
    onSelectCommission(subjectId, commissionId);
    setPreviewingCommissionId(null);
  };

  const fallbackResolver: ProfessorRatingResolver = () => null;
  const activeRatingResolver = resolveProfessorRating || fallbackResolver;

  return (
    <div className="w-full lg:w-[320px] xl:w-[340px] shrink-0 flex flex-col bg-slate-900/60 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-md min-h-0 h-full">
      {/* Header & Search */}
      <div className="p-3 border-b border-slate-800 space-y-2.5 bg-slate-950/40 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Clock className="w-4 h-4" />
            </span>
            <span className="text-xs font-black uppercase tracking-wider text-white">
              Oferta Académica ({term})
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleToggleAll}
              className="px-2 py-0.5 rounded-lg border border-slate-700/80 bg-slate-900 hover:bg-slate-800 text-[10px] font-semibold text-slate-300 hover:text-white transition-all flex items-center gap-1 shadow-sm"
              title={allExpanded ? 'Plegar todas las materias' : 'Desplegar todas las materias'}
            >
              {allExpanded ? (
                <>
                  <ChevronsUp className="w-3 h-3 text-indigo-400" />
                  <span>Plegar todas</span>
                </>
              ) : (
                <>
                  <ChevronsDown className="w-3 h-3 text-indigo-400" />
                  <span>Desplegar</span>
                </>
              )}
            </button>

            <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
              {subjectsPool.length} mat.
            </span>
          </div>
        </div>

        {/* Search bar + Mobile Filters Button */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar materia, código o docente..."
              className="w-full pl-8 pr-9 py-2 rounded-xl bg-slate-950 border border-slate-800 text-[16px] sm:text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors min-h-[44px] sm:min-h-0"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-white min-w-[36px] min-h-[36px] flex items-center justify-center cursor-pointer"
                title="Borrar búsqueda"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Botón Filtros solo en mobile */}
          <div className="sm:hidden">
            <button
              type="button"
              onClick={() => setIsFiltersSheetOpen(true)}
              className={`min-h-[44px] px-3 rounded-xl border flex items-center gap-1.5 text-xs font-bold transition-all shrink-0 cursor-pointer active:scale-95 ${
                activeFiltersCount > 0
                  ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Filter className="w-4 h-4" />
              <span>Filtros</span>
              {activeFiltersCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-white/20 text-white font-mono text-[10px] flex items-center justify-center">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Chips de filtros activos en mobile */}
        {activeFiltersCount > 0 && (
          <div className="sm:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 text-[11px]">
            {shiftFilter !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold whitespace-nowrap">
                <span>Turno: {shiftFilter}</span>
                <button type="button" onClick={() => setShiftFilter('all')} className="hover:text-white ml-0.5">✕</button>
              </span>
            )}
            {onlyConflictFree && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold whitespace-nowrap">
                <span>Sin choques</span>
                <button type="button" onClick={() => setOnlyConflictFree(false)} className="hover:text-white ml-0.5">✕</button>
              </span>
            )}
            {showAllSubjects && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold whitespace-nowrap">
                <span>Todas</span>
                <button type="button" onClick={() => setShowAllSubjects(false)} className="hover:text-white ml-0.5">✕</button>
              </span>
            )}
            {minRatingFilter > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold whitespace-nowrap">
                <span>★ {minRatingFilter}+</span>
                <button type="button" onClick={() => setMinRatingFilter(0)} className="hover:text-white ml-0.5">✕</button>
              </span>
            )}
            {sortByBestRated && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold whitespace-nowrap">
                <span>Mejor valoradas</span>
                <button type="button" onClick={() => setSortByBestRated(false)} className="hover:text-white ml-0.5">✕</button>
              </span>
            )}
            <button
              type="button"
              onClick={handleClearAllFilters}
              className="text-[10px] text-slate-400 hover:text-white underline shrink-0 px-1"
            >
              Limpiar
            </button>
          </div>
        )}

        {/* Filters bar en Desktop (oculto en pantallas chicas para no comer espacio vertical) */}
        <div className="hidden sm:flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px]">
          {/* Shift selector */}
          <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
            {(['all', 'mañana', 'tarde', 'noche'] as const).map((sh) => (
              <button
                key={sh}
                onClick={() => setShiftFilter(sh)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold capitalize transition-all flex items-center justify-center ${
                  shiftFilter === sh
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sh === 'all' ? 'Turnos' : sh}
              </button>
            ))}
          </div>

          {/* Conflict-free filter toggle */}
          <button
            onClick={() => setOnlyConflictFree(!onlyConflictFree)}
            className={`px-2.5 py-1 rounded-lg border text-[10px] font-semibold flex items-center gap-1 transition-all ${
              onlyConflictFree
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
            }`}
          >
            <Sparkles className="w-3 h-3 text-emerald-400" />
            <span>Sin choques</span>
          </button>

          {/* Show all subjects toggle */}
          <button
            onClick={() => setShowAllSubjects(!showAllSubjects)}
            className={`px-2.5 py-1 rounded-lg border text-[10px] font-semibold flex items-center gap-1 transition-all ${
              showAllSubjects
                ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
            }`}
            title="Mostrar todas las materias del cuatrimestre incluso las bloqueadas"
          >
            {showAllSubjects ? <Eye className="w-3 h-3 text-cyan-400" /> : <EyeOff className="w-3 h-3" />}
            <span>Todas</span>
          </button>
        </div>

        {/* Professor rating filter & sort row en Desktop */}
        <div className="hidden sm:flex items-center justify-between gap-1.5 pt-0.5 text-[10px]">
          <select
            aria-label="Valoración mínima de comisión"
            value={minRatingFilter}
            onChange={(e) => setMinRatingFilter(Number(e.target.value))}
            className="flex-1 min-w-0 rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value={0}>Valoración mínima: Todas</option>
            <option value={3.5}>Valoración: ★ 3,5+</option>
            <option value={4}>Valoración: ★ 4,0+</option>
            <option value={4.5}>Valoración: ★ 4,5+</option>
          </select>

          <button
            type="button"
            onClick={() => setSortByBestRated(!sortByBestRated)}
            className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 shrink-0 transition-all cursor-pointer text-[10px] ${
              sortByBestRated
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Ordenar las comisiones mejor valoradas primero"
          >
            <Star className={`w-3 h-3 ${sortByBestRated ? 'text-amber-400 fill-amber-400' : 'text-amber-400'}`} />
            <span>Mejor valoradas</span>
          </button>
        </div>
      </div>

      {/* Subjects Accordion List with dedicated internal scroll */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0 overscroll-contain">
        {subjectsPool.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 space-y-1">
            <Filter className="w-6 h-6 mx-auto text-slate-600" />
            <p>No se encontraron materias con los filtros seleccionados.</p>
          </div>
        ) : (
          subjectsPool.map((subject) => {
            const sched = schedulesMap.get(subject.id);
            const commissions = sched?.commissions || [];
            const hasCommissions = commissions.length > 0;
            const selectedComm = selections[subject.id];
            const isExpanded = expandedSubjectIds.has(subject.id);

            // Filter commissions based on shift, conflict free toggle, and professor rating
            const baseFilteredCommissions = commissions.filter((c) => {
              if (shiftFilter !== 'all' && c.turno && c.turno !== shiftFilter) {
                return false;
              }
              if (onlyConflictFree) {
                const { conflicts } = getCommissionConflictsWithSelection(
                  c,
                  subject.id,
                  subject.name,
                  selections,
                  subjectNamesMap
                );
                if (conflicts.length > 0) return false;
              }
              return true;
            });

            const filteredCommissions = filterAndSortCommissionsByRating(
              baseFilteredCommissions,
              {
                minRating: minRatingFilter,
                sortByRating: sortByBestRated,
              },
              activeRatingResolver
            );

            // Fijar la comisión elegida al principio de su grupo (ajuste 1)
            const sortedCommissions = selectedComm
              ? [...filteredCommissions].sort((a, b) => {
                  if (a.id === selectedComm.id) return -1;
                  if (b.id === selectedComm.id) return 1;
                  return 0;
                })
              : filteredCommissions;

            return (
              <div
                key={subject.id}
                className={`rounded-xl border transition-all overflow-hidden ${
                  selectedComm
                    ? 'border-indigo-500/50 bg-indigo-950/20 shadow-sm'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                }`}
              >
                {/* Entire Subject Header Row is Clickable with aria-expanded */}
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => toggleSubjectExpanded(subject.id)}
                  className="w-full p-2.5 sm:p-3 min-h-[48px] flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors cursor-pointer group"
                >
                  <div className="min-w-0 pr-2 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 group-hover:text-slate-300">
                        #{subject.code}
                      </span>
                      <span className="text-xs font-bold text-white truncate block">
                        {subject.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1 flex-wrap">
                      <span>{subject.level}° año</span>
                      <span>•</span>
                      <span>{subject.weeklyHours} hs/sem</span>
                      {selectedComm && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-emerald-300 font-bold flex items-center gap-1 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full text-[10px]">
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>{selectedComm.code} elegida</span>
                          </span>
                          {onViewInGrid && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onViewInGrid(subject.id);
                              }}
                              className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold underline decoration-indigo-400/50 active:scale-95 transition-transform"
                            >
                              Ver en grilla ➔
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Botón manual Plegar / Ver por materia (ajuste 1) */}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSubjectExpanded(subject.id);
                      }}
                      className="px-2.5 py-1.5 sm:py-0.5 rounded-lg text-xs sm:text-[10px] font-semibold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 transition-colors cursor-pointer min-h-[38px] sm:min-h-0 flex items-center justify-center"
                      title={isExpanded ? 'Plegar comisiones de esta materia' : 'Desplegar comisiones'}
                    >
                      {isExpanded ? 'Plegar' : 'Ver'}
                    </span>

                    {!hasCommissions ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-500 border border-slate-700/40">
                        Sin oferta
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {filteredCommissions.length} com.
                      </span>
                    )}

                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
                        isExpanded ? 'rotate-180 text-white' : 'rotate-0'
                      }`}
                    />
                  </div>
                </button>

                {/* Animated Commissions List Dropdown */}
                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      key={`content-${subject.id}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden border-t border-slate-800/60 bg-slate-950/60"
                    >
                      <div className="p-2 space-y-2">
                        {!hasCommissions ? (
                          <div className="p-3 text-center text-xs text-slate-500">
                            <Info className="w-4 h-4 mx-auto mb-1 text-slate-600" />
                            <span>No hay comisiones cargadas para esta materia aún.</span>
                          </div>
                        ) : sortedCommissions.length === 0 ? (
                          <div className="p-3 text-center text-xs text-slate-500">
                            <span>Ninguna comisión coincide con los filtros aplicados.</span>
                          </div>
                        ) : (
                          sortedCommissions.map((comm) => {
                            const isSelected = selectedComm?.id === comm.id;
                            const isPreviewing = previewingCommissionId === comm.id;
                            const { conflicts, consecutive } = getCommissionConflictsWithSelection(
                              comm,
                              subject.id,
                              subject.name,
                              selections,
                              subjectNamesMap
                            );
                            const hasConflict = conflicts.length > 0;
                            const commRating = computeCommissionCombinedRating(
                              comm,
                              activeRatingResolver
                            );

                            return (
                              <div
                                key={comm.id}
                                onClick={() => {
                                  if (isTouchDevice && !isSelected) {
                                    if (!isPreviewing) {
                                      setPreviewingCommissionId(comm.id);
                                      onHoverCommission({
                                        commission: comm,
                                        subjectId: subject.id,
                                        subjectName: subject.name,
                                        hasConflict,
                                      });
                                    }
                                  }
                                }}
                                onMouseEnter={() => {
                                  if (!isTouchDevice) {
                                    onHoverCommission({
                                      commission: comm,
                                      subjectId: subject.id,
                                      subjectName: subject.name,
                                      hasConflict,
                                    });
                                  }
                                }}
                                onMouseLeave={() => {
                                  if (!isTouchDevice) {
                                    onHoverCommission(null);
                                  }
                                }}
                                className={`p-2.5 rounded-xl border text-xs transition-all relative ${
                                  isSelected
                                    ? 'bg-emerald-950/35 border-emerald-400/80 shadow-[0_0_15px_rgba(16,185,129,0.25)] ring-1 ring-emerald-400/40'
                                    : isPreviewing
                                    ? 'bg-amber-950/30 border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.25)] ring-1 ring-amber-400/40'
                                    : hasConflict
                                    ? 'bg-slate-900 border-rose-500/30 hover:border-rose-500/60'
                                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                                }`}
                              >
                                {/* Commission Code & Shift */}
                                <div className="flex items-center justify-between gap-1 mb-1.5">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-extrabold text-white text-xs">
                                      Comisión {comm.code}
                                    </span>
                                    {comm.turno && (
                                      <span className="text-[10px] font-bold px-1.5 py-0.2 rounded uppercase tracking-wider bg-slate-800 text-slate-300">
                                        {comm.turno}
                                      </span>
                                    )}
                                    {isSelected && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                                        <Check className="w-3 h-3 text-emerald-400" />
                                        <span>Elegida</span>
                                      </span>
                                    )}
                                    {isPreviewing && !isSelected && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                                        Previsualizando
                                      </span>
                                    )}
                                    {commRating.professors.length > 1 &&
                                      commRating.combinedAverage !== null && (
                                        <span
                                          className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                                          title="Valoración combinada de los docentes con promedio confiable en esta comisión"
                                        >
                                          Prom. ★ {formatRatingDecimal(commRating.combinedAverage, 1)}
                                        </span>
                                      )}
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {isSelected && onRemoveCommission && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onRemoveCommission(subject.id);
                                        }}
                                        className="px-3 py-2 sm:py-1.5 rounded-lg font-semibold text-xs sm:text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 border border-rose-500/30 transition-all active:scale-95 min-h-[44px] sm:min-h-0 flex items-center justify-center"
                                        title="Deseleccionar comisión"
                                      >
                                        Quitar
                                      </button>
                                    )}

                                    {/* Botón de acción: previsualizar o elegir según toque o ratón */}
                                    {isTouchDevice && !isSelected && !isPreviewing ? (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPreviewingCommissionId(comm.id);
                                          onHoverCommission({
                                            commission: comm,
                                            subjectId: subject.id,
                                            subjectName: subject.name,
                                            hasConflict,
                                          });
                                        }}
                                        className="px-3 py-2 sm:py-1.5 rounded-lg font-semibold text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all active:scale-95 border border-slate-700 min-h-[44px] sm:min-h-0 flex items-center justify-center"
                                      >
                                        Previsualizar
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleSelectCommission(subject.id, comm.id);
                                        }}
                                        className={`px-3.5 py-2 sm:py-1.5 rounded-lg font-bold text-xs transition-all flex items-center gap-1 cursor-pointer active:scale-95 min-h-[44px] sm:min-h-0 justify-center ${
                                          isSelected
                                            ? 'bg-emerald-600 text-white shadow-sm'
                                            : isPreviewing
                                            ? 'bg-gradient-to-r from-emerald-600 to-indigo-600 text-white shadow-md animate-pulse'
                                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
                                        }`}
                                      >
                                        {isSelected ? (
                                          <>
                                            <Check className="w-3.5 h-3.5" />
                                            <span>Elegida</span>
                                          </>
                                        ) : isPreviewing ? (
                                          <>
                                            <Check className="w-3.5 h-3.5" />
                                            <span>Confirmar</span>
                                          </>
                                        ) : (
                                          <span>Elegir</span>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Professors with interactive rating badges & popovers */}
                                {commRating.professors.length > 0 ? (
                                  <div className="space-y-1 mb-1.5">
                                    {commRating.professors.map((profEntry, pIdx) => (
                                      <ProfessorRatingBadge
                                        key={`${comm.id}-prof-${pIdx}`}
                                        professorName={profEntry.name}
                                        professorId={profEntry.id}
                                        rating={profEntry.rating}
                                        onOpenDetail={onOpenProfessorDetail}
                                      />
                                    ))}
                                  </div>
                                ) : comm.professors.length > 0 ? (
                                  <div className="flex items-center gap-1 text-[11px] text-slate-400 mb-1.5">
                                    <User className="w-3 h-3 text-slate-500 shrink-0" />
                                    <span className="truncate">{comm.professors.join(', ')}</span>
                                  </div>
                                ) : null}

                                {/* Slots timetable */}
                                <div className="space-y-1 my-1.5">
                                  {comm.slots.map((s, sIdx) => (
                                    <div
                                      key={sIdx}
                                      className="flex items-center justify-between text-[10px] font-mono text-slate-300 bg-slate-950/50 px-2 py-0.5 rounded border border-slate-800/60"
                                    >
                                      <span className="font-bold text-indigo-300">{s.day}</span>
                                      <span>{s.start} - {s.end}</span>
                                      <span className="text-slate-500 flex items-center gap-1">
                                        {s.room && (
                                          <span className="flex items-center gap-0.5">
                                            <MapPin className="w-2.5 h-2.5" />
                                            <span>{s.room}</span>
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  ))}
                                </div>

                                {/* Conflict Warning Alert Tag */}
                                {hasConflict && (
                                  <div className="p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[10px] text-rose-300 font-semibold flex items-center gap-1.5 mt-1">
                                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                    <span className="truncate">
                                      Choca con: {conflicts.map((c) => c.subjectName2).join(', ')}
                                    </span>
                                  </div>
                                )}

                                {/* Consecutive class notice */}
                                {!hasConflict && consecutive.length > 0 && (
                                  <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300 flex items-center gap-1 mt-1">
                                    <Info className="w-3 h-3 text-amber-400 shrink-0" />
                                    <span className="truncate">
                                      Clase consecutiva con {consecutive[0].subjectName2} ({consecutive[0].day} {consecutive[0].time})
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}

                        {sortedCommissions.length > 0 && (
                          <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/80 px-1 text-[10px] text-slate-400">
                            <span>{sortedCommissions.length} {sortedCommissions.length === 1 ? 'comisión' : 'comisiones'}</span>
                            <button
                              type="button"
                              onClick={() => toggleSubjectExpanded(subject.id)}
                              className="text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 hover:underline cursor-pointer"
                            >
                              <ChevronsUp className="w-3 h-3" />
                              <span>Plegar materia</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>

      {/* BottomSheet de Filtros para Mobile */}
      <BottomSheet
        isOpen={isFiltersSheetOpen}
        onClose={() => setIsFiltersSheetOpen(false)}
        title="Filtros de Comisiones"
        subtitle={`Oferta Académica (${term})`}
        maxHeightDvh={85}
        footer={
          <div className="flex items-center justify-between gap-3 w-full">
            <button
              type="button"
              onClick={handleClearAllFilters}
              className="px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 font-bold text-xs hover:bg-slate-700 transition-colors cursor-pointer min-h-[44px]"
            >
              Limpiar
            </button>
            <button
              type="button"
              onClick={() => setIsFiltersSheetOpen(false)}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-xs hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-950/50 cursor-pointer min-h-[44px]"
            >
              Aplicar filtros ({activeFiltersCount})
            </button>
          </div>
        }
      >
        <div className="space-y-5 text-sm p-1">
          {/* Turno */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
              Turno de Cursada
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['all', 'mañana', 'tarde', 'noche'] as const).map((sh) => (
                <button
                  key={sh}
                  type="button"
                  onClick={() => setShiftFilter(sh)}
                  className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold capitalize transition-all border flex items-center justify-center cursor-pointer ${
                    shiftFilter === sh
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  {sh === 'all' ? 'Cualquier turno' : `Turno ${sh}`}
                </button>
              ))}
            </div>
          </div>

          {/* Choques y materias */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
              Opciones de Oferta
            </label>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setOnlyConflictFree(!onlyConflictFree)}
                className={`w-full min-h-[48px] p-3 rounded-xl border flex items-center justify-between text-xs font-bold transition-all cursor-pointer ${
                  onlyConflictFree
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>Ocultar comisiones con choques</span>
                </div>
                <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                  onlyConflictFree ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 bg-slate-950'
                }`}>
                  {onlyConflictFree && <Check className="w-3.5 h-3.5" />}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setShowAllSubjects(!showAllSubjects)}
                className={`w-full min-h-[48px] p-3 rounded-xl border flex items-center justify-between text-xs font-bold transition-all cursor-pointer ${
                  showAllSubjects
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-cyan-400" />
                  <span>Mostrar todas (incluyendo bloqueadas)</span>
                </div>
                <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                  showAllSubjects ? 'bg-cyan-600 border-cyan-500 text-white' : 'border-slate-700 bg-slate-950'
                }`}>
                  {showAllSubjects && <Check className="w-3.5 h-3.5" />}
                </div>
              </button>
            </div>
          </div>

          {/* Valoración Docente */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
              Valoración Docente
            </label>

            <div className="space-y-1.5">
              {[
                { val: 0, label: 'Cualquier valoración' },
                { val: 3, label: '★ 3,0 o más (Regular o superior)' },
                { val: 3.5, label: '★ 3,5 o más (Buena o superior)' },
                { val: 4, label: '★ 4,0 o más (Muy buena o superior)' },
                { val: 4.5, label: '★ 4,5 o más (Excelente)' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setMinRatingFilter(opt.val)}
                  className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                    minRatingFilter === opt.val
                      ? 'bg-indigo-600 text-white border-indigo-500 font-bold'
                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  <span>{opt.label}</span>
                  {minRatingFilter === opt.val && <Check className="w-4 h-4" />}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setSortByBestRated(!sortByBestRated)}
              className={`w-full min-h-[48px] p-3 rounded-xl border flex items-center justify-between text-xs font-bold transition-all cursor-pointer mt-2 ${
                sortByBestRated
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <span>Ordenar comisiones mejor valoradas primero</span>
              </div>
              <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                sortByBestRated ? 'bg-amber-600 border-amber-500 text-white' : 'border-slate-700 bg-slate-950'
              }`}>
                {sortByBestRated && <Check className="w-3.5 h-3.5" />}
              </div>
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
};
