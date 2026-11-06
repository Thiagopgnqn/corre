import React, { useMemo } from 'react';
import {
  Lock,
  ChevronRight,
} from 'lucide-react';
import type { Subject, UserCareerState } from '../../types/career';
import {
  getSubjectStatus,
  checkEligibility,
  ALL_SUBJECTS_MAP,
} from '../../utils/correlativas';
import { StatusBadge } from '../common/StatusBadge';

interface SubjectListViewProps {
  subjects: Subject[];
  activeState: UserCareerState;
  onSelectSubject: (id: number) => void;
  selectedSubjectId: number | null;
  isSimulationActive?: boolean;
  sampleSubjectId?: number;
}

export const SubjectListView: React.FC<SubjectListViewProps> = ({
  subjects,
  activeState,
  onSelectSubject,
  selectedSubjectId,
  isSimulationActive = false,
  sampleSubjectId = 1,
}) => {
  // Agrupar materias por nivel (1° a 5° año)
  const groupedByLevel = useMemo(() => {
    const map = new Map<number, Subject[]>();
    for (let i = 1; i <= 5; i++) {
      map.set(i, []);
    }

    subjects.forEach((s) => {
      const list = map.get(s.level) || [];
      list.push(s);
      map.set(s.level, list);
    });

    return Array.from(map.entries())
      .filter(([_, list]) => list.length > 0)
      .sort(([a], [b]) => a - b);
  }, [subjects]);

  return (
    <div className="w-full flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-6 pb-24">
      {groupedByLevel.map(([level, levelSubjects]) => {
        // Calcular estadísticas de avance del año
        const total = levelSubjects.length;
        const approvedCount = levelSubjects.filter((s) => {
          const st = getSubjectStatus(s, activeState);
          return st === 'aprobada' || st === 'promocionada';
        }).length;

        const percentage = total > 0 ? Math.round((approvedCount / total) * 100) : 0;

        return (
          <div key={level} className="space-y-3">
            {/* Header del Nivel / Año */}
            <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-md py-2 border-b border-slate-800/80 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold text-xs flex items-center justify-center">
                  {level}°
                </span>
                <h3 className="text-sm font-bold text-white tracking-tight">
                  {level}° Año
                </h3>
                <span className="text-xs text-slate-400 font-medium">
                  ({approvedCount}/{total} aprobadas)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-indigo-400">
                  {percentage}%
                </span>
                <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Lista de Materias del Nivel */}
            <div className="space-y-2">
              {levelSubjects.map((subject) => {
                const status = getSubjectStatus(subject, activeState);
                const grade = activeState[subject.id]?.grade;
                const isSelected = selectedSubjectId === subject.id;

                // Correlativas faltantes si está bloqueada
                const eligibility = checkEligibility(subject, activeState);
                const missingRegularNames = eligibility.missingRegular
                  .map((id) => ALL_SUBJECTS_MAP.get(id)?.name)
                  .filter(Boolean);
                const missingApprovedNames = eligibility.missingApproved
                  .map((id) => ALL_SUBJECTS_MAP.get(id)?.name)
                  .filter(Boolean);

                const isBlocked = status === 'bloqueada' && !isSimulationActive;

                return (
                  <div
                    key={subject.id}
                    data-tour={subject.id === sampleSubjectId ? 'sample-subject' : undefined}
                    data-subject-id={subject.id}
                    onClick={() => onSelectSubject(subject.id)}
                    className={`p-3.5 rounded-2xl border transition-all active:scale-[0.99] cursor-pointer shadow-sm ${
                      isSelected
                        ? 'bg-slate-800/90 border-indigo-500 shadow-lg shadow-indigo-950/40 ring-1 ring-indigo-500'
                        : 'bg-slate-900/80 hover:bg-slate-800/80 border-slate-800/90'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0 space-y-1">
                        {/* Código y modalidad */}
                        <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
                          <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60">
                            #{subject.code}
                          </span>
                          <span>{subject.modality}</span>
                          <span>•</span>
                          <span>{subject.weeklyHours} hs/sem</span>
                          {subject.isElective && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px] font-semibold">
                              Electiva
                            </span>
                          )}
                        </div>

                        {/* Nombre de la materia */}
                        <h4 className="text-sm font-bold text-white leading-snug break-words">
                          {subject.name}
                        </h4>
                      </div>

                      {/* Estado actual */}
                      <div className="shrink-0 pt-0.5 flex items-center gap-1.5">
                        <StatusBadge status={status} grade={grade} size="sm" />
                        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                      </div>
                    </div>

                    {/* Motivo de bloqueo explícito en texto si está bloqueada */}
                    {isBlocked && (missingRegularNames.length > 0 || missingApprovedNames.length > 0) && (
                      <div className="mt-2.5 pt-2 border-t border-slate-800/60 space-y-1 text-[11px] text-rose-300/90 bg-rose-950/20 p-2 rounded-xl border border-rose-500/20">
                        {missingRegularNames.length > 0 && (
                          <div className="flex items-start gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                            <span>
                              <strong className="text-rose-200">Falta regularizar:</strong>{' '}
                              {missingRegularNames.join(', ')}
                            </span>
                          </div>
                        )}
                        {missingApprovedNames.length > 0 && (
                          <div className="flex items-start gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                            <span>
                              <strong className="text-rose-200">Falta aprobar:</strong>{' '}
                              {missingApprovedNames.join(', ')}
                            </span>
                          </div>
                        )}
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
  );
};
