export type SubjectStatus =
  | 'bloqueada'
  | 'disponible'
  | 'cursando'
  | 'regularizada'
  | 'aprobada'
  | 'promocionada';

export type Modality = 'A' | '1C' | '2C' | '1C-CC' | '2C-CC' | '1C/2C';

export interface Subject {
  id: number;
  code: string;
  name: string;
  level: number; // 1, 2, 3, 4, 5 (Nivel sugerido por plan)
  assignedYear?: number; // Año asignado por el usuario (1 a 5)
  modality: Modality;
  weeklyHours: number;
  regularPrereqs: number[]; // IDs de materias requeridas >= regularizada
  approvedPrereqs: number[]; // IDs de materias requeridas >= aprobada
  isElective?: boolean;
  credits?: number;
  specialRule?: string; // Reglas especiales
  isIntegrator?: boolean;
}

export interface UserSubjectState {
  status: SubjectStatus;
  grade?: number; // 1 - 10
  updatedAt?: string;
}

export type UserCareerState = Record<number | string, UserSubjectState>;

export type AssignedElectivesByYear = Record<number, number[]>;

export interface CareerProgress {
  totalSubjects: number;
  approvedCount: number;
  promotedCount: number;
  regularizedCount: number;
  takingCount: number;
  blockedCount: number;
  availableCount: number;
  totalWeeklyHours: number;
  approvedWeeklyHours: number;
  careerPercentageBySubjects: number;
  careerPercentageByHours: number;
  averageGrade: number;
  averageGradeWithPromotions: number;
  pendingFinalsCount: number;
  // Electivas globales (sin mínimos por nivel)
  totalElectiveCreditsApproved: number;
  totalElectiveCreditsTaking: number;
  totalElectiveCreditsRequired: number;
  missingElectiveCreditsForDegree: number;
  missingCoreForDegree: number[];
  // Títulos
  isAnalistaEligible: boolean;
  missingForAnalista?: {
    missingCoreIds: number[];
    seminarioApproved: boolean;
    electiveCredits: number;
  };
  isPPSEligible: boolean;
  isDegreeEligible: boolean;
}

export interface CriticalPathResult {
  chain: Subject[];
  length: number;
  estimatedTerms: number;
}
