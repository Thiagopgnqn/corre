import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  X,
  AlertTriangle,
  Calendar,
  Clock,
  ArrowRight,
  Check,
  CheckCircle2,
} from 'lucide-react';
import type {
  SubjectSchedule,
  Commission,
  Shift,
  CombinationCriteria,
} from '../../types/schedule';
import type { Subject } from '../../types/career';
import { generateScheduleCombinations } from '../../utils/scheduleLogic';

interface ScheduleCombinationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableSubjects: Subject[];
  schedulesMap: Map<number, SubjectSchedule>;
  currentSelections: Record<number, Commission>;
  onApplyCombination: (selections: Record<number, Commission>) => void;
  subjectNamesMap: Map<number, string>;
  term: '1C' | '2C';
}

export const ScheduleCombinationsModal: React.FC<ScheduleCombinationsModalProps> = ({
  isOpen,
  onClose,
  availableSubjects,
  schedulesMap,
  currentSelections,
  onApplyCombination,
  subjectNamesMap,
  term,
}) => {
  // Pool of candidate subjects that have commissions loaded in this term
  const subjectsWithSchedule = useMemo(() => {
    return availableSubjects.filter((s) => {
      const sched = schedulesMap.get(s.id);
      if (!sched || sched.commissions.length === 0) return false;
      const matchesTerm =
        s.modality === 'A' ||
        (term === '1C' && s.modality.includes('1C')) ||
        (term === '2C' && s.modality.includes('2C'));
      return matchesTerm;
    });
  }, [availableSubjects, schedulesMap, term]);

  // Selected subjects to include in the combination
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<number[]>(() => {
    const existing = Object.keys(currentSelections).map(Number);
    if (existing.length > 0) return existing;
    return subjectsWithSchedule.slice(0, 4).map((s) => s.id);
  });

  const [sortBy, setSortBy] = useState<CombinationCriteria['sortBy']>('fewer-days');
  const [preferShift, setPreferShift] = useState<Shift | 'cualquiera'>('cualquiera');

  const toggleSubject = (id: number) => {
    setSelectedSubjectIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const results = useMemo(() => {
    if (!isOpen || selectedSubjectIds.length === 0) {
      return { hasConflictFree: true, combinations: [] };
    }

    return generateScheduleCombinations(
      selectedSubjectIds,
      schedulesMap,
      {
        sortBy,
        preferShift,
      },
      subjectNamesMap
    );
  }, [isOpen, selectedSubjectIds, schedulesMap, sortBy, preferShift, subjectNamesMap]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-600/30">
              <Sparkles className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base sm:text-lg font-black text-white">
                Sugeridor de Combinaciones de Horarios
              </h3>
              <p className="text-xs text-slate-400">
                Elegí qué materias querés cursar y generamos combinaciones óptimas sin choques.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Controls: Subject selector chips + Sort filters */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/40 space-y-3">
          {/* Subjects chips */}
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
              1. Materias que querés cursar ({selectedSubjectIds.length} elegidas):
            </span>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {subjectsWithSchedule.map((s) => {
                const isSelected = selectedSubjectIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleSubject(s.id)}
                    className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 border ${
                      isSelected
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>{s.name}</span>
                    {isSelected && <Check className="w-3 h-3" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sort & Shift preference */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/60 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-semibold">2. Priorizar:</span>
              <div className="inline-flex rounded-xl bg-slate-900 p-0.5 border border-slate-800 font-semibold">
                <button
                  onClick={() => setSortBy('fewer-days')}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    sortBy === 'fewer-days' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Menos días
                </button>
                <button
                  onClick={() => setSortBy('fewer-gaps')}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    sortBy === 'fewer-gaps' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Menos huecos
                </button>
                <button
                  onClick={() => setSortBy('preferred-shift')}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    sortBy === 'preferred-shift' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Preferencia de turno
                </button>
              </div>
            </div>

            {sortBy === 'preferred-shift' && (
              <div className="flex items-center gap-2">
                <span className="text-slate-400 font-semibold">Turno preferido:</span>
                <select
                  value={preferShift}
                  onChange={(e) => setPreferShift(e.target.value as Shift | 'cualquiera')}
                  className="bg-slate-900 border border-slate-800 text-xs text-white rounded-xl px-2.5 py-1 focus:outline-none"
                >
                  <option value="cualquiera">Cualquiera</option>
                  <option value="mañana">Mañana</option>
                  <option value="tarde">Tarde</option>
                  <option value="noche">Noche</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Modal Results List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {selectedSubjectIds.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              Seleccioná al menos una materia arriba para generar combinaciones.
            </div>
          ) : results.combinations.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No se encontraron combinaciones posibles para las materias seleccionadas.
            </div>
          ) : (
            <>
              {/* Notice if no conflict-free combination exists */}
              {!results.hasConflictFree && (
                <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                  <div>
                    <span className="font-bold block">
                      No existe ninguna combinación 100% libre de choques para estas materias.
                    </span>
                    <span className="text-rose-200/80 text-[11px]">
                      A continuación te presentamos las combinaciones con la menor cantidad de choques posibles para que evalúes alternativas.
                    </span>
                  </div>
                </div>
              )}

              {/* Suggestions Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {results.combinations.map((combo, idx) => {
                  const commList = Object.entries(combo.selections);
                  return (
                    <div
                      key={combo.id}
                      className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                        combo.conflictCount === 0
                          ? 'bg-slate-950/60 border-slate-800 hover:border-indigo-500/60 shadow-lg'
                          : 'bg-rose-950/20 border-rose-500/30 hover:border-rose-500/50'
                      }`}
                    >
                      <div className="space-y-2">
                        {/* Title & Badges */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-black text-white">
                            Opción #{idx + 1}
                          </span>

                          <div className="flex items-center gap-1.5">
                            {combo.conflictCount === 0 ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Sin choques</span>
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/20 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                <span>{combo.conflictCount} choque{combo.conflictCount > 1 ? 's' : ''}</span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Metrics: Days, Gaps, Time range */}
                        <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
                          <span className="flex items-center gap-1 text-slate-300">
                            <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                            <span>{combo.distinctDaysCount} días</span>
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1 text-slate-300">
                            <Clock className="w-3.5 h-3.5 text-indigo-400" />
                            <span>{combo.totalGapMinutes > 0 ? `${combo.totalGapMinutes} min hueco` : 'Sin huecos'}</span>
                          </span>
                        </div>

                        {/* Commissions list */}
                        <div className="space-y-1 pt-1 border-t border-slate-800/80">
                          {commList.map(([sIdStr, comm]) => {
                            const sId = Number(sIdStr);
                            const name = subjectNamesMap.get(sId) || `Materia #${sId}`;
                            return (
                              <div
                                key={sId}
                                className="flex items-center justify-between text-[11px] bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800/60"
                              >
                                <span className="font-semibold text-white truncate pr-2">{name}</span>
                                <span className="font-mono text-indigo-300 shrink-0 font-bold px-1.5 py-0.5 rounded bg-indigo-950/60 border border-indigo-500/20">
                                  {comm.code}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Action button: Apply combination */}
                      <button
                        onClick={() => {
                          onApplyCombination(combo.selections);
                          onClose();
                        }}
                        className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 transition-all flex items-center justify-center gap-1.5 mt-2"
                      >
                        <span>Cargar en mi grilla</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
