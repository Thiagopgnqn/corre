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
  Layers,
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
import { libraryApi } from '../../api/library.api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { BottomSheet } from '../common/BottomSheet';

type DrawerMobileTab = 'info' | 'correlativas' | 'cursadas' | 'historial' | 'biblioteca';

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
    getSubjectExamAttempts,
    saveExamAttempt,
    deleteExamAttempt,
  } = useCareer();

  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<DrawerMobileTab>('info');
  const [deletingEnrollmentId, setDeletingEnrollmentId] = useState<string | null>(null);
  const [libraryCounts, setLibraryCounts] = useState<Record<string, number>>({});
  const [isAddingAttempt, setIsAddingAttempt] = useState(false);
  const [attemptDate, setAttemptDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [attemptGrade, setAttemptGrade] = useState(2);
  const [attemptNotes, setAttemptNotes] = useState('');
  const [isSavingAttempt, setIsSavingAttempt] = useState(false);
  const [deletingAttemptId, setDeletingAttemptId] = useState<string | null>(null);

  React.useEffect(() => {
    setIsAddingAttempt(false);
    setAttemptNotes('');
    setMobileTab('info');
  }, [selectedSubject?.id]);

  React.useEffect(() => {
    libraryApi
      .getSubjectsSummary()
      .then((res) => {
        if (res.success && res.data) {
          const map: Record<string, number> = {};
          res.data.forEach((item: any) => {
            if (item.codeInPlan) map[String(item.codeInPlan)] = item.approvedFilesCount || 0;
            if (item.id) map[item.id] = item.approvedFilesCount || 0;
          });
          setLibraryCounts(map);
        }
      })
      .catch(() => {});
  }, []);

  if (!selectedSubject) return null;

  const status = getSubjectStatus(selectedSubject, activeState);
  const grade = activeState[selectedSubject.id]?.grade;
  const unlocked = getUnlockedBySubject(selectedSubject.id);
  const isInBasket = semesterBasket.includes(selectedSubject.id);
  const subjectEnrollments = getSubjectEnrollments(selectedSubject.id);
  const subjectExamAttempts = selectedSubject ? getSubjectExamAttempts(selectedSubject.id) : [];

  const handleSaveAttempt = async () => {
    if (!selectedSubject) return;
    setIsSavingAttempt(true);
    try {
      await saveExamAttempt(selectedSubject.id, {
        date: attemptDate,
        grade: attemptGrade,
        notes: attemptNotes.trim() ? attemptNotes.trim() : undefined,
      });
      setIsAddingAttempt(false);
      setAttemptNotes('');
    } catch (err: any) {
      alert(err?.message || 'Error al guardar el examen');
    } finally {
      setIsSavingAttempt(false);
    }
  };

  const handleDeleteAttempt = async (id: string) => {
    setDeletingAttemptId(id);
    try {
      await deleteExamAttempt(id);
    } catch (err: any) {
      alert(err?.message || 'Error al eliminar el examen');
    } finally {
      setDeletingAttemptId(null);
    }
  };

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

  // ==========================================
  // FRAGMENTOS MODULARES REUTILIZABLES
  // ==========================================

  // Estado y acción de cambio
  const renderStatusSection = () => (
    <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">
        <span className="text-xs text-slate-400 block">Estado actual:</span>
        <StatusBadge status={status} grade={grade} size="md" />
      </div>

      <button
        data-tour="drawer-status-btn"
        onClick={() => setStatusModalSubjectId(selectedSubject.id)}
        className="min-h-[44px] px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95"
      >
        <Sparkles className="w-4 h-4 shrink-0" />
        <span>Cambiar estado</span>
      </button>
    </div>
  );

  // Sección Mi cursada
  const renderEnrollmentsSection = () => (
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
          className="min-h-[44px] px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/35 text-indigo-300 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer active:scale-95"
        >
          <Plus className="w-3.5 h-3.5" />
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

                    {enr.status && (
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize ${
                          enr.status === 'libre'
                            ? 'bg-rose-950/70 text-rose-300 border-rose-500/40'
                            : enr.status === 'promocionada'
                            ? 'bg-purple-950/70 text-purple-300 border-purple-500/40'
                            : enr.status === 'regularizada'
                            ? 'bg-amber-950/70 text-amber-300 border-amber-500/40'
                            : 'bg-cyan-950/70 text-cyan-300 border-cyan-500/40'
                        }`}
                      >
                        {enr.status === 'libre' ? 'Libre' : enr.status}
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
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={deletingEnrollmentId === enr.id}
                    onClick={() => handleDeleteEnrollment(enr.id)}
                    title="Eliminar cursada"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-rose-950/30 hover:bg-rose-950/60 text-rose-300 border border-rose-500/25 disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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
  );

  // Historial de Finales y Aplazos
  const renderExamAttemptsSection = () => (
    <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-800 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
            Finales y Aplazos ({subjectExamAttempts.length})
          </span>
        </div>
        {!isAddingAttempt && (
          <button
            type="button"
            onClick={() => setIsAddingAttempt(true)}
            className="min-h-[44px] px-2.5 py-1 text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Registrar final</span>
          </button>
        )}
      </div>

      {isAddingAttempt && (
        <div className="p-3.5 rounded-xl bg-slate-900 border border-indigo-500/30 space-y-3">
          <div className="text-xs font-bold text-indigo-300">
            Nuevo intento de examen final
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Fecha</label>
              <input
                type="date"
                value={attemptDate}
                onChange={(e) => setAttemptDate(e.target.value)}
                className="w-full min-h-[44px] bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Nota (1 - 10)</label>
              <select
                value={attemptGrade}
                onChange={(e) => setAttemptGrade(Number(e.target.value))}
                className="w-full min-h-[44px] bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} {n < settings.minPassingGrade ? '(Aplazo)' : '(Aprobado)'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Comentarios / Observaciones (opcional)</label>
            <input
              type="text"
              placeholder="Ej. Mesa de diciembre, libre por falta de tp..."
              value={attemptNotes}
              onChange={(e) => setAttemptNotes(e.target.value)}
              className="w-full min-h-[44px] bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsAddingAttempt(false)}
              className="min-h-[44px] px-3.5 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isSavingAttempt}
              onClick={handleSaveAttempt}
              className="min-h-[44px] px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs cursor-pointer disabled:opacity-50"
            >
              {isSavingAttempt ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      {subjectExamAttempts.length === 0 && !isAddingAttempt ? (
        <div className="text-[11px] text-slate-400 italic">
          No hay intentos de examen final o aplazos registrados para esta materia.
        </div>
      ) : (
        <div className="space-y-1.5">
          {subjectExamAttempts.map((att) => {
            const isPassed = att.grade >= settings.minPassingGrade;
            return (
              <div
                key={att.id}
                className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        isPassed
                          ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40'
                          : 'bg-rose-950/70 text-rose-300 border-rose-500/40'
                      }`}
                    >
                      {isPassed ? 'Aprobado' : 'Aplazo'}
                    </span>
                    <span className="font-extrabold text-white">Nota: {att.grade}</span>
                    <span className="text-[11px] text-slate-400">{att.date}</span>
                  </div>
                  {att.notes && (
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                      {att.notes}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={deletingAttemptId === att.id}
                  onClick={() => handleDeleteAttempt(att.id)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
                  title="Eliminar intento"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // Carga semanal y basket
  const renderStatsAndBasketSection = () => (
    <div className="space-y-3">
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

      <button
        type="button"
        onClick={() => toggleBasketSubject(selectedSubject.id)}
        className={`w-full min-h-[48px] p-3 rounded-xl border font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98 ${
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
    </div>
  );

  // Link a la biblioteca
  const renderLibraryLinkSection = () => (
    <button
      type="button"
      onClick={() => {
        setSelectedSubjectId(null);
        if (typeof window !== 'undefined') {
          window.location.hash = `library/${selectedSubject.id}`;
        }
      }}
      className="w-full min-h-[48px] p-3.5 rounded-xl border border-indigo-500/30 bg-indigo-950/40 hover:bg-indigo-900/50 text-indigo-200 hover:text-white font-semibold text-xs transition-all flex items-center justify-between cursor-pointer group shadow-sm active:scale-98"
    >
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-amber-400 shrink-0" />
        <span>
          Material de estudio ({libraryCounts[String(selectedSubject.id)] || 0})
        </span>
      </div>
      <span className="text-[11px] text-indigo-400 group-hover:text-indigo-200 flex items-center gap-1 font-medium">
        Ver exámenes y apuntes
        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
      </span>
    </button>
  );

  // Regla especial
  const renderSpecialRuleSection = () => {
    if (!selectedSubject.specialRule) return null;
    return (
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
    );
  };

  // Requisitos correlativos
  const renderPrereqsSection = () => (
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
  );

  // Qué desbloquea
  const renderUnlocksSection = () => (
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
  );

  // ==========================================
  // RENDER MOBILE: BottomSheet con Pestañas
  // ==========================================
  if (isMobile) {
    const mobileTabs: Array<{
      id: DrawerMobileTab;
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      badge?: number;
    }> = [
      { id: 'info', label: 'General', icon: BookOpen },
      { id: 'correlativas', label: 'Correlativas', icon: Layers },
      { id: 'cursadas', label: 'Mi Cursada', icon: Users, badge: subjectEnrollments.length },
      { id: 'historial', label: 'Finales', icon: Clock, badge: subjectExamAttempts.length },
      {
        id: 'biblioteca',
        label: 'Material',
        icon: Sparkles,
        badge: libraryCounts[String(selectedSubject.id)],
      },
    ];

    return (
      <BottomSheet
        isOpen={Boolean(selectedSubject)}
        onClose={() => setSelectedSubjectId(null)}
        title={selectedSubject.name}
        subtitle={`#${selectedSubject.code} · Nivel ${selectedSubject.level} · ${
          selectedSubject.modality === 'A' ? 'Anual' : 'Cuatrimestral'
        }`}
        maxHeightDvh={92}
      >
        <div className="space-y-4 py-1">
          {/* Segmented Horizontal Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 border-b border-slate-800/80 -mx-1 px-1">
            {mobileTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = mobileTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMobileTab(tab.id)}
                  className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md font-bold'
                      : 'bg-slate-800/60 text-slate-300 hover:text-white border border-slate-700/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-indigo-950/80 text-indigo-300 border border-indigo-400/30'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab content area */}
          <div className="space-y-4 pt-1 pb-6">
            {mobileTab === 'info' && (
              <>
                {renderStatusSection()}
                {renderStatsAndBasketSection()}
                {renderLibraryLinkSection()}
                {renderSpecialRuleSection()}
              </>
            )}

            {mobileTab === 'correlativas' && (
              <>
                {renderPrereqsSection()}
                {renderUnlocksSection()}
                {renderSpecialRuleSection()}
              </>
            )}

            {mobileTab === 'cursadas' && renderEnrollmentsSection()}

            {mobileTab === 'historial' && renderExamAttemptsSection()}

            {mobileTab === 'biblioteca' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-300 leading-relaxed">
                  Accedé a la biblioteca colaborativa de {selectedSubject.name} para descargar parciales, finales resueltos y apuntes organizados por materia.
                </p>
                {renderLibraryLinkSection()}
              </div>
            )}
          </div>
        </div>
      </BottomSheet>
    );
  }

  // ==========================================
  // RENDER DESKTOP: Panel lateral tradicional
  // ==========================================
  return (
    <AnimatePresence>
      {/* Desktop Backdrop Overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => setSelectedSubjectId(null)}
        className="fixed inset-0 z-[var(--z-backdrop)] bg-black/60 backdrop-blur-xs sm:bg-black/30"
      />

      <div className="fixed inset-y-0 right-0 z-[var(--z-sheet)] w-full sm:w-[440px] pointer-events-none flex justify-end">
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
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
              title="Cerrar panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Body - continuous scroll */}
          <div className="p-4 sm:p-5 overflow-y-auto space-y-5 flex-1 text-sm pb-24 sm:pb-6">
            {renderStatusSection()}
            {renderEnrollmentsSection()}
            {renderExamAttemptsSection()}
            {renderStatsAndBasketSection()}
            {renderLibraryLinkSection()}
            {renderSpecialRuleSection()}
            {renderPrereqsSection()}
            {renderUnlocksSection()}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
