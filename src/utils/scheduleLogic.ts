import type {
  DayOfWeek,
  Slot,
  Commission,
  SubjectSchedule,
  ScheduleConflict,
  ConsecutiveWarning,
  CombinationCriteria,
  SuggestedCombination,
  ScheduleValidationResult,
  Shift,
} from '../types/schedule';

export const DAYS_ORDER: DayOfWeek[] = ['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  LUN: 'Lunes',
  MAR: 'Martes',
  MIE: 'Miércoles',
  JUE: 'Jueves',
  VIE: 'Viernes',
  SAB: 'Sábado',
};

/**
 * Converts "HH:MM" (24h) string to total minutes from midnight.
 */
export function timeToMinutes(time: string): number {
  if (!time || typeof time !== 'string') return 0;
  const parts = time.trim().split(':');
  if (parts.length < 2) return 0;
  const hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;
  return hours * 60 + minutes;
}

/**
 * Converts minutes from midnight to "HH:MM" formatted string.
 */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(Math.max(0, minutes) / 60);
  const m = Math.max(0, minutes) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Checks whether two time slots overlap or are consecutive on the same day.
 */
export function checkSlotsOverlap(
  slotA: Slot,
  slotB: Slot
): {
  overlaps: boolean;
  isConsecutive: boolean;
  overlapStart?: string;
  overlapEnd?: string;
  consecutiveTime?: string;
} {
  if (slotA.day !== slotB.day) {
    return { overlaps: false, isConsecutive: false };
  }

  const startA = timeToMinutes(slotA.start);
  const endA = timeToMinutes(slotA.end);
  const startB = timeToMinutes(slotB.start);
  const endB = timeToMinutes(slotB.end);

  // Strict interval overlap: start1 < end2 AND start2 < end1
  if (startA < endB && startB < endA) {
    const overlapStartMin = Math.max(startA, startB);
    const overlapEndMin = Math.min(endA, endB);
    return {
      overlaps: true,
      isConsecutive: false,
      overlapStart: minutesToTime(overlapStartMin),
      overlapEnd: minutesToTime(overlapEndMin),
    };
  }

  // Touching borders (consecutive without gap)
  if (endA === startB) {
    return {
      overlaps: false,
      isConsecutive: true,
      consecutiveTime: slotA.end,
    };
  }
  if (endB === startA) {
    return {
      overlaps: false,
      isConsecutive: true,
      consecutiveTime: slotB.end,
    };
  }

  return { overlaps: false, isConsecutive: false };
}

/**
 * Checks for conflicts between a candidate commission and currently selected commissions.
 */
export function getCommissionConflictsWithSelection(
  candidate: Commission,
  candidateSubjectId: number,
  candidateSubjectName: string,
  selections: Record<number, Commission>,
  subjectNamesMap?: Map<number, string>
): {
  conflicts: ScheduleConflict[];
  consecutive: ConsecutiveWarning[];
} {
  const conflicts: ScheduleConflict[] = [];
  const consecutive: ConsecutiveWarning[] = [];

  Object.entries(selections).forEach(([subjIdStr, selectedComm]) => {
    const selectedSubjId = Number(subjIdStr);
    // Ignore if it's the same subject (since selecting this candidate replaces the previous selection)
    if (selectedSubjId === candidateSubjectId) return;

    const selectedSubjName = subjectNamesMap?.get(selectedSubjId) || `Materia #${selectedSubjId}`;

    candidate.slots.forEach((cSlot) => {
      selectedComm.slots.forEach((sSlot) => {
        const check = checkSlotsOverlap(cSlot, sSlot);
        if (check.overlaps && check.overlapStart && check.overlapEnd) {
          conflicts.push({
            subjectId1: candidateSubjectId,
            subjectName1: candidateSubjectName,
            commissionId1: candidate.id,
            commissionCode1: candidate.code,
            slot1: cSlot,
            subjectId2: selectedSubjId,
            subjectName2: selectedSubjName,
            commissionId2: selectedComm.id,
            commissionCode2: selectedComm.code,
            slot2: sSlot,
            day: cSlot.day,
            overlapStart: check.overlapStart,
            overlapEnd: check.overlapEnd,
          });
        } else if (check.isConsecutive && check.consecutiveTime) {
          consecutive.push({
            subjectId1: candidateSubjectId,
            subjectName1: candidateSubjectName,
            commissionCode1: candidate.code,
            subjectId2: selectedSubjId,
            subjectName2: selectedSubjName,
            commissionCode2: selectedComm.code,
            day: cSlot.day,
            time: check.consecutiveTime,
          });
        }
      });
    });
  });

  return { conflicts, consecutive };
}

/**
 * Finds all pairwise conflicts across an entire selection map.
 */
export function detectAllConflicts(
  selections: Record<number, Commission>,
  subjectNamesMap?: Map<number, string>
): {
  conflicts: ScheduleConflict[];
  consecutiveWarnings: ConsecutiveWarning[];
} {
  const entries = Object.entries(selections);
  const conflicts: ScheduleConflict[] = [];
  const consecutiveWarnings: ConsecutiveWarning[] = [];

  for (let i = 0; i < entries.length; i++) {
    const [idAStr, commA] = entries[i];
    const idA = Number(idAStr);
    const nameA = subjectNamesMap?.get(idA) || `Materia #${idA}`;

    for (let j = i + 1; j < entries.length; j++) {
      const [idBStr, commB] = entries[j];
      const idB = Number(idBStr);
      const nameB = subjectNamesMap?.get(idB) || `Materia #${idB}`;

      commA.slots.forEach((slotA) => {
        commB.slots.forEach((slotB) => {
          const check = checkSlotsOverlap(slotA, slotB);
          if (check.overlaps && check.overlapStart && check.overlapEnd) {
            conflicts.push({
              subjectId1: idA,
              subjectName1: nameA,
              commissionId1: commA.id,
              commissionCode1: commA.code,
              slot1: slotA,
              subjectId2: idB,
              subjectName2: nameB,
              commissionId2: commB.id,
              commissionCode2: commB.code,
              slot2: slotB,
              day: slotA.day,
              overlapStart: check.overlapStart,
              overlapEnd: check.overlapEnd,
            });
          } else if (check.isConsecutive && check.consecutiveTime) {
            consecutiveWarnings.push({
              subjectId1: idA,
              subjectName1: nameA,
              commissionCode1: commA.code,
              subjectId2: idB,
              subjectName2: nameB,
              commissionCode2: commB.code,
              day: slotA.day,
              time: check.consecutiveTime,
            });
          }
        });
      });
    }
  }

  return { conflicts, consecutiveWarnings };
}

/**
 * Calculates total weekly hours from selected commissions.
 */
export function calculateTotalWeeklyHours(commissions: Commission[]): number {
  let totalMin = 0;
  commissions.forEach((c) => {
    c.slots.forEach((s) => {
      const start = timeToMinutes(s.start);
      const end = timeToMinutes(s.end);
      if (end > start) {
        totalMin += end - start;
      }
    });
  });
  return Number((totalMin / 60).toFixed(1));
}

/**
 * Returns distinct active days and earliest / latest class times.
 */
export function calculateScheduleSummary(commissions: Commission[]): {
  distinctDays: DayOfWeek[];
  freeDays: DayOfWeek[];
  earliestByDay: Partial<Record<DayOfWeek, string>>;
  latestByDay: Partial<Record<DayOfWeek, string>>;
  globalEarliest: string;
  globalLatest: string;
  totalHours: number;
} {
  const activeDaysSet = new Set<DayOfWeek>();
  const earliestByDay: Partial<Record<DayOfWeek, string>> = {};
  const latestByDay: Partial<Record<DayOfWeek, string>> = {};

  let minGlobal = 24 * 60;
  let maxGlobal = 0;

  commissions.forEach((c) => {
    c.slots.forEach((s) => {
      activeDaysSet.add(s.day);
      const start = timeToMinutes(s.start);
      const end = timeToMinutes(s.end);

      if (start < minGlobal) minGlobal = start;
      if (end > maxGlobal) maxGlobal = end;

      const prevEarliest = earliestByDay[s.day] ? timeToMinutes(earliestByDay[s.day]!) : 24 * 60;
      if (start < prevEarliest) earliestByDay[s.day] = s.start;

      const prevLatest = latestByDay[s.day] ? timeToMinutes(latestByDay[s.day]!) : 0;
      if (end > prevLatest) latestByDay[s.day] = s.end;
    });
  });

  const distinctDays = DAYS_ORDER.filter((d) => activeDaysSet.has(d));
  const freeDays = DAYS_ORDER.filter((d) => !activeDaysSet.has(d));

  return {
    distinctDays,
    freeDays,
    earliestByDay,
    latestByDay,
    globalEarliest: minGlobal < 24 * 60 ? minutesToTime(minGlobal) : '08:00',
    globalLatest: maxGlobal > 0 ? minutesToTime(maxGlobal) : '22:00',
    totalHours: calculateTotalWeeklyHours(commissions),
  };
}

/**
 * Calculates gap minutes between classes on the same day for a set of commissions.
 */
export function calculateGapMinutes(commissions: Commission[]): number {
  const slotsByDay: Record<DayOfWeek, Array<{ start: number; end: number }>> = {
    LUN: [],
    MAR: [],
    MIE: [],
    JUE: [],
    VIE: [],
    SAB: [],
  };

  commissions.forEach((c) => {
    c.slots.forEach((s) => {
      slotsByDay[s.day].push({
        start: timeToMinutes(s.start),
        end: timeToMinutes(s.end),
      });
    });
  });

  let totalGaps = 0;

  Object.values(slotsByDay).forEach((slots) => {
    if (slots.length <= 1) return;
    slots.sort((a, b) => a.start - b.start);
    for (let i = 0; i < slots.length - 1; i++) {
      const currentEnd = slots[i].end;
      const nextStart = slots[i + 1].start;
      if (nextStart > currentEnd) {
        totalGaps += nextStart - currentEnd;
      }
    }
  });

  return totalGaps;
}

/**
 * Strictly validates schedule data according to the schema.
 */
export function validateScheduleData(
  raw: unknown,
  validSubjectIds?: Set<number | string>
): ScheduleValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw || !Array.isArray(raw)) {
    return {
      valid: false,
      errors: ['El archivo de horarios debe contener un arreglo JSON en la raíz.'],
      warnings: [],
      schedulesCount: 0,
      commissionsCount: 0,
    };
  }

  const validDays = new Set<DayOfWeek>(['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB']);
  const validTerms = new Set(['1C', '2C', 'A']);
  const seenCommissionIds = new Set<string>();

  let schedulesCount = 0;
  let commissionsCount = 0;
  const validSchedules: SubjectSchedule[] = [];

  raw.forEach((item, itemIdx) => {
    if (!item || typeof item !== 'object') {
      errors.push(`Elemento #${itemIdx + 1} inválido: debe ser un objeto.`);
      return;
    }

    const { subjectId, term, commissions } = item as Record<string, unknown>;

    if (subjectId === undefined || subjectId === null) {
      errors.push(`Elemento #${itemIdx + 1} no tiene subjectId.`);
      return;
    }

    if (validSubjectIds && !validSubjectIds.has(Number(subjectId)) && !validSubjectIds.has(String(subjectId))) {
      warnings.push(`Materia ID ${subjectId} no figura en el plan de estudios cargado.`);
    }

    if (!term || !validTerms.has(String(term))) {
      errors.push(`Materia ID ${subjectId}: cuatrimestre "${term}" inválido (debe ser 1C, 2C o A).`);
      return;
    }

    if (!Array.isArray(commissions)) {
      errors.push(`Materia ID ${subjectId}: "commissions" debe ser una lista de comisiones.`);
      return;
    }

    const sanitizedCommissions: Commission[] = [];

    commissions.forEach((comm, commIdx) => {
      if (!comm || typeof comm !== 'object') {
        errors.push(`Materia ID ${subjectId}, comisión #${commIdx + 1} inválida.`);
        return;
      }

      const { id, code, turno, professors, slots, notes } = comm as Record<string, unknown>;

      if (!id || typeof id !== 'string') {
        errors.push(`Materia ID ${subjectId}, comisión #${commIdx + 1}: "id" requerido.`);
        return;
      }

      if (seenCommissionIds.has(id)) {
        errors.push(`ID de comisión duplicado: "${id}". Los IDs deben ser únicos globalmente.`);
        return;
      }
      seenCommissionIds.add(id);

      if (!code || typeof code !== 'string') {
        errors.push(`Comisión "${id}": "code" requerido.`);
        return;
      }

      if (!Array.isArray(slots) || slots.length === 0) {
        errors.push(`Comisión "${id}" (${code}): debe tener al menos un slot horario.`);
        return;
      }

      const sanitizedSlots: Slot[] = [];

      slots.forEach((s, sIdx) => {
        if (!s || typeof s !== 'object') {
          errors.push(`Comisión "${id}", slot #${sIdx + 1} inválido.`);
          return;
        }

        const { day, start, end, room, mode } = s as Record<string, unknown>;

        if (!day || !validDays.has(day as DayOfWeek)) {
          errors.push(`Comisión "${id}", slot #${sIdx + 1}: día "${day}" inválido.`);
          return;
        }

        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (!start || typeof start !== 'string' || !timeRegex.test(start)) {
          errors.push(`Comisión "${id}", slot #${sIdx + 1}: hora de inicio "${start}" inválida (formato HH:MM 24hs).`);
          return;
        }

        if (!end || typeof end !== 'string' || !timeRegex.test(end)) {
          errors.push(`Comisión "${id}", slot #${sIdx + 1}: hora de fin "${end}" inválida (formato HH:MM 24hs).`);
          return;
        }

        const startMin = timeToMinutes(start);
        const endMin = timeToMinutes(end);
        if (endMin <= startMin) {
          errors.push(`Comisión "${id}", slot #${sIdx + 1}: hora de fin (${end}) debe ser posterior al inicio (${start}).`);
          return;
        }

        sanitizedSlots.push({
          day: day as DayOfWeek,
          start,
          end,
          room: room ? String(room) : undefined,
          mode: mode === 'virtual' || mode === 'presencial' ? mode : undefined,
        });
      });

      sanitizedCommissions.push({
        id,
        code,
        turno: turno === 'mañana' || turno === 'tarde' || turno === 'noche' ? turno : undefined,
        professors: Array.isArray(professors) ? professors.map(String) : [],
        notes: notes ? String(notes) : undefined,
        slots: sanitizedSlots,
      });

      commissionsCount++;
    });

    validSchedules.push({
      subjectId: Number(subjectId) || String(subjectId),
      term: term as '1C' | '2C' | 'A',
      commissions: sanitizedCommissions,
    });

    schedulesCount++;
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    schedulesCount,
    commissionsCount,
    validSchedules: errors.length === 0 ? validSchedules : undefined,
  };
}

/**
 * Algorithmic generator for schedule combinations.
 * Generates conflict-free combinations; if none exist, returns combinations with minimal conflicts.
 */
export function generateScheduleCombinations(
  targetSubjectIds: number[],
  schedulesMap: Map<number, SubjectSchedule>,
  options: CombinationCriteria,
  subjectNamesMap?: Map<number, string>
): {
  hasConflictFree: boolean;
  combinations: SuggestedCombination[];
} {
  if (targetSubjectIds.length === 0) {
    return { hasConflictFree: true, combinations: [] };
  }

  // Filter commissions per subject
  const subjectOptions: Array<{ subjectId: number; commissions: Commission[] }> = [];

  for (const sId of targetSubjectIds) {
    const sched = schedulesMap.get(sId);
    if (!sched || sched.commissions.length === 0) {
      continue;
    }
    subjectOptions.push({
      subjectId: sId,
      commissions: sched.commissions,
    });
  }

  if (subjectOptions.length === 0) {
    return { hasConflictFree: true, combinations: [] };
  }

  const allCombinations: Array<Record<number, Commission>> = [];

  // Recursive backtracking to generate all assignments
  function backtrack(index: number, current: Record<number, Commission>) {
    if (index === subjectOptions.length) {
      allCombinations.push({ ...current });
      return;
    }

    const { subjectId, commissions } = subjectOptions[index];
    for (const comm of commissions) {
      current[subjectId] = comm;
      backtrack(index + 1, current);
    }
  }

  backtrack(0, {});

  // Analyze each combination
  const scoredCombos: SuggestedCombination[] = allCombinations.map((selections, idx) => {
    const commList = Object.values(selections);
    const { conflicts } = detectAllConflicts(selections, subjectNamesMap);
    const summary = calculateScheduleSummary(commList);
    const gapMinutes = calculateGapMinutes(commList);

    const shiftCounts: Record<Shift, number> = { mañana: 0, tarde: 0, noche: 0 };
    commList.forEach((c) => {
      if (c.turno) shiftCounts[c.turno]++;
    });

    return {
      id: `combo-${idx + 1}`,
      selections,
      conflictCount: conflicts.length,
      conflicts,
      distinctDaysCount: summary.distinctDays.length,
      totalGapMinutes: gapMinutes,
      shiftCounts,
      earliestStart: summary.globalEarliest,
      latestEnd: summary.globalLatest,
    };
  });

  const conflictFree = scoredCombos.filter((c) => c.conflictCount === 0);
  const pool = conflictFree.length > 0 ? conflictFree : scoredCombos;
  const hasConflictFree = conflictFree.length > 0;

  // Sorting based on criteria
  pool.sort((a, b) => {
    // 1. Primary: minimal conflicts first
    if (a.conflictCount !== b.conflictCount) {
      return a.conflictCount - b.conflictCount;
    }

    // 2. User chosen sort criterion
    if (options.sortBy === 'fewer-days') {
      if (a.distinctDaysCount !== b.distinctDaysCount) {
        return a.distinctDaysCount - b.distinctDaysCount;
      }
      return a.totalGapMinutes - b.totalGapMinutes;
    }

    if (options.sortBy === 'fewer-gaps') {
      if (a.totalGapMinutes !== b.totalGapMinutes) {
        return a.totalGapMinutes - b.totalGapMinutes;
      }
      return a.distinctDaysCount - b.distinctDaysCount;
    }

    if (options.sortBy === 'preferred-shift' && options.preferShift && options.preferShift !== 'cualquiera') {
      const shift = options.preferShift;
      const countA = a.shiftCounts[shift] || 0;
      const countB = b.shiftCounts[shift] || 0;
      if (countA !== countB) {
        return countB - countA; // more matching shifts first
      }
      return a.distinctDaysCount - b.distinctDaysCount;
    }

    return a.distinctDaysCount - b.distinctDaysCount;
  });

  return {
    hasConflictFree,
    combinations: pool.slice(0, 15), // Return top 15 suggestions
  };
}
