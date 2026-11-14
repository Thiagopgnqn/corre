export type SubjectStatus =
  | 'bloqueada'
  | 'disponible'
  | 'cursando'
  | 'regularizada'
  | 'aprobada'
  | 'promocionada'
  | 'libre';

export type Modality = 'A' | '1C' | '2C' | '1C-CC' | '2C-CC' | '1C/2C';

export interface Subject {
  id: number;
  code: string;
  shortName?: string;
  uuid?: string;
  name: string;
  level: number; // 1, 2, 3, 4, 5 (Nivel sugerido por plan)
  assignedYear?: number; // Año asignado por el usuario (1 a 5)
  modality: Modality;
  contraCuatrimestral?: boolean;
  weeklyHours: number;
  regularPrereqs: number[]; // IDs de materias requeridas >= regularizada
  approvedPrereqs: number[]; // IDs de materias requeridas >= aprobada
  isElective?: boolean;
  kind?: 'obligatoria' | 'electiva';
  credits?: number;
  isOptionalTrack?: boolean;
  trackKey?: string;
  specialRule?: string; // Reglas especiales
  isIntegrator?: boolean;
}

export interface PlanPpsRequirement {
  referenceSubjectCode: number;
  label?: string;
  description?: string;
}

export interface PlanIntermediateDegree {
  key: string;
  name: string;
  shortLabel?: string;
  shortTitle?: string;
  requiredElectiveCredits?: number;
  specialRuleSubjectCode?: number;
}

export interface PlanConfig {
  requiredElectiveCredits: number;
  defaultMinPassingGrade: number;
  electiveSlotsEquivalent: number;
  totalLevels: number;
  levelLabel: string;
  shortTag: string;
  finalDegreeTitle?: string;
  intermediateDegrees: PlanIntermediateDegree[];
  ppsRequirement: PlanPpsRequirement | null;
  [key: string]: unknown;
}

export interface PlanSpecialRule {
  id: string;
  subjectCode?: number;
  ruleType: string;
  params: Record<string, unknown>;
  description: string;
}

export interface PlanCareerMeta {
  id: string;
  name: string;
  code: string;
  facultyId: string;
  facultyCode?: string;
  facultyName?: string;
  institutionCode?: string;
  institutionName?: string;
}

export interface ActivePlanCatalog {
  plan: {
    id: string;
    name: string;
    year: number;
    config: PlanConfig;
    updatedAt?: string;
  };
  career: PlanCareerMeta;
  subjects: Subject[];
  rules: PlanSpecialRule[];
  acronyms: Record<string, number>;
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
  averageGradeWithoutFails?: number;
  averageGradeWithFails?: number;
  totalFailsCount?: number;
  libreCount?: number;
  pendingFinalsCount: number;
  // Electivas globales (sin mínimos por nivel)
  totalElectiveCreditsApproved: number;
  totalElectiveCreditsTaking: number;
  totalElectiveCreditsRegularized: number;
  totalElectiveCreditsRequired: number;
  missingElectiveCreditsForDegree: number;
  missingCoreForDegree: number[];
  // Porcentajes de avance y desglose (suman 100%)
  percentageApproved: number;
  percentageTaking: number;
  percentageRegularized: number;
  percentagePending: number;
  totalEquivalentSlots: number;
  approvedEquivalentSlots: number;
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

export interface ExamAttempt {
  id: string;
  subjectCode: number;
  subjectId?: string;
  date: string;
  grade: number;
  isPassed: boolean;
  notes?: string;
  createdAt?: string;
}
