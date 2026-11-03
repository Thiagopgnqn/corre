import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Lock,
  Sparkles,
  PlayCircle,
  Clock,
  CheckCircle2,
  Award,
  AlertTriangle,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import {
  getSubjectStatus,
  checkEligibility,
  getUnlockedBySubject,
  ALL_SUBJECTS_MAP,
} from '../../utils/correlativas';
import { useIsMobile } from '../../hooks/useIsMobile';
import { BottomSheet } from './BottomSheet';
import type { SubjectStatus } from '../../types/career';

export const QuickStatusModal: React.FC = () => {
  const {
    statusModalSubjectId,
    setStatusModalSubjectId,
    activeState,
    updateSubjectStatus,
    isSimulationMode,
  } = useCareer();

  const isMobile = useIsMobile();
  const [selectedGrade, setSelectedGrade] = useState<number>(8);
  const [targetStatus, setTargetStatus] = useState<SubjectStatus | null>(null);

  const subject = statusModalSubjectId ? ALL_SUBJECTS_MAP.get(statusModalSubjectId) : null;
  const currentSaved = statusModalSubjectId ? activeState[statusModalSubjectId] : undefined;
  const currentStatus = subject ? getSubjectStatus(subject, activeState) : 'bloqueada';

  useEffect(() => {
    if (currentSaved?.grade) {
      setSelectedGrade(currentSaved.grade);
    } else {
      setSelectedGrade(8);
    }
    if (subject) {
      setTargetStatus(currentStatus);
    }
  }, [statusModalSubjectId, currentSaved, currentStatus, subject]);

  if (!statusModalSubjectId || !subject) return null;

  const { eligible, missingRegular, missingApproved } = checkEligibility(subject, activeState);
  const unlocked = getUnlockedBySubject(subject.id);

  // En modo simulación se permite cualquier estado para proyectar escenarios.
  // En modo real, se verifican correlativas para cursando/regularizada/aprobada.
  const isStatusAllowed = (statusToCheck: SubjectStatus): { allowed: boolean; reason?: string } => {
    if (isSimulationMode) return { allowed: true };
    if (statusToCheck === 'disponible' || statusToCheck === 'libre') return { allowed: true };

    if (!eligible) {
      if (missingRegular.length > 0 && (statusToCheck === 'cursando' || statusToCheck === 'regularizada')) {
        return {
          allowed: false,
          reason: `Falta regularizar: ${missingRegular.map((id) => ALL_SUBJECTS_MAP.get(id)?.name || `#${id}`).join(', ')}`,
        };
      }
      if (missingApproved.length > 0 && (statusToCheck === 'aprobada' || statusToCheck === 'promocionada')) {
        return {
          allowed: false,
          reason: `Falta aprobar: ${missingApproved.map((id) => ALL_SUBJECTS_MAP.get(id)?.name || `#${id}`).join(', ')}`,
        };
      }
    }
    return { allowed: true };
  };

  const handleApply = (status: SubjectStatus, grade?: number) => {
    updateSubjectStatus(subject.id, status, grade);
    setStatusModalSubjectId(null);
  };

  const statusOptions: Array<{
    status: SubjectStatus;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    accentColor: string;
    borderActive: string;
    bgActive: string;
    requiresGrade?: boolean;
  }> = [
    {
      status: 'disponible',
      label: 'Pendiente / Sin cursar',
      description: 'Estado inicial, sin cursar aún',
      icon: eligible ? Sparkles : Lock,
      accentColor: 'text-slate-300',
      borderActive: 'border-slate-500',
      bgActive: 'bg-slate-800/80',
    },
    {
      status: 'cursando',
      label: 'Cursando',
      description: 'Cursando este cuatrimestre / año',
      icon: PlayCircle,
      accentColor: 'text-cyan-400',
      borderActive: 'border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]',
      bgActive: 'bg-cyan-950/70',
    },
    {
      status: 'regularizada',
      label: 'Regularizada',
      description: 'Cursada aprobada, final pendiente',
      icon: Clock,
      accentColor: 'text-amber-400',
      borderActive: 'border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.3)]',
      bgActive: 'bg-amber-950/70',
    },
    {
      status: 'aprobada',
      label: 'Aprobada (Final)',
      description: 'Materia rendida con examen final',
      icon: CheckCircle2,
      accentColor: 'text-green-400',
      borderActive: 'border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)]',
      bgActive: 'bg-green-950/70',
      requiresGrade: true,
    },
    {
      status: 'promocionada',
      label: 'Promocionada',
      description: 'Promocionada directamente con nota',
      icon: Award,
      accentColor: 'text-purple-300',
      borderActive: 'border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.35)]',
      bgActive: 'bg-purple-950/70',
      requiresGrade: true,
    },
    {
      status: 'libre',
      label: 'Libre / Recursar',
      description: 'Cursada no aprobada o abandonada',
      icon: AlertTriangle,
      accentColor: 'text-rose-400',
      borderActive: 'border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)]',
      bgActive: 'bg-rose-950/70',
    },
  ];

  // ==========================================
  // RENDER MOBILE: BottomSheet táctil para pulgar
  // ==========================================
  if (isMobile) {
    return (
      <BottomSheet
        isOpen={Boolean(statusModalSubjectId)}
        onClose={() => setStatusModalSubjectId(null)}
        title={subject.name}
        subtitle={`#${subject.code} · Nivel ${subject.level} · ${subject.weeklyHours} hs/sem`}
        maxHeightDvh={90}
      >
        <div className="space-y-4 py-2">
          {/* Alerta de correlativas faltantes si aplica */}
          {!eligible && !isSimulationMode && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Requisitos de correlatividad pendientes</span>
              </div>
              {missingRegular.length > 0 && (
                <p className="text-amber-200/90 pl-5">
                  • Falta regularizar: {missingRegular.map((id) => ALL_SUBJECTS_MAP.get(id)?.name || `#${id}`).join(', ')}
                </p>
              )}
              {missingApproved.length > 0 && (
                <p className="text-amber-200/90 pl-5">
                  • Falta aprobar: {missingApproved.map((id) => ALL_SUBJECTS_MAP.get(id)?.name || `#${id}`).join(', ')}
                </p>
              )}
            </div>
          )}

          {/* Selector de calificación numérica cuando el estado seleccionado requiere nota */}
          {(targetStatus === 'aprobada' || targetStatus === 'promocionada') && (
            <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">Nota final obtenida:</span>
                <span className="text-lg font-bold text-emerald-400 font-mono px-2.5 py-0.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30">
                  {selectedGrade}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[4, 5, 6, 7, 8, 9, 10, 1, 2, 3].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      setSelectedGrade(g);
                      handleApply(targetStatus, g);
                    }}
                    className={`min-h-[44px] rounded-xl font-bold text-sm transition-all flex items-center justify-center cursor-pointer active:scale-95 ${
                      selectedGrade === g
                        ? 'bg-emerald-500 text-slate-950 shadow-md font-extrabold'
                        : g < 4
                        ? 'bg-rose-950/40 text-rose-300 border border-rose-900/50'
                        : 'bg-slate-800 text-slate-200 border border-slate-700/60'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 text-center">
                Tocá una nota para guardar y aplicar de inmediato
              </p>
            </div>
          )}

          {/* Lista de estados táctiles >= 48px */}
          <div className="space-y-1.5">
            {statusOptions.map((opt) => {
              const Icon = opt.icon;
              const isCurrent = currentStatus === opt.status;
              const isSelected = targetStatus === opt.status;
              const check = isStatusAllowed(opt.status);
              const isDisabled = !check.allowed;

              return (
                <div key={opt.status} className="flex flex-col">
                  <button
                    type="button"
                    disabled={isDisabled}
                    onClick={() => {
                      if (opt.requiresGrade) {
                        setTargetStatus(opt.status);
                      } else {
                        handleApply(opt.status);
                      }
                    }}
                    className={`w-full min-h-[50px] p-3 rounded-2xl border text-left transition-all flex items-center justify-between gap-3 cursor-pointer active:scale-98 ${
                      isDisabled
                        ? 'opacity-45 bg-slate-950/40 border-slate-800/60 cursor-not-allowed'
                        : isSelected
                        ? `${opt.bgActive} ${opt.borderActive}`
                        : 'bg-slate-800/50 border-slate-700/60 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${opt.accentColor} bg-slate-900/90 border border-slate-800`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold text-sm ${opt.accentColor}`}>
                            {opt.label}
                          </span>
                          {isCurrent && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-700 text-slate-300 font-medium">
                              Actual
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {opt.description}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {opt.requiresGrade && isSelected ? (
                        <span className="text-xs font-bold text-emerald-400 font-mono">
                          Nota: {selectedGrade}
                        </span>
                      ) : isSelected ? (
                        <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                      ) : null}
                    </div>
                  </button>

                  {/* Razón visible si está deshabilitado por correlativas */}
                  {isDisabled && check.reason && (
                    <span className="text-[11px] text-amber-400/90 pl-3 pt-1">
                      ⚠️ {check.reason}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Acción destructiva: Restablecer / Quitar estado */}
          <div className="pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => handleApply('disponible', undefined)}
              className="w-full min-h-[48px] px-4 py-2.5 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 flex items-center justify-center gap-2 text-xs font-semibold transition-colors cursor-pointer active:scale-95"
            >
              <RotateCcw className="w-4 h-4 text-rose-400" />
              <span>Restablecer materia a Sin Cursar</span>
            </button>
          </div>
        </div>
      </BottomSheet>
    );
  }

  // ==========================================
  // RENDER DESKTOP: Modal centrado tradicional
  // ==========================================
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-2.5 sm:p-4 bg-black/70 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-5 border-b border-slate-800 flex items-start justify-between bg-slate-950/50">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Nivel {subject.level}
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {subject.modality}
                </span>
                <span className="text-xs text-slate-400">
                  {subject.weeklyHours} hs/sem {subject.credits ? `• ${subject.credits} créditos` : ''}
                </span>
                {isSimulationMode && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Modo Simulación
                  </span>
                )}
              </div>
              <h2 className="text-base sm:text-xl font-bold text-white flex flex-wrap items-baseline gap-2 leading-snug">
                <span className="break-words">{subject.name}</span>
                <span className="text-xs sm:text-sm text-slate-500 font-mono shrink-0">#{subject.code}</span>
              </h2>
            </div>
            <button
              onClick={() => setStatusModalSubjectId(null)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-5 space-y-5 overflow-y-auto">
            {/* Missing Prerequisites Warning */}
            {(!eligible || subject.specialRule) && (
              <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-200 text-sm space-y-1">
                <div className="flex items-center gap-2 font-semibold text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Requisitos de correlatividad</span>
                </div>
                {missingRegular.length > 0 && (
                  <p className="text-xs text-amber-200/90 pl-6">
                    • Falta tener regularizadas:{' '}
                    {missingRegular
                      .map((id) => ALL_SUBJECTS_MAP.get(id)?.name || `#${id}`)
                      .join(', ')}
                  </p>
                )}
                {missingApproved.length > 0 && (
                  <p className="text-xs text-amber-200/90 pl-6">
                    • Falta tener aprobadas:{' '}
                    {missingApproved
                      .map((id) => ALL_SUBJECTS_MAP.get(id)?.name || `#${id}`)
                      .join(', ')}
                  </p>
                )}
                {subject.specialRule && (
                  <p className="text-xs text-purple-300 font-medium pl-6">
                    ★ {subject.specialRule}
                  </p>
                )}
              </div>
            )}

            {/* State selection options */}
            <div className="space-y-2.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Seleccionar nuevo estado
              </label>
              <div className="grid grid-cols-1 gap-2">
                {statusOptions.map((opt) => {
                  const Icon = opt.icon;
                  const isSelected = targetStatus === opt.status;
                  const check = isStatusAllowed(opt.status);
                  const isDisabled = !check.allowed;

                  return (
                    <div key={opt.status} className="flex flex-col">
                      <button
                        type="button"
                        disabled={isDisabled}
                        onClick={() => setTargetStatus(opt.status)}
                        className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isDisabled
                            ? 'opacity-40 bg-slate-900 border-slate-800 cursor-not-allowed'
                            : isSelected
                            ? `${opt.bgActive} ${opt.borderActive}`
                            : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/80 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`p-2 rounded-lg ${
                              isSelected ? 'bg-black/30' : 'bg-slate-800'
                            } ${opt.accentColor}`}
                          >
                            <Icon className="w-5 h-5" />
                          </div>
                          <div>
                            <div className={`font-semibold text-sm ${opt.accentColor}`}>
                              {opt.label}
                            </div>
                            <div className="text-xs text-slate-400">{opt.description}</div>
                          </div>
                        </div>
                        {isSelected && (
                          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                        )}
                      </button>
                      {isDisabled && check.reason && (
                        <span className="text-[11px] text-amber-400/80 pl-2 pt-0.5">
                          ⚠️ {check.reason}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Grade Input Section if Approved or Promoted */}
            {(targetStatus === 'aprobada' || targetStatus === 'promocionada') && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Calificación Final (Nota 1 - 10)
                  </label>
                  <span className="text-lg font-bold text-emerald-400 px-2.5 py-0.5 rounded-lg bg-emerald-950/60 border border-emerald-500/30">
                    {selectedGrade}
                  </span>
                </div>

                <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5 sm:gap-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((gradeNum) => (
                    <button
                      key={gradeNum}
                      type="button"
                      onClick={() => setSelectedGrade(gradeNum)}
                      className={`h-10 sm:h-9 rounded-lg font-bold text-sm transition-all cursor-pointer ${
                        selectedGrade === gradeNum
                          ? 'bg-emerald-500 text-slate-950 shadow-[0_0_12px_rgba(16,185,129,0.5)] scale-105'
                          : gradeNum < 4
                          ? 'bg-rose-950/40 text-rose-300/80 hover:bg-rose-900/60'
                          : gradeNum < 6
                          ? 'bg-amber-950/40 text-amber-300/80 hover:bg-amber-900/60'
                          : 'bg-slate-700/50 text-slate-200 hover:bg-slate-700'
                      }`}
                    >
                      {gradeNum}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* What this unlocks info */}
            {unlocked.totalCount > 0 && (
              <div className="p-3.5 rounded-xl bg-slate-800/30 border border-slate-800 text-xs text-slate-400 space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                  <ArrowRight className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Impacto en la carrera:</span>
                </div>
                {unlocked.unlocksOnRegularize.length > 0 && (
                  <p>
                    <span className="text-amber-400 font-medium">Al regularizar:</span> habilita cursar{' '}
                    {unlocked.unlocksOnRegularize.map((s) => s.name).join(', ')}
                  </p>
                )}
                {unlocked.unlocksOnApprove.length > 0 && (
                  <p>
                    <span className="text-green-400 font-medium">Al aprobar:</span> habilita cursar{' '}
                    {unlocked.unlocksOnApprove.map((s) => s.name).join(', ')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer buttons */}
          <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
            <button
              type="button"
              onClick={() => handleApply('disponible', undefined)}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors px-2 py-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restablecer estado</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStatusModalSubjectId(null)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (targetStatus) {
                    const gradeToPass =
                      targetStatus === 'aprobada' || targetStatus === 'promocionada'
                        ? selectedGrade
                        : undefined;
                    handleApply(targetStatus, gradeToPass);
                  }
                }}
                className="px-5 py-2 text-sm font-semibold rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-indigo-500/25 transition-all cursor-pointer"
              >
                Guardar cambios
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
