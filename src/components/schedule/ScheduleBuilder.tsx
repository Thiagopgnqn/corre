import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Clock,
  Upload,
  Plus,
  Undo2,
  Redo2,
  Copy,
  Trash2,
  Layers,
  Edit2,
  Check,
  Calendar,
  PieChart,
  ChevronDown,
  MoreHorizontal,
  X,
  AlertTriangle,
  Sparkles,
  PlayCircle,
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { useProfessorRatings } from '../../hooks/useProfessorRatings';
import { CORE_SUBJECTS } from '../../data/plan2023';
import { ELECTIVES } from '../../data/electives';
import { getSubjectStatus } from '../../utils/correlativas';
import { detectAllConflicts } from '../../utils/scheduleLogic';
import type { Commission, SubjectSchedule } from '../../types/schedule';
import { ScheduleWeeklyGrid } from './ScheduleWeeklyGrid';
import { ScheduleLeftPanel } from './ScheduleLeftPanel';
import { ScheduleSummaryPanel } from './ScheduleSummaryPanel';
import { ScheduleCombinationsModal } from './ScheduleCombinationsModal';
import { ScheduleImportModal } from './ScheduleImportModal';
import { ProfessorDetailModal } from '../professors/ProfessorDetailModal';
import { ReviewFormModal } from '../professors/ReviewFormModal';

export const ScheduleBuilder: React.FC = () => {
  const {
    activeState,
    settings,
    assignedElectives,
    semesterBasket,
    activeSchedules,
    customSchedules,
    setCustomSchedules,
    scheduleTerm,
    setScheduleTerm,
    scheduleSelections,
    setScheduleSelections,
    selectCommission,
    removeCommission,
    clearScheduleSelections,
    scheduleDrafts,
    saveDraft,
    loadDraft,
    deleteDraft,
    renameDraft,
    duplicateDraft,
    applyScheduleToEnrolled,
  } = useCareer();

  const { getRatingForProfessor, reloadRatings } = useProfessorRatings(true);

  // Modals state
  const [combinationsModalOpen, setCombinationsModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [detailProfessorId, setDetailProfessorId] = useState<string | null>(null);
  const [reviewFromScheduleProfId, setReviewFromScheduleProfId] = useState<string | null>(null);
  const [focusedConflictId, setFocusedConflictId] = useState<string | null>(null);
  const [focusedSubjectId, setFocusedSubjectId] = useState<number | null>(null);

  // Draft renaming state
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftNameInput, setDraftNameInput] = useState('');

  // Undo / Redo history stack
  const [history, setHistory] = useState<Array<Record<number, string>>>([scheduleSelections]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const pushHistory = useCallback((nextSelections: Record<number, string>) => {
    setHistory((prev) => [...prev.slice(0, historyIndex + 1), nextSelections]);
    setHistoryIndex((prev) => prev + 1);
  }, [historyIndex]);

  const handleSelectCommissionWithHistory = useCallback((subjectId: number, commissionId: string) => {
    const next = { ...scheduleSelections, [subjectId]: commissionId };
    selectCommission(subjectId, commissionId);
    pushHistory(next);
  }, [scheduleSelections, selectCommission, pushHistory]);

  const handleRemoveCommissionWithHistory = useCallback((subjectId: number) => {
    const next = { ...scheduleSelections };
    delete next[subjectId];
    removeCommission(subjectId);
    pushHistory(next);
  }, [scheduleSelections, removeCommission, pushHistory]);

  const handleClearWithHistory = useCallback(() => {
    clearScheduleSelections();
    pushHistory({});
  }, [clearScheduleSelections, pushHistory]);

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex((idx) => idx - 1);
      setScheduleSelections(prev);
    }
  }, [historyIndex, history, setScheduleSelections]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex((idx) => idx + 1);
      setScheduleSelections(next);
    }
  }, [historyIndex, history, setScheduleSelections]);

  // Hovered commission state for the Ghost/Phantom grid preview
  const [hoveredCommission, setHoveredCommission] = useState<{
    commission: Commission;
    subjectId: number;
    subjectName: string;
    hasConflict: boolean;
  } | null>(null);

  // Subject names map
  const subjectNamesMap = useMemo(() => {
    const map = new Map<number, string>();
    CORE_SUBJECTS.forEach((s) => map.set(s.id, s.name));
    ELECTIVES.forEach((e) => map.set(e.id, e.name));
    return map;
  }, []);

  const knownSubjectIds = useMemo(() => {
    const set = new Set<number | string>();
    CORE_SUBJECTS.forEach((s) => set.add(s.id));
    ELECTIVES.forEach((e) => set.add(e.id));
    return set;
  }, []);

  // Schedules by subject map
  const schedulesMap = useMemo(() => {
    const map = new Map<number, SubjectSchedule>();
    activeSchedules.forEach((s) => map.set(Number(s.subjectId), s));
    return map;
  }, [activeSchedules]);

  // Available subjects pool based on career status
  const availableSubjects = useMemo(() => {
    const core = settings.includeAnalistaTrack
      ? CORE_SUBJECTS
      : CORE_SUBJECTS.filter((s) => s.id !== 99);

    // Collect electives that user has planned/assigned
    const assignedElectiveIds = new Set(
      Object.values(assignedElectives).flat()
    );
    const relevantElectives = ELECTIVES.filter((e) => assignedElectiveIds.has(e.id));

    const pool = [...core, ...relevantElectives];

    return pool.filter((s) => {
      const st = getSubjectStatus(s, activeState);
      return st === 'disponible' || st === 'cursando';
    });
  }, [activeState, settings.includeAnalistaTrack, assignedElectives]);

  // Full pool of all subjects
  const allSubjects = useMemo(() => {
    const core = settings.includeAnalistaTrack
      ? CORE_SUBJECTS
      : CORE_SUBJECTS.filter((s) => s.id !== 99);
    return [...core, ...ELECTIVES];
  }, [settings.includeAnalistaTrack]);

  // Selected commission objects map: subjectId -> Commission
  const selectedCommissionsMap = useMemo(() => {
    const map: Record<number, Commission> = {};
    Object.entries(scheduleSelections).forEach(([sIdStr, commId]) => {
      const sId = Number(sIdStr);
      const sched = schedulesMap.get(sId);
      const found = sched?.commissions.find((c) => c.id === commId);
      if (found) {
        map[sId] = found;
      }
    });
    return map;
  }, [scheduleSelections, schedulesMap]);

  // Calculate conflicts across current selection
  const { conflicts } = useMemo(() => {
    return detectAllConflicts(selectedCommissionsMap, subjectNamesMap);
  }, [selectedCommissionsMap, subjectNamesMap]);

  // Sync basket subjects with schedule
  const handleLoadFromBasket = () => {
    if (semesterBasket.length === 0) return;
    // Auto-select the first available commission for each basket subject if not already selected
    const next = { ...scheduleSelections };
    semesterBasket.forEach((sId) => {
      if (!next[sId]) {
        const sched = schedulesMap.get(sId);
        if (sched && sched.commissions.length > 0) {
          next[sId] = sched.commissions[0].id;
        }
      }
    });
    setScheduleSelections(next);
    pushHistory(next);
  };

  // Mobile & layout state
  const [mobileProposalsOpen, setMobileProposalsOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
  const [isMobileGridExpanded, setIsMobileGridExpanded] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Total weekly hours
  const totalHours = useMemo(() => {
    let minutes = 0;
    Object.values(selectedCommissionsMap).forEach((comm) => {
      comm.slots.forEach((s) => {
        const [sh, sm] = s.start.split(':').map(Number);
        const [eh, em] = s.end.split(':').map(Number);
        minutes += eh * 60 + em - (sh * 60 + sm);
      });
    });
    return Math.round((minutes / 60) * 10) / 10;
  }, [selectedCommissionsMap]);

  const selectedCount = Object.keys(selectedCommissionsMap).length;

  return (
    <div className="w-full max-w-[1920px] mx-auto px-2 sm:px-4 py-2 sm:py-3 flex-1 flex flex-col gap-2 min-h-0 h-full overflow-hidden lg:h-auto lg:overflow-visible lg:gap-3">
      {/* Mobile Header Bar & Controls (< lg) */}
      {!isDesktop && (
        <div className="flex flex-col gap-2 shrink-0">
          <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-2xl backdrop-blur-md shadow-lg flex items-center justify-between gap-2">
            {/* Left: icon + title */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-white tracking-tight truncate">
                  Horarios
                </h2>
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  {selectedCount} mat. • {totalHours} hs/sem
                </div>
              </div>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* 1C / 2C compact toggle */}
              <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-[11px] font-bold">
                <button
                  onClick={() => setScheduleTerm('1C')}
                  className={`px-2 py-1 rounded transition-colors ${
                    scheduleTerm === '1C' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'
                  }`}
                >
                  1C
                </button>
                <button
                  onClick={() => setScheduleTerm('2C')}
                  className={`px-2 py-1 rounded transition-colors ${
                    scheduleTerm === '2C' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400'
                  }`}
                >
                  2C
                </button>
              </div>

              {/* Undo / Redo */}
              <button
                onClick={handleUndo}
                disabled={historyIndex <= 0}
                className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 active:scale-95 transition-transform"
                title="Deshacer"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleRedo}
                disabled={historyIndex >= history.length - 1}
                className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 active:scale-95 transition-transform"
                title="Rehacer"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>

              {/* Proposals dropdown toggle */}
              <div className="relative">
                <button
                  onClick={() => {
                    setMobileProposalsOpen(!mobileProposalsOpen);
                    setMobileActionsOpen(false);
                  }}
                  className="px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white text-[11px] font-bold flex items-center gap-1 active:scale-95 transition-transform"
                >
                  <span>Planes</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {/* Proposals Dropdown Panel */}
                {mobileProposalsOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-56 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 z-50 space-y-1">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1">
                      Mis propuestas
                    </div>
                    {scheduleDrafts.map((draft) => (
                      <div
                        key={draft.id}
                        onClick={() => {
                          loadDraft(draft.id);
                          setMobileProposalsOpen(false);
                        }}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-800 cursor-pointer text-xs"
                      >
                        <div className="flex items-center gap-1.5 font-bold text-white truncate">
                          <Calendar className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="truncate">{draft.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 shrink-0">
                          ({Object.keys(draft.selections).length})
                        </span>
                      </div>
                    ))}

                    <button
                      onClick={() => {
                        setMobileProposalsOpen(false);
                        const name = prompt(
                          'Nombre para esta propuesta (ej. Plan B):',
                          `Plan ${String.fromCharCode(65 + scheduleDrafts.length)}`
                        );
                        if (name) saveDraft(name, scheduleTerm);
                      }}
                      className="w-full mt-1 py-1.5 px-2 rounded-lg border border-dashed border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 text-xs font-bold flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Guardar como propuesta</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Summary drawer button */}
              <button
                type="button"
                onClick={() => setSummaryDrawerOpen(true)}
                className="px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white text-[11px] font-bold flex items-center gap-1 active:scale-95 transition-transform"
                title="Ver resumen y opciones"
              >
                <PieChart className="w-3.5 h-3.5 text-indigo-400" />
                <span>Resumen</span>
                {conflicts.length > 0 && (
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                )}
              </button>

              {/* More Options toggle */}
              <div className="relative">
                <button
                  onClick={() => {
                    setMobileActionsOpen(!mobileActionsOpen);
                    setMobileProposalsOpen(false);
                  }}
                  className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white text-[11px] active:scale-95 transition-transform"
                  title="Más opciones"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>

                {mobileActionsOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-52 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-50 space-y-1">
                    {semesterBasket.length > 0 && (
                      <button
                        onClick={() => {
                          handleLoadFromBasket();
                          setMobileActionsOpen(false);
                        }}
                        className="w-full text-left p-2 rounded-lg hover:bg-slate-800 text-xs text-cyan-300 font-semibold flex items-center gap-2"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>Cargar canasta ({semesterBasket.length})</span>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setImportModalOpen(true);
                        setMobileActionsOpen(false);
                      }}
                      className="w-full text-left p-2 rounded-lg hover:bg-slate-800 text-xs text-slate-200 font-semibold flex items-center gap-2"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Importar horarios JSON</span>
                    </button>
                    <button
                      onClick={() => {
                        handleClearWithHistory();
                        setMobileActionsOpen(false);
                      }}
                      disabled={selectedCount === 0}
                      className="w-full text-left p-2 rounded-lg hover:bg-rose-950/40 text-xs text-rose-400 font-semibold flex items-center gap-2 disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Limpiar selecciones</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Banner & Control Toolbar (Desktop >= lg) */}
      {isDesktop && (
        <div className="bg-slate-900/70 border border-slate-800 p-3 sm:p-4 rounded-2xl backdrop-blur-md shadow-xl space-y-3 shrink-0">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 p-0.5 shadow-lg shadow-indigo-500/20 flex items-center justify-center shrink-0">
                <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center text-indigo-400">
                  <Clock className="w-5 h-5" />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
                    Armador de Horarios de Cuatrimestre
                  </h2>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    Semanal
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Elegí tus comisiones, consultá reseñas docentes y detectá superposiciones en tiempo real.
                </p>
              </div>
            </div>

            {/* Right Toolbar Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Term selector (1C / 2C) */}
              <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs font-semibold">
                <button
                  onClick={() => setScheduleTerm('1C')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    scheduleTerm === '1C'
                      ? 'bg-indigo-600 text-white shadow-sm font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  1° Cuatrimestre
                </button>
                <button
                  onClick={() => setScheduleTerm('2C')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    scheduleTerm === '2C'
                      ? 'bg-indigo-600 text-white shadow-sm font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  2° Cuatrimestre
                </button>
              </div>

              {/* Undo / Redo */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={handleUndo}
                  disabled={historyIndex <= 0}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                  title="Deshacer selección (Ctrl+Z)"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                  title="Rehacer selección"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
              </div>

              {/* Load from basket button if basket has items */}
              {semesterBasket.length > 0 && (
                <button
                  onClick={handleLoadFromBasket}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 transition-all flex items-center gap-1.5"
                  title="Cargar las materias que sumaste en 'Armá tu Cuatrimestre'"
                >
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Cargar mi canasta ({semesterBasket.length})</span>
                </button>
              )}

              {/* Import schedule JSON button */}
              <button
                onClick={() => setImportModalOpen(true)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-all flex items-center gap-1.5"
                title="Importar archivo JSON de horarios"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Importar horarios</span>
              </button>
            </div>
          </div>

          {/* Drafts Row: Save up to 5 proposals */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800/60 text-xs">
            <div className="flex items-center gap-2 overflow-x-auto">
              <span className="text-slate-400 font-semibold text-[11px] uppercase tracking-wider shrink-0">
                Propuestas:
              </span>

              {scheduleDrafts.map((draft) => {
                const isEditing = editingDraftId === draft.id;
                return (
                  <div
                    key={draft.id}
                    className="inline-flex items-center rounded-xl bg-slate-950 border border-slate-800 overflow-hidden shadow-sm shrink-0"
                  >
                    {isEditing ? (
                      <div className="flex items-center px-2 py-1">
                        <input
                          type="text"
                          value={draftNameInput}
                          onChange={(e) => setDraftNameInput(e.target.value)}
                          className="bg-transparent text-xs text-white outline-none w-24 font-bold"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              renameDraft(draft.id, draftNameInput);
                              setEditingDraftId(null);
                            }
                          }}
                        />
                        <button
                          onClick={() => {
                            renameDraft(draft.id, draftNameInput);
                            setEditingDraftId(null);
                          }}
                          className="p-1 text-emerald-400 hover:text-emerald-300"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => loadDraft(draft.id)}
                        className="px-3 py-1.5 font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1.5"
                      >
                        <Calendar className="w-3 h-3 text-indigo-400" />
                        <span>{draft.name}</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          ({Object.keys(draft.selections).length})
                        </span>
                      </button>
                    )}

                    {!isEditing && (
                      <div className="flex items-center border-l border-slate-800 px-1 gap-0.5">
                        <button
                          onClick={() => {
                            setEditingDraftId(draft.id);
                            setDraftNameInput(draft.name);
                          }}
                          className="p-1 text-slate-500 hover:text-slate-300"
                          title="Renombrar propuesta"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => duplicateDraft(draft.id)}
                          className="p-1 text-slate-500 hover:text-slate-300"
                          title="Duplicar propuesta"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => deleteDraft(draft.id)}
                          className="p-1 text-slate-500 hover:text-rose-400"
                          title="Eliminar propuesta"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {scheduleDrafts.length < 5 && (
                <button
                  onClick={() => {
                    const name = prompt('Nombre para esta propuesta (ej. Plan B):', `Plan ${String.fromCharCode(65 + scheduleDrafts.length)}`);
                    if (name) saveDraft(name, scheduleTerm);
                  }}
                  className="px-2.5 py-1.5 rounded-xl border border-dashed border-slate-700 hover:border-indigo-400 text-slate-400 hover:text-white transition-all flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Guardar propuesta</span>
                </button>
              )}
            </div>

            <div className="text-[11px] text-slate-400 font-mono">
              {Object.keys(scheduleSelections).length} materias en esta propuesta
            </div>
          </div>
        </div>
      )}

      {/* Compact summary strip on 1024-1279px (lg only, hidden on xl) (Ajuste 2) */}
      {isDesktop && (
        <div className="hidden lg:flex xl:hidden items-center justify-between p-2.5 px-3 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md text-xs shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 font-bold text-white">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>{totalHours} hs/sem</span>
            </div>
            <span className="text-slate-600">•</span>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Materias:</span>
              <span className="font-bold text-white">{selectedCount}</span>
            </div>
            <span className="text-slate-600">•</span>
            <div>
              {conflicts.length > 0 ? (
                <span className="text-rose-400 font-bold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {conflicts.length} {conflicts.length === 1 ? 'choque' : 'choques'}
                </span>
              ) : (
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  Sin choques
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setCombinationsModalOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-bold flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
            >
              <Sparkles className="w-3 h-3 text-indigo-400" />
              <span>Combinaciones</span>
            </button>
            {selectedCount > 0 && (
              <button
                onClick={applyScheduleToEnrolled}
                className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-bold flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
              >
                <PlayCircle className="w-3 h-3 text-emerald-400" />
                <span>Cursando</span>
              </button>
            )}
            <button
              onClick={() => setSummaryDrawerOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
            >
              <PieChart className="w-3 h-3 text-indigo-400" />
              <span>Ver resumen</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Layout: Desktop side-by-side vs Mobile Vertical Split */}
      {isDesktop ? (
        <div className="flex-1 min-h-0 flex flex-row gap-3 sm:gap-4 items-start lg:overflow-visible">
          {/* Columna Izquierda: Oferta Académica (Fijada sticky en pantalla) */}
          <div className="sticky top-3 lg:w-[320px] xl:w-[340px] shrink-0 h-[calc(100vh-1.5rem)] flex flex-col z-10">
            <ScheduleLeftPanel
              term={scheduleTerm}
              availableSubjects={availableSubjects}
              allSubjects={allSubjects}
              schedulesMap={schedulesMap}
              selections={selectedCommissionsMap}
              onSelectCommission={handleSelectCommissionWithHistory}
              onRemoveCommission={handleRemoveCommissionWithHistory}
              onHoverCommission={setHoveredCommission}
              subjectNamesMap={subjectNamesMap}
              focusedSubjectId={focusedSubjectId}
              onViewInGrid={(sId) => {
                if (sId) setFocusedSubjectId(sId);
              }}
              resolveProfessorRating={getRatingForProfessor}
              onOpenProfessorDetail={setDetailProfessorId}
            />
          </div>

          {/* Columna Central: Grilla semanal (con ancho cómodo para los seis días, fluye en toda la altura) */}
          <div className="flex-1 min-w-0 flex flex-col">
            <ScheduleWeeklyGrid
              selections={selectedCommissionsMap}
              onRemoveCommission={handleRemoveCommissionWithHistory}
              hoveredCommission={hoveredCommission}
              conflicts={conflicts}
              subjectNamesMap={subjectNamesMap}
              focusedConflictId={focusedConflictId}
              focusedSubjectId={focusedSubjectId}
              onFocusSubject={(sId) => setFocusedSubjectId(sId)}
            />
          </div>

          {/* Columna Derecha: Resumen semanal (visible desde 1280px / xl, fijada sticky en pantalla) */}
          <div className="hidden xl:flex sticky top-3 w-[300px] xl:w-[320px] shrink-0 h-[calc(100vh-1.5rem)] flex-col z-10">
            <ScheduleSummaryPanel
              selections={selectedCommissionsMap}
              conflicts={conflicts}
              subjectNamesMap={subjectNamesMap}
              onOpenCombinationsModal={() => setCombinationsModalOpen(true)}
              onApplyToEnrolled={applyScheduleToEnrolled}
              onClearAll={handleClearWithHistory}
              onSelectConflict={setFocusedConflictId}
              resolveProfessorRating={getRatingForProfessor}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden h-full pb-1">
          {/* Grilla superior fija (< 1024px) ocupando ~38-42% del alto visible */}
          <div
            className={`shrink-0 transition-all duration-200 ${
              isMobileGridExpanded
                ? 'fixed inset-0 z-50 p-2 sm:p-4 bg-[#090d16] flex flex-col overflow-hidden'
                : 'h-[38dvh] max-h-[42%] min-h-[190px] flex flex-col rounded-2xl overflow-hidden shadow-lg border border-slate-800'
            }`}
          >
            {/* Cabecera compacta de la grilla con botón Ver mi semana / Cerrar */}
            <div className="flex items-center justify-between p-1.5 px-2.5 bg-slate-950 border-b border-slate-800 shrink-0 text-xs">
              <div className="flex items-center gap-1.5 min-w-0 font-bold text-white">
                <Calendar className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="truncate">Tu Semana</span>
                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                  ({selectedCount} mat. • {totalHours} hs)
                </span>
                {conflicts.length > 0 && (
                  <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-rose-500 text-white font-mono font-bold animate-pulse shrink-0">
                    !{conflicts.length}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsMobileGridExpanded(!isMobileGridExpanded)}
                  className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
                  title={isMobileGridExpanded ? 'Cerrar pantalla completa' : 'Ver semana en pantalla completa'}
                >
                  {isMobileGridExpanded ? (
                    <>
                      <X className="w-3 h-3" />
                      <span>Cerrar</span>
                    </>
                  ) : (
                    <>
                      <Layers className="w-3 h-3" />
                      <span>Ver mi semana</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <ScheduleWeeklyGrid
                selections={selectedCommissionsMap}
                onRemoveCommission={handleRemoveCommissionWithHistory}
                hoveredCommission={hoveredCommission}
                conflicts={conflicts}
                subjectNamesMap={subjectNamesMap}
                focusedConflictId={focusedConflictId}
                focusedSubjectId={focusedSubjectId}
                onFocusSubject={(sId) => setFocusedSubjectId(sId)}
              />
            </div>
          </div>

          {/* Lista inferior con scroll propio */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <ScheduleLeftPanel
              term={scheduleTerm}
              availableSubjects={availableSubjects}
              allSubjects={allSubjects}
              schedulesMap={schedulesMap}
              selections={selectedCommissionsMap}
              onSelectCommission={handleSelectCommissionWithHistory}
              onRemoveCommission={handleRemoveCommissionWithHistory}
              onHoverCommission={setHoveredCommission}
              subjectNamesMap={subjectNamesMap}
              focusedSubjectId={focusedSubjectId}
              onViewInGrid={(sId) => {
                if (sId) setFocusedSubjectId(sId);
              }}
              resolveProfessorRating={getRatingForProfessor}
              onOpenProfessorDetail={setDetailProfessorId}
              isMobileView={true}
            />
          </div>
        </div>
      )}

      {/* Drawer / Modal de Resumen completo para móvil o pantallas intermedias */}
      {summaryDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md max-h-[85dvh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-3.5 border-b border-slate-800 bg-slate-950/80 shrink-0">
              <div className="flex items-center gap-2">
                <PieChart className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Resumen y Opciones</h3>
              </div>
              <button
                onClick={() => setSummaryDrawerOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <ScheduleSummaryPanel
                selections={selectedCommissionsMap}
                conflicts={conflicts}
                subjectNamesMap={subjectNamesMap}
                onOpenCombinationsModal={() => {
                  setSummaryDrawerOpen(false);
                  setCombinationsModalOpen(true);
                }}
                onApplyToEnrolled={() => {
                  setSummaryDrawerOpen(false);
                  applyScheduleToEnrolled();
                }}
                onClearAll={() => {
                  setSummaryDrawerOpen(false);
                  handleClearWithHistory();
                }}
                onSelectConflict={(cId) => {
                  setSummaryDrawerOpen(false);
                  setFocusedConflictId(cId);
                }}
                resolveProfessorRating={getRatingForProfessor}
              />
            </div>
          </div>
        </div>
      )}

      {/* Global Modals for Schedule Builder */}
      <ScheduleCombinationsModal
        isOpen={combinationsModalOpen}
        onClose={() => setCombinationsModalOpen(false)}
        availableSubjects={availableSubjects}
        schedulesMap={schedulesMap}
        currentSelections={selectedCommissionsMap}
        onApplyCombination={(combos) => {
          const next: Record<number, string> = {};
          Object.entries(combos).forEach(([sIdStr, comm]) => {
            next[Number(sIdStr)] = comm.id;
          });
          setScheduleSelections(next);
          pushHistory(next);
        }}
        subjectNamesMap={subjectNamesMap}
        term={scheduleTerm}
        resolveProfessorRating={getRatingForProfessor}
      />

      <ScheduleImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImportValidSchedules={(newScheds) => {
          setCustomSchedules(newScheds);
        }}
        onResetDefault={() => {
          setCustomSchedules(null);
        }}
        hasCustomSchedules={Boolean(customSchedules && customSchedules.length > 0)}
        knownSubjectIds={knownSubjectIds}
      />

      {/* Professor Detail & Review Modals accessible directly inside Schedule Builder */}
      <ProfessorDetailModal
        professorId={detailProfessorId}
        onClose={() => setDetailProfessorId(null)}
        onWriteReview={(profId) => {
          setDetailProfessorId(null);
          setReviewFromScheduleProfId(profId);
        }}
        onRatingsChanged={reloadRatings}
      />

      <ReviewFormModal
        isOpen={Boolean(reviewFromScheduleProfId)}
        onClose={() => setReviewFromScheduleProfId(null)}
        initialProfessorId={reviewFromScheduleProfId}
        onSaved={reloadRatings}
      />
    </div>
  );
};
