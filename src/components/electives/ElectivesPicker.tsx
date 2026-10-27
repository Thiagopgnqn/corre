import React, { useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  Lock,
  BookOpen,
  ArrowRight,
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { ELECTIVES, REQUIRED_CREDITS } from '../../data/electives';
import { getSubjectStatus, checkEligibility, ALL_SUBJECTS_MAP } from '../../utils/correlativas';
import { StatusBadge } from '../common/StatusBadge';

export const ElectivesPicker: React.FC = () => {
  const {
    activeState,
    computedProgress,
    setStatusModalSubjectId,
    setSelectedSubjectId,
  } = useCareer();

  const [activeLevelTab, setActiveLevelTab] = useState<3 | 4 | 5>(3);

  const electivesL3 = ELECTIVES.filter((e) => e.level === 3);
  const electivesL4 = ELECTIVES.filter((e) => e.level === 4);
  const electivesL5 = ELECTIVES.filter((e) => e.level === 5);

  const currentLevelElectives =
    activeLevelTab === 3 ? electivesL3 : activeLevelTab === 4 ? electivesL4 : electivesL5;

  const currentLevelCredits =
    activeLevelTab === 3
      ? computedProgress.electiveCreditsN3
      : activeLevelTab === 4
      ? computedProgress.electiveCreditsN4
      : computedProgress.electiveCreditsN5;

  const currentLevelRequired =
    activeLevelTab === 3
      ? REQUIRED_CREDITS.LEVEL_3
      : activeLevelTab === 4
      ? REQUIRED_CREDITS.LEVEL_4
      : REQUIRED_CREDITS.LEVEL_5;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header & Global Credits Progress */}
      <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl backdrop-blur-md space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <span>Gestión de Materias Electivas</span>
            </h2>
            <p className="text-xs text-slate-400">
              Elegí tus electivas por nivel para alcanzar los 20 créditos requeridos para el título de Ingeniero/a.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-400">Total acumulado:</span>
            <span className="px-3 py-1 rounded-xl bg-amber-500/10 text-amber-300 font-bold border border-amber-500/30 text-sm">
              {computedProgress.totalElectiveCredits} / {REQUIRED_CREDITS.TOTAL} créditos
            </span>
          </div>
        </div>

        {/* Global Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Créditos aprobados requeridos para titulación:</span>
            <span className="font-bold text-white">
              {Math.min(100, Math.round((computedProgress.totalElectiveCredits / REQUIRED_CREDITS.TOTAL) * 100))}%
            </span>
          </div>
          <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden p-0.5 border border-slate-800">
            <div
              className="h-full bg-gradient-to-r from-amber-500 via-purple-500 to-indigo-500 rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, (computedProgress.totalElectiveCredits / REQUIRED_CREDITS.TOTAL) * 100)}%`,
              }}
            />
          </div>
        </div>

        {/* Progress Cards per Level */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          {/* Nivel 3 Card */}
          <div
            onClick={() => setActiveLevelTab(3)}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              activeLevelTab === 3
                ? 'bg-amber-950/30 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-xs text-white">Nivel 3</span>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                Título Analista
              </span>
            </div>
            <div className="text-lg font-black text-amber-400">
              {computedProgress.electiveCreditsN3} / {REQUIRED_CREDITS.LEVEL_3} cr
            </div>
            <p className="text-[11px] text-slate-400">Min. 4 créditos requeridos</p>
          </div>

          {/* Nivel 4 Card */}
          <div
            onClick={() => setActiveLevelTab(4)}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              activeLevelTab === 4
                ? 'bg-amber-950/30 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-xs text-white">Nivel 4</span>
              <span className="text-[10px] text-slate-400">2 materias típicas</span>
            </div>
            <div className="text-lg font-black text-amber-400">
              {computedProgress.electiveCreditsN4} / {REQUIRED_CREDITS.LEVEL_4} cr
            </div>
            <p className="text-[11px] text-slate-400">Min. 6 créditos requeridos</p>
          </div>

          {/* Nivel 5 Card */}
          <div
            onClick={() => setActiveLevelTab(5)}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              activeLevelTab === 5
                ? 'bg-amber-950/30 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-xs text-white">Nivel 5</span>
              <span className="text-[10px] text-slate-400">3–4 materias típicas</span>
            </div>
            <div className="text-lg font-black text-amber-400">
              {computedProgress.electiveCreditsN5} / {REQUIRED_CREDITS.LEVEL_5} cr
            </div>
            <p className="text-[11px] text-slate-400">Min. 10 créditos requeridos</p>
          </div>
        </div>
      </div>

      {/* Level Selector Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        {([3, 4, 5] as const).map((lvl) => (
          <button
            key={lvl}
            onClick={() => setActiveLevelTab(lvl)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeLevelTab === lvl
                ? 'bg-gradient-to-r from-amber-600 to-amber-700 text-white shadow-lg shadow-amber-600/30'
                : 'bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <span>Electivas Nivel {lvl}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/30">
              {lvl === 3 ? '4 cr' : lvl === 4 ? '6 cr' : '10 cr'}
            </span>
          </button>
        ))}
      </div>

      {/* Active Level Electives List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span className="font-semibold uppercase tracking-wider text-slate-300">
            Oferta académica Nivel {activeLevelTab} ({currentLevelElectives.length} opciones)
          </span>
          <span>
            {currentLevelCredits >= currentLevelRequired ? (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Requisito de créditos cumplido en este nivel</span>
              </span>
            ) : (
              <span className="text-amber-400">
                Faltan {currentLevelRequired - currentLevelCredits} créditos para completar este nivel
              </span>
            )}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {currentLevelElectives.map((elective) => {
            const status = getSubjectStatus(elective, activeState);
            const grade = activeState[elective.id]?.grade;
            const { eligible } = checkEligibility(
              elective,
              activeState
            );

            return (
              <div
                key={elective.id}
                onClick={() => setSelectedSubjectId(elective.id)}
                className={`p-4 rounded-xl border backdrop-blur-md transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                  status === 'aprobada' || status === 'promocionada'
                    ? 'bg-emerald-950/20 border-emerald-500/40'
                    : status === 'cursando'
                    ? 'bg-cyan-950/20 border-cyan-500/40'
                    : eligible
                    ? 'bg-slate-900/80 border-amber-500/30 hover:border-amber-500/60'
                    : 'bg-slate-950/40 border-slate-800/80 opacity-75'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-bold px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700">
                        #{elective.code}
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        {elective.credits} créditos
                      </span>
                      <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                        {elective.modality}
                      </span>
                    </div>

                    <StatusBadge status={status} grade={grade} size="sm" />
                  </div>

                  <h3 className="font-bold text-sm text-white leading-snug">
                    {elective.name}
                  </h3>
                </div>

                {/* Prerequisites requirements */}
                <div className="text-[11px] space-y-1 bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/60">
                  <div className="font-medium text-slate-400 flex items-center justify-between">
                    <span>Correlativas:</span>
                    {eligible ? (
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Habilitada</span>
                      </span>
                    ) : (
                      <span className="text-rose-400 font-semibold flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        <span>Faltan requisitos</span>
                      </span>
                    )}
                  </div>

                  {elective.regularPrereqs.length > 0 && (
                    <div className="text-slate-400">
                      <span className="text-amber-400">Reg:</span>{' '}
                      {elective.regularPrereqs
                        .map((id) => ALL_SUBJECTS_MAP.get(id)?.name || `#${id}`)
                        .join(', ')}
                    </div>
                  )}

                  {elective.approvedPrereqs.length > 0 && (
                    <div className="text-slate-400">
                      <span className="text-green-400">Apr:</span>{' '}
                      {elective.approvedPrereqs
                        .map((id) => ALL_SUBJECTS_MAP.get(id)?.name || `#${id}`)
                        .join(', ')}
                    </div>
                  )}
                </div>

                {/* Footer action */}
                <div
                  className="flex items-center justify-between pt-2 border-t border-slate-800/60"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>{elective.weeklyHours} hs/sem</span>
                  </span>

                  <button
                    onClick={() => setStatusModalSubjectId(elective.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-amber-600 text-slate-200 hover:text-white transition-all flex items-center gap-1.5"
                  >
                    <span>Editar estado</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
