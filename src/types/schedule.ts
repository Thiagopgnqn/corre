export type DayOfWeek = 'LUN' | 'MAR' | 'MIE' | 'JUE' | 'VIE' | 'SAB';

export type Shift = 'mañana' | 'tarde' | 'noche';

export type Slot = {
  day: DayOfWeek;
  start: string; // "HH:MM" 24 hs, ej. "08:00"
  end: string; // "HH:MM", ej. "10:15"
  room?: string; // aula, opcional
  mode?: 'presencial' | 'virtual'; // opcional
};

export type Commission = {
  id: string; // único global, ej. "6-1K1"
  code: string; // nombre de la comisión, ej. "1K1"
  turno?: Shift;
  professors: string[]; // uno o más profesores
  slots: Slot[]; // una comisión puede tener varios bloques en la semana
  notes?: string;
};

export type TermType = '1C' | '2C' | 'A';

export type SubjectSchedule = {
  subjectId: number | string; // mismo ID que la materia del plan (N°) o el ID de la electiva
  term: TermType; // cuatrimestre en que se dicta esa oferta
  commissions: Commission[];
};

export interface ScheduleConflict {
  subjectId1: number;
  subjectName1: string;
  commissionId1: string;
  commissionCode1: string;
  slot1: Slot;
  subjectId2: number;
  subjectName2: string;
  commissionId2: string;
  commissionCode2: string;
  slot2: Slot;
  day: DayOfWeek;
  overlapStart: string;
  overlapEnd: string;
}

export interface ConsecutiveWarning {
  subjectId1: number;
  subjectName1: string;
  commissionCode1: string;
  subjectId2: number;
  subjectName2: string;
  commissionCode2: string;
  day: DayOfWeek;
  time: string; // HH:MM
}

export interface ScheduleDraft {
  id: string;
  name: string; // ej. "Plan A", "Plan B"
  term: '1C' | '2C';
  // Map of subjectId (number) -> commissionId (string)
  selections: Record<number, string>;
  createdAt: number;
  updatedAt: number;
}

export interface CombinationCriteria {
  preferShift?: Shift | 'cualquiera';
  sortBy: 'fewer-days' | 'fewer-gaps' | 'preferred-shift';
  avoidDays?: DayOfWeek[];
  avoidTimeRange?: { start: string; end: string };
}

export interface SuggestedCombination {
  id: string;
  selections: Record<number, Commission>;
  conflictCount: number;
  conflicts: ScheduleConflict[];
  distinctDaysCount: number;
  totalGapMinutes: number;
  shiftCounts: Record<Shift, number>;
  earliestStart: string;
  latestEnd: string;
}

export interface ScheduleValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  schedulesCount: number;
  commissionsCount: number;
  validSchedules?: SubjectSchedule[];
}
