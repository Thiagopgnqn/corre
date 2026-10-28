import React, { useState, useMemo } from 'react';
import {
  CalendarDays,
  Clock,
  Plus,
  Check,
  Trash2,
  PlayCircle,
  AlertCircle,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { CORE_SUBJECTS } from '../../data/plan2023';
import { ELECTIVES } from '../../data/electives';
import { getSubjectStatus, ALL_SUBJECTS_MAP } from '../../utils/correlativas';

export interface SemesterPlannerProps {
  onNavigateToSchedule?: () => void;
}

export const SemesterPlanner: React.FC<SemesterPlannerProps> = ({ onNavigateToSchedule }) => {
  const {
    activeState,
    semesterBasket,
    toggleBasketSubject,
    clearBasket,
    batchUpdateStatus,
    setSelectedSubjectId,
    settings,
  } = useCareer();

  const [termFilter, setTermFilter] = useState<'all' | '1C' | '2C' | 'A'>('all');
  const [includeElectives, setIncludeElectives] = useState<boolean>(true);

  // Available subjects pool
  const availableSubjects = useMemo(() => {
    const core = settings.includeAnalistaTrack
      ? CORE_SUBJECTS
      : CORE_SUBJECTS.filter((s) => s.id !== 99);
    const pool = includeElectives ? [...core, ...ELECTIVES] : core;

    return pool.filter((s) => {
      const status = getSubjectStatus(s, activeState);
      if (status !== 'disponible') return false;

      if (termFilter === 'all') return true;
      if (termFilter === 'A') return s.modality === 'A';
      if (termFilter === '1C') return s.modality.includes('1C') || s.modality === 'A';
      if (termFilter === '2C') return s.modality.includes('2C') || s.modality === 'A';
      return true;
    });
  }, [includeElectives, termFilter, activeState, settings.includeAnalistaTrack]);

  // Basket subjects details & calculation
  const basketSubjects = useMemo(() => {
    return semesterBasket.map((id) => ALL_SUBJECTS_MAP.get(id)!).filter(Boolean);
  }, [semesterBasket]);

  const totalWeeklyHours = useMemo(() => {
    return basketSubjects.reduce((acc, s) => acc + s.weeklyHours, 0);
  }, [basketSubjects]);

  // Workload analysis
  const workloadInfo = useMemo(() => {
    if (totalWeeklyHours === 0) {
      return { label: 'Sin materias seleccionadas', color: 'text-slate-400', bg: 'bg-slate-800' };
    }
    if (totalWeeklyHours <= 14) {
      return {
        label: 'Carga Liviana (fácil de llevar)',
        color: 'text-emerald-400',
        bg: 'bg-emerald-950/70 border-emerald-500/40',
      };
    }
    if (totalWeeklyHours <= 22) {
      return {
        label: 'Carga Recomendada (ritmo estándar)',
        color: 'text-cyan-400',
        bg: 'bg-cyan-950/70 border-cyan-500/40',
      };
    }
    if (totalWeeklyHours <= 28) {
      return {
        label: 'Carga Intensa (exigente pero alcanzable)',
        color: 'text-amber-400',
        bg: 'bg-amber-950/70 border-amber-500/40',
      };
    }
    return {
      label: 'Carga Muy Pesada (cuidado con superposición)',
      color: 'text-rose-400',
      bg: 'bg-rose-950/70 border-rose-500/40',
    };
  }, [totalWeeklyHours]);

  const handleStartTakingAll = () => {
    if (basketSubjects.length === 0) return;
    const updates = basketSubjects.map((s) => ({
      id: s.id,
      status: 'cursando' as const,
    }));
    batchUpdateStatus(updates);
    clearBasket();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl backdrop-blur-md flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-cyan-400" />
            <span>Armá tu Cuatrimestre</span>
          </h2>
          <p className="text-xs text-slate-400">
            Materias que tenés 100% habilitadas para cursar según tus correlativas. Armá tu canasta y proyectá tu carga horaria.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setTermFilter('all')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                termFilter === 'all' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Todas
            </button>
            <button
              onClick={() => setTermFilter('1C')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                termFilter === '1C' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              1° Cuatrimestre
            </button>
            <button
              onClick={() => setTermFilter('2C')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                termFilter === '2C' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              2° Cuatrimestre
            </button>
            <button
              onClick={() => setTermFilter('A')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                termFilter === 'A' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              Anuales
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
            <input
              type="checkbox"
              checked={includeElectives}
              onChange={(e) => setIncludeElectives(e.target.checked)}
              className="rounded border-slate-700 text-cyan-500 focus:ring-0 bg-slate-800"
            />
            <span>Incluir Electivas</span>
          </label>
        </div>
      </div>

      {/* Mobile basket quick summary banner */}
      {basketSubjects.length > 0 && (
        <div className="lg:hidden p-3.5 rounded-xl bg-cyan-950/80 border border-cyan-500/50 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2 text-xs">
            <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="font-bold text-white">{basketSubjects.length} {basketSubjects.length === 1 ? 'materia' : 'materias'} elegidas:</span>
            <span className="text-cyan-300 font-black">{totalWeeklyHours} hs</span>
          </div>
          <span className="text-[11px] text-cyan-300/90 font-medium">{workloadInfo.label.split('(')[0]}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Available Subjects Grid (2 Cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span className="font-semibold uppercase tracking-wider text-slate-300">
              Materias Disponibles ({availableSubjects.length})
            </span>
            <span>Hacé click en + para sumarla a tu cuatrimestre</span>
          </div>

          {availableSubjects.length === 0 ? (
            <div className="p-12 rounded-2xl border border-slate-800 bg-slate-900/40 text-center space-y-3">
              <Sparkles className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-base font-bold text-white">No tenés materias disponibles con este filtro</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Revisá el Mapa de Correlativas para ver qué finales o cursadas previas necesitás regularizar o aprobar para desbloquear las próximas materias.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {availableSubjects.map((subject) => {
                const inBasket = semesterBasket.includes(subject.id);

                return (
                  <div
                    key={subject.id}
                    onClick={() => setSelectedSubjectId(subject.id)}
                    className={`p-4 rounded-xl border backdrop-blur-md transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                      inBasket
                        ? 'bg-cyan-950/40 border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                        : 'bg-slate-900/70 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            #{subject.code}
                          </span>
                          <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                            Nivel {subject.level}
                          </span>
                          <span className="text-[10px] text-slate-400 bg-slate-800 px-1 py-0.5 rounded">
                            {subject.modality}
                          </span>
                        </div>

                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          <span>{subject.weeklyHours} hs/sem</span>
                        </span>
                      </div>

                      <h3 className="font-bold text-sm text-white leading-snug break-words">
                        {subject.name}
                      </h3>
                    </div>

                    <div className="flex flex-wrap items-center justify-between pt-2 border-t border-slate-800/60 gap-2" onClick={(e) => e.stopPropagation()}>
                      <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1 whitespace-nowrap">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Correlativas listas</span>
                      </span>

                      <button
                        onClick={() => toggleBasketSubject(subject.id)}
                        className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1 shrink-0 ${
                          inBasket
                            ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                            : 'bg-slate-800 hover:bg-cyan-600 text-slate-300 hover:text-white border border-slate-700'
                        }`}
                      >
                        {inBasket ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Agregada</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            <span>Sumar</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Basket Summary (1 Col) */}
        <div className="space-y-4 sticky top-20">
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-white">Mi Selección del Cuatrimestre</h3>
                <p className="text-xs text-slate-400">
                  {basketSubjects.length} {basketSubjects.length === 1 ? 'materia' : 'materias'} elegidas
                </p>
              </div>

              {basketSubjects.length > 0 && (
                <button
                  onClick={clearBasket}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                  title="Vaciar selección"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Total Hours Metric Card */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 block">Carga horaria semanal total:</span>
                <span className="text-2xl font-black text-cyan-400">{totalWeeklyHours} hs</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center">
                <Clock className="w-5 h-5" />
              </div>
            </div>

            {/* Workload evaluation tag */}
            <div className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${workloadInfo.bg} ${workloadInfo.color}`}>
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{workloadInfo.label}</span>
            </div>

            {/* Chosen subjects items */}
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {basketSubjects.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">
                  Todavía no agregaste materias. Tocá "Sumar" en cualquiera de las disponibles de la izquierda.
                </p>
              ) : (
                basketSubjects.map((s) => (
                  <div
                    key={s.id}
                    className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/80 flex items-center justify-between text-xs"
                  >
                    <div className="pr-2 leading-tight flex-1">
                      <span className="font-bold text-white block break-words">{s.name}</span>
                      <span className="text-slate-500 text-[10px]">
                        #{s.code} • {s.modality} • {s.weeklyHours}hs
                      </span>
                    </div>

                    <button
                      onClick={() => toggleBasketSubject(s.id)}
                      className="p-1 text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Action buttons */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              {onNavigateToSchedule && (
                <button
                  onClick={onNavigateToSchedule}
                  disabled={basketSubjects.length === 0}
                  className="w-full py-2.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 disabled:opacity-40 text-indigo-300 hover:text-white font-bold text-xs transition-all flex items-center justify-center gap-2"
                >
                  <Clock className="w-4 h-4 text-indigo-400" />
                  <span>Armar horarios con esta canasta 🕒</span>
                </button>
              )}

              <button
                onClick={handleStartTakingAll}
                disabled={basketSubjects.length === 0}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-40 text-white font-bold text-xs shadow-lg shadow-cyan-600/20 transition-all flex items-center justify-center gap-2"
              >
                <PlayCircle className="w-4 h-4" />
                <span>Marcar todas como "Cursando"</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
