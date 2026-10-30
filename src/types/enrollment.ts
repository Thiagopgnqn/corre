import type { SubjectStatus } from './career';

export type EnrollmentSource = 'manual' | 'schedule_builder';
export type EnrollmentTerm = '1C' | '2C' | 'A';

export interface EnrollmentProfessorBrief {
  professorId: string;
  displayName: string;
}

export interface SubjectEnrollment {
  id: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  subjectShortName: string;
  subjectLevel: number;
  commissionId: string | null;
  commissionCode: string | null;
  turno: string | null;
  academicYear: number | null;
  term: EnrollmentTerm | null;
  source: EnrollmentSource;
  professors: EnrollmentProfessorBrief[];
  createdAt: string;
  updatedAt: string;
}

export interface CommissionSlotOption {
  day: number;
  dayLabel: string;
  startTime: string;
  endTime: string;
  room: string | null;
  mode: string | null;
}

export interface SubjectCommissionOption {
  id: string;
  code: string;
  turno: string;
  termOffer: '1C' | '2C' | 'A';
  scheduleTermId: string;
  academicYear: number;
  term: '1C' | '2C';
  periodLabel: string;
  isCurrent: boolean;
  slots: CommissionSlotOption[];
  professors: EnrollmentProfessorBrief[];
}

export interface SubjectProfessorOption {
  professorId: string;
  displayName: string;
  isCurrentTerm: boolean;
  isHistoricalLink: boolean;
  termLabels: string[];
}

export interface SubjectEnrollmentOptions {
  subject: {
    id: string;
    code: number;
    name: string;
    shortName: string;
    level: number;
  };
  commissions: SubjectCommissionOption[];
  professors: SubjectProfessorOption[];
}

export interface UpsertEnrollmentInput {
  enrollmentId?: string | null;
  commissionId?: string | null;
  commissionCode?: string | null;
  academicYear?: number | null;
  term?: EnrollmentTerm | null;
  professorIds?: string[];
  professorNames?: string[];
  source?: EnrollmentSource;
}

export interface PendingCommissionPrompt {
  subjectCode: number;
  subjectName: string;
  targetStatus: SubjectStatus;
  editingEnrollment?: SubjectEnrollment | null;
}

export interface PendingReviewPromptItem {
  professorId: string;
  professorName: string;
  subjectId: string;
  subjectCode: number;
  subjectName: string;
  academicYear: number | null;
  term: EnrollmentTerm | null;
}

