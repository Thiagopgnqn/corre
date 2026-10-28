import React, { useState, useMemo, useCallback } from 'react';
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
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
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

  // Modals state
  const [combinationsModalOpen, setCombinationsModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [focusedConflictId, setFocusedConflictId] = useState<string | null>(null);

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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Top Banner & Control Toolbar */}
      <div className="bg-slate-900/70 border border-slate-800 p-4 sm:p-5 rounded-2xl backdrop-blur-md shadow-xl space-y-4">
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
                Elegí tus comisiones, previsualizá la semana y detectá superposiciones en tiempo real.
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

      {/* Main 3-Column Layout: Left Subjects Panel, Center Timetable Grid, Right Summary Panel */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Left Subjects & Commissions Accordion Panel */}
        <ScheduleLeftPanel
          term={scheduleTerm}
          availableSubjects={availableSubjects}
          allSubjects={allSubjects}
          schedulesMap={schedulesMap}
          selections={selectedCommissionsMap}
          onSelectCommission={handleSelectCommissionWithHistory}
          onHoverCommission={setHoveredCommission}
          subjectNamesMap={subjectNamesMap}
        />

        {/* Center Timetable Weekly Calendar Grid */}
        <ScheduleWeeklyGrid
          selections={selectedCommissionsMap}
          onRemoveCommission={handleRemoveCommissionWithHistory}
          hoveredCommission={hoveredCommission}
          conflicts={conflicts}
          subjectNamesMap={subjectNamesMap}
          focusedConflictId={focusedConflictId}
        />

        {/* Right Summary & Actions Panel */}
        <ScheduleSummaryPanel
          selections={selectedCommissionsMap}
          conflicts={conflicts}
          subjectNamesMap={subjectNamesMap}
          onOpenCombinationsModal={() => setCombinationsModalOpen(true)}
          onApplyToEnrolled={applyScheduleToEnrolled}
          onClearAll={handleClearWithHistory}
          onSelectConflict={setFocusedConflictId}
        />
      </div>

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
    </div>
  );
};
