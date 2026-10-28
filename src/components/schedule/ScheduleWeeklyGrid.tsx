import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  X,
  MapPin,
  Laptop,
  Clock,
  Sparkles,
  Calendar,
  User,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { DayOfWeek, Commission, Slot, ScheduleConflict } from '../../types/schedule';
import {
  DAYS_ORDER,
  DAY_LABELS,
  timeToMinutes,
} from '../../utils/scheduleLogic';

export const SUBJECT_PALETTES = [
  { id: 'indigo', border: 'border-indigo-400', bg: 'bg-indigo-950/90', text: 'text-indigo-200', dot: 'bg-indigo-400', badge: 'bg-indigo-500/20 text-indigo-300' },
  { id: 'cyan', border: 'border-cyan-400', bg: 'bg-cyan-950/90', text: 'text-cyan-200', dot: 'bg-cyan-400', badge: 'bg-cyan-500/20 text-cyan-300' },
  { id: 'emerald', border: 'border-emerald-400', bg: 'bg-emerald-950/90', text: 'text-emerald-200', dot: 'bg-emerald-400', badge: 'bg-emerald-500/20 text-emerald-300' },
  { id: 'amber', border: 'border-amber-400', bg: 'bg-amber-950/90', text: 'text-amber-200', dot: 'bg-amber-400', badge: 'bg-amber-500/20 text-amber-300' },
  { id: 'fuchsia', border: 'border-fuchsia-400', bg: 'bg-fuchsia-950/90', text: 'text-fuchsia-200', dot: 'bg-fuchsia-400', badge: 'bg-fuchsia-500/20 text-fuchsia-300' },
  { id: 'sky', border: 'border-sky-400', bg: 'bg-sky-950/90', text: 'text-sky-200', dot: 'bg-sky-400', badge: 'bg-sky-500/20 text-sky-300' },
  { id: 'teal', border: 'border-teal-400', bg: 'bg-teal-950/90', text: 'text-teal-200', dot: 'bg-teal-400', badge: 'bg-teal-500/20 text-teal-300' },
  { id: 'rose', border: 'border-rose-400', bg: 'bg-rose-950/90', text: 'text-rose-200', dot: 'bg-rose-400', badge: 'bg-rose-500/20 text-rose-300' },
  { id: 'purple', border: 'border-purple-400', bg: 'bg-purple-950/90', text: 'text-purple-200', dot: 'bg-purple-400', badge: 'bg-purple-500/20 text-purple-300' },
];

export function getSubjectColor(subjectId: number) {
  const idx = Math.abs(subjectId) % SUBJECT_PALETTES.length;
  return SUBJECT_PALETTES[idx];
}

export const SUBJECT_SHORT_NAMES: Record<number, string> = {
  // Nivel 1
  1: 'Análisis Mat. 1',
  2: 'Álgebra y Geom.',
  3: 'Física 1',
  4: 'Inglés 1',
  5: 'Lógica y Estruct.',
  6: 'Algoritmos (AED)',
  7: 'Arquitectura (ACO)',
  8: 'Sist. y Procesos (SPN)',
  11: 'Ing. y Sociedad',

  // Nivel 2
  9: 'Análisis Mat. 2',
  10: 'Física 2',
  12: 'Inglés 2',
  13: 'Sintaxis (SSL)',
  14: 'Paradigmas (PPR)',
  15: 'Sistemas Operativos',
  16: 'Análisis de Sistemas',
  17: 'Probabilidad y Est.',

  // Nivel 3
  18: 'Economía',
  19: 'Bases de Datos',
  20: 'Desarrollo Software (DDS)',
  21: 'Com. de Datos',
  22: 'Análisis Numérico',
  23: 'Diseño de Sist. (DSI)',
  99: 'Seminario Integrador',

  // Nivel 4
  24: 'Legislación',
  25: 'Calidad de Software',
  26: 'Redes de Datos (RDA)',
  27: 'Investigación Operativa',
  28: 'Simulación',
  29: 'Automatización (TPA)',
  30: 'Admin. de Sistemas',

  // Nivel 5
  31: 'Inteligencia Artificial',
  32: 'Ciencia de Datos',
  33: 'Sistemas de Gestión',
  34: 'Gestión Gerencial',
  35: 'Seguridad en Sistemas',
  36: 'Proyecto Final',

  // Electivas
  401: 'Gerenciamiento Proyectos',
  402: 'Arquitectura Software',
  403: 'Testing de Software',
  404: 'Seguridad en Redes',
  405: 'Aplic. con Objetos (DAO)',
  406: 'Gobierno de TI',
  407: 'Bioinformática',
  408: 'Interfaces y UIX',
  501: 'Criptografía Aplicada',
  502: 'Auditoría de Sistemas',
  503: 'Cloud Computing',
  504: 'DevOps & CI/CD',
  505: 'Arquitecturas Cloud Nativas',
  506: 'Deep Learning',
  507: 'Decisiones (DEC)',
  508: 'Procesamiento Lenguaje Natural',
  509: 'Seguridad SW (SDS)',
  510: 'Big Data',
  511: 'Software Libre (ISFA)',
  512: 'Habilidades Blandas',
  513: 'Entornos Virtuales',
  514: 'PPS',
};

export function getSubjectShortName(id: number, fullName: string): string {
  if (SUBJECT_SHORT_NAMES[id]) return SUBJECT_SHORT_NAMES[id];
  if (!fullName) return `Materia #${id}`;
  if (fullName.length <= 22) return fullName;
  return fullName.slice(0, 20) + '...';
}

// Recreos estándar UTN
export const RECREOS = [
  { start: '09:30', end: '09:40', label: 'Recreo' },
  { start: '11:10', end: '11:20', label: 'Recreo' },
  { start: '12:50', end: '13:15', label: 'Cambio de turno' },
  { start: '16:25', end: '16:35', label: 'Recreo' },
  { start: '18:05', end: '18:15', label: 'Recreo' },
  { start: '19:45', end: '19:55', label: 'Recreo' },
  { start: '21:25', end: '21:35', label: 'Recreo' },
];

export interface ScheduledItem {
  subjectId: number;
  subjectName: string;
  commission: Commission;
  slot: Slot;
  color: (typeof SUBJECT_PALETTES)[0];
  hasConflict: boolean;
  conflictDetails?: string;
  clashingSubjects?: string[];
}

interface ScheduleWeeklyGridProps {
  selections: Record<number, Commission>;
  onRemoveCommission: (subjectId: number) => void;
  hoveredCommission: { commission: Commission; subjectId: number; subjectName: string; hasConflict: boolean } | null;
  conflicts: ScheduleConflict[];
  subjectNamesMap: Map<number, string>;
  focusedConflictId?: string | null;
  onFocusSubject?: (subjectId: number) => void;
}

export const ScheduleWeeklyGrid: React.FC<ScheduleWeeklyGridProps> = ({
  selections,
  onRemoveCommission,
  hoveredCommission,
  conflicts,
  subjectNamesMap,
  focusedConflictId,
  onFocusSubject,
}) => {
  const [selectedMobileDay, setSelectedMobileDay] = useState<DayOfWeek>('LUN');
  const [mobileGridMode, setMobileGridMode] = useState<'day' | 'week'>('day');
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [activePopover, setActivePopover] = useState<ScheduledItem | null>(null);

  // Resize listener to adapt layout dynamically between mobile & desktop
  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Detect current day of week to highlight column
  const todayDay: DayOfWeek | null = useMemo(() => {
    const dayNum = new Date().getDay(); // 0=DOM, 1=LUN, 2=MAR, 3=MIE, 4=JUE, 5=VIE, 6=SAB
    const mapping: Record<number, DayOfWeek> = {
      1: 'LUN',
      2: 'MAR',
      3: 'MIE',
      4: 'JUE',
      5: 'VIE',
      6: 'SAB',
    };
    return mapping[dayNum] || null;
  }, []);

  // Initialize selectedMobileDay with today if valid weekday
  useEffect(() => {
    if (todayDay) {
      setSelectedMobileDay(todayDay);
    }
  }, [todayDay]);

  // Compute start/end time bounds dynamically based on active commissions + 1h margin
  const { minMinute, maxMinute, hoursRange } = useMemo(() => {
    const allComms = Object.values(selections);
    if (hoveredCommission) {
      allComms.push(hoveredCommission.commission);
    }

    let minSlotMin = Infinity;
    let maxSlotMin = -Infinity;

    allComms.forEach((comm) => {
      comm.slots.forEach((s) => {
        const start = timeToMinutes(s.start);
        const end = timeToMinutes(s.end);
        if (start < minSlotMin) minSlotMin = start;
        if (end > maxSlotMin) maxSlotMin = end;
      });
    });

    // If no slots exist, default to 08:00 to 22:00
    if (minSlotMin === Infinity || maxSlotMin === -Infinity) {
      minSlotMin = 8 * 60;
      maxSlotMin = 22 * 60;
    }

    // Add 1 hour margin (clamped between 07:00 and 23:00)
    const startHour = Math.max(7, Math.floor(minSlotMin / 60) - 1);
    const endHour = Math.min(23, Math.ceil(maxSlotMin / 60) + 1);

    const min = startHour * 60;
    const max = endHour * 60;

    const hours: number[] = [];
    for (let h = startHour; h <= endHour; h++) {
      hours.push(h);
    }

    return { minMinute: min, maxMinute: max, hoursRange: hours };
  }, [selections, hoveredCommission]);

  const totalMinutes = maxMinute - minMinute;
  const HOUR_HEIGHT = 64; // px per hour for generous readability
  const totalGridHeight = (hoursRange.length - 1) * HOUR_HEIGHT;

  // Flatten selected slots into printable items
  const scheduledItems = useMemo(() => {
    const list: ScheduledItem[] = [];

    Object.entries(selections).forEach(([subjIdStr, comm]) => {
      const subjectId = Number(subjIdStr);
      const subjectName = subjectNamesMap.get(subjectId) || `Materia #${subjectId}`;
      const color = getSubjectColor(subjectId);

      comm.slots.forEach((slot) => {
        const clashing = conflicts.filter(
          (c) =>
            (c.subjectId1 === subjectId && c.commissionId1 === comm.id && c.slot1 === slot) ||
            (c.subjectId2 === subjectId && c.commissionId2 === comm.id && c.slot2 === slot)
        );

        let conflictDetails: string | undefined;
        let clashingSubjects: string[] | undefined;
        if (clashing.length > 0) {
          clashingSubjects = clashing.map((c) =>
            c.subjectId1 === subjectId
              ? `${c.subjectName2} (${c.commissionCode2})`
              : `${c.subjectName1} (${c.commissionCode1})`
          );
          conflictDetails = `Choca con: ${clashingSubjects.join(', ')}`;
        }

        list.push({
          subjectId,
          subjectName,
          commission: comm,
          slot,
          color,
          hasConflict: clashing.length > 0,
          conflictDetails,
          clashingSubjects,
        });
      });
    });

    return list;
  }, [selections, conflicts, subjectNamesMap]);

  // Unique list of selected subjects for the bottom color legend
  const legendSubjects = useMemo(() => {
    return Object.entries(selections).map(([sIdStr, comm]) => {
      const sId = Number(sIdStr);
      const name = subjectNamesMap.get(sId) || `Materia #${sId}`;
      const color = getSubjectColor(sId);
      const short = getSubjectShortName(sId, name);
      return { subjectId: sId, name, short, commission: comm, color };
    });
  }, [selections, subjectNamesMap]);

  // Swipe gesture for mobile view
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(diff) > 50) {
      const currentIdx = DAYS_ORDER.indexOf(selectedMobileDay);
      if (diff < 0 && currentIdx < DAYS_ORDER.length - 1) {
        // Swipe left -> next day
        setSelectedMobileDay(DAYS_ORDER[currentIdx + 1]);
      } else if (diff > 0 && currentIdx > 0) {
        // Swipe right -> prev day
        setSelectedMobileDay(DAYS_ORDER[currentIdx - 1]);
      }
    }
    touchStartX.current = null;
  };

  const isSingleDayMode = !isDesktop && mobileGridMode === 'day';
  const activeDays = isSingleDayMode ? [selectedMobileDay] : DAYS_ORDER;
  const gridColsClass = isSingleDayMode ? 'grid-cols-[48px_1fr]' : 'grid-cols-[55px_repeat(6,1fr)]';
  const containerWidthClass = isSingleDayMode ? 'w-full lg:min-w-0' : 'min-w-[640px] lg:min-w-0';

  return (
    <div className="flex-1 flex flex-col bg-slate-900/60 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-md min-h-0 relative">
      {/* Mobile Day Selector & View Mode Switcher */}
      <div className="lg:hidden flex items-center justify-between p-2 bg-slate-950/90 border-b border-slate-800 gap-1 shrink-0">
        <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
          <button
            onClick={() => {
              const idx = DAYS_ORDER.indexOf(selectedMobileDay);
              if (idx > 0) setSelectedMobileDay(DAYS_ORDER[idx - 1]);
            }}
            disabled={DAYS_ORDER.indexOf(selectedMobileDay) === 0}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-20 shrink-0"
            title="Día anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1 overflow-x-auto py-0.5 no-scrollbar flex-1">
            {DAYS_ORDER.map((d) => {
              const count = scheduledItems.filter((i) => i.slot.day === d).length;
              const isActive = selectedMobileDay === d;
              const isToday = todayDay === d;
              return (
                <button
                  key={d}
                  onClick={() => {
                    setSelectedMobileDay(d);
                    setMobileGridMode('day');
                  }}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 shrink-0 active:scale-95 ${
                    isActive && mobileGridMode === 'day'
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  <span>{d}</span>
                  {isToday && (
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  )}
                  {count > 0 && (
                    <span
                      className={`text-[9px] px-1 rounded-full font-mono font-bold ${
                        isActive && mobileGridMode === 'day' ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => {
              const idx = DAYS_ORDER.indexOf(selectedMobileDay);
              if (idx < DAYS_ORDER.length - 1) setSelectedMobileDay(DAYS_ORDER[idx + 1]);
            }}
            disabled={DAYS_ORDER.indexOf(selectedMobileDay) === DAYS_ORDER.length - 1}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white disabled:opacity-20 shrink-0"
            title="Día siguiente"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Day / Week View Mode Toggle on Mobile */}
        <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-[10px] font-bold shrink-0">
          <button
            onClick={() => setMobileGridMode('day')}
            className={`px-2 py-1 rounded-md transition-all ${
              mobileGridMode === 'day'
                ? 'bg-indigo-600 text-white shadow-sm font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Día
          </button>
          <button
            onClick={() => setMobileGridMode('week')}
            className={`px-2 py-1 rounded-md transition-all ${
              mobileGridMode === 'week'
                ? 'bg-indigo-600 text-white shadow-sm font-black'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Semana
          </button>
        </div>
      </div>

      {/* Main Grid Canvas Wrapper with Independent Internal Vertical & Horizontal Scroll */}
      <div
        className="flex-1 overflow-auto relative p-2 sm:p-4 min-h-0 select-none"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className={`${containerWidthClass} flex flex-col`} style={{ height: `${totalGridHeight + 50}px` }}>
          {/* Day Headers: Sticky at top */}
          <div className={`grid ${gridColsClass} border-b border-slate-800 pb-2 mb-2 sticky top-0 bg-[#090d16] z-20`}>
            <div className="text-[11px] font-mono text-slate-500 flex items-center justify-center">
              <Clock className="w-3.5 h-3.5" />
            </div>
            {isSingleDayMode ? (
              <div className="flex items-center justify-between py-1 px-3 rounded-xl bg-slate-900/90 border border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-white">{DAY_LABELS[selectedMobileDay]}</span>
                  {todayDay === selectedMobileDay && (
                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-500/30 text-indigo-300 uppercase tracking-wider">
                      Hoy
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-indigo-300 font-mono font-bold">
                  {scheduledItems.filter((i) => i.slot.day === selectedMobileDay).length > 0
                    ? `${scheduledItems.filter((i) => i.slot.day === selectedMobileDay).length} ${
                        scheduledItems.filter((i) => i.slot.day === selectedMobileDay).length === 1 ? 'clase' : 'clases'
                      }`
                    : 'Día libre'}
                </span>
              </div>
            ) : (
              DAYS_ORDER.map((day) => {
                const dayItems = scheduledItems.filter((i) => i.slot.day === day);
                const isToday = todayDay === day;
                const isMobileActive = selectedMobileDay === day;

                return (
                  <div
                    key={day}
                    className={`text-center py-1 px-1 rounded-xl transition-colors relative ${
                      isToday
                        ? 'bg-indigo-500/15 border-b-2 border-indigo-400 text-indigo-300 font-bold'
                        : isMobileActive
                        ? 'bg-slate-800/60 text-slate-200'
                        : 'text-slate-400'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-xs font-bold block">{DAY_LABELS[day]}</span>
                      {isToday && (
                        <span className="text-[9px] font-bold px-1 py-0.1 rounded bg-indigo-500/30 text-indigo-300 uppercase tracking-wider">
                          Hoy
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono block">
                      {dayItems.length > 0
                        ? `${dayItems.length} clase${dayItems.length > 1 ? 's' : ''}`
                        : 'Libre'}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Time Slots & Columns Container */}
          <div className={`relative flex-1 grid ${gridColsClass}`}>
            {/* Time labels axis (Sticky on left) */}
            <div className="relative border-r border-slate-800/80 pr-2 sticky left-0 z-10 bg-[#090d16]/95">
              {hoursRange.map((hour, hIdx) => {
                const minute = hour * 60;
                const topPct = ((minute - minMinute) / totalMinutes) * 100;
                if (topPct < 0 || topPct > 100) return null;

                return (
                  <React.Fragment key={hour}>
                    {/* Hour Label */}
                    <div
                      style={{ top: `${topPct}%` }}
                      className="absolute right-2 -translate-y-1/2 text-[10px] font-mono text-slate-400 whitespace-nowrap font-medium"
                    >
                      {String(hour).padStart(2, '0')}:00
                    </div>

                    {/* Half Hour Marker */}
                    {hIdx < hoursRange.length - 1 && (
                      <div
                        style={{ top: `${((minute + 30 - minMinute) / totalMinutes) * 100}%` }}
                        className="absolute right-1 -translate-y-1/2 text-[9px] font-mono text-slate-600 select-none"
                      >
                        :30
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Active Day Columns */}
            {activeDays.map((day, dayIndex) => {
              const dayScheduled = scheduledItems.filter((item) => item.slot.day === day);
              const isHoveredDay = hoveredCommission?.commission.slots.some((s) => s.day === day);
              const isToday = todayDay === day;

              return (
                <div
                  key={day}
                  className={`relative border-r border-slate-800/40 last:border-r-0 ${
                    isToday
                      ? 'bg-indigo-500/[0.04]'
                      : dayIndex % 2 === 0
                      ? 'bg-slate-950/20'
                      : 'bg-transparent'
                  }`}
                >
                  {/* Empty day free state in single day mode */}
                  {dayScheduled.length === 0 && isSingleDayMode && (
                    <div className="absolute inset-x-4 top-1/3 -translate-y-1/2 p-6 rounded-2xl bg-slate-950/80 border border-slate-800 text-center space-y-2 backdrop-blur-md shadow-2xl pointer-events-none z-10">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mx-auto flex items-center justify-center">
                        <Calendar className="w-6 h-6" />
                      </div>
                      <h4 className="text-sm font-bold text-white">¡Día libre!</h4>
                      <p className="text-xs text-slate-400">
                        No tenés materias programadas para los {DAY_LABELS[day].toLowerCase()}s.
                      </p>
                    </div>
                  )}
                  {/* Horizontal Hour Lines & 30-min Sublines */}
                  {hoursRange.map((hour, hIdx) => {
                    const minute = hour * 60;
                    const topPct = ((minute - minMinute) / totalMinutes) * 100;
                    const halfPct = ((minute + 30 - minMinute) / totalMinutes) * 100;

                    return (
                      <React.Fragment key={hour}>
                        {/* 1 Hour Solid Line */}
                        <div
                          style={{ top: `${topPct}%` }}
                          className="absolute inset-x-0 border-t border-slate-800/70 pointer-events-none"
                        />
                        {/* 30 Min Dashed Subtle Line */}
                        {hIdx < hoursRange.length - 1 && halfPct <= 100 && (
                          <div
                            style={{ top: `${halfPct}%` }}
                            className="absolute inset-x-0 border-t border-dashed border-slate-800/30 pointer-events-none"
                          />
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* Sombras suaves para los recreos de clase */}
                  {RECREOS.map((rec, rIdx) => {
                    const rStart = timeToMinutes(rec.start);
                    const rEnd = timeToMinutes(rec.end);
                    if (rEnd <= minMinute || rStart >= maxMinute) return null;

                    const clampedStart = Math.max(rStart, minMinute);
                    const clampedEnd = Math.min(rEnd, maxMinute);
                    const topPct = ((clampedStart - minMinute) / totalMinutes) * 100;
                    const heightPct = ((clampedEnd - clampedStart) / totalMinutes) * 100;

                    return (
                      <div
                        key={rIdx}
                        style={{
                          top: `${topPct}%`,
                          height: `${Math.max(1.2, heightPct)}%`,
                        }}
                        className="absolute inset-x-0 bg-slate-800/20 border-y border-dashed border-slate-700/30 pointer-events-none flex items-center justify-center overflow-hidden"
                        title={rec.label}
                      >
                        <span className="text-[8px] font-mono text-slate-600 uppercase tracking-widest opacity-60">
                          {rec.label}
                        </span>
                      </div>
                    );
                  })}

                  {/* Render Scheduled Blocks */}
                  {dayScheduled.map((item, itemIdx) => {
                    const startMin = timeToMinutes(item.slot.start);
                    const endMin = timeToMinutes(item.slot.end);
                    const topPct = ((startMin - minMinute) / totalMinutes) * 100;
                    const heightPct = ((endMin - startMin) / totalMinutes) * 100;
                    const durationMinutes = endMin - startMin;
                    const isShortBlock = durationMinutes <= 50;

                    const shortName = getSubjectShortName(item.subjectId, item.subjectName);

                    const isFocused =
                      focusedConflictId &&
                      conflicts.some(
                        (c) =>
                          (c.commissionId1 === item.commission.id || c.commissionId2 === item.commission.id) &&
                          `${c.commissionId1}-${c.commissionId2}` === focusedConflictId
                      );

                    return (
                      <motion.div
                        key={`${item.subjectId}-${item.commission.id}-${item.slot.start}-${itemIdx}`}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.18 }}
                        onClick={() => setActivePopover(item)}
                        style={{
                          top: `${topPct}%`,
                          height: `${Math.max(3.8, heightPct)}%`,
                        }}
                        title={`${item.subjectName} — Comisión ${item.commission.code}\n${item.slot.day} ${item.slot.start} a ${item.slot.end}${item.slot.room ? ` • Aula ${item.slot.room}` : ''}${item.hasConflict ? `\n⚠️ ${item.conflictDetails}` : ''}`}
                        className={`absolute inset-x-1 rounded-xl p-2 flex flex-col justify-between border backdrop-blur-md shadow-lg transition-all group overflow-hidden cursor-pointer ${
                          item.hasConflict
                            ? 'border-rose-500 bg-rose-950/90 text-rose-200 shadow-[0_0_20px_rgba(244,63,94,0.35)]'
                            : `${item.color.bg} ${item.color.border} ${item.color.text} hover:brightness-110 shadow-sm`
                        } ${isFocused ? 'ring-2 ring-amber-400 animate-pulse' : ''}`}
                      >
                        {/* Animated Striped Pattern on Conflicts */}
                        {item.hasConflict && (
                          <div
                            className="absolute inset-0 pointer-events-none opacity-25 bg-[repeating-linear-gradient(45deg,#ef4444_0,#ef4444_8px,#b91c1c_8px,#b91c1c_16px)] animate-pulse"
                            aria-hidden="true"
                          />
                        )}

                        {/* Top: Short Subject Name & Commission Code */}
                        <div className="relative z-10 flex items-start justify-between gap-1 w-full">
                          <div className="min-w-0 flex-1">
                            <span className="font-extrabold text-xs sm:text-[11px] leading-tight block truncate text-white">
                              {isSingleDayMode ? item.subjectName : shortName}
                            </span>
                            {!isShortBlock && (
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded inline-block bg-black/40 border border-white/10 text-slate-200">
                                  {item.commission.code}
                                </span>
                                {isSingleDayMode && item.commission.turno && (
                                  <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                                    {item.commission.turno}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {isShortBlock && (
                              <span className="text-[9px] font-mono font-bold px-1 py-0.2 rounded bg-black/50 border border-white/10">
                                {item.commission.code}
                              </span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveCommission(item.subjectId);
                              }}
                              className="opacity-90 sm:opacity-0 sm:group-hover:opacity-100 p-1 rounded-lg bg-black/60 hover:bg-rose-500/60 text-slate-300 hover:text-white transition-opacity active:scale-95"
                              title="Quitar comisión"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Conflict Indicator Tag */}
                        {item.hasConflict && (
                          <div className="relative z-10 my-0.5 p-1 rounded bg-rose-900/80 border border-rose-500/50 text-[10px] text-rose-200 flex items-center gap-1 font-semibold truncate shadow-sm">
                            <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                            <span className="truncate">{item.conflictDetails || '¡Superposición!'}</span>
                          </div>
                        )}

                        {/* Bottom: Time, Room & Mode */}
                        <div className="relative z-10 flex items-center justify-between text-[10px] font-mono text-slate-300 pt-0.5 border-t border-white/10 w-full">
                          <span className="font-bold whitespace-nowrap">
                            {item.slot.start} - {item.slot.end}
                          </span>

                          <div className="flex items-center gap-1 shrink-0">
                            {item.slot.room && (
                              <span
                                className="flex items-center gap-0.5 text-slate-300"
                                title={`Aula: ${item.slot.room}`}
                              >
                                <MapPin className="w-2.5 h-2.5" />
                                <span>{isSingleDayMode ? `Aula ${item.slot.room}` : item.slot.room}</span>
                              </span>
                            )}
                            {item.slot.mode === 'virtual' && (
                              <span className="text-cyan-300" title="Clase Virtual">
                                <Laptop className="w-2.5 h-2.5" />
                              </span>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}

                  {/* Render Hover Preview "Phantom / Ghost" Blocks */}
                  {isHoveredDay && hoveredCommission && (
                    <AnimatePresence>
                      {hoveredCommission.commission.slots
                        .filter((s) => s.day === day)
                        .map((slot, hIdx) => {
                          const startMin = timeToMinutes(slot.start);
                          const endMin = timeToMinutes(slot.end);
                          const topPct = ((startMin - minMinute) / totalMinutes) * 100;
                          const heightPct = ((endMin - startMin) / totalMinutes) * 100;
                          const shortName = getSubjectShortName(
                            hoveredCommission.subjectId,
                            hoveredCommission.subjectName
                          );

                          return (
                            <motion.div
                              key={`ghost-${hoveredCommission.commission.id}-${hIdx}`}
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 0.9, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.15 }}
                              style={{
                                top: `${topPct}%`,
                                height: `${Math.max(3.8, heightPct)}%`,
                              }}
                              className={`absolute inset-x-1.5 rounded-xl p-2 border-2 border-dashed z-30 pointer-events-none flex flex-col justify-between backdrop-blur-md shadow-2xl ${
                                hoveredCommission.hasConflict
                                  ? 'border-rose-400 bg-rose-950/80 text-rose-200'
                                  : 'border-cyan-400 bg-cyan-950/80 text-cyan-200'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1 w-full">
                                <span className="font-extrabold text-[11px] truncate block text-white">
                                  {shortName} ({hoveredCommission.commission.code})
                                </span>
                                {hoveredCommission.hasConflict ? (
                                  <span className="text-[10px] font-bold text-rose-300 flex items-center gap-0.5 shrink-0 bg-rose-500/20 px-1 rounded">
                                    <AlertTriangle className="w-3 h-3 text-rose-400" />
                                    <span>Choca</span>
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold text-cyan-300 flex items-center gap-0.5 shrink-0 bg-cyan-500/20 px-1 rounded">
                                    <Sparkles className="w-3 h-3" />
                                    <span>Vista previa</span>
                                  </span>
                                )}
                              </div>

                              <div className="text-[10px] font-mono font-bold flex items-center justify-between pt-0.5 border-t border-cyan-400/20">
                                <span>{slot.start} - {slot.end}</span>
                                <span>{slot.room || ''}</span>
                              </div>
                            </motion.div>
                          );
                        })}
                    </AnimatePresence>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Color Legend & Active Subjects Toolbar underneath the Grid */}
      {legendSubjects.length > 0 && (
        <div className="p-2 sm:p-2.5 border-t border-slate-800 bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto text-xs py-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
              Materias elegidas ({legendSubjects.length}):
            </span>
            {legendSubjects.map((sub) => (
              <div
                key={sub.subjectId}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] shrink-0 hover:border-slate-700 transition-colors"
              >
                <span className={`w-2 h-2 rounded-full ${sub.color.dot} shrink-0`} />
                <span className="font-bold text-white truncate max-w-[140px]" title={sub.name}>
                  {sub.short}
                </span>
                <span className="font-mono text-slate-400 text-[10px]">
                  ({sub.commission.code})
                </span>
                <button
                  onClick={() => onRemoveCommission(sub.subjectId)}
                  className="p-0.5 hover:text-rose-400 text-slate-500 rounded"
                  title={`Quitar ${sub.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Popover / Detail Card upon Clicking a Scheduled Class Block */}
      <AnimatePresence>
        {activePopover && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 10 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl p-4 sm:p-5 space-y-4"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${activePopover.color.dot}`} />
                    <h3 className="text-base font-extrabold text-white leading-tight">
                      {activePopover.subjectName}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                    <span className="font-mono font-bold text-indigo-400">
                      Comisión {activePopover.commission.code}
                    </span>
                    {activePopover.commission.turno && (
                      <>
                        <span>•</span>
                        <span className="capitalize font-semibold">{activePopover.commission.turno}</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => setActivePopover(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Professors */}
              {activePopover.commission.professors.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Equipo Docente:</span>
                  </span>
                  <p className="text-xs text-slate-200 pl-5">
                    {activePopover.commission.professors.join(', ')}
                  </p>
                </div>
              )}

              {/* All Slots for this Commission */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Días y horarios de la comisión:</span>
                </span>
                <div className="space-y-1 pl-1">
                  {activePopover.commission.slots.map((s, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border font-mono ${
                        s.day === activePopover.slot.day && s.start === activePopover.slot.start
                          ? 'bg-indigo-600/20 border-indigo-400/50 text-indigo-200'
                          : 'bg-slate-950/50 border-slate-800 text-slate-300'
                      }`}
                    >
                      <span className="font-bold">{s.day}</span>
                      <span>{s.start} - {s.end}</span>
                      <span className="text-slate-400 flex items-center gap-1">
                        {s.room && <span>Aula: {s.room}</span>}
                        {s.mode === 'virtual' && <span className="text-cyan-300 font-semibold">[Virtual]</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Conflict Alert in Popover */}
              {activePopover.hasConflict && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-rose-300">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    <span>¡Superposición horaria detectada!</span>
                  </div>
                  <p className="text-[11px] text-rose-300/90 pl-5">
                    {activePopover.conflictDetails}
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  onClick={() => {
                    onRemoveCommission(activePopover.subjectId);
                    setActivePopover(null);
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 border border-rose-500/20 transition-all"
                >
                  Quitar comisión
                </button>

                <button
                  onClick={() => {
                    if (onFocusSubject) {
                      onFocusSubject(activePopover.subjectId);
                    }
                    setActivePopover(null);
                  }}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Cambiar comisión</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
