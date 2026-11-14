import type {
  AllowedPrereqType,
  AllowedSubjectKind,
  AllowedSubjectModality,
  SupportedSpecialRuleType,
} from './planImport.rules.js';

export interface ParsedPlanMetadata {
  name: string;
  year: number;
  levelLabel: string;
  totalLevels: number;
  requiredElectiveCredits: number;
  electiveSlotsEquivalent: number;
  defaultMinPassingGrade: number;
  finalDegreeTitle?: string;
  shortTag?: string;
  ppsRequirement: {
    referenceSubjectCode: number;
    label: string;
    description?: string;
  } | null;
  intermediateDegrees: Array<{
    key: string;
    name: string;
    shortLabel?: string;
    shortTitle?: string;
    requiredElectiveCredits?: number;
    specialRuleSubjectCode?: number;
  }>;
}

export interface ParsedSubjectRow {
  codeInPlan: number;
  displayCode: string;
  name: string;
  shortName: string;
  level: number;
  modality: AllowedSubjectModality;
  contraCuatrimestral: boolean;
  weeklyHours: number;
  kind: AllowedSubjectKind;
  credits: number | null;
  isIntegrator: boolean;
  isOptionalTrack: boolean;
  trackKey: string | null;
}

export interface ParsedPrerequisiteRow {
  subjectCode: number;
  requiresSubjectCode: number;
  type: AllowedPrereqType;
}

export interface ParsedSpecialRuleRow {
  subjectCode: number;
  ruleType: SupportedSpecialRuleType;
  params: Record<string, unknown>;
  description: string;
}

export interface ParsedAcronymRow {
  acronym: string;
  subjectCode: number;
}

export interface PlanImportIssue {
  sheet: string;
  row: number; // 1-based Excel row number (0 = file/workbook level)
  field?: string;
  message: string;
}

export interface ParsedPlanWorkbookData {
  plan: ParsedPlanMetadata;
  subjects: ParsedSubjectRow[];
  prerequisites: ParsedPrerequisiteRow[];
  specialRules: ParsedSpecialRuleRow[];
  acronyms: ParsedAcronymRow[];
}

export interface ParsePlanWorkbookResult {
  valid: boolean;
  errors: PlanImportIssue[];
  warnings: PlanImportIssue[];
  stats: {
    sheetCount: number;
    totalRowsProcessed: number;
    subjectsCount: number;
    coreSubjectsCount: number;
    electiveSubjectsCount: number;
    prerequisitesCount: number;
    specialRulesCount: number;
    acronymsCount: number;
    maxLevel: number;
  };
  data: ParsedPlanWorkbookData | null;
}
