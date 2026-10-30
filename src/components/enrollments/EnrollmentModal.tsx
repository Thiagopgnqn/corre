import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  Check,
  Clock,
  HelpCircle,
  Loader2,
  Search,
  Users,
  X,
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { enrollmentsApi } from '../../api/enrollments.api';
import type {
  EnrollmentTerm,
  SubjectCommissionOption,
  SubjectEnrollmentOptions,
} from '../../types/enrollment';
import { getAutocompletedProfessorIdsFromCommission } from '../../utils/enrollmentLogic';

type SelectionMode = 'commission' | 'manual' | 'unknown';

export const EnrollmentModal: React.FC = () => {
  const shouldReduceMotion = useReducedMotion();
  const { pendingCommissionPrompt, setPendingCommissionPrompt, saveSubjectEnrollment } =
    useCareer();

  const [options, setOptions] = useState<SubjectEnrollmentOptions | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [mode, setMode] = useState<SelectionMode>('commission');
  const [selectedPeriodLabel, setSelectedPeriodLabel] = useState<string>('ALL');
  const [selectedCommissionId, setSelectedCommissionId] = useState<string | null>(null);
  const [selectedProfessorIds, setSelectedProfessorIds] = useState<string[]>([]);
  const [manualYear, setManualYear] = useState<string>('');
  const [manualTerm, setManualTerm] = useState<'' | EnrollmentTerm>('');
  const [profSearch, setProfSearch] = useState<string>('');

  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(
    () => Array.from({ length: 14 }, (_, idx) => currentYear - idx),
    [currentYear]
  );

  const editingEnrollment = pendingCommissionPrompt?.editingEnrollment ?? null;
  const targetStatus = pendingCommissionPrompt?.targetStatus ?? 'cursando';
  const isTakingNow = targetStatus === 'cursando';

  useEffect(() => {
    if (!pendingCommissionPrompt) {
      setOptions(null);
      setErrorMsg(null);
      return;
    }

    let active = true;
    setIsLoading(true);
    setErrorMsg(null);
    setProfSearch('');

    enrollmentsApi
      .getSubjectOptions(pendingCommissionPrompt.subjectCode)
      .then((res) => {
        if (!active || !res.success) return;
        const data = res.data;
        setOptions(data);

        if (editingEnrollment) {
          if (editingEnrollment.commissionId) {
            const matchedComm = data.commissions.find(
              (c) => c.id === editingEnrollment.commissionId
            );
            setMode('commission');
            setSelectedCommissionId(editingEnrollment.commissionId);
            setSelectedPeriodLabel(matchedComm ? matchedComm.periodLabel : 'ALL');
          } else if (
            editingEnrollment.academicYear === null &&
            editingEnrollment.term === null &&
            editingEnrollment.professors.length === 0
          ) {
            setMode('unknown');
            setSelectedCommissionId(null);
          } else {
            setMode('manual');
            setSelectedCommissionId(null);
          }
          setManualYear(
            editingEnrollment.academicYear ? String(editingEnrollment.academicYear) : ''
          );
          setManualTerm(editingEnrollment.term ?? '');
          setSelectedProfessorIds(
            editingEnrollment.professors.map((p) => p.professorId)
          );
          return;
        }

        // Modo nueva cursada
        if (data.commissions.length > 0) {
          setMode('commission');
          const currentPeriodComm = data.commissions.find((c) => c.isCurrent);
          if (pendingCommissionPrompt.targetStatus === 'cursando' && currentPeriodComm) {
            setSelectedPeriodLabel(currentPeriodComm.periodLabel);
          } else {
            setSelectedPeriodLabel('ALL');
          }
          setSelectedCommissionId(null);
          setSelectedProfessorIds([]);
        } else {
          setMode('manual');
          setSelectedPeriodLabel('ALL');
          setSelectedCommissionId(null);
          setSelectedProfessorIds([]);
        }

        setManualYear(
          pendingCommissionPrompt.targetStatus === 'cursando' ? String(currentYear) : ''
        );
        setManualTerm('');
      })
      .catch((err: any) => {
        if (active) {
          setErrorMsg(
            err?.message || 'No se pudieron cargar las comisiones de esta materia.'
          );
          setMode('manual');
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [pendingCommissionPrompt, editingEnrollment, currentYear]);

  useEffect(() => {
    if (!pendingCommissionPrompt) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) {
        setPendingCommissionPrompt(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [pendingCommissionPrompt, isSaving, setPendingCommissionPrompt]);

  const periodGroups = useMemo(() => {
    if (!options) return [];
    const seen = new Map<string, { label: string; isCurrent: boolean; count: number }>();
    for (const comm of options.commissions) {
      const existing = seen.get(comm.periodLabel);
      if (existing) {
        existing.count += 1;
        if (comm.isCurrent) existing.isCurrent = true;
      } else {
        seen.set(comm.periodLabel, {
          label: comm.periodLabel,
          isCurrent: comm.isCurrent,
          count: 1,
        });
      }
    }
    return Array.from(seen.values());
  }, [options]);

  const visibleCommissions = useMemo(() => {
    if (!options) return [];
    if (selectedPeriodLabel === 'ALL') return options.commissions;
    return options.commissions.filter((c) => c.periodLabel === selectedPeriodLabel);
  }, [options, selectedPeriodLabel]);

  const groupedVisibleCommissions = useMemo(() => {
    const groups: Array<{ periodLabel: string; isCurrent: boolean; items: SubjectCommissionOption[] }> = [];
    const byLabel = new Map<string, { periodLabel: string; isCurrent: boolean; items: SubjectCommissionOption[] }>();
    for (const comm of visibleCommissions) {
      let grp = byLabel.get(comm.periodLabel);
      if (!grp) {
        grp = { periodLabel: comm.periodLabel, isCurrent: comm.isCurrent, items: [] };
        byLabel.set(comm.periodLabel, grp);
        groups.push(grp);
      }
      grp.items.push(comm);
    }
    return groups;
  }, [visibleCommissions]);

  const filteredProfessors = useMemo(() => {
    if (!options) return [];
    if (!profSearch.trim()) return options.professors;
    const q = profSearch.toLowerCase().trim();
    return options.professors.filter((p) => p.displayName.toLowerCase().includes(q));
  }, [options, profSearch]);

  if (!pendingCommissionPrompt) return null;

  const handleSelectCommission = (comm: SubjectCommissionOption) => {
    setMode('commission');
    setSelectedCommissionId(comm.id);
    // Autocompletar profesores de la comisión (ajustables debajo)
    setSelectedProfessorIds(getAutocompletedProfessorIdsFromCommission(comm));
    setManualYear(String(comm.academicYear));
    setManualTerm(comm.termOffer === 'A' ? 'A' : comm.term);
    setErrorMsg(null);
  };

  const handleToggleProfessor = (professorId: string) => {
    setSelectedProfessorIds((prev) =>
      prev.includes(professorId)
        ? prev.filter((id) => id !== professorId)
        : [...prev, professorId]
    );
  };

  const handleOmit = () => {
    setPendingCommissionPrompt(null);
  };

  const handleSave = async () => {
    if (!pendingCommissionPrompt) return;
    setErrorMsg(null);

    if (mode === 'commission' && !selectedCommissionId) {
      setErrorMsg('Elegí una comisión de la lista, o cambiá a "Otra / de un año anterior" u "Omitir".');
      return;
    }

    setIsSaving(true);
    try {
      if (mode === 'commission' && selectedCommissionId) {
        await saveSubjectEnrollment(pendingCommissionPrompt.subjectCode, {
          enrollmentId: editingEnrollment?.id ?? null,
          commissionId: selectedCommissionId,
          professorIds: selectedProfessorIds,
          source: editingEnrollment?.source ?? 'manual',
        });
      } else if (mode === 'unknown') {
        await saveSubjectEnrollment(pendingCommissionPrompt.subjectCode, {
          enrollmentId: editingEnrollment?.id ?? null,
          commissionId: null,
          academicYear: null,
          term: null,
          professorIds: [],
          source: 'manual',
        });
      } else {
        await saveSubjectEnrollment(pendingCommissionPrompt.subjectCode, {
          enrollmentId: editingEnrollment?.id ?? null,
          commissionId: null,
          academicYear: manualYear ? Number(manualYear) : null,
          term: manualTerm ? manualTerm : null,
          professorIds: selectedProfessorIds,
          source: 'manual',
        });
      }
      setPendingCommissionPrompt(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo guardar la cursada.');
    } finally {
      setIsSaving(false);
    }
  };

  const modalTitle = editingEnrollment
    ? 'Editar datos de mi cursada'
    : isTakingNow
    ? '¿Con qué comisión la estás cursando?'
    : '¿Con qué comisión la cursaste?';

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[65] flex items-center justify-center p-2.5 sm:p-4 bg-black/75 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="enrollment-modal-title"
      >
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 14, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0, y: 10, scale: 0.97 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-2xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/70 flex items-start justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  Opcional · Mi cursada
                </span>
                <span className="text-xs font-mono text-slate-400">
                  #{pendingCommissionPrompt.subjectCode}
                </span>
              </div>
              <h2
                id="enrollment-modal-title"
                className="text-base sm:text-lg font-black text-white leading-snug"
              >
                {modalTitle}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {pendingCommissionPrompt.subjectName} — te recomendaremos reseñar a tus docentes cuando quieras.
              </p>
            </div>

            <button
              type="button"
              onClick={handleOmit}
              aria-label="Omitir y cerrar"
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {isLoading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2.5 text-slate-400 text-xs">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                <span>Buscando comisiones y docentes de la materia...</span>
              </div>
            ) : (
              <>
                {/* Selector de modo: Comisiones cargadas vs Otra / año anterior vs No lo sé */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={!options || options.commissions.length === 0}
                    onClick={() => setMode('commission')}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      mode === 'commission'
                        ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                        : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-extrabold flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span>Comisión cargada</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {options && options.commissions.length > 0
                        ? `${options.commissions.length} disponibles`
                        : 'Sin horarios cargados'}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMode('manual');
                      setSelectedCommissionId(null);
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      mode === 'manual'
                        ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                        : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-extrabold flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span>Otra / año anterior</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Elegí año y docentes manualmente
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMode('unknown');
                      setSelectedCommissionId(null);
                      setSelectedProfessorIds([]);
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      mode === 'unknown'
                        ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                        : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-extrabold flex items-center gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>No lo sé / no recuerdo</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Guardar sin comisión ni docentes
                    </p>
                  </button>
                </div>

                {/* MODO 1: Comisiones cargadas agrupadas por período */}
                {mode === 'commission' && options && options.commissions.length > 0 && (
                  <div className="space-y-3">
                    {periodGroups.length > 1 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-semibold text-slate-400 mr-1">
                          Período:
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedPeriodLabel('ALL')}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                            selectedPeriodLabel === 'ALL'
                              ? 'bg-indigo-600 border-indigo-500 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          Todos
                        </button>
                        {periodGroups.map((pg) => (
                          <button
                            key={pg.label}
                            type="button"
                            onClick={() => setSelectedPeriodLabel(pg.label)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all flex items-center gap-1 cursor-pointer ${
                              selectedPeriodLabel === pg.label
                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
                            }`}
                          >
                            <span>{pg.label}</span>
                            {pg.isCurrent && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                Actual
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                      {groupedVisibleCommissions.map((grp) => (
                        <div key={grp.periodLabel} className="space-y-1.5">
                          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            <span>{grp.periodLabel}</span>
                            {grp.isCurrent && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 normal-case">
                                Cuatrimestre actual
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {grp.items.map((comm) => {
                              const isSelected = selectedCommissionId === comm.id;
                              const slotsSummary =
                                comm.slots.length > 0
                                  ? comm.slots
                                      .map(
                                        (s) => `${s.dayLabel} ${s.startTime}-${s.endTime}`
                                      )
                                      .join(' · ')
                                  : 'Horario a confirmar';
                              const profsSummary =
                                comm.professors.length > 0
                                  ? comm.professors.map((p) => p.displayName).join(' · ')
                                  : 'Sin docentes asignados';

                              return (
                                <button
                                  key={comm.id}
                                  type="button"
                                  onClick={() => handleSelectCommission(comm)}
                                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                                    isSelected
                                      ? 'bg-indigo-600/20 border-indigo-400 shadow-[0_0_14px_rgba(99,102,241,0.25)]'
                                      : 'bg-slate-950/75 border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-xs font-black text-white px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700">
                                        {comm.code}
                                      </span>
                                      <span className="text-[10px] font-semibold capitalize text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded">
                                        {comm.turno}
                                      </span>
                                    </div>
                                    {isSelected && (
                                      <span className="w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center shrink-0">
                                        <Check className="w-3 h-3" />
                                      </span>
                                    )}
                                  </div>

                                  <div className="text-[11px] text-slate-400 flex items-center gap-1 truncate">
                                    <Clock className="w-3 h-3 text-slate-500 shrink-0" />
                                    <span className="truncate" title={slotsSummary}>
                                      {slotsSummary}
                                    </span>
                                  </div>

                                  <div className="text-[11px] text-slate-200 font-medium line-clamp-2">
                                    {profsSummary}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* MODO 2: Otra comisión / año anterior */}
                {mode === 'manual' && (
                  <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                    <div className="text-xs font-bold text-slate-200">
                      Período en que la cursaste (opcional)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label
                          htmlFor="enrollment-manual-year"
                          className="text-[11px] text-slate-400 block mb-1"
                        >
                          Año lectivo
                        </label>
                        <select
                          id="enrollment-manual-year"
                          value={manualYear}
                          onChange={(e) => setManualYear(e.target.value)}
                          className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        >
                          <option value="">Sin especificar...</option>
                          {availableYears.map((yr) => (
                            <option key={yr} value={yr}>
                              {yr}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="enrollment-manual-term"
                          className="text-[11px] text-slate-400 block mb-1"
                        >
                          Cuatrimestre / modalidad
                        </label>
                        <select
                          id="enrollment-manual-term"
                          value={manualTerm}
                          onChange={(e) =>
                            setManualTerm(e.target.value as '' | EnrollmentTerm)
                          }
                          className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        >
                          <option value="">Sin especificar...</option>
                          <option value="1C">1° Cuatrimestre (1C)</option>
                          <option value="2C">2° Cuatrimestre (2C)</option>
                          <option value="A">Anual (A)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Selector ajustable de docentes de la materia (visible en modo comisión seleccionada o modo manual) */}
                {options &&
                  options.professors.length > 0 &&
                  (mode === 'manual' ||
                    (mode === 'commission' && selectedCommissionId !== null)) && (
                    <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                          <Users className="w-3.5 h-3.5 text-indigo-400" />
                          <span>
                            {mode === 'commission'
                              ? 'Docentes de tu cursada (podés ajustar si cambió alguno)'
                              : '¿Con qué docente(s) la cursaste?'}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-indigo-300">
                          {selectedProfessorIds.length}{' '}
                          {selectedProfessorIds.length === 1
                            ? 'seleccionado'
                            : 'seleccionados'}
                        </span>
                      </div>

                      {options.professors.length > 6 && (
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            value={profSearch}
                            onChange={(e) => setProfSearch(e.target.value)}
                            placeholder="Filtrar docente de esta materia..."
                            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                        {filteredProfessors.map((prof) => {
                          const checked = selectedProfessorIds.includes(prof.professorId);
                          return (
                            <button
                              key={prof.professorId}
                              type="button"
                              onClick={() => handleToggleProfessor(prof.professorId)}
                              className={`px-2.5 py-2 rounded-xl border text-left text-xs flex items-center justify-between gap-2 transition-all cursor-pointer ${
                                checked
                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 font-bold'
                                  : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-700'
                              }`}
                            >
                              <span className="truncate">{prof.displayName}</span>
                              <span
                                className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                                  checked
                                    ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                                    : 'border-slate-700 bg-slate-950'
                                }`}
                              >
                                {checked && <Check className="w-3 h-3 stroke-[3]" />}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                {mode === 'unknown' && (
                  <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300 leading-relaxed">
                    No hay problema: podés guardar que cursaste la materia sin especificar
                    comisión ni docentes, o simplemente hacer click en{' '}
                    <strong className="text-white">Omitir por ahora</strong>. Más adelante
                    podés completarlo desde el panel lateral de la materia en{' '}
                    <strong className="text-indigo-300">&ldquo;Mi cursada&rdquo;</strong>.
                  </div>
                )}

                {errorMsg && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              disabled={isSaving}
              onClick={handleOmit}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {editingEnrollment ? 'Cancelar' : 'Omitir por ahora'}
            </button>

            <button
              type="button"
              disabled={isLoading || isSaving}
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-45 text-white text-xs font-extrabold shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{editingEnrollment ? 'Guardar cambios' : 'Guardar cursada'}</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

