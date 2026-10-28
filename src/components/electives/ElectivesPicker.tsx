import React, { useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  Lock,
  Plus,
  Trash2,
  ArrowRightLeft,
  AlertTriangle,
  X,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCareer } from '../../context/CareerContext';
import { ELECTIVES, REQUIRED_ELECTIVE_CREDITS_TOTAL, type ElectiveSubject } from '../../data/electives';
import { getSubjectStatus, checkEligibility, ALL_SUBJECTS_MAP } from '../../utils/correlativas';
import { StatusBadge } from '../common/StatusBadge';

export const ElectivesPicker: React.FC = () => {
  const {
    activeState,
    computedProgress,
    assignedElectives,
    addElectiveToYear,
    removeElectiveFromYear,
    moveElectiveYear,
    setStatusModalSubjectId,
    setSelectedSubjectId,
    settings,
    updateSettings,
  } = useCareer();

  const [modalYear, setModalYear] = useState<number | null>(null);
  const [modalSearch, setModalSearch] = useState('');

  // Helper to find which year an elective is assigned to
  const getAssignedYear = (id: number): number | null => {
    for (let y = 1; y <= 5; y++) {
      if (assignedElectives[y]?.includes(id)) {
        return y;
      }
    }
    return null;
  };

  const handleDragStart = (e: React.DragEvent, electiveId: number) => {
    e.dataTransfer.setData('text/plain', String(electiveId));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetYear: number) => {
    e.preventDefault();
    const idStr = e.dataTransfer.getData('text/plain');
    const id = Number(idStr);
    if (!id) return;
    const currentYear = getAssignedYear(id);
    if (currentYear !== null && currentYear !== targetYear) {
      moveElectiveYear(id, currentYear, targetYear);
    } else if (currentYear === null) {
      addElectiveToYear(id, targetYear);
    }
  };

  const years = [1, 2, 3, 4, 5];

  // Filtered electives for modal
  const filteredElectives = ELECTIVES.filter((el) => {
    const q = modalSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      el.name.toLowerCase().includes(q) ||
      el.code.toLowerCase().includes(q) ||
      `nivel ${el.level}`.includes(q)
    );
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Top Banner: Global Credits Progress */}
      <div className="bg-slate-900/70 border border-slate-800 p-5 rounded-2xl backdrop-blur-md space-y-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Sparkles className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-xl font-black text-white tracking-tight">
                  Electivas Libres por Año
                </h2>
                <p className="text-xs text-slate-400">
                  Asigná las materias electivas libremente al año que prefieras según cumplas sus correlativas.
                </p>
              </div>
            </div>
          </div>

          {/* Credits Summary Badge */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-slate-950/80 px-4 py-2.5 rounded-xl border border-slate-800 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Créditos Aprobados
              </div>
              <div className="text-xl font-black text-amber-400">
                {computedProgress.totalElectiveCreditsApproved} / {REQUIRED_ELECTIVE_CREDITS_TOTAL}
              </div>
            </div>

            <div className="bg-slate-950/80 px-4 py-2.5 rounded-xl border border-slate-800 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                En Curso
              </div>
              <div className="text-xl font-black text-cyan-400">
                {computedProgress.totalElectiveCreditsTaking} cr
              </div>
            </div>

            <div className="bg-slate-950/80 px-4 py-2.5 rounded-xl border border-slate-800 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Faltan
              </div>
              <div className="text-xl font-black text-rose-400">
                {computedProgress.missingElectiveCreditsForDegree} cr
              </div>
            </div>
          </div>
        </div>

        {/* Global Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 font-medium">
              Meta global de titulación: <span className="text-white font-bold">{REQUIRED_ELECTIVE_CREDITS_TOTAL} créditos</span> en total (cualquier nivel)
            </span>
            <span className="font-bold text-amber-400">
              {Math.min(100, Math.round((computedProgress.totalElectiveCreditsApproved / REQUIRED_ELECTIVE_CREDITS_TOTAL) * 100))}%
            </span>
          </div>
          <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden p-0.5 border border-slate-800">
            <motion.div
              className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-400 rounded-full"
              initial={{ width: 0 }}
              animate={{
                width: `${Math.min(100, (computedProgress.totalElectiveCreditsApproved / REQUIRED_ELECTIVE_CREDITS_TOTAL) * 100)}%`,
              }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Planning Settings Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs">
          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-300 hover:text-white transition-colors">
            <input
              type="checkbox"
              checked={settings.allowBlockedElectivesPlanning}
              onChange={(e) => updateSettings({ allowBlockedElectivesPlanning: e.target.checked })}
              className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-amber-500/30"
            />
            <span className="font-medium">
              Permitir planificar electivas con correlativas aún bloqueadas
            </span>
          </label>

          <span className="text-slate-400 text-[11px]">
            * Los niveles (3°, 4°, 5°) de las electivas son solo sugerencias académicas de la UTN.
          </span>
        </div>
      </div>

      {/* Years Container: 1° to 5° */}
      <div className="space-y-5">
        {years.map((year) => {
          const assignedIds = assignedElectives[year] || [];
          const assignedSubjects = assignedIds
            .map((id) => ELECTIVES.find((e) => e.id === id))
            .filter((e): e is ElectiveSubject => Boolean(e));

          const yearTotalCredits = assignedSubjects.reduce((acc, curr) => acc + curr.credits, 0);

          return (
            <div
              key={year}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, year)}
              className="bg-slate-900/50 border border-slate-800/90 rounded-2xl p-4 sm:p-5 backdrop-blur-sm space-y-4 transition-colors hover:border-slate-700"
            >
              {/* Year Card Header */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 font-black text-sm flex items-center justify-center">
                    {year}°
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-white">
                      Electivas asignadas a {year}° Año
                    </h3>
                    <p className="text-xs text-slate-400">
                      {assignedSubjects.length === 0
                        ? 'Sin electivas asignadas todavía'
                        : `${assignedSubjects.length} electiva${assignedSubjects.length > 1 ? 's' : ''} • ${yearTotalCredits} créditos planificados`}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setModalSearch('');
                    setModalYear(year);
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>Agregar electiva</span>
                </button>
              </div>

              {/* Electives List for this Year */}
              {assignedSubjects.length === 0 ? (
                <div className="border border-dashed border-slate-800 rounded-xl p-6 text-center text-xs text-slate-400 space-y-1">
                  <p className="font-medium text-slate-400">No hay electivas asignadas a {year}° año.</p>
                  <p className="text-[11px] text-slate-400">
                    Arrastrá una electiva aquí o hacé clic en "+ Agregar electiva" para elegirla.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {assignedSubjects.map((elective) => {
                    const status = getSubjectStatus(elective, activeState);
                    const grade = activeState[elective.id]?.grade;
                    const { eligible, missingRegular, missingApproved } = checkEligibility(
                      elective,
                      activeState
                    );

                    // Warning condition: It was added, but prerequisites are not met, and user hasn't marked it as approved/regularized
                    const isPrereqWarning =
                      !eligible && status !== 'aprobada' && status !== 'promocionada' && status !== 'regularizada';

                    return (
                      <div
                        key={elective.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, elective.id)}
                        onClick={() => setSelectedSubjectId(elective.id)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-3 relative group ${
                          status === 'aprobada' || status === 'promocionada'
                            ? 'bg-emerald-950/20 border-emerald-500/40 shadow-sm'
                            : status === 'cursando'
                            ? 'bg-cyan-950/20 border-cyan-500/40 shadow-sm'
                            : isPrereqWarning
                            ? 'bg-rose-950/20 border-rose-500/50 shadow-sm'
                            : eligible
                            ? 'bg-slate-900/90 border-amber-500/40 hover:border-amber-500/70'
                            : 'bg-slate-950/60 border-slate-800'
                        }`}
                      >
                        <div>
                          {/* Badges top line */}
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700 shrink-0">
                                #{elective.code}
                              </span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 shrink-0">
                                {elective.credits} cr
                              </span>
                              <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded shrink-0">
                                Nivel sugerido {elective.level}°
                              </span>
                            </div>

                            <StatusBadge status={status} grade={grade} size="sm" />
                          </div>

                          {/* Elective Title */}
                          <h4 className="font-bold text-sm text-white leading-snug break-words">
                            {elective.name}
                          </h4>
                        </div>

                        {/* Prerequisite warning banner if prerequisites are broken/missing */}
                        {isPrereqWarning && (
                          <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-[11px] space-y-0.5">
                            <div className="flex items-center gap-1 font-bold">
                              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                              <span>Correlativas pendientes:</span>
                            </div>
                            {missingRegular.length > 0 && (
                              <div className="text-[10px] text-rose-200">
                                Falta regularizar:{' '}
                                {missingRegular
                                  .map((id) => ALL_SUBJECTS_MAP.get(id)?.name || `#${id}`)
                                  .join(', ')}
                              </div>
                            )}
                            {missingApproved.length > 0 && (
                              <div className="text-[10px] text-rose-200">
                                Falta aprobar:{' '}
                                {missingApproved
                                  .map((id) => ALL_SUBJECTS_MAP.get(id)?.name || `#${id}`)
                                  .join(', ')}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Card Footer: Status edit & Move/Remove controls */}
                        <div
                          className="flex flex-wrap items-center justify-between pt-2 border-t border-slate-800/80 gap-2 text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => setStatusModalSubjectId(elective.id)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-amber-600 text-slate-200 hover:text-white transition-all flex items-center gap-1"
                          >
                            <span>Cambiar estado</span>
                          </button>

                          <div className="flex items-center gap-1">
                            {/* Quick Move Dropdown */}
                            <select
                              value={year}
                              onChange={(e) => {
                                const newYear = Number(e.target.value);
                                if (newYear !== year) {
                                  moveElectiveYear(elective.id, year, newYear);
                                }
                              }}
                              className="text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700 rounded-lg px-1.5 py-1 focus:ring-1 focus:ring-amber-500"
                              title="Mover a otro año"
                            >
                              <option value={1}>1° Año</option>
                              <option value={2}>2° Año</option>
                              <option value={3}>3° Año</option>
                              <option value={4}>4° Año</option>
                              <option value={5}>5° Año</option>
                            </select>

                            {/* Remove button */}
                            <button
                              onClick={() => removeElectiveFromYear(elective.id, year)}
                              className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors"
                              title="Quitar electiva de este año"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Elective Modal */}
      <AnimatePresence>
        {modalYear !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-3xl max-h-[90vh] rounded-2xl bg-slate-900 border border-slate-800 flex flex-col shadow-2xl overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 font-bold flex items-center justify-center text-xs">
                    {modalYear}°
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-white">
                      Agregar electiva a {modalYear}° Año
                    </h3>
                    <p className="text-xs text-slate-400">
                      Seleccioná cualquier electiva de la oferta académica. Podés cursarla si cumplís sus correlativas.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setModalYear(null)}
                  className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Search & Filter Toolbar */}
              <div className="p-4 border-b border-slate-800/80 bg-slate-950/50 space-y-3">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={modalSearch}
                    onChange={(e) => setModalSearch(e.target.value)}
                    placeholder="Buscar por nombre, código o nivel..."
                    className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400">
                    Mostrando {filteredElectives.length} de {ELECTIVES.length} electivas disponibles
                  </span>

                  <label className="flex items-center gap-2 cursor-pointer select-none text-slate-300">
                    <input
                      type="checkbox"
                      checked={settings.allowBlockedElectivesPlanning}
                      onChange={(e) => updateSettings({ allowBlockedElectivesPlanning: e.target.checked })}
                      className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-amber-500/30"
                    />
                    <span className="text-[11px]">Permitir planificar bloqueadas</span>
                  </label>
                </div>
              </div>

              {/* Modal Electives List */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                {[3, 4, 5].map((lvl) => {
                  const levelGroup = filteredElectives.filter((e) => e.level === lvl);
                  if (levelGroup.length === 0) return null;

                  return (
                    <div key={lvl} className="space-y-2.5">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
                        <span>Electivas (Nivel Sugerido {lvl}°)</span>
                        <div className="h-px bg-slate-800 flex-1" />
                      </div>

                      <div className="space-y-2">
                        {levelGroup.map((elective) => {
                          const assignedYear = getAssignedYear(elective.id);
                          const isAlreadyInThisYear = assignedYear === modalYear;
                          const isAlreadyInOtherYear = assignedYear !== null && assignedYear !== modalYear;

                          const { eligible, missingRegular, missingApproved } = checkEligibility(
                            elective,
                            activeState
                          );

                          const canAdd = eligible || settings.allowBlockedElectivesPlanning;

                          return (
                            <div
                              key={elective.id}
                              className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                                isAlreadyInThisYear
                                  ? 'bg-amber-500/10 border-amber-500/40'
                                  : eligible
                                  ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                                  : 'bg-slate-950/30 border-slate-800/60 opacity-80'
                              }`}
                            >
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-xs font-bold px-1.5 py-0.2 rounded bg-slate-800 text-amber-300 border border-slate-700">
                                    #{elective.code}
                                  </span>
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                    {elective.credits} créditos
                                  </span>
                                  <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.2 rounded">
                                    {elective.modality}
                                  </span>
                                  {isAlreadyInOtherYear && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                      Asignada en {assignedYear}° año
                                    </span>
                                  )}
                                  {isAlreadyInThisYear && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                      Asignada en este año
                                    </span>
                                  )}
                                </div>

                                <h4 className="font-bold text-sm text-white leading-snug break-words">
                                  {elective.name}
                                </h4>

                                {/* Prereq diagnostic */}
                                {eligible ? (
                                  <p className="text-[11px] text-emerald-400 flex items-center gap-1 font-medium">
                                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                    <span>Correlativas cumplidas (disponible para cursar)</span>
                                  </p>
                                ) : (
                                  <div className="text-[11px] text-rose-400 space-y-0.5">
                                    <div className="flex items-center gap-1 font-medium">
                                      <Lock className="w-3.5 h-3.5 shrink-0" />
                                      <span>Bloqueada por correlativas:</span>
                                    </div>
                                    {missingRegular.length > 0 && (
                                      <div className="text-slate-400 text-[10px] pl-4">
                                        Falta regularizar:{' '}
                                        {missingRegular
                                          .map((id) => ALL_SUBJECTS_MAP.get(id)?.name || `#${id}`)
                                          .join(', ')}
                                      </div>
                                    )}
                                    {missingApproved.length > 0 && (
                                      <div className="text-slate-400 text-[10px] pl-4">
                                        Falta aprobar:{' '}
                                        {missingApproved
                                          .map((id) => ALL_SUBJECTS_MAP.get(id)?.name || `#${id}`)
                                          .join(', ')}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Action Button */}
                              <div className="shrink-0 pt-2 sm:pt-0">
                                {isAlreadyInThisYear ? (
                                  <button
                                    onClick={() => removeElectiveFromYear(elective.id, modalYear)}
                                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-500/30 transition-all flex items-center gap-1.5"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Quitar</span>
                                  </button>
                                ) : (
                                  <button
                                    disabled={!canAdd}
                                    onClick={() => {
                                      addElectiveToYear(elective.id, modalYear);
                                    }}
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                      !canAdd
                                        ? 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed'
                                        : isAlreadyInOtherYear
                                        ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/20'
                                        : !eligible && settings.allowBlockedElectivesPlanning
                                        ? 'bg-amber-600/80 hover:bg-amber-600 text-white border border-amber-500/40'
                                        : 'bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/20'
                                    }`}
                                  >
                                    {isAlreadyInOtherYear ? (
                                      <>
                                        <ArrowRightLeft className="w-3.5 h-3.5" />
                                        <span>Mover aquí</span>
                                      </>
                                    ) : !eligible && settings.allowBlockedElectivesPlanning ? (
                                      <>
                                        <ShieldAlert className="w-3.5 h-3.5" />
                                        <span>Planificar bloqueada</span>
                                      </>
                                    ) : (
                                      <>
                                        <Plus className="w-3.5 h-3.5" />
                                        <span>Agregar</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs">
                <span className="text-slate-400">
                  Una electiva solo puede estar asignada a un año a la vez.
                </span>
                <button
                  onClick={() => setModalYear(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-colors"
                >
                  Listo
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
