import React, { useState } from 'react';
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
  Edit2,
  Lock,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import {
  getSubjectStatus,
  getUnlockedBySubject,
  ALL_SUBJECTS_MAP,
  isApprovedOrHigher,
  isRegularOrHigher,
  canRenderProyectoFinal,
} from '../../utils/correlativas';
import { formatEnrollmentPeriodLabel } from '../../utils/enrollmentLogic';
import { StatusBadge } from '../common/StatusBadge';

export const SubjectDrawer: React.FC = () => {
  const {
    selectedSubject,
    setSelectedSubjectId,
    activeState,
    setStatusModalSubjectId,
    semesterBasket,
    toggleBasketSubject,
    settings,
    getSubjectEnrollments,
    openEnrollmentModal,
    deleteSubjectEnrollment,
  } = useCareer();

  const [deletingEnrollmentId, setDeletingEnrollmentId] = useState<string | null>(null);

  if (!selectedSubject) return null;

  const status = getSubjectStatus(selectedSubject, activeState);
  const grade = activeState[selectedSubject.id]?.grade;
  const unlocked = getUnlockedBySubject(selectedSubject.id);

  const isInBasket = semesterBasket.includes(selectedSubject.id);
  const subjectEnrollments = getSubjectEnrollments(selectedSubject.id);

  const handleDeleteEnrollment = async (enrollmentId: string) => {
    setDeletingEnrollmentId(enrollmentId);
    try {
      await deleteSubjectEnrollment(enrollmentId);
    } catch (err: any) {
      alert(err?.message || 'No se pudo eliminar la cursada.');
    } finally {
      setDeletingEnrollmentId(null);
    }
  };

  return (
    <AnimatePresence>
      {/* Mobile/Desktop Backdrop Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => setSelectedSubjectId(null)}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs sm:bg-black/30"
      />

      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] pointer-events-none flex justify-end">
        <motion.div
          initial={{ x: '100%', opacity: 0.5 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="pointer-events-auto h-full w-full bg-slate-900/95 backdrop-blur-xl border-l border-slate-800 shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/70 flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 shrink-0">
                  #{selectedSubject.code}
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
                  Nivel {selectedSubject.level}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                  {selectedSubject.modality}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white leading-snug break-words">
                {selectedSubject.name}
              </h2>
            </div>

            <button
              onClick={() => setSelectedSubjectId(null)}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
              title="Cerrar panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="p-4 sm:p-5 overflow-y-auto space-y-5 flex-1 text-sm pb-24 sm:pb-6">
            {/* Status & Change Action */}
            <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <span className="text-xs text-slate-400 block">Estado actual:</span>
                <StatusBadge status={status} grade={grade} size="md" />
              </div>

              <button
                data-tour="drawer-status-btn"
                onClick={() => setStatusModalSubjectId(selectedSubject.id)}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Cambiar</span>
              </button>
            </div>

            {/* Sección "Mi cursada" (comisión, período, docentes y recursadas) */}
            <div
              data-tour="drawer-enrollment-section"
              className="p-4 rounded-xl bg-slate-950/55 border border-slate-800 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-indigo-400 shrink-0" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    Mi cursada
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    openEnrollmentModal(selectedSubject.id, {
                      targetStatus: status,
                      editingEnrollment: null,
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/35 text-indigo-300 text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>
                    {subjectEnrollments.length > 0 ? 'Agregar cursada' : 'Indicar comisión'}
                  </span>
                </button>
              </div>

              {subjectEnrollments.length === 0 ? (
                <p className="text-xs text-slate-400 leading-relaxed">
                  Todavía no registraste con qué comisión o docentes cursaste esta materia.
                  Podés agregarlo cuando quieras para recibir recomendaciones de reseñas.
                </p>
              ) : (
                <div className="space-y-2">
                  {subjectEnrollments.map((enr) => (
                    <div
                      key={enr.id}
                      className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {enr.commissionCode ? (
                              <span className="font-mono text-xs font-black px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                                Comisión {enr.commissionCode}
                              </span>
                            ) : (
                              <span className="text-xs font-bold text-slate-300">
                                Cursada manual
                              </span>
                            )}
                            {enr.turno && (
                              <span className="text-[10px] capitalize px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                                {enr.turno}
                              </span>
                            )}
                            {enr.source === 'schedule_builder' && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                                Horarios
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {formatEnrollmentPeriodLabel(enr.academicYear, enr.term)}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              openEnrollmentModal(selectedSubject.id, {
                                targetStatus: status,
                                editingEnrollment: enr,
                              })
                            }
                            title="Editar cursada"
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={deletingEnrollmentId === enr.id}
                            onClick={() => handleDeleteEnrollment(enr.id)}
                            title="Eliminar cursada"
                            className="p-1.5 rounded-lg bg-rose-950/30 hover:bg-rose-950/60 text-rose-300 border border-rose-500/25 disabled:opacity-40 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {enr.professors.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {enr.professors.map((prof) => (
                            <span
                              key={prof.professorId}
                              className="text-[11px] font-medium px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200"
                            >
                              {prof.displayName}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] italic text-slate-500">
                          Sin docentes especificados
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick stats info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
                <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Carga semanal</span>
                </div>
                <div className="text-base sm:text-lg font-bold text-white">
                  {selectedSubject.weeklyHours} hs/sem
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
                <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Modalidad</span>
                </div>
                <div className="text-base sm:text-lg font-bold text-white">
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
                  <CalendarCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Agregada a mi cuatrimestre (Quitar)</span>
                </>
              ) : (
                <>
                  <CalendarPlus className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span>Agregar a mi cuatrimestre planeado</span>
                </>
              )}
            </button>

            {/* Special rule notice if any */}
            {selectedSubject.specialRule && (
              <div className="p-3.5 rounded-xl bg-purple-950/30 border border-purple-500/30 text-purple-200 text-xs space-y-1.5">
                <div className="font-semibold text-purple-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Regla Especial de Aprobación</span>
                </div>
                <p className="leading-relaxed break-words">
                  {selectedSubject.id === 36 && !settings.includeAnalistaTrack
                    ? 'Para RENDIRLO hay que tener aprobadas todas las materias previas del plan (1 a 35 + Electivas).'
                    : selectedSubject.specialRule}
                </p>
                {selectedSubject.id === 36 && (
                  <div className="pt-1 text-[11px]">
                    {canRenderProyectoFinal(activeState, settings.includeAnalistaTrack).canRender ? (
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>¡Cumplís todas las materias previas para rendir Proyecto Final!</span>
                      </span>
                    ) : (
                      <span className="text-rose-400 font-semibold flex items-center gap-1">
                        <Lock className="w-3.5 h-3.5" />
                        <span>
                          Faltan aprobar {canRenderProyectoFinal(activeState, settings.includeAnalistaTrack).missingIds.length} materias previas
                        </span>
                      </span>
                    )}
                  </div>
                )}
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
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
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
                      <div className="space-y-1.5">
                        {selectedSubject.regularPrereqs.map((reqId) => {
                          const reqSub = ALL_SUBJECTS_MAP.get(reqId);
                          const met = isRegularOrHigher(activeState[reqId]);
                          return (
                            <div
                              key={reqId}
                              className={`flex items-start justify-between text-xs p-2 rounded-lg gap-2 ${
                                met ? 'bg-emerald-950/20 text-emerald-300' : 'bg-rose-950/20 text-rose-300'
                              }`}
                            >
                              <span className="leading-snug break-words flex-1">
                                #{reqSub?.code} {reqSub?.name || `Materia #${reqId}`}
                              </span>
                              {met ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                              ) : (
                                <Lock className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
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
                      <div className="space-y-1.5">
                        {selectedSubject.approvedPrereqs.map((reqId) => {
                          const reqSub = ALL_SUBJECTS_MAP.get(reqId);
                          const met = isApprovedOrHigher(activeState[reqId]);
                          return (
                            <div
                              key={reqId}
                              className={`flex items-start justify-between text-xs p-2 rounded-lg gap-2 ${
                                met ? 'bg-emerald-950/20 text-emerald-300' : 'bg-rose-950/20 text-rose-300'
                              }`}
                            >
                              <span className="leading-snug break-words flex-1">
                                #{reqSub?.code} {reqSub?.name || `Materia #${reqId}`}
                              </span>
                              {met ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                              ) : (
                                <Lock className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
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
                        <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                        <span>Al regularizar esta materia, habilita:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {unlocked.unlocksOnRegularize.map((s) => (
                          <span
                            key={s.id}
                            className="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 text-xs border border-slate-700 leading-normal break-words"
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
                        <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                        <span>Al aprobar esta materia, habilita:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {unlocked.unlocksOnApprove.map((s) => (
                          <span
                            key={s.id}
                            className="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 text-xs border border-slate-700 leading-normal break-words"
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
