import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Layers, Clock, ArrowRight } from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { CORE_SUBJECTS } from '../../data/plan2023';
import { ELECTIVES } from '../../data/electives';
import { getSubjectStatus } from '../../utils/correlativas';
import { StatusBadge } from './StatusBadge';
import type { SubjectStatus } from '../../types/career';

export const SearchModal: React.FC = () => {
  const {
    isSearchOpen,
    setIsSearchOpen,
    activeState,
    setSelectedSubjectId,
    setStatusModalSubjectId,
    settings,
  } = useCareer();

  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<number | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<SubjectStatus | 'all'>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setLevelFilter('all');
      setStatusFilter('all');
    }
  }, [isSearchOpen]);

  const allSubjects = useMemo(() => {
    const core = settings.includeAnalistaTrack
      ? CORE_SUBJECTS
      : CORE_SUBJECTS.filter((s) => s.id !== 99);
    return [...core, ...ELECTIVES];
  }, [settings.includeAnalistaTrack]);

  const filtered = useMemo(() => {
    return allSubjects.filter((subject) => {
      // Search term
      const matchesQuery =
        subject.name.toLowerCase().includes(query.toLowerCase()) ||
        subject.code.toLowerCase().includes(query.toLowerCase());

      if (!matchesQuery) return false;

      // Level filter
      if (levelFilter !== 'all' && subject.level !== levelFilter) {
        return false;
      }

      // Status filter
      if (statusFilter !== 'all') {
        const status = getSubjectStatus(subject, activeState);
        if (status !== statusFilter) return false;
      }

      return true;
    });
  }, [allSubjects, query, levelFilter, statusFilter, activeState]);

  if (!isSearchOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 p-4 bg-black/75 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -20 }}
          transition={{ duration: 0.15 }}
          className="relative w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        >
          {/* Search bar input */}
          <div className="flex items-center gap-3 p-4 border-b border-slate-800 bg-slate-950/60">
            <Search className="w-5 h-5 text-indigo-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar materia por nombre o código... (ej. Algoritmos, 14, DDS, Física)"
              className="w-full bg-transparent text-white placeholder-slate-500 text-base focus:outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <kbd className="hidden sm:inline-block px-2 py-0.5 text-xs text-slate-400 bg-slate-800 border border-slate-700 rounded-md">
              ESC
            </kbd>
          </div>

          {/* Quick Filters */}
          <div className="px-4 py-2.5 bg-slate-950/30 border-b border-slate-800 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400 font-medium">Nivel:</span>
            {(['all', 1, 2, 3, 4, 5] as const).map((lvl) => (
              <button
                key={lvl}
                onClick={() => setLevelFilter(lvl)}
                className={`px-2 py-0.5 rounded-md transition-colors ${
                  levelFilter === lvl
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                }`}
              >
                {lvl === 'all' ? 'Todos' : `${lvl}°`}
              </button>
            ))}

            <div className="h-4 w-[1px] bg-slate-800 mx-1 hidden sm:block" />

            <span className="text-slate-400 font-medium ml-1">Estado:</span>
            {(['all', 'disponible', 'cursando', 'regularizada', 'aprobada', 'promocionada', 'bloqueada'] as const).map(
              (st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2 py-0.5 rounded-md capitalize transition-colors ${
                    statusFilter === st
                      ? 'bg-indigo-600 text-white font-semibold'
                      : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st === 'all' ? 'Todos' : st}
                </button>
              )
            )}
          </div>

          {/* Results list */}
          <div className="p-3 overflow-y-auto space-y-1.5 flex-1">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Layers className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p>No se encontraron materias que coincidan con la búsqueda.</p>
              </div>
            ) : (
              filtered.map((subject) => {
                const status = getSubjectStatus(subject, activeState);
                const grade = activeState[subject.id]?.grade;

                return (
                  <div
                    key={subject.id}
                    className="group flex flex-wrap sm:flex-nowrap items-center justify-between p-3 rounded-xl hover:bg-slate-800/70 border border-transparent hover:border-slate-700/60 transition-all cursor-pointer gap-2"
                    onClick={() => {
                      setSelectedSubjectId(subject.id);
                      setIsSearchOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/80 flex items-center justify-center font-mono text-xs font-bold text-slate-300 shrink-0">
                        {subject.code}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm text-white group-hover:text-indigo-300 transition-colors flex items-center gap-2 flex-wrap">
                          <span className="break-words">{subject.name}</span>
                          {subject.isElective && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 shrink-0">
                              Electiva
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
                          <span>Nivel {subject.level}</span>
                          <span>•</span>
                          <span>{subject.modality}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {subject.weeklyHours} hs
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end pt-1 sm:pt-0 border-t border-slate-800/50 sm:border-0" onClick={(e) => e.stopPropagation()}>
                      <StatusBadge status={status} grade={grade} size="sm" />
                      <button
                        onClick={() => {
                          setStatusModalSubjectId(subject.id);
                          setIsSearchOpen(false);
                        }}
                        className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-700 transition-colors flex items-center gap-1 shrink-0"
                      >
                        <span>Estado</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="p-3 bg-slate-950/80 border-t border-slate-800 text-xs text-slate-500 flex items-center justify-between">
            <span>{filtered.length} materias encontradas</span>
            <span>Tip: Usá Ctrl + K para abrir en cualquier momento</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
