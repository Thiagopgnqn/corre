import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, Sparkles, BookOpen, Layers, Award } from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { CORE_SUBJECTS } from '../../data/plan2023';
import type { SubjectStatus } from '../../types/career';

export const OnboardingModal: React.FC = () => {
  const {
    isOnboardingOpen,
    setIsOnboardingOpen,
    batchUpdateStatus,
    loadSample,
    settings,
  } = useCareer();

  const corePool = settings.includeAnalistaTrack
    ? CORE_SUBJECTS
    : CORE_SUBJECTS.filter((s) => s.id !== 99);

  // Selection state: Map of subjectId -> { selected: boolean, grade: number, status: SubjectStatus }
  const [selections, setSelections] = useState<Record<number, { selected: boolean; grade: number; status: SubjectStatus }>>({});
  const [defaultGradeByLevel, setDefaultGradeByLevel] = useState<Record<number, number>>({
    1: 8,
    2: 8,
    3: 8,
    4: 8,
    5: 8,
  });

  if (!isOnboardingOpen) return null;

  const handleToggleLevel = (level: number, approve: boolean) => {
    const subjectsInLevel = corePool.filter((s) => s.level === level);
    const grade = defaultGradeByLevel[level] || 8;

    setSelections((prev) => {
      const next = { ...prev };
      subjectsInLevel.forEach((s) => {
        if (approve) {
          next[s.id] = { selected: true, grade, status: 'aprobada' };
        } else {
          delete next[s.id];
        }
      });
      return next;
    });
  };

  const handleToggleSingle = (subjectId: number, level: number) => {
    setSelections((prev) => {
      const next = { ...prev };
      if (next[subjectId]?.selected) {
        delete next[subjectId];
      } else {
        const grade = defaultGradeByLevel[level] || 8;
        next[subjectId] = { selected: true, grade, status: 'aprobada' };
      }
      return next;
    });
  };

  const handleGradeChange = (subjectId: number, grade: number) => {
    setSelections((prev) => ({
      ...prev,
      [subjectId]: {
        ...(prev[subjectId] || { selected: true, status: 'aprobada' }),
        grade,
      },
    }));
  };

  const handleApply = () => {
    const updates: Array<{ id: number; status: SubjectStatus; grade?: number }> = [];
    Object.entries(selections).forEach(([idStr, val]) => {
      if (val.selected) {
        updates.push({
          id: Number(idStr),
          status: val.status,
          grade: val.grade,
        });
      }
    });

    if (updates.length > 0) {
      batchUpdateStatus(updates);
    }
    setIsOnboardingOpen(false);
  };

  const levels = [1, 2, 3, 4, 5];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-3xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        >
          {/* Header */}
          <div className="p-5 border-b border-slate-800 bg-slate-950/60 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Carga Rápida Inicial de Materias</h2>
                <p className="text-xs text-slate-400">
                  Seleccioná en lote las materias que ya aprobaste por nivel para configurar tu avance en segundos.
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsOnboardingOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Preset Banner */}
          <div className="px-5 py-3 bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-slate-900 border-b border-indigo-900/40 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-indigo-200 flex items-center gap-2">
              <Award className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>¿Querés probar la app al instante con un historial realista?</span>
            </div>
            <button
              onClick={() => {
                loadSample();
                setIsOnboardingOpen(false);
              }}
              className="px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white text-xs font-semibold border border-indigo-500/40 transition-all shadow-sm"
            >
              Cargar demo: Alumno de 3er año
            </button>
          </div>

          {/* Body Levels */}
          <div className="p-5 overflow-y-auto space-y-5 flex-1">
            {levels.map((lvl) => {
              const subjectsInLevel = corePool.filter((s) => s.level === lvl);
              const allSelected = subjectsInLevel.every((s) => selections[s.id]?.selected);
              const someSelected = subjectsInLevel.some((s) => selections[s.id]?.selected);

              return (
                <div
                  key={lvl}
                  className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden"
                >
                  <div className="p-3.5 bg-slate-800/40 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80">
                    <div className="flex items-center gap-2.5">
                      <Layers className="w-4 h-4 text-indigo-400" />
                      <span className="font-bold text-sm text-white">Nivel {lvl}</span>
                      <span className="text-xs text-slate-400">({subjectsInLevel.length} materias)</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-slate-400">
                        <span>Nota base:</span>
                        <select
                          value={defaultGradeByLevel[lvl]}
                          onChange={(e) => {
                            const g = Number(e.target.value);
                            setDefaultGradeByLevel((prev) => ({ ...prev, [lvl]: g }));
                            // update existing in this level
                            setSelections((prev) => {
                              const next = { ...prev };
                              subjectsInLevel.forEach((s) => {
                                if (next[s.id]) next[s.id].grade = g;
                              });
                              return next;
                            });
                          }}
                          className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-xs focus:outline-none"
                        >
                          {[4, 5, 6, 7, 8, 9, 10].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleLevel(lvl, !allSelected)}
                        className={`px-3 py-1 text-xs rounded-lg font-semibold transition-all flex items-center gap-1 ${
                          allSelected
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : someSelected
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{allSelected ? 'Todo Aprobado' : 'Aprobar Nivel'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {subjectsInLevel.map((subject) => {
                      const isChecked = Boolean(selections[subject.id]?.selected);
                      const currentGrade = selections[subject.id]?.grade || defaultGradeByLevel[lvl] || 8;

                      return (
                        <div
                          key={subject.id}
                          className={`flex items-center justify-between p-2 rounded-lg border text-xs transition-colors ${
                            isChecked
                              ? 'bg-emerald-950/20 border-emerald-500/30 text-white'
                              : 'bg-slate-900/60 border-slate-800/80 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <label className="flex items-center gap-2 cursor-pointer flex-1 pr-2 leading-tight min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleSingle(subject.id, lvl)}
                              className="rounded border-slate-700 text-emerald-500 focus:ring-0 bg-slate-800 shrink-0"
                            />
                            <span className="font-mono text-slate-400 text-[10px] shrink-0">#{subject.code}</span>
                            <span className="break-words">{subject.name}</span>
                          </label>

                          {isChecked && (
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[10px] text-slate-400">Nota:</span>
                              <input
                                type="number"
                                min={1}
                                max={10}
                                value={currentGrade}
                                onChange={(e) => handleGradeChange(subject.id, Number(e.target.value))}
                                className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-center text-xs font-bold text-emerald-400 focus:outline-none"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {Object.values(selections).filter((s) => s.selected).length} materias seleccionadas
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsOnboardingOpen(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={Object.values(selections).filter((s) => s.selected).length === 0}
                className="px-5 py-2 text-sm font-semibold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white shadow-lg shadow-emerald-500/25 transition-all flex items-center gap-2"
              >
                <BookOpen className="w-4 h-4" />
                <span>Aplicar a mi carrera</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
