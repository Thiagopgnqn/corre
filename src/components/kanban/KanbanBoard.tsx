import React, { useState } from 'react';
import {
  Kanban as KanbanIcon,
  Layers,
  Sparkles,
  Lock,
  PlayCircle,
  Clock,
  CheckCircle2,
  BookOpen,
} from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { CORE_SUBJECTS } from '../../data/plan2023';
import { getSubjectStatus } from '../../utils/correlativas';
import { StatusBadge } from '../common/StatusBadge';
import type { SubjectStatus } from '../../types/career';

export const KanbanBoard: React.FC = () => {
  const {
    activeState,
    updateSubjectStatus,
    setStatusModalSubjectId,
    setSelectedSubjectId,
  } = useCareer();

  const [mode, setMode] = useState<'kanban' | 'levels'>('kanban');
  const [levelFilter, setLevelFilter] = useState<number | 'all'>('all');
  const [draggedSubjectId, setDraggedSubjectId] = useState<number | null>(null);

  const subjects = CORE_SUBJECTS.filter((s) => {
    if (levelFilter === 'all') return true;
    return s.level === levelFilter;
  });

  const columns: Array<{
    id: SubjectStatus;
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    accentColor: string;
    borderColor: string;
    filterFn: (status: SubjectStatus) => boolean;
  }> = [
    {
      id: 'disponible',
      title: 'Pendiente / Disponible',
      icon: Lock,
      accentColor: 'text-slate-400',
      borderColor: 'border-slate-800',
      filterFn: (st) => st === 'bloqueada' || st === 'disponible',
    },
    {
      id: 'cursando',
      title: 'Cursando',
      icon: PlayCircle,
      accentColor: 'text-cyan-400',
      borderColor: 'border-cyan-500/30',
      filterFn: (st) => st === 'cursando',
    },
    {
      id: 'regularizada',
      title: 'Regularizada (Final pendiente)',
      icon: Clock,
      accentColor: 'text-amber-400',
      borderColor: 'border-amber-500/30',
      filterFn: (st) => st === 'regularizada',
    },
    {
      id: 'aprobada',
      title: 'Aprobada / Promocionada',
      icon: CheckCircle2,
      accentColor: 'text-emerald-400',
      borderColor: 'border-emerald-500/30',
      filterFn: (st) => st === 'aprobada' || st === 'promocionada',
    },
  ];

  const handleDragStart = (e: React.DragEvent, id: number) => {
    e.dataTransfer.setData('text/plain', String(id));
    setDraggedSubjectId(id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetColStatus: SubjectStatus) => {
    e.preventDefault();
    const idStr = e.dataTransfer.getData('text/plain');
    const id = Number(idStr) || draggedSubjectId;
    setDraggedSubjectId(null);

    if (!id) return;

    if (targetColStatus === 'aprobada') {
      setStatusModalSubjectId(id); // Open grade selection modal
    } else {
      updateSubjectStatus(id, targetColStatus);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* View Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/60 border border-slate-800/80 p-4 rounded-2xl backdrop-blur-md">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <KanbanIcon className="w-5 h-5 text-indigo-400" />
            <span>Tablero de Seguimiento</span>
          </h2>
          <p className="text-xs text-slate-400">
            Organizá y visualizá tus materias con arrastrar y soltar o agrupadas por año.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Mode Switcher */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setMode('kanban')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                mode === 'kanban'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <KanbanIcon className="w-3.5 h-3.5" />
              <span>Columnas (Kanban)</span>
            </button>
            <button
              onClick={() => setMode('levels')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                mode === 'levels'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Por Nivel (1° a 5°)</span>
            </button>
          </div>

          {/* Level Filter */}
          <div className="flex items-center gap-1 text-xs">
            <span className="text-slate-500 font-medium mr-1">Filtrar:</span>
            {(['all', 1, 2, 3, 4, 5] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setLevelFilter(lvl)}
                className={`px-2.5 py-1 rounded-lg transition-colors font-medium ${
                  levelFilter === lvl
                    ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {lvl === 'all' ? 'Todos' : `${lvl}°`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mode 1: Kanban Board */}
      {mode === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
          {columns.map((col) => {
            const ColIcon = col.icon;
            const colSubjects = subjects.filter((s) => {
              const status = getSubjectStatus(s, activeState);
              return col.filterFn(status);
            });

            return (
              <div
                key={col.id}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, col.id)}
                className={`rounded-2xl border bg-slate-900/50 backdrop-blur-md overflow-hidden flex flex-col min-h-[580px] transition-colors ${col.borderColor}`}
              >
                {/* Column Header */}
                <div className="p-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ColIcon className={`w-4 h-4 ${col.accentColor}`} />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      {col.title}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-300">
                    {colSubjects.length}
                  </span>
                </div>

                {/* Cards Container */}
                <div className="p-2.5 space-y-2.5 flex-1 overflow-y-auto max-h-[75vh]">
                  {colSubjects.length === 0 ? (
                    <div className="h-32 border-2 border-dashed border-slate-800/80 rounded-xl flex items-center justify-center text-xs text-slate-500">
                      Arrastrá materias aquí
                    </div>
                  ) : (
                    colSubjects.map((subject) => {
                      const status = getSubjectStatus(subject, activeState);
                      const grade = activeState[subject.id]?.grade;

                      return (
                        <div
                          key={subject.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, subject.id)}
                          onClick={() => setSelectedSubjectId(subject.id)}
                          className={`p-3 rounded-xl border bg-slate-900/90 hover:bg-slate-800/90 transition-all cursor-grab active:cursor-grabbing group shadow-sm hover:shadow-lg hover:border-slate-600 ${
                            status === 'disponible'
                              ? 'border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                              : status === 'bloqueada'
                              ? 'border-slate-800 opacity-80'
                              : 'border-slate-700/80'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                              #{subject.code}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              Nivel {subject.level} • {subject.modality}
                            </span>
                          </div>

                          <h4 className="font-bold text-xs text-white leading-snug group-hover:text-indigo-300 transition-colors">
                            {subject.name}
                          </h4>

                          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-800/80 text-[11px]">
                            <span className="text-slate-400 flex items-center gap-1">
                              <BookOpen className="w-3 h-3 text-slate-500" />
                              {subject.weeklyHours} hs
                            </span>

                            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <StatusBadge status={status} grade={grade} size="sm" />
                              <button
                                onClick={() => setStatusModalSubjectId(subject.id)}
                                className="p-1 rounded bg-slate-800 hover:bg-indigo-600 text-slate-400 hover:text-white transition-colors"
                                title="Cambiar estado"
                              >
                                <Sparkles className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Mode 2: Grouped by Level */}
      {mode === 'levels' && (
        <div className="space-y-6">
          {[1, 2, 3, 4, 5].map((lvl) => {
            const lvlSubjects = CORE_SUBJECTS.filter((s) => s.level === lvl);
            const approvedLvlCount = lvlSubjects.filter((s) => {
              const st = getSubjectStatus(s, activeState);
              return st === 'aprobada' || st === 'promocionada';
            }).length;
            const percent = Math.round((approvedLvlCount / lvlSubjects.length) * 100);

            return (
              <div
                key={lvl}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden"
              >
                {/* Level Bar */}
                <div className="p-4 bg-slate-950/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold text-sm">
                      {lvl}°
                    </span>
                    <div>
                      <h3 className="font-bold text-white text-base">Nivel {lvl}</h3>
                      <p className="text-xs text-slate-400">
                        {approvedLvlCount} de {lvlSubjects.length} materias aprobadas ({percent}%)
                      </p>
                    </div>
                  </div>

                  {/* Level progress bar */}
                  <div className="w-48 bg-slate-800 h-2.5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>

                {/* Level Grid */}
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {lvlSubjects.map((subject) => {
                    const status = getSubjectStatus(subject, activeState);
                    const grade = activeState[subject.id]?.grade;

                    return (
                      <div
                        key={subject.id}
                        onClick={() => setSelectedSubjectId(subject.id)}
                        className="p-3.5 rounded-xl border border-slate-800/80 bg-slate-950/50 hover:bg-slate-800/60 transition-all cursor-pointer flex flex-col justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="font-mono text-xs font-bold text-slate-400">
                              #{subject.code}
                            </span>
                            <span className="text-xs text-slate-500">
                              {subject.modality} • {subject.weeklyHours}hs
                            </span>
                          </div>
                          <h4 className="font-bold text-sm text-white">
                            {subject.name}
                          </h4>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-800/60" onClick={(e) => e.stopPropagation()}>
                          <StatusBadge status={status} grade={grade} size="sm" />
                          <button
                            onClick={() => setStatusModalSubjectId(subject.id)}
                            className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white transition-colors"
                          >
                            Modificar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
