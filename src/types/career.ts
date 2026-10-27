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
  level: number; // 1, 2, 3, 4, 5
  modality: Modality;
  weeklyHours: number;
  regularPrereqs: number[]; // IDs of subjects that must be >= regularizada
  approvedPrereqs: number[]; // IDs of subjects that must be >= aprobada
  isElective?: boolean;
  credits?: number;
  specialRule?: string; // Special notes like "Para rendirlo requiere todas de 1 a 23"
  isIntegrator?: boolean;
}

export interface UserSubjectState {
  status: SubjectStatus;
  grade?: number; // 1 - 10
  updatedAt?: string;
}

export type UserCareerState = Record<number | string, UserSubjectState>;

export interface ElectiveSlot {
  id: string;
  level: number;
  requiredCredits: number;
  selectedElectiveId?: string;
}

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
  electiveCreditsN3: number;
  electiveCreditsN4: number;
  electiveCreditsN5: number;
  totalElectiveCredits: number;
  isAnalistaEligible: boolean;
  isPPSEligible: boolean;
  isDegreeEligible: boolean;
}

export interface CriticalPathResult {
  chain: Subject[];
  length: number;
  estimatedTerms: number;
}
