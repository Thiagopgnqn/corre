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
import { useIsMobile } from '../../hooks/useIsMobile';
import { BottomSheet } from '../common/BottomSheet';

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
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<'comisiones' | 'grilla'>('comisiones');
  const [mobileProposalsOpen, setMobileProposalsOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
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
          <div className="bg-slate-900/80 border border-slate-800 p-2 rounded-2xl backdrop-blur-md shadow-lg flex items-center justify-between gap-2">
            {/* Left: icon + title + 1C/2C toggle (fits < 160px) */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex items-center gap-1.5">
                <h2 className="text-sm font-bold text-white tracking-tight truncate">
                  Horarios
                </h2>
                {/* 1C / 2C compact toggle */}
                <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-[11px] font-bold shrink-0">
                  <button
                    type="button"
                    onClick={() => setScheduleTerm('1C')}
                    className={`px-2 py-1 rounded min-h-[36px] flex items-center justify-center transition-colors ${
                      scheduleTerm === '1C' ? 'bg-indigo-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    1C
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleTerm('2C')}
                    className={`px-2 py-1 rounded min-h-[36px] flex items-center justify-center transition-colors ${
                      scheduleTerm === '2C' ? 'bg-indigo-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    2C
                  </button>
                </div>
              </div>
            </div>

            {/* Right controls: Undo + Redo + '...' (40x40 each) */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleUndo}
                disabled={historyIndex <= 0}
                className="w-10 h-10 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 active:scale-95 transition-transform flex items-center justify-center cursor-pointer"
                title="Deshacer"
                aria-label="Deshacer cambio de comisión"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={historyIndex >= history.length - 1}
                className="w-10 h-10 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 active:scale-95 transition-transform flex items-center justify-center cursor-pointer"
                title="Rehacer"
                aria-label="Rehacer cambio de comisión"
              >
                <Redo2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setMobileActionsOpen(true)}
                className="w-10 h-10 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white text-xs active:scale-95 transition-transform flex items-center justify-center cursor-pointer relative"
                title="Más opciones"
                aria-label="Más opciones"
              >
                <MoreHorizontal className="w-4 h-4" />
                {scheduleDrafts.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500" />
                )}
              </button>
            </div>
          </div>

          {/* Sticky Conflict Alert Banner on Mobile */}
          {conflicts.length > 0 && (
            <div
              onClick={() => setMobileTab('grilla')}
              className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200 flex items-center justify-between gap-2 shadow-md cursor-pointer active:scale-98 transition-all shrink-0"
            >
              <div className="flex items-center gap-2 min-w-0 font-bold text-rose-300">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="truncate">
                  ⚠️ {conflicts.length} {conflicts.length === 1 ? 'choque detectado' : 'choques detectados'}
                </span>
              </div>
              <span className="text-[11px] font-bold text-rose-300 underline decoration-rose-400/50 shrink-0 flex items-center gap-1">
                <span>Ver en grilla</span>
                <span>➔</span>
              </span>
            </div>
          )}

          {/* Segmented Mode Switcher on Mobile: Comisiones / Mi Semana */}
          <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold shrink-0">
            <button
              type="button"
              onClick={() => setMobileTab('comisiones')}
              className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all min-h-[40px] cursor-pointer ${
                mobileTab === 'comisiones'
                  ? 'bg-indigo-600 text-white shadow-md font-black'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Comisiones</span>
              {selectedCount > 0 && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  mobileTab === 'comisiones' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'
                }`}>
                  {selectedCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setMobileTab('grilla')}
              className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all min-h-[40px] cursor-pointer ${
                mobileTab === 'grilla'
                  ? 'bg-indigo-600 text-white shadow-md font-black'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Mi Horario</span>
              {conflicts.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              )}
            </button>
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
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden h-full pb-[calc(var(--mobile-nav-height,4rem)+var(--schedule-bar-height,4.5rem)+env(safe-area-inset-bottom,0px))]">
          {mobileTab === 'comisiones' && (
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
                  setMobileTab('grilla');
                }}
                resolveProfessorRating={getRatingForProfessor}
                onOpenProfessorDetail={setDetailProfessorId}
                isMobileView={true}
              />
            </div>
          )}

          {mobileTab === 'grilla' && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <ScheduleWeeklyGrid
                selections={selectedCommissionsMap}
                onRemoveCommission={handleRemoveCommissionWithHistory}
                hoveredCommission={hoveredCommission}
                conflicts={conflicts}
                subjectNamesMap={subjectNamesMap}
                focusedConflictId={focusedConflictId}
                focusedSubjectId={focusedSubjectId}
                onFocusSubject={(sId) => setFocusedSubjectId(sId)}
                onSwitchToCommissions={() => setMobileTab('comisiones')}
              />
            </div>
          )}
        </div>
      )}

      {/* Persistent Floating Summary Bar on mobile (< lg) */}
      {!isDesktop && (
        <div
          role="region"
          aria-label="Resumen rápido de horarios"
          className="fixed bottom-[calc(var(--mobile-nav-height,56px)+env(safe-area-inset-bottom,0px)+0.5rem)] left-2 right-2 sm:left-4 sm:right-4 max-w-lg mx-auto z-[var(--z-planner-bar,35)] bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-md rounded-2xl p-2 px-3 flex items-center justify-between gap-2"
        >
          <button
            type="button"
            onClick={() => setSummaryDrawerOpen(true)}
            className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer hover:opacity-90 transition-opacity"
            title="Ver resumen y estadísticas completas"
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-white truncate min-w-0">
              <span className="flex items-center gap-1 shrink-0">
                <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>{selectedCount} <span className="hidden xs:inline">mat.</span></span>
              </span>
              <span className="text-slate-500 shrink-0">•</span>
              <span className="text-slate-300 font-mono text-[11px] shrink-0">{totalHours} hs</span>
              {conflicts.length > 0 ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-300 bg-rose-500/20 px-1.5 py-0.5 rounded-full border border-rose-500/40 shrink-0">
                  ⚠️ {conflicts.length}
                </span>
              ) : selectedCount > 0 ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full border border-emerald-500/20 shrink-0">
                  ✓
                </span>
              ) : null}
            </div>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setMobileProposalsOpen(true)}
              className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-indigo-300 text-xs font-bold border border-slate-700 flex items-center gap-1 cursor-pointer min-h-[38px] shrink-0"
              title="Ver mis propuestas guardadas"
            >
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              <span>Planes</span>
              {scheduleDrafts.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/30 text-indigo-200 font-mono">
                  {scheduleDrafts.length}
                </span>
              )}
            </button>

            {mobileTab === 'comisiones' ? (
              <button
                type="button"
                onClick={() => setMobileTab('grilla')}
                className="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold shadow-md transition-all flex items-center gap-1 cursor-pointer min-h-[38px] shrink-0"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Grilla</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSummaryDrawerOpen(true)}
                className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-bold border border-slate-700 transition-all flex items-center gap-1 cursor-pointer min-h-[38px] shrink-0"
              >
                <PieChart className="w-3.5 h-3.5 text-indigo-400" />
                <span>Resumen</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Proposals BottomSheet on mobile */}
      <BottomSheet
        isOpen={mobileProposalsOpen}
        onClose={() => setMobileProposalsOpen(false)}
        title="Mis Propuestas de Horarios"
        maxHeightDvh={85}
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Guardá diferentes alternativas de cursada (ej. Plan A, Plan B) y cambialas con un solo toque.
          </p>

          <div className="space-y-2 max-h-[50dvh] overflow-y-auto">
            {scheduleDrafts.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-500">
                Aún no guardaste ninguna propuesta. Podés guardar tu selección actual con el botón de abajo.
              </div>
            ) : (
              scheduleDrafts.map((draft) => {
                const isEditing = editingDraftId === draft.id;
                return (
                  <div
                    key={draft.id}
                    className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-2 shadow-sm"
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="text"
                          value={draftNameInput}
                          onChange={(e) => setDraftNameInput(e.target.value)}
                          className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none flex-1 font-bold min-h-[38px]"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              renameDraft(draft.id, draftNameInput);
                              setEditingDraftId(null);
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            renameDraft(draft.id, draftNameInput);
                            setEditingDraftId(null);
                          }}
                          className="p-2 rounded-lg bg-emerald-600 text-white min-h-[38px] min-w-[38px] flex items-center justify-center cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Calendar className="w-4 h-4 text-indigo-400 shrink-0" />
                        <div className="min-w-0">
                          <span className="font-bold text-white text-xs block truncate">{draft.name}</span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {Object.keys(draft.selections).length} materias
                          </span>
                        </div>
                      </div>
                    )}

                    {!isEditing && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            loadDraft(draft.id);
                            setMobileProposalsOpen(false);
                          }}
                          className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold min-h-[44px] flex items-center justify-center cursor-pointer active:scale-95 shadow-sm"
                        >
                          Cargar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDraftId(draft.id);
                            setDraftNameInput(draft.name);
                          }}
                          className="p-2 text-slate-400 hover:text-white rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                          title="Renombrar propuesta"
                          aria-label="Renombrar propuesta"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => duplicateDraft(draft.id)}
                          className="p-2 text-slate-400 hover:text-white rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                          title="Duplicar propuesta"
                          aria-label="Duplicar propuesta"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteDraft(draft.id)}
                          className="p-2 text-slate-400 hover:text-rose-400 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                          title="Eliminar propuesta"
                          aria-label="Eliminar propuesta"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setMobileProposalsOpen(false);
              const name = prompt(
                'Nombre para esta propuesta (ej. Plan B):',
                `Plan ${String.fromCharCode(65 + scheduleDrafts.length)}`
              );
              if (name) saveDraft(name, scheduleTerm);
            }}
            className="w-full py-3 px-4 rounded-xl border border-dashed border-indigo-500/50 text-indigo-300 hover:bg-indigo-500/10 text-xs font-bold flex items-center justify-center gap-2 min-h-[44px] cursor-pointer active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Guardar selección actual como propuesta</span>
          </button>
        </div>
      </BottomSheet>

      {/* Actions BottomSheet on mobile */}
      <BottomSheet
        isOpen={mobileActionsOpen}
        onClose={() => setMobileActionsOpen(false)}
        title="Más Opciones de Horarios"
        maxHeightDvh={65}
      >
        <div className="space-y-2 py-1">
          <button
            type="button"
            onClick={() => {
              setMobileActionsOpen(false);
              setMobileProposalsOpen(true);
            }}
            className="w-full text-left p-3 rounded-xl hover:bg-slate-800 bg-slate-950/60 border border-slate-800 text-xs text-white font-semibold flex items-center justify-between min-h-[48px] cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-indigo-400" />
              <div>
                <span className="block font-bold">Mis Propuestas / Planes</span>
                <span className="text-[10px] text-slate-400">Alternativas guardadas (Plan A, Plan B)</span>
              </div>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300">
              {scheduleDrafts.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMobileActionsOpen(false);
              setSummaryDrawerOpen(true);
            }}
            className="w-full text-left p-3 rounded-xl hover:bg-slate-800 bg-slate-950/60 border border-slate-800 text-xs text-white font-semibold flex items-center justify-between min-h-[48px] cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <PieChart className="w-4 h-4 text-indigo-400" />
              <div>
                <span className="block font-bold">Resumen y Estadísticas</span>
                <span className="text-[10px] text-slate-400">Detalle de cursada, carga horaria y choques</span>
              </div>
            </div>
            {conflicts.length > 0 && (
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40">
                ⚠️ {conflicts.length}
              </span>
            )}
          </button>
          {semesterBasket.length > 0 && (
            <button
              type="button"
              onClick={() => {
                handleLoadFromBasket();
                setMobileActionsOpen(false);
              }}
              className="w-full text-left p-3 rounded-xl hover:bg-slate-800 bg-slate-950/60 border border-slate-800 text-xs text-cyan-300 font-semibold flex items-center gap-3 min-h-[48px] cursor-pointer"
            >
              <Layers className="w-4 h-4 text-cyan-400" />
              <span>Cargar materias de la canasta ({semesterBasket.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setImportModalOpen(true);
              setMobileActionsOpen(false);
            }}
            className="w-full text-left p-3 rounded-xl hover:bg-slate-800 bg-slate-950/60 border border-slate-800 text-xs text-slate-200 font-semibold flex items-center gap-3 min-h-[48px] cursor-pointer"
          >
            <Upload className="w-4 h-4 text-indigo-400" />
            <span>Importar oferta de horarios (.JSON)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              handleClearWithHistory();
              setMobileActionsOpen(false);
            }}
            disabled={selectedCount === 0}
            className="w-full text-left p-3 rounded-xl hover:bg-rose-950/40 bg-slate-950/60 border border-rose-500/20 text-xs text-rose-400 font-semibold flex items-center gap-3 min-h-[48px] disabled:opacity-40 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Limpiar todas las materias elegidas</span>
          </button>
        </div>
      </BottomSheet>

      {/* Drawer / Modal de Resumen completo para móvil o pantallas intermedias */}
      {isMobile ? (
        <BottomSheet
          isOpen={summaryDrawerOpen}
          onClose={() => setSummaryDrawerOpen(false)}
          title="Resumen y Opciones"
          maxHeightDvh={90}
        >
          <div className="pb-4">
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
                setMobileTab('grilla');
              }}
              resolveProfessorRating={getRatingForProfessor}
            />
          </div>
        </BottomSheet>
      ) : (
        summaryDrawerOpen && (
          <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm">
            <div className="w-full max-w-md max-h-[85dvh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between p-3.5 border-b border-slate-800 bg-slate-950/80 shrink-0">
                <div className="flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-bold text-white">Resumen y Opciones</h3>
                </div>
                <button
                  type="button"
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
        )
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
