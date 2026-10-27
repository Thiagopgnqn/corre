import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Clock,
  BookOpen,
  ArrowRight,
  AlertTriangle,
  Sparkles,
  CalendarPlus,
  CalendarCheck,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import {
  getSubjectStatus,
  getUnlockedBySubject,
  ALL_SUBJECTS_MAP,
  isApprovedOrHigher,
  isRegularOrHigher,
} from '../../utils/correlativas';
import { StatusBadge } from '../common/StatusBadge';

export const SubjectDrawer: React.FC = () => {
  const {
    selectedSubject,
    setSelectedSubjectId,
    activeState,
    setStatusModalSubjectId,
    semesterBasket,
    toggleBasketSubject,
  } = useCareer();

  if (!selectedSubject) return null;

  const status = getSubjectStatus(selectedSubject, activeState);
  const grade = activeState[selectedSubject.id]?.grade;
  const unlocked = getUnlockedBySubject(selectedSubject.id);

  const isInBasket = semesterBasket.includes(selectedSubject.id);

  return (
    <AnimatePresence>
      <div className="fixed inset-y-0 right-0 z-40 w-full sm:w-[420px] pointer-events-none flex justify-end">
        <motion.div
          initial={{ x: '100%', opacity: 0.5 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="pointer-events-auto h-full w-full bg-slate-900/95 backdrop-blur-xl border-l border-slate-800 shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="p-5 border-b border-slate-800 bg-slate-950/70 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  #{selectedSubject.code}
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Nivel {selectedSubject.level}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {selectedSubject.modality}
                </span>
              </div>
              <h2 className="text-lg font-bold text-white leading-tight">
                {selectedSubject.name}
              </h2>
            </div>

            <button
              onClick={() => setSelectedSubjectId(null)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="p-5 overflow-y-auto space-y-6 flex-1 text-sm">
            {/* Status & Change Action */}
            <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 block mb-1">Estado actual:</span>
                <StatusBadge status={status} grade={grade} size="md" />
              </div>

              <button
                onClick={() => setStatusModalSubjectId(selectedSubject.id)}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Cambiar</span>
              </button>
            </div>

            {/* Quick stats info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
                <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Carga semanal</span>
                </div>
                <div className="text-lg font-bold text-white">
                  {selectedSubject.weeklyHours} hs/sem
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
                <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Modalidad</span>
                </div>
                <div className="text-lg font-bold text-white">
                  {selectedSubject.modality === 'A' ? 'Anual' : 'Cuatrimestral'}
                </div>
              </div>
            </div>

            {/* Semester planner basket toggle */}
            <button
              onClick={() => toggleBasketSubject(selectedSubject.id)}
              className={`w-full p-3 rounded-xl border font-semibold text-xs transition-all flex items-center justify-center gap-2 ${
                isInBasket
                  ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {isInBasket ? (
                <>
                  <CalendarCheck className="w-4 h-4 text-emerald-400" />
                  <span>Agregada a mi cuatrimestre planeado (Quitar)</span>
                </>
              ) : (
                <>
                  <CalendarPlus className="w-4 h-4 text-indigo-400" />
                  <span>Agregar a mi cuatrimestre planeado</span>
                </>
              )}
            </button>

            {/* Special rule notice if any */}
            {selectedSubject.specialRule && (
              <div className="p-3.5 rounded-xl bg-purple-950/30 border border-purple-500/30 text-purple-200 text-xs space-y-1">
                <div className="font-semibold text-purple-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Regla Especial</span>
                </div>
                <p className="leading-relaxed">{selectedSubject.specialRule}</p>
              </div>
            )}

            {/* Prerequisites Section */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Requisitos para Cursar
              </h3>

              {selectedSubject.regularPrereqs.length === 0 &&
              selectedSubject.approvedPrereqs.length === 0 ? (
                <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-800 text-xs text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>No tiene materias correlativas previas requeridas.</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Regular Prereqs */}
                  {selectedSubject.regularPrereqs.length > 0 && (
                    <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 space-y-2">
                      <div className="text-xs font-semibold text-amber-300 flex items-center justify-between">
                        <span>Requiere REGULARIZADA (o aprobada):</span>
                        <span className="text-[11px] text-slate-400">
                          {selectedSubject.regularPrereqs.filter((id) =>
                            isRegularOrHigher(activeState[id])
                          ).length}{' '}
                          / {selectedSubject.regularPrereqs.length}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {selectedSubject.regularPrereqs.map((reqId) => {
                          const reqSub = ALL_SUBJECTS_MAP.get(reqId);
                          const met = isRegularOrHigher(activeState[reqId]);
                          return (
                            <div
                              key={reqId}
                              className={`flex items-center justify-between text-xs p-1.5 rounded-lg ${
                                met ? 'bg-emerald-950/20 text-emerald-300' : 'bg-rose-950/20 text-rose-300'
                              }`}
                            >
                              <span className="truncate">
                                #{reqSub?.code} {reqSub?.name || `Materia #${reqId}`}
                              </span>
                              {met ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              ) : (
                                <Lock className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Approved Prereqs */}
                  {selectedSubject.approvedPrereqs.length > 0 && (
                    <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 space-y-2">
                      <div className="text-xs font-semibold text-green-300 flex items-center justify-between">
                        <span>Requiere APROBADA (final o promoción):</span>
                        <span className="text-[11px] text-slate-400">
                          {selectedSubject.approvedPrereqs.filter((id) =>
                            isApprovedOrHigher(activeState[id])
                          ).length}{' '}
                          / {selectedSubject.approvedPrereqs.length}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {selectedSubject.approvedPrereqs.map((reqId) => {
                          const reqSub = ALL_SUBJECTS_MAP.get(reqId);
                          const met = isApprovedOrHigher(activeState[reqId]);
                          return (
                            <div
                              key={reqId}
                              className={`flex items-center justify-between text-xs p-1.5 rounded-lg ${
                                met ? 'bg-emerald-950/20 text-emerald-300' : 'bg-rose-950/20 text-rose-300'
                              }`}
                            >
                              <span className="truncate">
                                #{reqSub?.code} {reqSub?.name || `Materia #${reqId}`}
                              </span>
                              {met ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              ) : (
                                <Lock className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* What this unlocks section */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Qué Desbloquea
              </h3>

              {unlocked.totalCount === 0 ? (
                <p className="text-xs text-slate-500 italic">
                  Esta materia no es correlativa de ninguna otra posterior.
                </p>
              ) : (
                <div className="space-y-2">
                  {unlocked.unlocksOnRegularize.length > 0 && (
                    <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-800 space-y-1.5">
                      <div className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span>Al regularizar esta materia, habilita:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {unlocked.unlocksOnRegularize.map((s) => (
                          <span
                            key={s.id}
                            className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-xs border border-slate-700"
                          >
                            #{s.code} {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {unlocked.unlocksOnApprove.length > 0 && (
                    <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-800 space-y-1.5">
                      <div className="text-xs font-semibold text-green-400 flex items-center gap-1.5">
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span>Al aprobar esta materia, habilita:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {unlocked.unlocksOnApprove.map((s) => (
                          <span
                            key={s.id}
                            className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-xs border border-slate-700"
                          >
                            #{s.code} {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
