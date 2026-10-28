import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  X,
  MapPin,
  Laptop,
  Clock,
  Sparkles,
} from 'lucide-react';
import type { DayOfWeek, Commission, Slot, ScheduleConflict } from '../../types/schedule';
import {
  DAYS_ORDER,
  DAY_LABELS,
  timeToMinutes,
} from '../../utils/scheduleLogic';

export const SUBJECT_COLORS = [
  { bg: 'bg-indigo-950/80', border: 'border-indigo-400', glow: 'shadow-[0_0_15px_rgba(99,102,241,0.25)]', text: 'text-indigo-200', badge: 'bg-indigo-500/20 text-indigo-300' },
  { bg: 'bg-cyan-950/80', border: 'border-cyan-400', glow: 'shadow-[0_0_15px_rgba(6,182,212,0.25)]', text: 'text-cyan-200', badge: 'bg-cyan-500/20 text-cyan-300' },
  { bg: 'bg-emerald-950/80', border: 'border-emerald-400', glow: 'shadow-[0_0_15px_rgba(16,185,129,0.25)]', text: 'text-emerald-200', badge: 'bg-emerald-500/20 text-emerald-300' },
  { bg: 'bg-amber-950/80', border: 'border-amber-400', glow: 'shadow-[0_0_15px_rgba(245,158,11,0.25)]', text: 'text-amber-200', badge: 'bg-amber-500/20 text-amber-300' },
  { bg: 'bg-fuchsia-950/80', border: 'border-fuchsia-400', glow: 'shadow-[0_0_15px_rgba(217,70,239,0.25)]', text: 'text-fuchsia-200', badge: 'bg-fuchsia-500/20 text-fuchsia-300' },
  { bg: 'bg-sky-950/80', border: 'border-sky-400', glow: 'shadow-[0_0_15px_rgba(2,132,199,0.25)]', text: 'text-sky-200', badge: 'bg-sky-500/20 text-sky-300' },
  { bg: 'bg-teal-950/80', border: 'border-teal-400', glow: 'shadow-[0_0_15px_rgba(20,184,166,0.25)]', text: 'text-teal-200', badge: 'bg-teal-500/20 text-teal-300' },
  { bg: 'bg-rose-950/80', border: 'border-rose-400', glow: 'shadow-[0_0_15px_rgba(244,63,94,0.25)]', text: 'text-rose-200', badge: 'bg-rose-500/20 text-rose-300' },
  { bg: 'bg-purple-950/80', border: 'border-purple-400', glow: 'shadow-[0_0_15px_rgba(168,85,247,0.25)]', text: 'text-purple-200', badge: 'bg-purple-500/20 text-purple-300' },
];

export function getSubjectColor(subjectId: number) {
  const idx = Math.abs(subjectId) % SUBJECT_COLORS.length;
  return SUBJECT_COLORS[idx];
}

interface ScheduleWeeklyGridProps {
  selections: Record<number, Commission>;
  onRemoveCommission: (subjectId: number) => void;
  hoveredCommission: { commission: Commission; subjectId: number; subjectName: string; hasConflict: boolean } | null;
  conflicts: ScheduleConflict[];
  subjectNamesMap: Map<number, string>;
  focusedConflictId?: string | null;
}

export const ScheduleWeeklyGrid: React.FC<ScheduleWeeklyGridProps> = ({
  selections,
  onRemoveCommission,
  hoveredCommission,
  conflicts,
  subjectNamesMap,
  focusedConflictId,
}) => {
  const [selectedMobileDay, setSelectedMobileDay] = useState<DayOfWeek>('LUN');

  // Compute start/end time bounds for the timetable grid
  const { minMinute, maxMinute, hoursRange } = useMemo(() => {
    let min = 7 * 60 + 45; // 07:45 default
    let max = 22 * 60 + 30; // 22:30 default

    const allComms = Object.values(selections);
    if (hoveredCommission) {
      allComms.push(hoveredCommission.commission);
    }

    allComms.forEach((comm) => {
      comm.slots.forEach((s) => {
        const start = timeToMinutes(s.start);
        const end = timeToMinutes(s.end);
        if (start < min) min = Math.max(7 * 60, start - 15);
        if (end > max) max = Math.min(23 * 60 + 30, end + 15);
      });
    });

    const hours: number[] = [];
    const startHour = Math.floor(min / 60);
    const endHour = Math.ceil(max / 60);
    for (let h = startHour; h <= endHour; h++) {
      hours.push(h);
    }

    return { minMinute: min, maxMinute: max, hoursRange: hours };
  }, [selections, hoveredCommission]);

  const totalMinutes = maxMinute - minMinute;

  // Flatten selected slots into printable items
  const scheduledItems = useMemo(() => {
    const list: Array<{
      subjectId: number;
      subjectName: string;
      commission: Commission;
      slot: Slot;
      color: (typeof SUBJECT_COLORS)[0];
      hasConflict: boolean;
      conflictDetails?: string;
    }> = [];

    Object.entries(selections).forEach(([subjIdStr, comm]) => {
      const subjectId = Number(subjIdStr);
      const subjectName = subjectNamesMap.get(subjectId) || `Materia #${subjectId}`;
      const color = getSubjectColor(subjectId);

      comm.slots.forEach((slot) => {
        // Check if this slot conflicts with another selected slot
        const clashing = conflicts.filter(
          (c) =>
            (c.subjectId1 === subjectId && c.commissionId1 === comm.id && c.slot1 === slot) ||
            (c.subjectId2 === subjectId && c.commissionId2 === comm.id && c.slot2 === slot)
        );

        let conflictDetails: string | undefined;
        if (clashing.length > 0) {
          const names = clashing.map((c) =>
            c.subjectId1 === subjectId
              ? `${c.subjectName2} (${c.commissionCode2})`
              : `${c.subjectName1} (${c.commissionCode1})`
          );
          conflictDetails = `Choca con: ${names.join(', ')}`;
        }

        list.push({
          subjectId,
          subjectName,
          commission: comm,
          slot,
          color,
          hasConflict: clashing.length > 0,
          conflictDetails,
        });
      });
    });

    return list;
  }, [selections, conflicts, subjectNamesMap]);

  return (
    <div className="flex-1 flex flex-col bg-slate-900/40 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-md">
      {/* Mobile Day Selector Tabs */}
      <div className="lg:hidden flex items-center gap-1 p-2 bg-slate-950/80 border-b border-slate-800 overflow-x-auto">
        {DAYS_ORDER.map((d) => {
          const count = scheduledItems.filter((i) => i.slot.day === d).length;
          const isActive = selectedMobileDay === d;
          return (
            <button
              key={d}
              onClick={() => setSelectedMobileDay(d)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              <span>{d}</span>
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Grid Canvas Wrapper */}
      <div className="flex-1 overflow-auto relative min-h-[580px] p-2 sm:p-4">
        {/* Main Grid: Header row + columns */}
        <div className="min-w-[700px] lg:min-w-0 h-full flex flex-col">
          {/* Day Headers (Desktop: all days, Mobile: all in scroll view) */}
          <div className="grid grid-cols-[60px_repeat(6,1fr)] border-b border-slate-800 pb-2 mb-2 sticky top-0 bg-[#0b101b] z-20">
            <div className="text-[11px] font-mono text-slate-500 flex items-center justify-center">
              <Clock className="w-3.5 h-3.5" />
            </div>
            {DAYS_ORDER.map((day) => {
              const dayItems = scheduledItems.filter((i) => i.slot.day === day);
              const isMobileActive = selectedMobileDay === day;
              return (
                <div
                  key={day}
                  className={`text-center py-1 rounded-xl transition-colors ${
                    isMobileActive ? 'bg-indigo-500/10 text-indigo-300 font-bold' : 'text-slate-400'
                  }`}
                >
                  <span className="text-xs font-bold block">{DAY_LABELS[day]}</span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {dayItems.length > 0 ? `${dayItems.length} clase${dayItems.length > 1 ? 's' : ''}` : 'Libre'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Time Slots Rows Container */}
          <div className="relative flex-1 grid grid-cols-[60px_repeat(6,1fr)] min-h-[520px]">
            {/* Time labels axis */}
            <div className="relative border-r border-slate-800/80 pr-2">
              {hoursRange.map((hour) => {
                const minute = hour * 60;
                const topPct = ((minute - minMinute) / totalMinutes) * 100;
                if (topPct < 0 || topPct > 100) return null;
                return (
                  <div
                    key={hour}
                    style={{ top: `${topPct}%` }}
                    className="absolute right-2 -translate-y-1/2 text-[10px] font-mono text-slate-400 select-none whitespace-nowrap"
                  >
                    {String(hour).padStart(2, '0')}:00
                  </div>
                );
              })}
            </div>

            {/* 6 Columns for LUN to SAB */}
            {DAYS_ORDER.map((day, dayIndex) => {
              const dayScheduled = scheduledItems.filter((item) => item.slot.day === day);
              const isHoveredDay = hoveredCommission?.commission.slots.some((s) => s.day === day);

              return (
                <div
                  key={day}
                  className={`relative border-r border-slate-800/40 last:border-r-0 ${
                    dayIndex % 2 === 0 ? 'bg-slate-950/20' : 'bg-transparent'
                  }`}
                >
                  {/* Horizontal hour guide lines */}
                  {hoursRange.map((hour) => {
                    const minute = hour * 60;
                    const topPct = ((minute - minMinute) / totalMinutes) * 100;
                    if (topPct < 0 || topPct > 100) return null;
                    return (
                      <div
                        key={hour}
                        style={{ top: `${topPct}%` }}
                        className="absolute inset-x-0 border-t border-slate-800/30 pointer-events-none"
                      />
                    );
                  })}

                  {/* Render Scheduled Blocks */}
                  {dayScheduled.map((item, itemIdx) => {
                    const startMin = timeToMinutes(item.slot.start);
                    const endMin = timeToMinutes(item.slot.end);
                    const topPct = ((startMin - minMinute) / totalMinutes) * 100;
                    const heightPct = ((endMin - startMin) / totalMinutes) * 100;

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
                        transition={{ duration: 0.2 }}
                        style={{
                          top: `${topPct}%`,
                          height: `${Math.max(4.5, heightPct)}%`,
                        }}
                        className={`absolute inset-x-1 rounded-xl p-2 sm:p-2.5 flex flex-col justify-between border backdrop-blur-md shadow-lg transition-all group overflow-hidden ${
                          item.hasConflict
                            ? 'border-rose-500 bg-rose-950/90 text-rose-200 shadow-[0_0_20px_rgba(244,63,94,0.4)]'
                            : `${item.color.bg} ${item.color.border} ${item.color.glow} ${item.color.text}`
                        } ${isFocused ? 'ring-2 ring-amber-400 animate-pulse' : ''}`}
                      >
                        {/* Animated Striped Pattern on Conflicts */}
                        {item.hasConflict && (
                          <div
                            className="absolute inset-0 pointer-events-none opacity-20 bg-[repeating-linear-gradient(45deg,#ef4444_0,#ef4444_10px,#b91c1c_10px,#b91c1c_20px)] animate-pulse"
                            aria-hidden="true"
                          />
                        )}

                        {/* Top: Subject Name & Commission Code + Remove Button */}
                        <div className="relative z-10 flex items-start justify-between gap-1">
                          <div className="min-w-0">
                            <span className="font-extrabold text-[11px] sm:text-xs leading-tight block truncate text-white">
                              {item.subjectName}
                            </span>
                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.2 rounded inline-block mt-0.5 bg-black/40 border border-white/10">
                              Com. {item.commission.code}
                            </span>
                          </div>

                          <button
                            onClick={() => onRemoveCommission(item.subjectId)}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded-lg bg-black/50 hover:bg-rose-500/40 text-slate-300 hover:text-white transition-opacity"
                            title="Quitar comisión"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Middle: Conflict indicator banner if clashing */}
                        {item.hasConflict && (
                          <div className="relative z-10 my-0.5 p-1 rounded bg-rose-900/60 border border-rose-500/40 text-[10px] text-rose-200 flex items-center gap-1 font-semibold truncate">
                            <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                            <span className="truncate">{item.conflictDetails || '¡Superposición de horario!'}</span>
                          </div>
                        )}

                        {/* Bottom: Time range, Room & Mode */}
                        <div className="relative z-10 flex items-center justify-between text-[10px] font-mono text-slate-300 pt-1 border-t border-white/10">
                          <span className="font-bold">
                            {item.slot.start} - {item.slot.end}
                          </span>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {item.slot.room && (
                              <span className="flex items-center gap-0.5 text-slate-400" title={`Aula: ${item.slot.room}`}>
                                <MapPin className="w-2.5 h-2.5" />
                                <span className="hidden sm:inline">{item.slot.room}</span>
                              </span>
                            )}
                            {item.slot.mode === 'virtual' && (
                              <span className="flex items-center gap-0.5 text-cyan-300" title="Clase Virtual">
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

                          return (
                            <motion.div
                              key={`ghost-${hoveredCommission.commission.id}-${hIdx}`}
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 0.85, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.15 }}
                              style={{
                                top: `${topPct}%`,
                                height: `${Math.max(4.5, heightPct)}%`,
                              }}
                              className={`absolute inset-x-1.5 rounded-xl p-2 border-2 border-dashed z-30 pointer-events-none flex flex-col justify-between backdrop-blur-md shadow-2xl ${
                                hoveredCommission.hasConflict
                                  ? 'border-rose-400 bg-rose-950/80 text-rose-200'
                                  : 'border-cyan-400 bg-cyan-950/80 text-cyan-200'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-black text-[11px] truncate block text-white">
                                  {hoveredCommission.subjectName} ({hoveredCommission.commission.code})
                                </span>
                                {hoveredCommission.hasConflict ? (
                                  <span className="text-[10px] font-bold text-rose-400 flex items-center gap-0.5">
                                    <AlertTriangle className="w-3 h-3" />
                                    <span>Choca</span>
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold text-cyan-300 flex items-center gap-0.5">
                                    <Sparkles className="w-3 h-3" />
                                    <span>Previsualización</span>
                                  </span>
                                )}
                              </div>

                              <div className="text-[10px] font-mono font-bold flex items-center justify-between">
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
    </div>
  );
};
