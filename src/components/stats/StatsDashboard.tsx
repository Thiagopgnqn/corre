import React, { useState, useMemo } from 'react';
import {
  Award,
  Clock,
  Sparkles,
  ArrowRight,
  TrendingUp,
  GraduationCap,
  CheckCircle2,
  Lock,
  ChevronRight,
  Sliders,
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { CORE_SUBJECTS } from '../../data/plan2023';
import { ELECTIVES } from '../../data/electives';
import { getSubjectStatus, isApprovedOrHigher } from '../../utils/correlativas';
import { soundManager } from '../../utils/audio';
import { fireMilestoneConfetti } from '../../utils/confetti';

export const StatsDashboard: React.FC = () => {
  const {
    computedProgress,
    criticalPath,
    activeState,
    settings,
    updateSettings,
    setSelectedSubjectId,
  } = useCareer();

  const [activeTab, setActiveTab] = useState<'overview' | 'grades' | 'critical' | 'badges'>('overview');

  // Grades statistics
  const gradesData = useMemo(() => {
    const list: Array<{ id: number; name: string; level: number; grade: number; status: string }> = [];

    [...CORE_SUBJECTS, ...ELECTIVES].forEach((s) => {
      const st = activeState[s.id];
      if (st && st.grade !== undefined && isApprovedOrHigher(st)) {
        if (!settings.includePromotionsInGPA && st.status === 'promocionada') {
          return;
        }
        list.push({
          id: s.id,
          name: s.name,
          level: s.level,
          grade: st.grade,
          status: st.status,
        });
      }
    });

    const gradesOnly = list.map((item) => item.grade);
    const bestGrade = gradesOnly.length > 0 ? Math.max(...gradesOnly) : 0;
    const lowestGrade = gradesOnly.length > 0 ? Math.min(...gradesOnly) : 0;

    // Distribution: count of each grade 1-10
    const distribution: Record<number, number> = {};
    for (let i = 1; i <= 10; i++) distribution[i] = 0;
    gradesOnly.forEach((g) => {
      distribution[g] = (distribution[g] || 0) + 1;
    });

    // Average per level
    const avgByLevel: Record<number, { sum: number; count: number; avg: number }> = {
      1: { sum: 0, count: 0, avg: 0 },
      2: { sum: 0, count: 0, avg: 0 },
      3: { sum: 0, count: 0, avg: 0 },
      4: { sum: 0, count: 0, avg: 0 },
      5: { sum: 0, count: 0, avg: 0 },
    };

    list.forEach((item) => {
      if (avgByLevel[item.level]) {
        avgByLevel[item.level].sum += item.grade;
        avgByLevel[item.level].count += 1;
      }
    });

    for (let lvl = 1; lvl <= 5; lvl++) {
      if (avgByLevel[lvl].count > 0) {
        avgByLevel[lvl].avg = Number((avgByLevel[lvl].sum / avgByLevel[lvl].count).toFixed(2));
      }
    }

    return {
      list,
      bestGrade,
      lowestGrade,
      distribution,
      avgByLevel,
      totalGradesCount: list.length,
    };
  }, [activeState, settings]);

  // Milestones verification
  const milestones = useMemo(() => {
    const pct = computedProgress.careerPercentageBySubjects;
    return [
      {
        id: 'quarter',
        title: 'Primer Cuarto (25%)',
        desc: 'Completaste el 25% de la carrera',
        unlocked: pct >= 25,
        icon: Sparkles,
        color: 'from-blue-500 to-cyan-500',
      },
      {
        id: 'half',
        title: 'Mitad de Carrera (50%)',
        desc: 'Cruzaste la mitad del camino universitario',
        unlocked: pct >= 50,
        icon: TrendingUp,
        color: 'from-indigo-500 to-purple-500',
      },
      {
        id: 'three_quarters',
        title: 'Recta Final (75%)',
        desc: 'A un paso del proyecto de graduación',
        unlocked: pct >= 75,
        icon: Award,
        color: 'from-purple-500 to-pink-500',
      },
      {
        id: 'graduated',
        title: 'Graduación (100%)',
        desc: 'Todas las materias del plan aprobadas',
        unlocked: pct >= 100 && computedProgress.totalElectiveCredits >= 20,
        icon: GraduationCap,
        color: 'from-emerald-500 to-teal-500',
      },
      {
        id: 'analista',
        title: 'Título Intermedio: Analista Universitario',
        desc: 'Materias 1 a 23 + Seminario Integrador 99 + 4cr electivas N3',
        unlocked: computedProgress.isAnalistaEligible,
        icon: Award,
        color: 'from-amber-500 to-orange-500',
      },
      {
        id: 'pps',
        title: 'Habilitación PPS',
        desc: 'Cumplís los requisitos para cursar la Práctica Profesional',
        unlocked: computedProgress.isPPSEligible,
        icon: CheckCircle2,
        color: 'from-cyan-500 to-blue-500',
      },
    ];
  }, [computedProgress]);

  // Level progress cards
  const levelProgressList = useMemo(() => {
    return [1, 2, 3, 4, 5].map((lvl) => {
      const lvlCore = CORE_SUBJECTS.filter((s) => s.level === lvl);
      const approvedCount = lvlCore.filter((s) => isApprovedOrHigher(activeState[s.id])).length;
      const pct = Math.round((approvedCount / lvlCore.length) * 100);
      return {
        level: lvl,
        total: lvlCore.length,
        approved: approvedCount,
        percentage: pct,
      };
    });
  }, [activeState]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Sub Navigation Tabs */}
      <div className="flex items-center gap-1.5 bg-slate-900/70 p-1.5 rounded-2xl border border-slate-800 text-xs overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap shrink-0 transition-all ${
            activeTab === 'overview'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Resumen General
        </button>
        <button
          onClick={() => setActiveTab('grades')}
          className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap shrink-0 transition-all ${
            activeTab === 'grades'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Calificaciones & Promedios
        </button>
        <button
          onClick={() => setActiveTab('critical')}
          className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap shrink-0 transition-all ${
            activeTab === 'critical'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Camino Crítico
        </button>
        <button
          onClick={() => setActiveTab('badges')}
          className={`px-4 py-2 rounded-xl font-bold whitespace-nowrap shrink-0 transition-all ${
            activeTab === 'badges'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Hitos & Logros
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Main Progress Rings Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* By subjects */}
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md flex flex-col justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Avance por Materias
              </span>
              <div className="flex items-center justify-between my-4">
                <div>
                  <div className="text-3xl font-black text-white">
                    {computedProgress.careerPercentageBySubjects}%
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {computedProgress.approvedCount + computedProgress.promotedCount} de{' '}
                    {computedProgress.totalSubjects} materias
                  </div>
                </div>
                {/* Mini circular progress */}
                <svg className="w-16 h-16 transform -rotate-90">
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    stroke="#1e293b"
                    strokeWidth="6"
                    fill="transparent"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    stroke="#6366f1"
                    strokeWidth="6"
                    fill="transparent"
                    strokeDasharray={163.36}
                    strokeDashoffset={
                      163.36 - (163.36 * computedProgress.careerPercentageBySubjects) / 100
                    }
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
              </div>
              <div className="text-[11px] text-slate-500">Plan de estudios 2023 ISI</div>
            </div>

            {/* By weekly hours */}
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md flex flex-col justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Avance por Carga Horaria
              </span>
              <div className="flex items-center justify-between my-4">
                <div>
                  <div className="text-3xl font-black text-cyan-400">
                    {computedProgress.careerPercentageByHours}%
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {computedProgress.approvedWeeklyHours} de {computedProgress.totalWeeklyHours} hs/sem
                  </div>
                </div>
                <svg className="w-16 h-16 transform -rotate-90">
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    stroke="#1e293b"
                    strokeWidth="6"
                    fill="transparent"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    stroke="#06b6d4"
                    strokeWidth="6"
                    fill="transparent"
                    strokeDasharray={163.36}
                    strokeDashoffset={
                      163.36 - (163.36 * computedProgress.careerPercentageByHours) / 100
                    }
                    strokeLinecap="round"
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
              </div>
              <div className="text-[11px] text-slate-500">Ponderado por duración y horas</div>
            </div>

            {/* Pending finals */}
            <div className="p-5 rounded-2xl border border-amber-500/20 bg-amber-950/20 backdrop-blur-md flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
                  Finales Pendientes
                </span>
                <Clock className="w-4 h-4 text-amber-400" />
              </div>
              <div className="my-3">
                <div className="text-3xl font-black text-amber-400">
                  {computedProgress.pendingFinalsCount}
                </div>
                <div className="text-xs text-amber-200/80 mt-1">
                  Materias cursadas y regularizadas
                </div>
              </div>
              <div className="text-[11px] text-amber-400/80">Listas para rendir examen final</div>
            </div>

            {/* Average GPA */}
            <div className="p-5 rounded-2xl border border-emerald-500/20 bg-emerald-950/20 backdrop-blur-md flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">
                  Promedio General
                </span>
                <Award className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="my-3">
                <div className="text-3xl font-black text-emerald-400">
                  {computedProgress.averageGrade > 0 ? computedProgress.averageGrade : '--'}
                </div>
                <div className="text-xs text-emerald-200/80 mt-1">
                  {gradesData.totalGradesCount} materias con nota
                </div>
              </div>
              <div className="text-[11px] text-emerald-400/80">
                {settings.includePromotionsInGPA ? 'Incluye promociones' : 'Solo exámenes finales'}
              </div>
            </div>
          </div>

          {/* Level Progress Bars */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Avance Detallado por Nivel
            </h3>
            <div className="space-y-3">
              {levelProgressList.map((lvl) => (
                <div key={lvl.level} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">Nivel {lvl.level} (Año {lvl.level})</span>
                    <span className="text-slate-400 font-mono">
                      {lvl.approved} / {lvl.total} ({lvl.percentage}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-500"
                      style={{ width: `${lvl.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: GRADES */}
      {activeTab === 'grades' && (
        <div className="space-y-6">
          {/* Settings Bar */}
          <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Configuración del Promedio
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.includePromotionsInGPA}
                  onChange={(e) => updateSettings({ includePromotionsInGPA: e.target.checked })}
                  className="rounded border-slate-700 text-indigo-500 focus:ring-0 bg-slate-800"
                />
                <span>Incluir materias promocionadas</span>
              </label>

              <div className="flex items-center gap-1.5 text-slate-400">
                <span>Nota mínima de aprobación:</span>
                <select
                  value={settings.minPassingGrade}
                  onChange={(e) => updateSettings({ minPassingGrade: Number(e.target.value) })}
                  className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-0.5 text-xs focus:outline-none"
                >
                  <option value={4}>4 (Aprobación estándar)</option>
                  <option value={6}>6 (Aprobación exigente)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Grade Metrics & Distribution */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md text-center">
              <span className="text-xs font-semibold text-slate-400 uppercase">Promedio General</span>
              <div className="text-4xl font-black text-indigo-400 my-2">
                {computedProgress.averageGrade > 0 ? computedProgress.averageGrade : '--'}
              </div>
              <span className="text-xs text-slate-500">
                Calculado sobre {gradesData.totalGradesCount} materias
              </span>
            </div>

            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md text-center">
              <span className="text-xs font-semibold text-slate-400 uppercase">Mejor Calificación</span>
              <div className="text-4xl font-black text-emerald-400 my-2">
                {gradesData.bestGrade > 0 ? gradesData.bestGrade : '--'}
              </div>
              <span className="text-xs text-slate-500">Nota más alta registrada</span>
            </div>

            <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md text-center">
              <span className="text-xs font-semibold text-slate-400 uppercase">Nota Más Baja</span>
              <div className="text-4xl font-black text-amber-400 my-2">
                {gradesData.lowestGrade > 0 ? gradesData.lowestGrade : '--'}
              </div>
              <span className="text-xs text-slate-500">Nota mínima registrada</span>
            </div>
          </div>

          {/* Grade Distribution Bar Graph */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md space-y-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Distribución de Calificaciones (1 - 10)
            </h3>
            <div className="grid grid-cols-10 gap-1 sm:gap-2 items-end h-40 pt-6">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                const count = gradesData.distribution[num] || 0;
                const maxCount = Math.max(...Object.values(gradesData.distribution), 1);
                const heightPercent = Math.round((count / maxCount) * 100);

                return (
                  <div key={num} className="flex flex-col items-center h-full justify-end gap-1.5">
                    <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold">{count}</span>
                    <div
                      className="w-full rounded-t-lg bg-gradient-to-t from-indigo-600 to-cyan-400 transition-all duration-500"
                      style={{ height: `${Math.max(heightPercent, 4)}%` }}
                    />
                    <span className="text-[11px] sm:text-xs font-bold text-slate-300 font-mono">{num}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Average per level */}
          <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md space-y-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Promedio por Nivel
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
              {[1, 2, 3, 4, 5].map((lvl) => {
                const data = gradesData.avgByLevel[lvl];
                return (
                  <div
                    key={lvl}
                    className="p-3 rounded-xl bg-slate-950/50 border border-slate-800 text-center"
                  >
                    <span className="text-xs text-slate-400 font-medium">Nivel {lvl}</span>
                    <div className="text-xl font-bold text-white mt-1">
                      {data.count > 0 ? data.avg : '--'}
                    </div>
                    <span className="text-[10px] text-slate-500">{data.count} materias</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CRITICAL PATH */}
      {activeTab === 'critical' && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-slate-900 backdrop-blur-md flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold text-xs border border-indigo-500/30">
                  Algoritmo de Camino Crítico
                </span>
                <span className="text-xs text-slate-400">Grafo Acíclico Dirigido (DAG)</span>
              </div>
              <h3 className="text-lg font-bold text-white">
                Cadena de Correlativas Más Larga Hacia la Graduación
              </h3>
              <p className="text-xs text-slate-300 max-w-xl">
                Esta es la secuencia crítica de materias no aprobadas que dictará el tiempo mínimo para graduarte. Cada materia en este camino desbloquea a la siguiente.
              </p>
            </div>

            <div className="flex items-center gap-4 bg-slate-950/80 p-3.5 rounded-xl border border-slate-800">
              <div className="text-center">
                <span className="text-[10px] text-slate-400 uppercase block">Eslabones</span>
                <span className="text-2xl font-black text-indigo-400">
                  {criticalPath.length}
                </span>
              </div>
              <div className="h-8 w-[1px] bg-slate-800" />
              <div className="text-center">
                <span className="text-[10px] text-slate-400 uppercase block">Estimación</span>
                <span className="text-2xl font-black text-emerald-400">
                  ~{criticalPath.estimatedTerms} cuat.
                </span>
              </div>
            </div>
          </div>

          {/* Sequential Chain of Subjects */}
          {criticalPath.chain.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-slate-800 bg-slate-900/40">
              <GraduationCap className="w-12 h-12 text-emerald-400 mx-auto mb-2" />
              <h4 className="text-base font-bold text-white">¡No quedan materias en el camino crítico!</h4>
              <p className="text-xs text-slate-400">Completaste todas las materias troncales requeridas para el título.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {criticalPath.chain.map((subj, idx) => {
                const status = getSubjectStatus(subj, activeState);
                const isLast = idx === criticalPath.chain.length - 1;

                return (
                  <div key={subj.id} className="relative">
                    <div
                      onClick={() => setSelectedSubjectId(subj.id)}
                      className="p-4 rounded-xl border border-slate-800 bg-slate-900/80 hover:bg-slate-800/90 transition-all cursor-pointer flex flex-wrap items-center justify-between gap-3 group"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 flex items-center justify-center font-bold text-xs shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs text-slate-400 shrink-0">#{subj.code}</span>
                            <span className="font-bold text-sm text-white break-words group-hover:text-indigo-300 transition-colors">
                              {subj.name}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            Nivel {subj.level} • {subj.modality} • {subj.weeklyHours} hs/semana
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 capitalize whitespace-nowrap">
                          {status}
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors shrink-0" />
                      </div>
                    </div>

                    {!isLast && (
                      <div className="flex justify-center my-1 text-slate-600">
                        <ArrowRight className="w-4 h-4 rotate-90" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: BADGES & MILESTONES */}
      {activeTab === 'badges' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">Hitos y Títulos Académicos</h3>
              <p className="text-xs text-slate-400">
                Logros desbloqueados automáticamente al avanzar en el plan 2023.
              </p>
            </div>

            <button
              onClick={() => {
                soundManager.playMilestone();
                fireMilestoneConfetti();
              }}
              className="px-3 py-1.5 rounded-xl bg-purple-600/30 hover:bg-purple-600 text-purple-200 hover:text-white text-xs font-semibold border border-purple-500/40 transition-all flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Celebrar</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {milestones.map((m) => {
              const Icon = m.icon;

              return (
                <div
                  key={m.id}
                  className={`p-5 rounded-2xl border backdrop-blur-md transition-all ${
                    m.unlocked
                      ? 'bg-slate-900/90 border-indigo-500/40 shadow-[0_0_20px_rgba(99,102,241,0.2)]'
                      : 'bg-slate-950/40 border-slate-800/80 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center text-white bg-gradient-to-tr ${
                        m.unlocked ? m.color : 'from-slate-800 to-slate-900 text-slate-600'
                      } shadow-lg`}
                    >
                      <Icon className="w-6 h-6" />
                    </div>

                    {m.unlocked ? (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Desbloqueado</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        <span>Pendiente</span>
                      </span>
                    )}
                  </div>

                  <h4 className="font-bold text-sm text-white">{m.title}</h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{m.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
