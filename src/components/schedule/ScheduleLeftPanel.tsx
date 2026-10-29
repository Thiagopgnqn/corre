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
  X,
} from 'lucide-react';
import type { Commission, SubjectSchedule, Shift } from '../../types/schedule';
import type { Subject } from '../../types/career';
import { getCommissionConflictsWithSelection } from '../../utils/scheduleLogic';

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
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [shiftFilter, setShiftFilter] = useState<'all' | Shift>('all');
  const [onlyConflictFree, setOnlyConflictFree] = useState(false);
  const [showAllSubjects, setShowAllSubjects] = useState(false);
  const [expandedSubjectIds, setExpandedSubjectIds] = useState<Set<number>>(new Set());

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

  const handleSelectCommission = (subjectId: number, commissionId: string) => {
    onSelectCommission(subjectId, commissionId);
    // Auto-collapse this subject so it shows "Com. XXX elegida" prominently
    setExpandedSubjectIds((prev) => {
      const next = new Set(prev);
      next.delete(subjectId);
      return next;
    });
  };

  return (
    <div className="w-full lg:w-[320px] xl:w-[340px] shrink-0 flex flex-col bg-slate-900/60 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-md min-h-0">
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

        {/* Search bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar materia, código o docente..."
            className="w-full pl-8 pr-8 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
              title="Borrar búsqueda"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px]">
          {/* Shift selector */}
          <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
            {(['all', 'mañana', 'tarde', 'noche'] as const).map((sh) => (
              <button
                key={sh}
                onClick={() => setShiftFilter(sh)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize transition-all ${
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
            className={`px-1.5 py-1 rounded-lg border text-[10px] font-semibold flex items-center gap-1 transition-all ${
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
            className={`px-1.5 py-1 rounded-lg border text-[10px] font-semibold flex items-center gap-1 transition-all ${
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
      </div>

      {/* Subjects Accordion List with dedicated internal scroll */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
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

            // Filter commissions based on shift and conflict free toggle
            const filteredCommissions = commissions.filter((c) => {
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
                  className="w-full p-2.5 flex items-center justify-between text-left hover:bg-slate-800/40 transition-colors cursor-pointer group"
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

                  <div className="flex items-center gap-2 shrink-0">
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
                        ) : filteredCommissions.length === 0 ? (
                          <div className="p-3 text-center text-xs text-slate-500">
                            <span>Ninguna comisión coincide con los filtros aplicados.</span>
                          </div>
                        ) : (
                          filteredCommissions.map((comm) => {
                            const isSelected = selectedComm?.id === comm.id;
                            const { conflicts, consecutive } = getCommissionConflictsWithSelection(
                              comm,
                              subject.id,
                              subject.name,
                              selections,
                              subjectNamesMap
                            );
                            const hasConflict = conflicts.length > 0;

                            return (
                              <div
                                key={comm.id}
                                onMouseEnter={() =>
                                  onHoverCommission({
                                    commission: comm,
                                    subjectId: subject.id,
                                    subjectName: subject.name,
                                    hasConflict,
                                  })
                                }
                                onMouseLeave={() => onHoverCommission(null)}
                                className={`p-2.5 rounded-xl border text-xs transition-all relative ${
                                  isSelected
                                    ? 'bg-indigo-600/20 border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                                    : hasConflict
                                    ? 'bg-slate-900 border-rose-500/30 hover:border-rose-500/60'
                                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                                }`}
                              >
                                {/* Commission Code & Shift */}
                                <div className="flex items-center justify-between gap-1 mb-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-extrabold text-white text-xs">
                                      Comisión {comm.code}
                                    </span>
                                    {comm.turno && (
                                      <span className="text-[10px] font-bold px-1.5 py-0.2 rounded uppercase tracking-wider bg-slate-800 text-slate-300">
                                        {comm.turno}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    {isSelected && onRemoveCommission && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onRemoveCommission(subject.id);
                                        }}
                                        className="px-2.5 py-1.5 rounded-lg font-semibold text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 border border-rose-500/30 transition-all active:scale-95"
                                        title="Deseleccionar comisión"
                                      >
                                        Quitar
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleSelectCommission(subject.id, comm.id)}
                                      className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all flex items-center gap-1 cursor-pointer active:scale-95 ${
                                        isSelected
                                          ? 'bg-emerald-600 text-white shadow-sm'
                                          : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
                                      }`}
                                    >
                                      {isSelected ? (
                                        <>
                                          <Check className="w-3.5 h-3.5" />
                                          <span>Elegida</span>
                                        </>
                                      ) : (
                                        <span>Elegir</span>
                                      )}
                                    </button>
                                  </div>
                                </div>

                                {/* Professors */}
                                {comm.professors.length > 0 && (
                                  <div className="flex items-center gap-1 text-[11px] text-slate-400 mb-1.5">
                                    <User className="w-3 h-3 text-slate-500 shrink-0" />
                                    <span className="truncate">{comm.professors.join(', ')}</span>
                                  </div>
                                )}

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
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
