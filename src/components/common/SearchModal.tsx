import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, Layers, Clock, ArrowRight } from 'lucide-react';
import { useCareer } from '../../context/CareerContext';
import { CORE_SUBJECTS } from '../../data/plan2023';
import { ELECTIVES } from '../../data/electives';
import { getSubjectStatus } from '../../utils/correlativas';
import { StatusBadge } from './StatusBadge';
import { useIsMobile } from '../../hooks/useIsMobile';
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

  const isMobile = useIsMobile();
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

  // Esc key closes search
  useEffect(() => {
    if (!isSearchOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, setIsSearchOpen]);

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

  // ==========================================
  // RENDER MOBILE: Pantalla Completa Táctil
  // ==========================================
  if (isMobile) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar materias"
        className="fixed inset-0 z-[var(--z-modal)] h-[100dvh] max-h-[100dvh] bg-slate-950 flex flex-col overflow-hidden pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
      >
        {/* Mobile Header con Input y Cancelar */}
        <div className="p-3 border-b border-slate-800 bg-slate-900/90 flex items-center gap-2 shrink-0">
          <div className="flex-1 flex items-center gap-2.5 bg-slate-950 border border-slate-700/80 rounded-2xl px-3 min-h-[44px]">
            <Search className="w-5 h-5 text-indigo-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar materia o código..."
              className="w-full bg-transparent text-white placeholder-slate-500 text-[16px] focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="min-h-[44px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
                aria-label="Borrar texto"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsSearchOpen(false)}
            className="min-h-[44px] px-3 rounded-xl text-sm font-semibold text-indigo-400 hover:text-indigo-300 hover:bg-slate-800 flex items-center justify-center cursor-pointer active:scale-95 shrink-0"
          >
            Cancelar
          </button>
        </div>

        {/* Mobile Quick Filters */}
        <div className="px-3 py-2 bg-slate-900/40 border-b border-slate-800/80 flex items-center gap-1.5 text-xs overflow-x-auto no-scrollbar shrink-0">
          <span className="text-slate-400 font-medium shrink-0">Nivel:</span>
          {(['all', 1, 2, 3, 4, 5] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setLevelFilter(lvl)}
              className={`min-h-[44px] px-3 py-1.5 rounded-xl font-semibold transition-colors shrink-0 flex items-center cursor-pointer ${
                levelFilter === lvl
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {lvl === 'all' ? 'Todos' : `${lvl}°`}
            </button>
          ))}

          <div className="h-5 w-[1px] bg-slate-800 mx-1 shrink-0" />

          <span className="text-slate-400 font-medium ml-1 shrink-0">Estado:</span>
          {(['all', 'disponible', 'cursando', 'regularizada', 'aprobada', 'promocionada', 'bloqueada'] as const).map(
            (st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`min-h-[44px] px-3 py-1.5 rounded-xl font-semibold capitalize transition-colors shrink-0 flex items-center cursor-pointer ${
                  statusFilter === st
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {st === 'all' ? 'Todos' : st}
              </button>
            )
          )}
        </div>

        {/* Results List */}
        <div className="p-3 overflow-y-auto space-y-2 flex-1">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <Layers className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">No se encontraron materias.</p>
              <p className="text-xs text-slate-600 mt-1">Probá con otro nombre o código.</p>
            </div>
          ) : (
            filtered.map((subject) => {
              const status = getSubjectStatus(subject, activeState);
              const grade = activeState[subject.id]?.grade;

              return (
                <div
                  key={subject.id}
                  className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/80 active:bg-slate-800 transition-all cursor-pointer flex flex-col gap-2.5"
                  onClick={() => {
                    setSelectedSubjectId(subject.id);
                    setIsSearchOpen(false);
                  }}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-mono text-xs font-bold text-slate-300 shrink-0">
                      #{subject.code}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-white flex items-center gap-2 flex-wrap">
                        <span className="break-words">{subject.name}</span>
                        {subject.isElective && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 shrink-0">
                            Electiva
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                        <span>Nivel {subject.level}</span>
                        <span>•</span>
                        <span>{subject.modality === 'A' ? 'Anual' : 'Cuatrimestral'}</span>
                        <span>•</span>
                        <span>{subject.weeklyHours} hs</span>
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex items-center justify-between pt-2 border-t border-slate-800/60"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <StatusBadge status={status} grade={grade} size="sm" />
                    <button
                      type="button"
                      onClick={() => {
                        setStatusModalSubjectId(subject.id);
                        setIsSearchOpen(false);
                      }}
                      className="min-h-[44px] px-3.5 py-1 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-indigo-600 text-slate-200 border border-slate-700 flex items-center gap-1.5 cursor-pointer active:scale-95"
                    >
                      <span>Cambiar estado</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Mobile Results Count */}
        <div className="p-3 bg-slate-950/90 border-t border-slate-800 text-xs text-slate-500 text-center shrink-0">
          {filtered.length} {filtered.length === 1 ? 'materia encontrada' : 'materias encontradas'}
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER DESKTOP: Modal Centrado (Ctrl + K)
  // ==========================================
  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center pt-8 sm:pt-24 p-2 sm:p-4 bg-black/75 backdrop-blur-md">
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
                type="button"
                onClick={() => setQuery('')}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <kbd className="hidden sm:inline-block px-2 py-0.5 text-xs text-slate-400 bg-slate-800 border border-slate-700 rounded-md">
              ESC
            </kbd>
          </div>

          {/* Quick Filters */}
          <div className="px-3 sm:px-4 py-2 bg-slate-950/30 border-b border-slate-800 flex items-center gap-1.5 text-xs overflow-x-auto no-scrollbar">
            <span className="text-slate-400 font-medium shrink-0">Nivel:</span>
            {(['all', 1, 2, 3, 4, 5] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevelFilter(lvl)}
                className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                  levelFilter === lvl
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                }`}
              >
                {lvl === 'all' ? 'Todos' : `${lvl}°`}
              </button>
            ))}

            <div className="h-4 w-[1px] bg-slate-800 mx-1 shrink-0" />

            <span className="text-slate-400 font-medium ml-1 shrink-0">Estado:</span>
            {(['all', 'disponible', 'cursando', 'regularizada', 'aprobada', 'promocionada', 'bloqueada'] as const).map(
              (st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2 py-0.5 rounded-md capitalize transition-colors cursor-pointer ${
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

                    <div
                      className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end pt-1 sm:pt-0 border-t border-slate-800/50 sm:border-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <StatusBadge status={status} grade={grade} size="sm" />
                      <button
                        type="button"
                        onClick={() => {
                          setStatusModalSubjectId(subject.id);
                          setIsSearchOpen(false);
                        }}
                        className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-700 transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
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
